import { beforeEach, describe, expect, it, vi } from 'vitest'

// ответы «сервера» по очереди для каждого вызова
const replies: { error: { message: string; code?: string } | null; data?: unknown }[] = []
const calls: string[] = []
const next = (what: string) => {
  calls.push(what)
  return Promise.resolve(replies.shift() ?? { error: null })
}

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (fn: string) => next(`rpc:${fn}`),
    from: (table: string) => ({
      insert: () => next(`insert:${table}`),
      delete: () => ({ eq: () => ({ select: () => next(`delete:${table}`) }) }),
      select: () => ({ eq: () => ({ maybeSingle: () => next(`select:${table}`) }) }),
    }),
  },
  errMsg: (e: { message: string }) => e.message,
}))

const ob = await import('./outbox')

const item = (id: string, kind: 'expense' | 'expense-delete' | 'cash' | 'settlement' = 'expense') => ({
  id,
  tripId: 't1',
  kind,
  payload: { p_id: id },
  label: id,
})

beforeEach(() => {
  replies.length = 0
  calls.length = 0
})

describe('офлайн-очередь', () => {
  it('сетевой сбой — запись остаётся; сеть появилась — уходит', async () => {
    replies.push({ error: { message: 'TypeError: Failed to fetch' } })
    ob.enqueue(item('a'))
    await ob.flushOutbox()
    expect(calls).toEqual(['rpc:save_expense'])
    // всё ещё в очереди: следующая отправка снова её шлёт
    replies.push({ error: null })
    await ob.flushOutbox()
    expect(calls).toEqual(['rpc:save_expense', 'rpc:save_expense'])
    // после успеха очередь пуста — третий flush ничего не шлёт
    await ob.flushOutbox()
    expect(calls.length).toBe(2)
  })

  it('останавливается на первой сетевой ошибке, порядок сохраняется', async () => {
    replies.push({ error: { message: 'Load failed' } })
    ob.enqueue(item('b1'))
    ob.enqueue(item('b2', 'cash'))
    await ob.flushOutbox()
    expect(calls).toEqual(['rpc:save_expense']) // b2 не пытались — сети нет
    await ob.flushOutbox()
    expect(calls).toEqual(['rpc:save_expense', 'rpc:save_expense', 'insert:cash_ops'])
  })

  it('сервер отклонил — запись помечается ошибкой и больше не шлётся сама', async () => {
    replies.push({ error: { message: 'Доли не сходятся' } })
    ob.enqueue(item('c'))
    await ob.flushOutbox()
    await ob.flushOutbox()
    expect(calls).toEqual(['rpc:save_expense'])
    // ручной повтор
    replies.push({ error: null })
    await ob.retry('c')
    expect(calls).toEqual(['rpc:save_expense', 'rpc:save_expense'])
  })

  it('строка уже есть на сервере (повтор после потерянного ответа) — считается отправленной', async () => {
    replies.push({ error: { message: 'duplicate key', code: '23505' } })
    ob.enqueue(item('d', 'settlement'))
    await ob.flushOutbox()
    await ob.flushOutbox()
    expect(calls).toEqual(['insert:settlements'])
  })

  it('удалить из очереди', async () => {
    replies.push({ error: { message: 'Failed to fetch' } })
    ob.enqueue(item('e'))
    await ob.flushOutbox()
    ob.discard('e')
    await ob.flushOutbox()
    expect(calls).toEqual(['rpc:save_expense'])
  })

  const find = (id: string) => ob.outboxSnapshot().find((i) => i.id === id)

  it('отправленная запись помечается и держится до forgetSent', async () => {
    ob.enqueue(item('f'))
    await ob.flushOutbox()
    const f = find('f')
    expect(f && f.sent).toBe(true)
    await ob.flushOutbox()
    expect(calls).toEqual(['rpc:save_expense']) // повторно не шлётся
    ob.forgetSent([f as never])
    expect(find('f')).toBeUndefined()
  })

  it('запись, заменённая во время отправки, уходит следующей и не теряется', async () => {
    ob.enqueue(item('g')) // летит первая версия
    ob.enqueue({ ...item('g'), label: 'g2' }) // человек сразу поправил
    await ob.flushOutbox()
    expect(calls).toEqual(['rpc:save_expense', 'rpc:save_expense'])
    expect(find('g')).toMatchObject({ label: 'g2', sent: true })
  })

  it('удаление: удалил, уже нет строки — ок; строка осталась — ошибка прав', async () => {
    replies.push({ error: null, data: [{ id: 'h1' }] })
    ob.enqueue(item('h1', 'expense-delete'))
    replies.push({ error: null, data: [] }, { error: null, data: null })
    ob.enqueue(item('h2', 'expense-delete'))
    await ob.flushOutbox()
    replies.push({ error: null, data: [] }, { error: null, data: { id: 'h3' } })
    ob.enqueue(item('h3', 'expense-delete'))
    await ob.flushOutbox()
    expect(find('h1')).toMatchObject({ sent: true })
    expect(find('h2')).toMatchObject({ sent: true })
    expect(find('h3')).toMatchObject({ error: 'Удалить расход может только автор' })
  })

  it('isNetworkError отличает сеть от ошибок данных', () => {
    expect(ob.isNetworkError({ message: 'TypeError: Failed to fetch' })).toBe(true)
    expect(ob.isNetworkError({ message: 'Load failed' })).toBe(true)
    expect(ob.isNetworkError({ message: 'Доли (60) не сходятся с суммой (100)' })).toBe(false)
  })

  it('uuid уникальный и правильного формата', () => {
    const a = ob.uuid()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(ob.uuid()).not.toBe(a)
  })
})
