// Экспорт поездки в CSV, который нормально открывается в Excel (RU), Numbers и Google Таблицах:
// разделитель «;», дробная часть через запятую, BOM для кириллицы.
import { computeStats, computeWallet, simplifyDebts } from './balance'
import type { CashOp, Expense, Profile, Settlement, Trip } from '../types'
import { bankLabel } from '../types'

const num = (minor: number) => (minor / 100).toFixed(2).replace('.', ',')
const date = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}
const cell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const row = (...cells: (string | number | null | undefined)[]) => cells.map(cell).join(';')
const method = (m: string, bank: string | null) => (m === 'card' ? `Карта (${bankLabel(bank)})` : 'Наличные')

export interface ExportData {
  trip: Trip
  members: Profile[]
  memberById: Record<string, Profile>
  expenses: Expense[]
  settlements: Settlement[]
  cashOps: CashOp[]
}

export function buildTripCsv(d: ExportData): string {
  const base = d.trip.base_currency
  const name = (id: string) => d.memberById[id]?.name ?? 'Бывший участник'
  const ids = d.members.map((m) => m.id)
  const stats = computeStats(ids, d.expenses, d.settlements)
  const transfers = simplifyDebts(Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.balance])))
  const L: string[] = []

  L.push(row(`Поездка: ${d.trip.name}`), row(`Выгружено: ${date(new Date().toISOString())}`, `Валюта итогов: ${base}`), '')

  L.push(row('ИТОГИ'), row('Участник', `Заплатил, ${base}`, `Его траты, ${base}`, `Вернул, ${base}`, `Получил возвратов, ${base}`, `Баланс, ${base}`))
  for (const m of d.members) {
    const s = stats[m.id]
    L.push(row(m.name, num(s.paid), num(s.consumed), num(s.settledOut), num(s.settledIn), num(s.balance)))
  }
  L.push('', row('КТО КОМУ ПЕРЕВОДИТ'), row('Кто', 'Кому', `Сумма, ${base}`))
  if (transfers.length === 0) L.push(row('Все в расчёте'))
  for (const t of transfers) L.push(row(name(t.from), name(t.to), num(t.amount)))

  L.push('', row('РАСХОДЫ'))
  L.push(
    row('Дата', 'На что', 'Комментарий', 'Сумма', 'Валюта', 'Курс', `Сумма, ${base}`, 'Чем платили', 'Кто платил',
      ...d.members.map((m) => `Доля: ${m.name}, ${base}`)),
  )
  for (const e of [...d.expenses].sort((a, b) => a.spent_at.localeCompare(b.spent_at))) {
    const share = (id: string) => e.shares.find((s) => s.user_id === id)?.share_base
    L.push(
      row(date(e.spent_at), e.title, e.note, num(e.amount), e.currency, String(e.rate).replace('.', ','), num(e.amount_base),
        method(e.method, e.bank), name(e.paid_by), ...ids.map((id) => (share(id) ? num(share(id)!) : ''))),
    )
  }
  L.push(row('', 'ИТОГО', '', '', '', '', num(d.expenses.reduce((s, e) => s + e.amount_base, 0))))

  L.push('', row('ВОЗВРАТЫ ДОЛГОВ'), row('Дата', 'Кто', 'Кому', `Сумма, ${base}`, 'Как'))
  for (const s of [...d.settlements].sort((a, b) => a.created_at.localeCompare(b.created_at)))
    L.push(row(date(s.created_at), name(s.from_user), name(s.to_user), num(s.amount_base), method(s.method, s.bank)))

  L.push('', row('НАЛИЧНЫЕ: ОПЕРАЦИИ'), row('Дата', 'Кто', 'Что', 'Отдал', 'Валюта', 'Получил', 'Валюта', 'Комментарий'))
  for (const o of [...d.cashOps].sort((a, b) => a.happened_at.localeCompare(b.happened_at)))
    L.push(
      row(date(o.happened_at), name(o.user_id), o.kind === 'deposit' ? 'Привёз с собой' : 'Обмен',
        o.from_amount ? num(o.from_amount) : '', o.from_currency, num(o.to_amount), o.to_currency, o.note),
    )

  L.push('', row('НАЛИЧНЫЕ: ОСТАТКИ'), row('Участник', 'Валюта', 'Пришло', 'Обменял', 'Потратил', 'Возвраты', 'Остаток'))
  for (const m of d.members) {
    const w = computeWallet(m.id, d.cashOps, d.expenses, d.settlements, base)
    for (const [cur, l] of Object.entries(w))
      L.push(row(m.name, cur, num(l.added), num(l.exchangedOut), num(l.spent), num(l.settled), num(l.balance)))
  }

  return '﻿' + L.join('\r\n') + '\r\n'
}

export function exportFileName(trip: Trip) {
  const safe = trip.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '_') || 'trip'
  return `${safe}_${new Date().toISOString().slice(0, 10)}.csv`
}

/** На телефоне — системное «Поделиться» (сохранить в Файлы, отправить в чат), иначе обычная загрузка. */
export async function saveFile(name: string, content: string): Promise<void> {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const file = new File([blob], name, { type: 'text/csv' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.canShare?.({ files: [file] }) && /Android|iPhone|iPad|iPod/.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file], title: name })
      return
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
