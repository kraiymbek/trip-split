import { describe, expect, it } from 'vitest'
import { lastUsed, quickTitles } from './quick'
import { computeNotices, snapshotSeen } from './notify'
import type { Expense, Settlement } from '../types'

const ex = (p: Partial<Expense> & { id: string }): Expense => ({
  trip_id: 't',
  paid_by: 'a',
  title: 'Ужин',
  note: null,
  amount: 100_00,
  currency: 'THB',
  rate: 1,
  amount_base: 100_00,
  method: 'card',
  bank: 'kaspi',
  split_mode: 'equal',
  spent_at: '2026-12-01T10:00:00Z',
  created_by: 'a',
  created_at: '2026-12-01T10:00:00Z',
  updated_at: '2026-12-01T10:00:00Z',
  updated_by: 'a',
  shares: [
    { user_id: 'a', share_base: 50_00 },
    { user_id: 'me', share_base: 50_00 },
  ],
  ...p,
})
const names = { a: { id: 'a', name: 'Дана', avatar_color: '#000' }, b: { id: 'b', name: 'Бек', avatar_color: '#000' } }

describe('быстрые кнопки', () => {
  it('сначала повторяющееся в поездке, потом типовые; без дублей по регистру', () => {
    const list = [
      ex({ id: '1', title: 'Массаж' }),
      ex({ id: '2', title: 'массаж ' }),
      ex({ id: '3', title: 'Ужин у Сомчая' }), // разовое — не кнопка
      ex({ id: '4', title: 'Tuk-tuk' }),
      ex({ id: '5', title: 'Tuk-tuk' }),
      ex({ id: '6', title: 'Tuk-tuk' }),
    ]
    const q = quickTitles(list, 6)
    expect(q.slice(0, 2)).toEqual(['Tuk-tuk', 'Массаж'])
    expect(q).toContain('Grab')
    expect(q.filter((x) => x.toLowerCase() === 'массаж')).toHaveLength(1)
    expect(q).not.toContain('Ужин у Сомчая')
    expect(q).toHaveLength(6)
  })

  it('пустая поездка — типовые Grab и 7-Eleven первыми', () => {
    expect(quickTitles([]).slice(0, 2)).toEqual(['Grab', '7-Eleven'])
  })

  it('lastUsed — валюта и оплата из моего последнего такого же расхода', () => {
    const list = [
      ex({ id: '1', title: '7-Eleven', paid_by: 'me', method: 'card', bank: 'kaspi', spent_at: '2026-12-01T00:00:00Z' }),
      ex({ id: '2', title: '7-eleven', paid_by: 'me', method: 'cash', bank: null, spent_at: '2026-12-03T00:00:00Z' }),
      ex({ id: '3', title: '7-Eleven', paid_by: 'a', currency: 'USD', spent_at: '2026-12-05T00:00:00Z' }),
    ]
    expect(lastUsed(list, '7-Eleven', 'me')).toEqual({ currency: 'THB', method: 'cash', bank: null })
    expect(lastUsed(list, 'Grab', 'me')).toBeNull()
  })
})

describe('уведомления', () => {
  const base = [ex({ id: 'old' })]
  const seen = snapshotSeen(base, [], 'me')

  it('при первом заходе всё текущее считается просмотренным', () => {
    expect(computeNotices(base, [], 'me', seen, names, 'THB')).toEqual([])
  })

  it('новый расход от другого, где я в доле → уведомление с моей долей', () => {
    const n = computeNotices([...base, ex({ id: 'new', title: 'Grab' })], [], 'me', seen, names, 'THB')
    expect(n).toHaveLength(1)
    expect(n[0]).toMatchObject({ kind: 'new', expenseId: 'new', title: 'Дана · новый расход' })
    expect(n[0].body).toContain('«Grab»')
    expect(n[0].body).toContain('твоя доля')
  })

  it('расходы без меня и мои собственные — не уведомляют', () => {
    const other = ex({ id: 'x', shares: [{ user_id: 'a', share_base: 100_00 }] })
    const mine = ex({ id: 'y', created_by: 'me', updated_by: 'me', paid_by: 'me' })
    expect(computeNotices([...base, other, mine], [], 'me', seen, names, 'THB')).toEqual([])
  })

  it('чужая правка видимого расхода → «изменён»; моя правка — нет', () => {
    const edited = ex({ id: 'old', updated_at: '2026-12-02T00:00:00Z', updated_by: 'b' })
    const n = computeNotices([edited], [], 'me', seen, names, 'THB')
    expect(n[0]).toMatchObject({ kind: 'edit', title: 'Бек · изменён расход' })
    const mine = ex({ id: 'old', updated_at: '2026-12-02T00:00:00Z', updated_by: 'me' })
    expect(computeNotices([mine], [], 'me', seen, names, 'THB')).toEqual([])
  })

  it('мой расход поправил другой — это правка, а не новый', () => {
    const s = snapshotSeen([], [], 'me')
    const e = ex({ id: 'z', created_by: 'me', paid_by: 'me', updated_by: 'a', updated_at: '2026-12-02T00:00:00Z' })
    const n = computeNotices([e], [], 'me', s, names, 'THB')
    expect(n[0]).toMatchObject({ kind: 'edit' })
    expect(n[0].body).toContain('платил: ты')
  })

  it('возврат долга мне, отмеченный другим → уведомление; после «прочитано» — пусто', () => {
    const st: Settlement = {
      id: 's1', trip_id: 't', from_user: 'b', to_user: 'me', amount_base: 4021_97,
      method: 'cash', bank: null, created_at: '2026-12-03T00:00:00Z', created_by: 'b',
    }
    const n = computeNotices(base, [st], 'me', seen, names, 'THB')
    expect(n[0]).toMatchObject({ kind: 'settle', title: 'Бек · отмечен возврат долга' })
    expect(n[0].body).toMatch(/^Бек → тебе: /)
    const after = snapshotSeen(base, [st], 'me', seen)
    expect(computeNotices(base, [st], 'me', after, names, 'THB')).toEqual([])
  })

  it('неотправленные (⏳) записи не уведомляют', () => {
    const p = ex({ id: 'p', pending: true })
    expect(computeNotices([...base, p], [], 'me', seen, names, 'THB')).toEqual([])
  })
})
