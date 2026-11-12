// Офлайн-очередь: если при сохранении нет интернета, запись кладётся сюда (localStorage)
// и отправляется сама, когда сеть появится. У каждой записи свой id, выданный на телефоне,
// поэтому повторная отправка не создаёт дублей.
import { useSyncExternalStore } from 'react'
import { errMsg, supabase } from './supabase'

export type OutboxKind = 'expense' | 'cash' | 'settlement'

export interface OutboxItem {
  id: string // id записи — он же id строки в базе
  tripId: string
  kind: OutboxKind
  payload: Record<string, unknown>
  label: string // «Ужин на пляже · 2 450 ฿» — для показа в списке
  createdAt: string
  error?: string // сервер отклонил запись — нужно решение человека
}

const KEY = 'ts:outbox'

function read(): OutboxItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

let items: OutboxItem[] = typeof window !== 'undefined' ? read() : []
const subs = new Set<() => void>()

function commit(next: OutboxItem[]) {
  items = next
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    /* private mode — очередь живёт только в памяти */
  }
  subs.forEach((f) => f())
}

export function uuid(): string {
  const c = globalThis.crypto as Crypto
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  // запасной вариант для старых браузеров / http без HTTPS
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Ошибка из-за сети (а не из-за данных) — такую запись можно отложить и отправить позже. */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  return /Failed to fetch|NetworkError|Load failed|network|fetch failed|timed? ?out|ERR_INTERNET/i.test(m)
}

// протухший токен после долгого офлайна — тоже временная проблема
const isAuthHiccup = (m: string) => /JWT|token|Auth session missing/i.test(m)

export function enqueue(item: Omit<OutboxItem, 'createdAt'>) {
  commit([...items.filter((i) => i.id !== item.id), { ...item, createdAt: new Date().toISOString() }])
  scheduleRetry()
}

export function discard(id: string) {
  commit(items.filter((i) => i.id !== id))
}

export function retry(id: string) {
  commit(items.map((i) => (i.id === id ? { ...i, error: undefined } : i)))
  return flushOutbox()
}

async function send(item: OutboxItem): Promise<{ message: string; code?: string } | null> {
  if (item.kind === 'expense') {
    const { error } = await supabase.rpc('save_expense', item.payload)
    return error
  }
  const table = item.kind === 'cash' ? 'cash_ops' : 'settlements'
  const { error } = await supabase.from(table).insert(item.payload)
  if (error?.code === '23505') return null // такая строка уже есть — значит, раньше дошло
  return error
}

let flushing: Promise<void> | null = null

/** Отправить всё, что ждёт. Останавливается на первой сетевой ошибке. */
export function flushOutbox(): Promise<void> {
  if (flushing) return flushing
  flushing = (async () => {
    for (const item of [...items]) {
      if (item.error) continue
      let err: { message: string } | null
      try {
        err = await send(item)
      } catch (e) {
        err = { message: e instanceof Error ? e.message : String(e) }
      }
      if (!err) {
        commit(items.filter((i) => i.id !== item.id))
        continue
      }
      if (isNetworkError(err) || isAuthHiccup(err.message)) break
      commit(items.map((i) => (i.id === item.id ? { ...i, error: errMsg(err) } : i)))
    }
  })().finally(() => {
    flushing = null
    scheduleRetry()
  })
  return flushing
}

let timer: ReturnType<typeof setTimeout> | undefined
function scheduleRetry() {
  clearTimeout(timer)
  if (items.some((i) => !i.error)) timer = setTimeout(flushOutbox, 20_000)
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flushOutbox())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flushOutbox()
  })
  // после перезапуска приложения — попробовать отправить то, что осталось
  setTimeout(flushOutbox, 1500)
}

export function subscribeOutbox(f: () => void) {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}

const snapshot = () => items

export function useOutbox(tripId?: string): OutboxItem[] {
  const all = useSyncExternalStore(subscribeOutbox, snapshot, snapshot)
  return tripId ? all.filter((i) => i.tripId === tripId) : all
}
