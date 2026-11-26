import { crossRate } from './rates'

// Чистые функции расчёта долгов. Все суммы — целые числа в сотых долях базовой валюты.

export type PayMethod = 'card' | 'cash'

export interface ShareLike {
  user_id: string
  share_base: number
}

export interface ExpenseLike {
  paid_by: string
  amount_base: number
  method: PayMethod
  bank?: string | null
  shares: ShareLike[]
}

export interface SettlementLike {
  from_user: string
  to_user: string
  amount_base: number
}

export interface Transfer {
  from: string
  to: string
  amount: number
}

export interface MemberStat {
  paid: number // сколько человек заплатил за всех
  consumed: number // сколько из общих трат приходится на него
  settledOut: number // сколько он вернул другим
  settledIn: number // сколько ему вернули
  balance: number // > 0 — ему должны, < 0 — он должен
}

/** Делит total поровну; остаток раздаётся по одной копейке первым участникам. */
export function splitEqual(total: number, userIds: string[]): ShareLike[] {
  if (userIds.length === 0) return []
  const base = Math.floor(total / userIds.length)
  let rest = total - base * userIds.length
  return userIds.map((user_id) => {
    const extra = rest > 0 ? 1 : 0
    rest -= extra
    return { user_id, share_base: base + extra }
  })
}

/** Подгоняет округлённые доли так, чтобы их сумма точно равнялась total (разница — самой крупной доле). */
function fixRounding<T extends { v: number }>(items: T[], total: number): T[] {
  if (!items.length) return items
  const diff = total - items.reduce((s, x) => s + x.v, 0)
  if (diff !== 0) {
    const biggest = items.reduce((a, b) => (b.v > a.v ? b : a))
    biggest.v = Math.max(0, biggest.v + diff)
  }
  return items
}

/** Свои суммы в валюте расхода → доли в базовой валюте, сумма долей === amountBase. */
export function customToBase(vals: Record<string, number>, rate: number, amountBase: number): ShareLike[] {
  const items = Object.entries(vals)
    .filter(([, v]) => v > 0)
    .map(([user_id, v]) => ({ user_id, v: Math.round(v * rate) }))
  return fixRounding(items, amountBase).map(({ user_id, v }) => ({ user_id, share_base: v }))
}

/** Доли в базовой валюте → суммы в валюте расхода (для редактирования), сумма === amount. */
export function baseToCustom(shares: ShareLike[], rate: number, amount: number): Record<string, number> {
  const items = shares.map((s) => ({ user_id: s.user_id, v: Math.round(s.share_base / rate) }))
  return Object.fromEntries(fixRounding(items, amount).map(({ user_id, v }) => [user_id, v]))
}

export function computeStats(
  memberIds: string[],
  expenses: ExpenseLike[],
  settlements: SettlementLike[],
): Record<string, MemberStat> {
  const stats: Record<string, MemberStat> = {}
  const get = (id: string) =>
    (stats[id] ??= { paid: 0, consumed: 0, settledOut: 0, settledIn: 0, balance: 0 })
  memberIds.forEach(get)

  for (const e of expenses) {
    get(e.paid_by).paid += e.amount_base
    for (const s of e.shares) get(s.user_id).consumed += s.share_base
  }
  for (const s of settlements) {
    get(s.from_user).settledOut += s.amount_base
    get(s.to_user).settledIn += s.amount_base
  }
  for (const st of Object.values(stats)) {
    st.balance = st.paid - st.consumed + st.settledOut - st.settledIn
  }
  return stats
}

export function computeBalances(
  memberIds: string[],
  expenses: ExpenseLike[],
  settlements: SettlementLike[],
): Record<string, number> {
  const stats = computeStats(memberIds, expenses, settlements)
  return Object.fromEntries(Object.entries(stats).map(([id, s]) => [id, s.balance]))
}

/** Долги по каждой паре: кто за кого платил, минус возвраты между ними; встречные долги взаимозачитываются. */
export function pairwiseDebts(expenses: ExpenseLike[], settlements: SettlementLike[]): Transfer[] {
  const net = new Map<string, number>() // ключ «a|b» при a < b: > 0 — a должен b, < 0 — b должен a
  const add = (debtor: string, creditor: string, v: number) => {
    if (debtor === creditor || !v) return
    const [k, sign] = debtor < creditor ? [`${debtor}|${creditor}`, 1] : [`${creditor}|${debtor}`, -1]
    net.set(k, (net.get(k) ?? 0) + sign * v)
  }
  for (const e of expenses) for (const s of e.shares) add(s.user_id, e.paid_by, s.share_base)
  for (const s of settlements) add(s.to_user, s.from_user, s.amount_base) // вернул — значит, долг меньше
  const out: Transfer[] = []
  for (const [k, v] of net) {
    const [a, b] = k.split('|')
    if (v > 0) out.push({ from: a, to: b, amount: v })
    else if (v < 0) out.push({ from: b, to: a, amount: -v })
  }
  return out.sort((x, y) => y.amount - x.amount)
}

export type MethodTotals = Record<PayMethod, number>

const emptyTotals = (): MethodTotals => ({ card: 0, cash: 0 })

/** Сколько заплачено каждым способом — всего, по банкам (для карт) и по каждому плательщику. */
export function breakdownByMethod(expenses: ExpenseLike[]): {
  total: MethodTotals
  byBank: Record<string, number>
  byPayer: Record<string, MethodTotals>
} {
  const total = emptyTotals()
  const byBank: Record<string, number> = {}
  const byPayer: Record<string, MethodTotals> = {}
  for (const e of expenses) {
    total[e.method] += e.amount_base
    if (e.method === 'card') {
      const b = e.bank ?? 'other'
      byBank[b] = (byBank[b] ?? 0) + e.amount_base
    }
    ;(byPayer[e.paid_by] ??= emptyTotals())[e.method] += e.amount_base
  }
  return { total, byBank, byPayer }
}

// ───────────── наличные ─────────────

export interface CashOpLike {
  user_id: string
  kind: 'deposit' | 'exchange'
  from_amount: number | null
  from_currency: string | null
  to_amount: number
  to_currency: string
}

export interface CashExpenseLike {
  paid_by: string
  method: PayMethod
  amount: number // в валюте расхода
  currency: string
}

export interface CashSettlementLike extends SettlementLike {
  method: PayMethod
}

export interface WalletLine {
  added: number // привёз + получил при обмене
  exchangedOut: number // отдал при обмене
  spent: number // расходы наличными
  settled: number // возвраты долгов наличными: + получил, − отдал
  balance: number
}

/** Кошелёк наличных одного человека по валютам. Возвраты наличными считаются в базовой валюте поездки. */
export function computeWallet(
  userId: string,
  ops: CashOpLike[],
  expenses: CashExpenseLike[],
  settlements: CashSettlementLike[],
  baseCurrency: string,
): Record<string, WalletLine> {
  const w: Record<string, WalletLine> = {}
  const line = (cur: string) => (w[cur] ??= { added: 0, exchangedOut: 0, spent: 0, settled: 0, balance: 0 })

  for (const o of ops) {
    if (o.user_id !== userId) continue
    line(o.to_currency).added += o.to_amount
    if (o.kind === 'exchange' && o.from_currency && o.from_amount) line(o.from_currency).exchangedOut += o.from_amount
  }
  for (const e of expenses) {
    if (e.paid_by === userId && e.method === 'cash') line(e.currency).spent += e.amount
  }
  for (const s of settlements) {
    if (s.method !== 'cash') continue
    if (s.from_user === userId) line(baseCurrency).settled -= s.amount_base
    if (s.to_user === userId) line(baseCurrency).settled += s.amount_base
  }
  for (const l of Object.values(w)) l.balance = l.added - l.exchangedOut - l.spent + l.settled
  return w
}

// ───────────── пересчёт в другую валюту по курсу на день оплаты ─────────────

export interface DatedExpense extends ExpenseLike {
  amount: number // в валюте расхода
  currency: string
  spent_at: string
}
export interface DatedSettlement extends SettlementLike {
  created_at: string
}

/** Тенге за единицу валюты на день YYYY-MM-DD (Нацбанк РК) — или undefined, если курса нет. */
export type KztRatesByDay = (day: string) => Record<string, number> | undefined

// день оплаты — по времени Алматы (как у Нацбанка), чтобы у всех участников курс был один и тот же
const almatyDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Almaty' })
export const dayOf = (iso: string) => almatyDay.format(new Date(iso))

/** Дни, на которые нужны курсы, чтобы пересчитать поездку. */
export function daysToConvert(expenses: DatedExpense[], settlements: DatedSettlement[]): string[] {
  return [...new Set([...expenses.map((e) => dayOf(e.spent_at)), ...settlements.map((s) => dayOf(s.created_at))])].sort()
}

/** Расходы и возвраты в валюте `to`: каждый расход — по курсу на свой день; расход в `to` берётся как есть.
 *  Доли пересчитываются так, что их сумма точно равна сумме расхода. Возврат — по тому же среднему курсу,
 *  что и долги этой пары: иначе закрытый в базовой валюте долг из-за разницы курсов «ожил» бы на копейки.
 *  null — если для какого-то дня или валюты нет курса. */
export function convertTrip<E extends DatedExpense, S extends DatedSettlement>(
  expenses: E[],
  settlements: S[],
  base: string,
  to: string,
  rates: KztRatesByDay,
): { expenses: E[]; settlements: S[] } | null {
  const outE: E[] = []
  const debt = new Map<string, { base: number; to: number }>() // «должник>кредитор» — его долги в обеих валютах
  for (const e of expenses) {
    const kzt = rates(dayOf(e.spent_at))
    const direct = e.currency === to ? 1 : kzt && crossRate(kzt, e.currency, to)
    if (!direct) return null
    const total = Math.round(e.amount * direct)
    // доли — в той же пропорции, что и в базовой валюте (курс в самом расходе мог отличаться от курса Нацбанка)
    const vals = Object.fromEntries(e.shares.map((s) => [s.user_id, s.share_base]))
    const k = e.amount_base ? total / e.amount_base : 0
    const shares = customToBase(vals, k, total)
    outE.push({ ...e, amount_base: total, shares })
    for (const sh of shares) {
      if (sh.user_id === e.paid_by) continue
      const key = `${sh.user_id}>${e.paid_by}`
      const d = debt.get(key) ?? { base: 0, to: 0 }
      d.base += vals[sh.user_id] ?? 0
      d.to += sh.share_base
      debt.set(key, d)
    }
  }
  const outS: S[] = []
  for (const s of settlements) {
    // возврат гасит долги отправителя получателю — по их курсу; излишек — по курсу встречных долгов,
    // а если общих расходов не было — по курсу на день возврата
    const own = debt.get(`${s.from_user}>${s.to_user}`)
    const back = debt.get(`${s.to_user}>${s.from_user}`)
    const kzt = rates(dayOf(s.created_at))
    const dayRate = base === to ? 1 : kzt ? crossRate(kzt, base, to) : null
    const rateOf = (d?: { base: number; to: number }) => (d && d.base ? d.to / d.base : null)
    const covered = Math.min(s.amount_base, Math.max(0, own?.base ?? 0))
    const r1 = rateOf(own)
    const r2 = rateOf(back) ?? dayRate
    if ((covered && !r1) || (s.amount_base > covered && !r2)) return null
    if (own && covered) own.base -= covered // следующий возврат гасит уже остаток
    if (own && covered && r1) own.to -= covered * r1
    outS.push({ ...s, amount_base: Math.round(covered * (r1 ?? 0) + (s.amount_base - covered) * (r2 ?? 0)) })
  }
  return { expenses: outE, settlements: outS }
}
