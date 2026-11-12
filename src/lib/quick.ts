// Быстрые кнопки «на что потратили»: сначала то, что в этой поездке вводили чаще всего, потом типовые траты.
import type { Expense, PayMethod } from '../types'

export const DEFAULT_QUICK = ['Grab', '7-Eleven', 'Еда', 'Кафе', 'Такси', 'Массаж', 'Продукты', 'Бар', 'Отель', 'Экскурсия']

const norm = (s: string) => s.trim().toLowerCase()

export function quickTitles(expenses: Expense[], limit = 10, defaults = DEFAULT_QUICK): string[] {
  const stat = new Map<string, { title: string; count: number; last: string }>()
  for (const e of expenses) {
    const k = norm(e.title)
    if (!k) continue
    const cur = stat.get(k)
    if (!cur) stat.set(k, { title: e.title.trim(), count: 1, last: e.spent_at })
    else {
      cur.count++
      if (e.spent_at > cur.last) cur.last = e.spent_at
    }
  }
  // своё — только то, что повторялось (разовое «Ужин у Сомчая» кнопкой не нужно)
  const own = [...stat.values()]
    .filter((x) => x.count >= 2)
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
    .map((x) => x.title)
  const seen = new Set(own.map(norm))
  return [...own, ...defaults.filter((d) => !seen.has(norm(d)))].slice(0, limit)
}

/** Как платил в прошлый раз за то же самое — чтобы подставить валюту и способ оплаты. */
export function lastUsed(
  expenses: Expense[],
  title: string,
  me: string,
): { currency: string; method: PayMethod; bank: string | null } | null {
  const k = norm(title)
  const mine = expenses
    .filter((e) => norm(e.title) === k && e.paid_by === me)
    .sort((a, b) => b.spent_at.localeCompare(a.spent_at))[0]
  return mine ? { currency: mine.currency, method: mine.method, bank: mine.bank } : null
}
