import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTripCtx } from './TripLayout'
import { formatMoney } from '../lib/money'
import { METHODS, methodLabel, type Expense, type PayMethod } from '../types'
import { Avatar, Card, Chip } from '../components/ui'

const dayFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })

export default function TripExpenses() {
  const { trip, expenses, members, memberById, me, unseenExpenses } = useTripCtx()
  const [method, setMethod] = useState<PayMethod | 'all'>('all')
  const [payer, setPayer] = useState<string>('all')
  const base = trip.base_currency

  const filtered = useMemo(
    () =>
      expenses.filter((e) => (method === 'all' || e.method === method) && (payer === 'all' || e.paid_by === payer)),
    [expenses, method, payer],
  )

  const groups = useMemo(() => {
    const m = new Map<string, Expense[]>()
    for (const e of filtered) {
      const d = new Date(e.spent_at)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(e)
    }
    return [...m.values()]
  }, [filtered])

  const total = filtered.reduce((s, e) => s + e.amount_base, 0)
  const mine = filtered.reduce((s, e) => s + (e.shares.find((x) => x.user_id === me)?.share_base ?? 0), 0)

  const forWhom = (e: Expense) => {
    if (e.shares.length === members.length && members.length > 1) return 'за всех'
    if (e.shares.length === 1 && e.shares[0].user_id === e.paid_by) return 'за себя'
    return 'за ' + e.shares.map((s) => memberById[s.user_id]?.name ?? '?').join(', ')
  }

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Card className="!p-3">
          <div className="text-xs text-slate-500">Потрачено{method !== 'all' || payer !== 'all' ? ' (фильтр)' : ''}</div>
          <div className="text-lg font-bold">{formatMoney(total, base)}</div>
        </Card>
        <Card className="!p-3">
          <div className="text-xs text-slate-500">Из них на меня</div>
          <div className="text-lg font-bold">{formatMoney(mine, base)}</div>
        </Card>
      </div>

      <div className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={method === 'all'} onClick={() => setMethod('all')}>
          Все
        </Chip>
        {METHODS.map((m) => (
          <Chip key={m.id} active={method === m.id} onClick={() => setMethod(m.id)}>
            {m.icon} {m.label}
          </Chip>
        ))}
      </div>
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={payer === 'all'} onClick={() => setPayer('all')}>
          Платил кто угодно
        </Chip>
        {members.map((m) => (
          <Chip key={m.id} active={payer === m.id} onClick={() => setPayer(m.id)}>
            {m.id === me ? 'Я' : m.name}
          </Chip>
        ))}
      </div>

      {groups.length === 0 && (
        <div className="py-16 text-center text-slate-500">
          <div className="mb-2 text-4xl">🧾</div>
          {expenses.length ? 'Ничего не найдено' : 'Расходов пока нет. Жми «+», чтобы добавить первый.'}
        </div>
      )}

      {groups.map((items) => (
        <section key={items[0].id} className="mb-5">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {dayFmt.format(new Date(items[0].spent_at))}
          </h2>
          <Card className="divide-y divide-slate-100 !p-0">
            {items.map((e) => (
              <Link key={e.id} to={`e/${e.id}`} className="flex gap-3 px-4 py-3 active:bg-slate-50">
                <Avatar p={memberById[e.paid_by]} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="truncate font-semibold">
                      {e.pending && <span title="Ждёт отправки">⏳ </span>}
                      {unseenExpenses.has(e.id) && (
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-rose-500 align-middle" title="Новое" />
                      )}
                      {e.title}
                    </div>
                    <div className="shrink-0 text-right font-semibold">{formatMoney(e.amount, e.currency)}</div>
                  </div>
                  {e.note && <div className="truncate text-sm text-slate-500">{e.note}</div>}
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="flex min-w-0 items-center">
                      <span className="truncate">
                        {e.paid_by === me ? 'Я' : (memberById[e.paid_by]?.name ?? '?')} · {methodLabel(e.method, e.bank)} ·{' '}
                        {forWhom(e)}
                      </span>
                    </span>
                    {e.currency !== base && <span className="shrink-0">≈ {formatMoney(e.amount_base, base)}</span>}
                  </div>
                </div>
              </Link>
            ))}
          </Card>
        </section>
      ))}

      <Link
        to="new"
        className="fixed right-5 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-teal-600 text-3xl text-white shadow-lg active:bg-teal-700"
        aria-label="Добавить расход"
      >
        +
      </Link>
    </div>
  )
}
