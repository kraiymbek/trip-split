import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTripCtx } from './TripLayout'
import { formatMoney } from '../lib/money'
import { METHODS, methodLabel, type Expense, type PayMethod } from '../types'
import { Clock, Loader2, Plus, ReceiptText } from 'lucide-react'
import { Avatar, Card, Chip } from '../components/ui'
import { MethodIcon } from '../components/PayPicker'

const dayFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const dayTimeFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

// когда расход внесли; дату добавляем, только если внесли не в тот день, под которым он стоит
function addedAt(e: Expense): string {
  if (!e.created_at) return ''
  const c = new Date(e.created_at)
  return (sameDay(c, new Date(e.spent_at)) ? timeFmt : dayTimeFmt).format(c)
}

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
    <div className="pb-20">
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Card className="border-transparent bg-primary !p-4 text-primary-foreground shadow-md shadow-primary/15">
          <div className="text-xs font-medium opacity-80">Потрачено{method !== 'all' || payer !== 'all' ? ' (фильтр)' : ''}</div>
          <div className="mt-0.5 text-xl font-bold tabular">{formatMoney(total, base)}</div>
        </Card>
        <Card className="!p-4">
          <div className="text-xs font-medium text-muted-foreground">Из них на меня</div>
          <div className="mt-0.5 text-xl font-bold tabular">{formatMoney(mine, base)}</div>
        </Card>
      </div>

      <div className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={method === 'all'} onClick={() => setMethod('all')}>
          Все
        </Chip>
        {METHODS.map((m) => (
          <Chip key={m.id} active={method === m.id} onClick={() => setMethod(m.id)}>
            <MethodIcon m={m.id} className="size-4" /> {m.label}
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
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <ReceiptText className="size-7" aria-hidden />
          </span>
          {expenses.length ? 'Ничего не найдено' : 'Расходов пока нет. Нажми «+» внизу, чтобы добавить первый.'}
        </div>
      )}

      {groups.map((items) => (
        <section key={items[0].id} className="mb-5">
          <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground first-letter:uppercase">
            {dayFmt.format(new Date(items[0].spent_at))}
          </h2>
          <Card className="divide-y divide-border overflow-hidden !p-0">
            {items.map((e) => (
              <Link key={e.id} to={`e/${e.id}`} className="flex gap-3 px-4 py-3 transition-colors hover:bg-accent/40 active:bg-muted">
                <Avatar p={memberById[e.paid_by]} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 font-semibold">
                      {e.pending &&
                        (e.syncing ? (
                          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Сохраняется" />
                        ) : (
                          <Clock className="size-4 shrink-0 text-sky-600" aria-label="Ждёт отправки" />
                        ))}
                      {unseenExpenses.has(e.id) && (
                        <span className="size-2 shrink-0 rounded-full bg-destructive" role="img" aria-label="Новое" />
                      )}
                      <span className="truncate">{e.title}</span>
                    </div>
                    <div className="shrink-0 text-right font-semibold tabular">{formatMoney(e.amount, e.currency)}</div>
                  </div>
                  {e.note && <div className="truncate text-sm text-muted-foreground">{e.note}</div>}
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="flex min-w-0 items-center gap-1">
                      <MethodIcon m={e.method} className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {e.created_at && (
                          <time dateTime={e.created_at} className="tabular">
                            {addedAt(e)} ·{' '}
                          </time>
                        )}
                        {e.paid_by === me ? 'Я' : (memberById[e.paid_by]?.name ?? '?')} · {methodLabel(e.method, e.bank)} ·{' '}
                        {forWhom(e)}
                      </span>
                    </span>
                    {e.currency !== base && <span className="shrink-0 tabular">≈ {formatMoney(e.amount_base, base)}</span>}
                  </div>
                </div>
              </Link>
            ))}
          </Card>
        </section>
      ))}

      <Link
        to="new"
        className="fixed right-5 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-30 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95"
        aria-label="Добавить расход"
      >
        <Plus className="size-7" />
      </Link>
    </div>
  )
}
