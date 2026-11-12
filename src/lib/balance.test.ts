import { describe, expect, it } from 'vitest'
import { moneyError, parseMoney, parseRate } from './money'
import {
  baseToCustom,
  customToBase,
  breakdownByMethod,
  computeWallet,
  computeBalances,
  computeStats,
  simplifyDebts,
  splitEqual,
  type ExpenseLike,
} from './balance'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('splitEqual', () => {
  it('делит с остатком так, что сумма сходится', () => {
    const shares = splitEqual(1000, ['a', 'b', 'c'])
    expect(shares.map((s) => s.share_base)).toEqual([334, 333, 333])
    expect(sum(shares.map((s) => s.share_base))).toBe(1000)
  })
  it('пустой список', () => expect(splitEqual(100, [])).toEqual([]))
})

describe('balances & debts', () => {
  const members = ['ali', 'bek', 'dana']
  const exp = (paid_by: string, amount: number, ids = members, method: ExpenseLike['method'] = 'card') => ({
    paid_by,
    amount_base: amount,
    method,
    shares: splitEqual(amount, ids),
  })

  it('один заплатил за всех поровну', () => {
    const b = computeBalances(members, [exp('ali', 900)], [])
    expect(b).toEqual({ ali: 600, bek: -300, dana: -300 })
    expect(simplifyDebts(b)).toEqual([
      { from: 'bek', to: 'ali', amount: 300 },
      { from: 'dana', to: 'ali', amount: 300 },
    ])
  })

  it('свои суммы и платёж за одного', () => {
    const custom: ExpenseLike = {
      paid_by: 'bek',
      amount_base: 1000,
      method: 'cash',
      shares: [
        { user_id: 'ali', share_base: 700 },
        { user_id: 'dana', share_base: 300 },
      ],
    }
    const b = computeBalances(members, [custom], [])
    expect(b).toEqual({ ali: -700, bek: 1000, dana: -300 })
  })

  it('возврат долга обнуляет баланс', () => {
    const b = computeBalances(members, [exp('ali', 900)], [
      { from_user: 'bek', to_user: 'ali', amount_base: 300 },
      { from_user: 'dana', to_user: 'ali', amount_base: 300 },
    ])
    expect(b).toEqual({ ali: 0, bek: 0, dana: 0 })
    expect(simplifyDebts(b)).toEqual([])
  })

  it('взаимные траты сворачиваются в минимум переводов', () => {
    const b = computeBalances(members, [exp('ali', 900), exp('bek', 600), exp('dana', 300)], [])
    expect(sum(Object.values(b))).toBe(0)
    const t = simplifyDebts(b)
    expect(t).toEqual([{ from: 'dana', to: 'ali', amount: 300 }])
  })

  it('сумма балансов всегда 0 на случайных данных', () => {
    let seed = 42
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const ppl = ['a', 'b', 'c', 'd', 'e']
    const expenses = Array.from({ length: 50 }, () => {
      const who = ppl.filter(() => rnd() > 0.3)
      const ids = who.length ? who : ['a']
      return exp(ppl[Math.floor(rnd() * ppl.length)], 1 + Math.floor(rnd() * 100000), ids)
    })
    const b = computeBalances(ppl, expenses, [])
    expect(sum(Object.values(b))).toBe(0)
    const transfers = simplifyDebts(b)
    expect(transfers.length).toBeLessThanOrEqual(ppl.length - 1)
    // применяем переводы — все должны выйти в 0
    const after = { ...b }
    for (const t of transfers) {
      after[t.from] += t.amount
      after[t.to] -= t.amount
    }
    expect(Object.values(after).every((v) => v === 0)).toBe(true)
  })

  it('статистика: заплатил / потратил на себя', () => {
    const s = computeStats(members, [exp('ali', 900)], [])
    expect(s.ali).toMatchObject({ paid: 900, consumed: 300, balance: 600 })
  })
})

describe('customToBase / baseToCustom', () => {
  it('сумма долей точно равна итогу после конвертации', () => {
    // 100 ₸ + 100 ₸ + 100 ₸ по курсу 0.0753 → 22.59 ฿, а по отдельности 7.53 × 3 = 22.59 — плюс неудобный случай
    const vals = { a: 3333, b: 3333, c: 3334 }
    const rate = 0.0753
    const base = Math.round(10000 * rate)
    const shares = customToBase(vals, rate, base)
    expect(sum(shares.map((s) => s.share_base))).toBe(base)
  })
  it('нулевые суммы выкидываются', () => {
    expect(customToBase({ a: 500, b: 0 }, 1, 500)).toEqual([{ user_id: 'a', share_base: 500 }])
  })
  it('обратный перевод для редактирования сходится с суммой', () => {
    const amount = 1500000
    const rate = 0.0753
    const base = Math.round(amount * rate)
    const shares = splitEqual(base, ['a', 'b', 'c'])
    const back = baseToCustom(shares, rate, amount)
    expect(sum(Object.values(back))).toBe(amount)
  })
  it('на случайных данных всегда сходится', () => {
    for (let i = 0; i < 500; i++) {
      const rate = 0.001 + Math.random() * 50
      const n = 1 + Math.floor(Math.random() * 6)
      const ids = Array.from({ length: n }, (_, k) => `u${k}`)
      const amount = n + Math.floor(Math.random() * 10_000_000)
      const base = Math.round(amount * rate)
      if (base < 1) continue
      const vals = Object.fromEntries(splitEqual(amount, ids).map((s) => [s.user_id, s.share_base]))
      const shares = customToBase(vals, rate, base)
      expect(sum(shares.map((s) => s.share_base))).toBe(base)
      expect(shares.every((s) => s.share_base >= 0)).toBe(true)
      expect(sum(Object.values(baseToCustom(shares, rate, amount)))).toBe(amount)
    }
  })
})

describe('breakdownByMethod', () => {
  it('суммирует по способам, банкам и плательщикам', () => {
    const r = breakdownByMethod([
      { paid_by: 'a', amount_base: 100, method: 'cash', shares: [] },
      { paid_by: 'a', amount_base: 50, method: 'card', bank: 'kaspi', shares: [] },
      { paid_by: 'b', amount_base: 70, method: 'card', bank: 'halyk', shares: [] },
      { paid_by: 'b', amount_base: 5, method: 'card', bank: 'kaspi', shares: [] },
      { paid_by: 'b', amount_base: 30, method: 'cash', shares: [] },
    ])
    expect(r.total).toEqual({ card: 125, cash: 130 })
    expect(r.byBank).toEqual({ kaspi: 55, halyk: 70 })
    expect(r.byPayer.a).toEqual({ card: 50, cash: 100 })
  })
})

describe('parseMoney / moneyError / parseRate', () => {
  it('разные форматы ввода', () => {
    expect(parseMoney('1 234,56')).toBe(123456)
    expect(parseMoney('1234.5')).toBe(123450)
    expect(parseMoney(',5')).toBe(50)
    expect(parseMoney('100')).toBe(10000)
    expect(parseMoney('0')).toBeNull()
    expect(parseMoney('0', true)).toBe(0)
    expect(parseMoney('0,00', true)).toBe(0)
    expect(parseMoney('1.234')).toBeNull()
    expect(parseMoney('-5')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('9999999999')).toBeNull()
    expect(parseMoney('1000000000')).toBe(100000000000)
  })
  it('понятные ошибки', () => {
    expect(moneyError('')).toBe('Введи сумму')
    expect(moneyError('1,234')).toBe('Не больше двух знаков после запятой')
    expect(moneyError('12a')).toMatch(/только цифры/)
    expect(moneyError('0')).toMatch(/больше нуля/)
    expect(moneyError('99999999999')).toBe('Слишком большая сумма')
    expect(moneyError('150,5')).toBe('')
  })
  it('курс', () => {
    expect(parseRate('0,0753')).toBe(0.0753)
    expect(parseRate('14')).toBe(14)
    expect(parseRate('0')).toBeNull()
    expect(parseRate('')).toBeNull()
    expect(parseRate('-1')).toBeNull()
    expect(parseRate('abc')).toBeNull()
  })
})

describe('computeWallet', () => {
  it('привёз, обменял, потратил, вернул долг', () => {
    const w = computeWallet(
      'a',
      [
        { user_id: 'a', kind: 'deposit', from_amount: null, from_currency: null, to_amount: 30000, to_currency: 'USD' },
        { user_id: 'a', kind: 'deposit', from_amount: null, from_currency: null, to_amount: 5000000, to_currency: 'KZT' },
        { user_id: 'a', kind: 'exchange', from_amount: 20000, from_currency: 'USD', to_amount: 670000, to_currency: 'THB' },
        { user_id: 'b', kind: 'deposit', from_amount: null, from_currency: null, to_amount: 999, to_currency: 'THB' },
      ],
      [
        { paid_by: 'a', method: 'cash', amount: 45000, currency: 'THB' },
        { paid_by: 'a', method: 'card', amount: 100000, currency: 'THB' },
        { paid_by: 'b', method: 'cash', amount: 30000, currency: 'THB' },
        { paid_by: 'a', method: 'cash', amount: 300000, currency: 'KZT' },
      ],
      [
        { from_user: 'a', to_user: 'b', amount_base: 10000, method: 'cash' },
        { from_user: 'b', to_user: 'a', amount_base: 2500, method: 'cash' },
        { from_user: 'a', to_user: 'b', amount_base: 77700, method: 'card' },
      ],
      'THB',
    )
    expect(w.USD.balance).toBe(10000) // 300 − 200
    expect(w.THB).toEqual({ added: 670000, exchangedOut: 0, spent: 45000, settled: -7500, balance: 617500 })
    expect(w.KZT.balance).toBe(4700000)
  })
  it('без операций — пусто; минус, если трат больше, чем внесено', () => {
    expect(computeWallet('x', [], [], [], 'THB')).toEqual({})
    const w = computeWallet('a', [], [{ paid_by: 'a', method: 'cash', amount: 500, currency: 'THB' }], [], 'THB')
    expect(w.THB.balance).toBe(-500)
  })
})

describe('экспорт CSV', async () => {
  const { buildTripCsv } = await import('./exportCsv')
  const p = (id: string, name: string) => ({ id, name, avatar_color: '#000' })
  const csv = buildTripCsv({
    trip: { id: 't', name: 'Тай; 2026', base_currency: 'THB', invite_code: 'x', created_by: 'a', created_at: '' },
    members: [p('a', 'Али'), p('b', 'Бек')],
    memberById: { a: p('a', 'Али'), b: p('b', 'Бек') },
    expenses: [
      { id: 'e1', trip_id: 't', paid_by: 'a', title: 'Ужин; "лучший"', note: null, amount: 100050, currency: 'THB', rate: 1,
        amount_base: 100050, method: 'card', bank: 'kaspi', split_mode: 'equal', spent_at: '2026-12-01T10:00:00Z', created_by: 'a',
        shares: [{ user_id: 'a', share_base: 50025 }, { user_id: 'b', share_base: 50025 }] },
    ],
    settlements: [],
    cashOps: [{ id: 'c1', trip_id: 't', user_id: 'b', kind: 'exchange', from_amount: 10000, from_currency: 'USD', to_amount: 335000, to_currency: 'THB', note: null, happened_at: '2026-12-01T09:00:00Z' }],
  })
  it('BOM, разделитель ;, запятая в дробях, кавычки', () => {
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('"Поездка: Тай; 2026"')
    expect(csv).toContain('"Ужин; ""лучший"""')
    expect(csv).toContain('1000,50;Карта (Kaspi);Али;500,25;500,25')
  })
  it('итоги и переводы', () => {
    expect(csv).toContain('Бек;Али;500,25')
    expect(csv).toContain('Бек;THB;3350,00;0,00;0,00;0,00;3350,00')
    expect(csv).toContain('Бек;USD;0,00;100,00;0,00;0,00;-100,00')
  })
})
