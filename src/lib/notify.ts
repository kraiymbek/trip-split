// Уведомления «тебе добавили расход» — без сервера: сравниваем данные поездки с тем, что человек уже видел.
// Что видел — хранится на телефоне (localStorage) по каждой поездке.
import { formatMoney } from './money'
import type { Expense, Profile, Settlement } from '../types'

export type Seen = Record<string, string> // ключ записи → её версия

export interface Notice {
  key: string // e:<id> или s:<id>
  version: string
  kind: 'new' | 'edit' | 'settle'
  actor: string // кто сделал
  at: string
  expenseId?: string
  title: string // «Дана · новый расход»
  body: string // «Ужин на пляже · 2 450 ฿ · твоя доля 612,50 ฿»
}

type Names = Record<string, Profile | undefined>

const name = (names: Names, id: string) => names[id]?.name ?? 'Кто-то'

/** Записи, которые касаются меня (вместе с моими — их версии тоже запоминаем). */
function relevant(expenses: Expense[], settlements: Settlement[], me: string) {
  const ex = expenses
    .filter((e) => !e.pending && (e.paid_by === me || e.shares.some((s) => s.user_id === me)))
    .map((e) => ({ key: `e:${e.id}`, version: e.updated_at ?? e.created_at ?? '', actor: e.updated_by ?? e.created_by, e }))
  const st = settlements
    .filter((s) => !s.pending && (s.from_user === me || s.to_user === me))
    .map((s) => ({ key: `s:${s.id}`, version: '1', actor: s.created_by ?? '', s }))
  return { ex, st }
}

/** Всё текущее «как будто уже видел» — первый заход в поездку не заваливает уведомлениями. */
export function snapshotSeen(expenses: Expense[], settlements: Settlement[], me: string, prev: Seen = {}): Seen {
  const { ex, st } = relevant(expenses, settlements, me)
  const next: Seen = { ...prev }
  for (const x of [...ex, ...st]) next[x.key] = x.version
  return next
}

export function computeNotices(
  expenses: Expense[],
  settlements: Settlement[],
  me: string,
  seen: Seen,
  names: Names,
  base: string,
): Notice[] {
  const { ex, st } = relevant(expenses, settlements, me)
  const out: Notice[] = []
  for (const { key, version, actor, e } of ex) {
    if (actor === me || seen[key] === version) continue
    const share = e.shares.find((s) => s.user_id === me)?.share_base
    const parts = [`«${e.title}»`, formatMoney(e.amount, e.currency)]
    if (share !== undefined) parts.push(`твоя доля ${formatMoney(share, base)}`)
    if (e.paid_by === me) parts.push('платил: ты')
    // правка — если уже видел старую версию или расход менялся после создания (например, свой расход поправил другой)
    const isEdit = seen[key] !== undefined || (!!e.created_at && !!e.updated_at && e.updated_at !== e.created_at)
    out.push({
      key,
      version,
      kind: isEdit ? 'edit' : 'new',
      actor,
      at: version,
      expenseId: e.id,
      title: `${name(names, actor)} · ${isEdit ? 'изменён расход' : 'новый расход'}`,
      body: parts.join(' · '),
    })
  }
  for (const { key, version, actor, s } of st) {
    if (!actor || actor === me || seen[key] === version) continue
    const from = s.from_user === me ? 'ты' : name(names, s.from_user)
    const to = s.to_user === me ? 'тебе' : name(names, s.to_user)
    out.push({
      key,
      version,
      kind: 'settle',
      actor,
      at: s.created_at,
      title: `${name(names, actor)} · отмечен возврат долга`,
      body: `${from} → ${to}: ${formatMoney(s.amount_base, base)}`,
    })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

// ─── хранение «что видел» ───

const seenKey = (trip: string, me: string) => `ts:seen:${trip}:${me}`

export function loadSeen(trip: string, me: string): Seen | null {
  try {
    const v = JSON.parse(localStorage.getItem(seenKey(trip, me)) ?? 'null')
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

export function saveSeen(trip: string, me: string, seen: Seen) {
  try {
    localStorage.setItem(seenKey(trip, me), JSON.stringify(seen))
  } catch {
    /* private mode */
  }
}

// ─── системные уведомления (пока приложение открыто или свёрнуто) ───

const PREF = 'ts:notify'

export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window

export function notifyEnabled(): boolean {
  try {
    return notifySupported() && Notification.permission === 'granted' && localStorage.getItem(PREF) === '1'
  } catch {
    return false
  }
}

export async function enableNotify(): Promise<NotificationPermission | 'unsupported'> {
  if (!notifySupported()) return 'unsupported'
  const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  try {
    if (p === 'granted') localStorage.setItem(PREF, '1')
  } catch {
    /* ignore */
  }
  return p
}

export function disableNotify() {
  try {
    localStorage.removeItem(PREF)
  } catch {
    /* ignore */
  }
}

export async function systemNotify(title: string, body: string, url: string, tag: string) {
  if (!notifyEnabled()) return
  const opts: NotificationOptions & { data?: unknown } = { body, tag, icon: '/icons/icon-192.png', data: { url } }
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) return await reg.showNotification(title, opts)
    const n = new Notification(title, opts)
    n.onclick = () => {
      window.focus()
      location.assign(url)
    }
  } catch {
    /* Android Chrome без service worker не умеет new Notification — тихо пропускаем */
  }
}
