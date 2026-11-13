// Очередь отправки (localStorage). Расходы всегда сохраняются через неё: в списке запись видна сразу,
// а на сервер уходит в фоне; без интернета ждёт и отправляется сама. Наличные и переводы кладутся сюда,
// только когда нет сети. У каждой записи свой id, выданный на телефоне, поэтому повторная отправка не создаёт дублей.
import { useMemo, useSyncExternalStore } from 'react'
import { errMsg, supabase } from './supabase'

export type OutboxKind = 'expense' | 'expense-delete' | 'cash' | 'settlement'

export interface OutboxItem {
  id: string // id записи — он же id строки в базе
  tripId: string
  kind: OutboxKind
  payload: Record<string, unknown>
  label: string // «Ужин на пляже · 2 450 ฿» — для показа в списке
  createdAt: string
  error?: string // сервер отклонил запись — нужно решение человека
  stalled?: boolean // попытка упёрлась в сеть — ждём интернета
  sent?: boolean // сервер принял; держим, пока список не перезагрузится (см. forgetSent)
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

/** Положить в очередь (заменяет запись с тем же id) и сразу попробовать отправить. */
export function enqueue(item: Omit<OutboxItem, 'createdAt'>) {
  commit([...items.filter((i) => i.id !== item.id), { ...item, createdAt: new Date().toISOString() }])
  void flushOutbox()
}

/** Убрать отправленные записи — после того как свежий список с сервера их уже содержит. */
export function forgetSent(sent: OutboxItem[]) {
  const done = new Set(sent)
  if (items.some((i) => done.has(i))) commit(items.filter((i) => !done.has(i)))
}

export function discard(id: string) {
  commit(items.filter((i) => i.id !== id))
}

export function retry(id: string) {
  commit(items.map((i) => (i.id === id ? { ...i, error: undefined, stalled: false } : i)))
  return flushOutbox()
}

async function send(item: OutboxItem): Promise<{ message: string; code?: string } | null> {
  if (item.kind === 'expense') {
    const { error } = await supabase.rpc('save_expense', item.payload)
    return error
  }
  if (item.kind === 'expense-delete') {
    // без прав RLS не возвращает ошибку, а просто ничего не удаляет — поэтому проверяем, осталась ли строка
    const del = await supabase.from('expenses').delete().eq('id', item.id).select('id')
    if (del.error) return del.error
    if (del.data?.length) return null
    const left = await supabase.from('expenses').select('id').eq('id', item.id).maybeSingle()
    if (left.error) return left.error
    return left.data ? { message: 'Удалить расход может только автор' } : null // нет строки — уже удалён или не был создан
  }
  const table = item.kind === 'cash' ? 'cash_ops' : 'settlements'
  const { error } = await supabase.from(table).insert(item.payload)
  if (error?.code === '23505') return null // такая строка уже есть — значит, раньше дошло
  return error
}

let flushing: Promise<void> | null = null

/** Отправить всё, что ждёт, по порядку. Останавливается на первой сетевой ошибке.
 *  Записи, добавленные во время отправки, уходят в том же проходе. */
export function flushOutbox(): Promise<void> {
  if (flushing) return flushing
  flushing = (async () => {
    const tried = new Set<OutboxItem>()
    for (;;) {
      const item = items.find((i) => !i.error && !i.sent && !tried.has(i))
      if (!item) break
      tried.add(item)
      let err: { message: string } | null
      try {
        err = await send(item)
      } catch (e) {
        err = { message: e instanceof Error ? e.message : String(e) }
      }
      // сравниваем по ссылке: если запись заменили, пока она летела, новую версию не трогаем
      const patch = (p: Partial<OutboxItem>) => commit(items.map((i) => (i === item ? { ...i, ...p } : i)))
      if (!err) {
        patch({ sent: true, stalled: false })
        continue
      }
      if (isNetworkError(err) || isAuthHiccup(err.message)) {
        // сети нет — ждут все, а не только та, что упёрлась первой
        let changed = false
        const next = items.map((i) => (!i.error && !i.sent && !i.stalled ? ((changed = true), { ...i, stalled: true }) : i))
        if (changed) commit(next)
        break
      }
      patch({ error: errMsg(err), stalled: false })
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
  if (items.some((i) => !i.error && !i.sent)) timer = setTimeout(flushOutbox, 20_000)
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
export const outboxSnapshot = snapshot

export function useOutbox(tripId?: string): OutboxItem[] {
  const all = useSyncExternalStore(subscribeOutbox, snapshot, snapshot)
  return useMemo(() => (tripId ? all.filter((i) => i.tripId === tripId) : all), [all, tripId])
}
