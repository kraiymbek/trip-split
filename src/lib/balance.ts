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

/** Минимизирует число переводов: самый крупный должник платит самому крупному кредитору. */
export function simplifyDebts(balances: Record<string, number>): Transfer[] {
  const debtors = Object.entries(balances)
    .filter(([, b]) => b < 0)
    .map(([id, b]) => ({ id, amt: -b }))
  const creditors = Object.entries(balances)
    .filter(([, b]) => b > 0)
    .map(([id, b]) => ({ id, amt: b }))
  const out: Transfer[] = []

  while (debtors.length && creditors.length) {
    debtors.sort((a, b) => b.amt - a.amt)
    creditors.sort((a, b) => b.amt - a.amt)
    const d = debtors[0]
    const c = creditors[0]
    const amount = Math.min(d.amt, c.amt)
    out.push({ from: d.id, to: c.id, amount })
    d.amt -= amount
    c.amt -= amount
    if (d.amt === 0) debtors.shift()
    if (c.amt === 0) creditors.shift()
  }
  return out
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
