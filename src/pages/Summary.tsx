import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTripCtx } from './TripLayout'
import { breakdownByMethod, computeStats, simplifyDebts, type Transfer } from '../lib/balance'
import { CURRENCIES, convert, formatMoney, minorToInput, moneyError, parseMoney } from '../lib/money'
import { fetchRate } from '../lib/rates'
import { errMsg, supabase } from '../lib/supabase'
import { discard, enqueue, isNetworkError, uuid } from '../lib/outbox'
import { BANKS, METHODS, methodLabel, type PayMethod, type Profile } from '../types'
import { PayPicker, lastBank } from '../components/PayPicker'
import { Avatar, Button, Card, Chip, ErrorBox, Label } from '../components/ui'

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function Summary() {
  const { trip, members, memberById, expenses, settlements, me, reload } = useTripCtx()
  const base = trip.base_currency
  const alt = base === 'KZT' ? 'THB' : 'KZT'
  const [altRate, setAltRate] = useState<number | null>(null)
  const [showAlt, setShowAlt] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (showAlt && altRate === null) fetchRate(base, alt).then(setAltRate)
  }, [showAlt, altRate, base, alt])

  const memberIds = members.map((m) => m.id)
  const stats = useMemo(() => computeStats(memberIds, expenses, settlements), [memberIds.join(','), expenses, settlements]) // eslint-disable-line react-hooks/exhaustive-deps
  const transfers = useMemo(
    () => simplifyDebts(Object.fromEntries(Object.entries(stats).map(([id, s]) => [id, s.balance]))),
    [stats],
  )
  const byMethod = useMemo(() => breakdownByMethod(expenses), [expenses])
  const total = expenses.reduce((s, e) => s + e.amount_base, 0)

  const money = (minor: number) => (
    <>
      {formatMoney(minor, base)}
      {showAlt && altRate && (
        <span className="ml-1 text-[0.8em] font-normal opacity-60">≈ {formatMoney(convert(minor, altRate), alt)}</span>
      )}
    </>
  )
  const name = (id: string) => (id === me ? 'Я' : (memberById[id]?.name ?? 'Бывший участник'))

  const myBalance = stats[me]?.balance ?? 0

  async function deleteSettlement(id: string) {
    if (!confirm('Отменить отметку о возврате?')) return
    if (settlements.find((s) => s.id === id)?.pending) return discard(id)
    const { error } = await supabase.from('settlements').delete().eq('id', id)
    if (error) setError(errMsg(error))
    else reload()
  }

  return (
    <div className="space-y-5 pb-6">
      <div className="flex justify-end">
        <Chip active={showAlt} onClick={() => setShowAlt((v) => !v)}>
          {CURRENCIES[alt].flag} Показать в {alt}
        </Chip>
      </div>

      {/* мой итог */}
      <Card
        className={`text-center ${myBalance > 0 ? '!bg-teal-600 text-white' : myBalance < 0 ? '!bg-rose-600 text-white' : ''}`}
      >
        <div className="text-sm opacity-80">
          {myBalance > 0 ? 'Тебе должны' : myBalance < 0 ? 'Ты должен' : 'Ты в расчёте'}
        </div>
        <div className="mt-1 text-3xl font-bold">{myBalance === 0 ? '🎉' : money(Math.abs(myBalance))}</div>
      </Card>

      {/* переводы */}
      <section>
        <Label>Кто кому переводит</Label>
        {transfers.length === 0 ? (
          <Card className="text-center text-slate-500">Все в расчёте ✨</Card>
        ) : (
          <Card className="divide-y divide-slate-100 !p-0">
            {transfers.map((t) => (
              <TransferRow
                key={`${t.from}-${t.to}-${t.amount}`}
                t={t}
                fromName={name(t.from)}
                toName={name(t.to)}
                highlight={t.from === me || t.to === me}
                open={open === `${t.from}-${t.to}`}
                onToggle={() => setOpen(open === `${t.from}-${t.to}` ? null : `${t.from}-${t.to}`)}
                money={money}
                base={base}
                onDone={async (amount, method, bank) => {
                  const row = { id: uuid(), trip_id: trip.id, from_user: t.from, to_user: t.to, amount_base: amount, method, bank }
                  let error: { message: string } | null
                  try {
                    error = (await supabase.from('settlements').insert(row)).error
                  } catch (e) {
                    error = { message: e instanceof Error ? e.message : String(e) }
                  }
                  if (error && isNetworkError(error)) {
                    enqueue({ id: row.id, tripId: trip.id, kind: 'settlement', payload: row,
                      label: `Возврат: ${name(t.from)} → ${name(t.to)} · ${formatMoney(amount, base)}` })
                    setOpen(null)
                    return
                  }
                  if (error) return setError(errMsg(error))
                  setOpen(null)
                  reload()
                }}
                fromP={memberById[t.from]}
                toP={memberById[t.to]}
              />
            ))}
          </Card>
        )}
        <div className="mt-2">
          <ErrorBox>{error}</ErrorBox>
        </div>
      </section>

      {/* участники */}
      <section>
        <Label>Баланс участников</Label>
        <Card className="divide-y divide-slate-100 !p-0">
          {members.map((m) => {
            const s = stats[m.id]
            return (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar p={m} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{name(m.id)}</div>
                  <div className="text-xs text-slate-500">
                    заплатил {formatMoney(s.paid, base)} · его траты {formatMoney(s.consumed, base)}
                  </div>
                </div>
                <div
                  className={`text-right font-semibold ${s.balance > 0 ? 'text-teal-700' : s.balance < 0 ? 'text-rose-600' : 'text-slate-400'}`}
                >
                  {s.balance > 0 ? '+' : s.balance < 0 ? '−' : ''}
                  {formatMoney(Math.abs(s.balance), base)}
                </div>
              </div>
            )
          })}
        </Card>
      </section>

      {/* способы оплаты */}
      <section>
        <Label>Чем платили · всего {formatMoney(total, base)}</Label>
        <Card className="space-y-3">
          <Bar label="💳 Карта" value={byMethod.total.card} total={total} base={base} />
          {BANKS.filter((b) => byMethod.byBank[b.id]).length > 0 && (
            <div className="space-y-1 border-l-2 border-slate-100 pl-3">
              {BANKS.filter((b) => byMethod.byBank[b.id]).map((b) => (
                <div key={b.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />
                    {b.label}
                  </span>
                  <span className="text-slate-500">{formatMoney(byMethod.byBank[b.id], base)}</span>
                </div>
              ))}
            </div>
          )}
          <Bar label="💵 Наличные" value={byMethod.total.cash} total={total} base={base} />
          {members.some((m) => byMethod.byPayer[m.id]) && (
            <div className="border-t border-slate-100 pt-3 text-sm">
              {members
                .filter((m) => byMethod.byPayer[m.id])
                .map((m) => (
                  <div key={m.id} className="flex justify-between gap-2 py-0.5">
                    <span className="text-slate-600">{name(m.id)}</span>
                    <span className="text-right text-slate-500">
                      {METHODS.filter((x) => byMethod.byPayer[m.id][x.id])
                        .map((x) => `${x.icon} ${formatMoney(byMethod.byPayer[m.id][x.id], base)}`)
                        .join(' · ')}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </Card>
      </section>


      {/* история возвратов */}
      {settlements.length > 0 && (
        <section>
          <Label>Возвраты долгов</Label>
          <Card className="divide-y divide-slate-100 !p-0">
            {settlements.map((s) => (
              <div key={s.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div>
                    {name(s.from_user)} → {name(s.to_user)}: <b>{formatMoney(s.amount_base, base)}</b>
                  </div>
                  <div className="text-xs text-slate-500">
                    {s.pending ? '⏳ ждёт отправки · ' : ''}{methodLabel(s.method, s.bank)} · {dateFmt.format(new Date(s.created_at))}
                  </div>
                </div>
                <button onClick={() => deleteSettlement(s.id)} className="px-2 text-slate-400" aria-label="Отменить">
                  ✕
                </button>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  )
}

function Bar({ label, value, total, base }: { label: string; value: number; total: number; base: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-medium">
          {formatMoney(value, base)} <span className="text-slate-400">· {pct}%</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function TransferRow(props: {
  t: Transfer
  fromName: string
  toName: string
  fromP?: Profile
  toP?: Profile
  highlight: boolean
  open: boolean
  onToggle: () => void
  money: (m: number) => ReactNode
  base: string
  onDone: (amount: number, method: PayMethod, bank: string | null) => Promise<void>
}) {
  const { t, open } = props
  const [method, setMethod] = useState<PayMethod>('card')
  const [bank, setBank] = useState<string | null>(lastBank)
  const [amountStr, setAmountStr] = useState(minorToInput(t.amount))
  const [busy, setBusy] = useState(false)
  const amount = parseMoney(amountStr)

  return (
    <div className={props.highlight ? 'bg-amber-50/60' : ''}>
      <button onClick={props.onToggle} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <Avatar p={props.fromP} size={28} />
        <span className="font-medium">{props.fromName}</span>
        <span className="text-slate-400">→</span>
        <Avatar p={props.toP} size={28} />
        <span className="flex-1 truncate font-medium">{props.toName}</span>
        <span className="font-bold">{props.money(t.amount)}</span>
      </button>
      {open && (
        <div className="space-y-2 px-4 pb-4">
          <div className="text-xs text-slate-500">Отметить, что долг возвращён (можно частично):</div>
          <PayPicker
            method={method}
            bank={bank}
            onChange={(m, b) => {
              setMethod(m)
              setBank(b)
            }}
          />
          <div className="flex gap-2">
            <div className="flex flex-1 items-center rounded-xl bg-white px-3 ring-1 ring-slate-200">
              <input
                className="h-11 w-full bg-transparent outline-none"
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
              />
              <span className="text-slate-400">{CURRENCIES[props.base]?.symbol ?? props.base}</span>
            </div>
            <Button
              className="!h-11"
              disabled={!amount || amount > t.amount || (method === 'card' && !bank) || busy}
              onClick={async () => {
                setBusy(true)
                await props.onDone(amount!, method, method === 'card' ? bank : null)
                setBusy(false)
              }}
            >
              Вернул ✓
            </Button>
          </div>
          {amount !== null && amount > t.amount && (
            <div className="text-xs text-amber-700">Больше долга — максимум {formatMoney(t.amount, props.base)}</div>
          )}
          {amount === null && amountStr.trim() !== '' && (
            <div className="text-xs text-amber-700">{moneyError(amountStr)}</div>
          )}
        </div>
      )}
    </div>
  )
}
