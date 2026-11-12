import { beforeEach, describe, expect, it, vi } from 'vitest'

// ответы «сервера» по очереди для каждого вызова
const replies: { error: { message: string; code?: string } | null }[] = []
const calls: string[] = []
const next = (what: string) => {
  calls.push(what)
  return Promise.resolve(replies.shift() ?? { error: null })
}

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (fn: string) => next(`rpc:${fn}`),
    from: (table: string) => ({ insert: () => next(`insert:${table}`) }),
  },
  errMsg: (e: { message: string }) => e.message,
}))

const ob = await import('./outbox')

const item = (id: string, kind: 'expense' | 'cash' | 'settlement' = 'expense') => ({
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
    ob.enqueue(item('b1'))
    ob.enqueue(item('b2', 'cash'))
    replies.push({ error: { message: 'Load failed' } })
    await ob.flushOutbox()
    expect(calls).toEqual(['rpc:save_expense']) // b2 не пытались — сети нет
    await ob.flushOutbox()
    expect(calls).toEqual(['rpc:save_expense', 'rpc:save_expense', 'insert:cash_ops'])
  })

  it('сервер отклонил — запись помечается ошибкой и больше не шлётся сама', async () => {
    ob.enqueue(item('c'))
    replies.push({ error: { message: 'Доли не сходятся' } })
    await ob.flushOutbox()
    await ob.flushOutbox()
    expect(calls).toEqual(['rpc:save_expense'])
    // ручной повтор
    replies.push({ error: null })
    await ob.retry('c')
    expect(calls).toEqual(['rpc:save_expense', 'rpc:save_expense'])
  })

  it('строка уже есть на сервере (повтор после потерянного ответа) — считается отправленной', async () => {
    ob.enqueue(item('d', 'settlement'))
    replies.push({ error: { message: 'duplicate key', code: '23505' } })
    await ob.flushOutbox()
    await ob.flushOutbox()
    expect(calls).toEqual(['insert:settlements'])
  })

  it('удалить из очереди', async () => {
    ob.enqueue(item('e'))
    ob.discard('e')
    await ob.flushOutbox()
    expect(calls).toEqual([])
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
