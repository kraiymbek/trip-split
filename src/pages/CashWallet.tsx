import { useMemo, useState, type FormEvent } from 'react'
import { useTripCtx } from './TripLayout'
import { computeWallet } from '../lib/balance'
import { CURRENCIES, QUICK_CURRENCIES, formatMoney, moneyError, parseMoney } from '../lib/money'
import { errMsg, supabase } from '../lib/supabase'
import { discard, enqueue, isNetworkError, uuid } from '../lib/outbox'
import { ArrowLeftRight, Banknote, Check, Loader2, Clock, HandCoins, Luggage, Receipt, Trash2, type LucideIcon } from 'lucide-react'
import { Button, Card, Chip, ErrorBox, Label, inputCls } from '../components/ui'

const pad = (n: number) => String(n).padStart(2, '0')
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
const sym = (c: string) => CURRENCIES[c]?.symbol ?? c

function CurrencyChips({ value, onChange, exclude }: { value: string; onChange: (c: string) => void; exclude?: string }) {
  const quick = QUICK_CURRENCIES.filter((c) => c !== exclude)
  const isOther = !quick.includes(value)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {quick.map((c) => (
        <Chip key={c} active={value === c} onClick={() => onChange(c)}>
          {CURRENCIES[c]?.flag} {c}
        </Chip>
      ))}
      <select
        className={`h-9 rounded-full px-3 text-sm ring-1 outline-none ${
          isOther ? 'bg-primary text-white ring-primary' : 'bg-card text-muted-foreground ring-border'
        }`}
        value={isOther ? value : ''}
        onChange={(e) => e.target.value && onChange(e.target.value)}
      >
        <option value="">Другая…</option>
        {Object.entries(CURRENCIES)
          .filter(([code]) => !quick.includes(code) && code !== exclude)
          .map(([code, c]) => (
            <option key={code} value={code}>
              {c.flag} {code}
            </option>
          ))}
      </select>
    </div>
  )
}

type HistoryItem = {
  key: string
  date: string
  icon: LucideIcon
  title: string
  sub?: string
  lines: { amount: number; currency: string }[]
  opId?: string
  pending?: boolean
}

export default function CashWallet() {
  const { trip, expenses, settlements, cashOps, me, memberById, reload } = useTripCtx()
  const base = trip.base_currency
  const [mode, setMode] = useState<'none' | 'exchange' | 'deposit'>('none')

  const wallet = useMemo(
    () => computeWallet(me, cashOps, expenses, settlements, base),
    [me, cashOps, expenses, settlements, base],
  )
  // бат первым, дальше остальные валюты, где было движение
  const currencies = Object.keys(wallet).sort((a, b) => (a === 'THB' ? -1 : b === 'THB' ? 1 : a.localeCompare(b)))
  const main = currencies[0]

  const history: HistoryItem[] = useMemo(() => {
    const items: HistoryItem[] = []
    for (const o of cashOps) {
      if (o.user_id !== me) continue
      items.push(
        o.kind === 'deposit'
          ? {
              key: o.id,
              date: o.happened_at,
              icon: Luggage,
              title: 'Привёз с собой',
              sub: o.note ?? undefined,
              lines: [{ amount: o.to_amount, currency: o.to_currency }],
              opId: o.id,
              pending: o.pending,
            }
          : {
              key: o.id,
              date: o.happened_at,
              icon: ArrowLeftRight,
              title: `Обмен ${o.from_currency} → ${o.to_currency}`,
              sub: [
                `курс 1 ${o.from_currency} = ${+(o.to_amount / o.from_amount!).toPrecision(5)} ${o.to_currency}`,
                o.note,
              ]
                .filter(Boolean)
                .join(' · '),
              lines: [
                { amount: o.to_amount, currency: o.to_currency },
                { amount: -o.from_amount!, currency: o.from_currency! },
              ],
              opId: o.id,
              pending: o.pending,
            },
      )
    }
    for (const e of expenses) {
      if (e.paid_by !== me || e.method !== 'cash') continue
      items.push({
        key: e.id,
        date: e.spent_at,
        icon: Receipt,
        title: e.title,
        sub: 'расход наличными',
        lines: [{ amount: -e.amount, currency: e.currency }],
      })
    }
    for (const s of settlements) {
      if (s.method !== 'cash' || (s.from_user !== me && s.to_user !== me)) continue
      const out = s.from_user === me
      const other = memberById[out ? s.to_user : s.from_user]?.name ?? '?'
      items.push({
        key: s.id,
        date: s.created_at,
        icon: HandCoins,
        title: out ? `Вернул долг: ${other}` : `Вернули долг: ${other}`,
        lines: [{ amount: out ? -s.amount_base : s.amount_base, currency: base }],
      })
    }
    return items.sort((a, b) => b.date.localeCompare(a.date))
  }, [cashOps, expenses, settlements, me, memberById, base])

  async function removeOp(id: string) {
    if (!confirm('Удалить эту запись?')) return
    if (cashOps.find((o) => o.id === id)?.pending) return discard(id)
    const { error } = await supabase.from('cash_ops').delete().eq('id', id)
    if (error) alert(errMsg(error))
    else reload()
  }

  return (
    <div className="space-y-5 pb-6">
      {/* остаток */}
      {main ? (
        <Card
          className={`border-transparent shadow-md ${wallet[main].balance < 0 ? '!bg-negative text-white shadow-negative/20' : '!bg-primary text-primary-foreground shadow-primary/20'}`}
        >
          <div className="flex items-center gap-1.5 text-sm font-medium opacity-85">
            <Banknote className="size-4" aria-hidden /> Наличными у меня
          </div>
          <div className="mt-1 text-4xl font-bold tracking-tight tabular">{formatMoney(wallet[main].balance, main)}</div>
          {currencies.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm opacity-90">
              {currencies.slice(1).map((c) => (
                <span key={c} className="tabular">{formatMoney(wallet[c].balance, c)}</span>
              ))}
            </div>
          )}
        </Card>
      ) : (
        <Card className="flex flex-col items-center gap-3 py-6 text-center text-muted-foreground">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <Banknote className="size-7" aria-hidden />
          </span>
          Здесь будет твой остаток наличных. Отметь, сколько взял с собой, и записывай каждый обмен.
        </Card>
      )}

      {currencies.some((c) => wallet[c].balance < 0) && (
        <p className="text-xs text-negative">
          Минус значит, что наличными потрачено больше, чем записано. Добавь «Привёз с собой» или обмен.
        </p>
      )}

      {/* кнопки */}
      <div className="grid grid-cols-2 gap-2">
        <Button variant={mode === 'exchange' ? 'primary' : 'ghost'} onClick={() => setMode(mode === 'exchange' ? 'none' : 'exchange')}>
          <ArrowLeftRight /> Обменял
        </Button>
        <Button variant={mode === 'deposit' ? 'primary' : 'ghost'} onClick={() => setMode(mode === 'deposit' ? 'none' : 'deposit')}>
          <Luggage /> Привёз с собой
        </Button>
      </div>

      {mode !== 'none' && (
        <OpForm
          key={mode}
          kind={mode}
          tripId={trip.id}
          onDone={() => {
            setMode('none')
            reload()
          }}
        />
      )}

      {/* по валютам */}
      {currencies.length > 0 && (
        <section>
          <Label>По валютам</Label>
          <Card className="divide-y divide-border !p-0">
            {currencies.map((c) => {
              const l = wallet[c]
              const parts = [
                l.added && `+${formatMoney(l.added, c)} пришло`,
                l.exchangedOut && `−${formatMoney(l.exchangedOut, c)} обменял`,
                l.spent && `−${formatMoney(l.spent, c)} потратил`,
                l.settled && `${l.settled > 0 ? '+' : '−'}${formatMoney(Math.abs(l.settled), c)} долги`,
              ].filter(Boolean)
              return (
                <div key={c} className="px-4 py-3">
                  <div className="flex justify-between font-semibold">
                    <span>
                      {CURRENCIES[c]?.flag} {c}
                    </span>
                    <span className={`tabular ${l.balance < 0 ? 'text-negative' : ''}`}>{formatMoney(l.balance, c)}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{parts.join(' · ')}</div>
                </div>
              )
            })}
          </Card>
        </section>
      )}

      {/* история */}
      {history.length > 0 && (
        <section>
          <Label>История наличных</Label>
          <Card className="divide-y divide-border !p-0">
            {history.map((h) => (
              <div key={h.key} className="flex items-start gap-3 px-4 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <h.icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    {h.pending && <Clock className="size-3.5 shrink-0 text-sky-600" aria-label="Ждёт отправки" />}
                    <span className="truncate">{h.title}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {dateFmt.format(new Date(h.date))}
                    {h.sub ? ` · ${h.sub}` : ''}
                  </div>
                </div>
                <div className="shrink-0 text-right text-sm font-semibold tabular">
                  {h.lines.map((l, i) => (
                    <div key={i} className={l.amount < 0 ? 'text-negative' : 'text-primary'}>
                      {l.amount < 0 ? '−' : '+'}
                      {formatMoney(Math.abs(l.amount), l.currency)}
                    </div>
                  ))}
                </div>
                {h.opId && (
                  <button
                    onClick={() => removeOp(h.opId!)}
                    className="-my-1 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/5 hover:text-destructive"
                    aria-label="Удалить запись"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">
            Расходы наличными и возвраты долгов наличными попадают сюда сами. Возвраты считаются в {base}.
          </p>
        </section>
      )}
    </div>
  )
}

function OpForm({ kind, tripId, onDone }: { kind: 'exchange' | 'deposit'; tripId: string; onDone: () => void }) {
  const [fromStr, setFromStr] = useState('')
  const [fromCur, setFromCur] = useState('USD')
  const [toStr, setToStr] = useState('')
  const [toCur, setToCur] = useState(kind === 'exchange' ? 'THB' : 'KZT')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(today())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const from = parseMoney(fromStr)
  const to = parseMoney(toStr)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (kind === 'exchange') {
      const fe = moneyError(fromStr)
      if (fe) return setError(`Отдал: ${fe.toLowerCase()}`)
      if (fromCur === toCur) return setError('Валюты обмена должны отличаться')
    }
    const te = moneyError(toStr)
    if (te) return setError(kind === 'exchange' ? `Получил: ${te.toLowerCase()}` : te)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Укажи дату')

    const happened_at = date === today() ? new Date().toISOString() : new Date(`${date}T12:00:00`).toISOString()
    setBusy(true)
    const row = {
      id: uuid(),
      trip_id: tripId,
      kind,
      from_amount: kind === 'exchange' ? from : null,
      from_currency: kind === 'exchange' ? fromCur : null,
      to_amount: to,
      to_currency: toCur,
      note: note.trim() || null,
      happened_at,
    }
    let error: { message: string } | null
    try {
      error = (await supabase.from('cash_ops').insert(row)).error
    } catch (e) {
      error = { message: e instanceof Error ? e.message : String(e) }
    }
    setBusy(false)
    if (error && isNetworkError(error)) {
      enqueue({
        id: row.id,
        tripId,
        kind: 'cash',
        payload: row,
        label:
          kind === 'exchange'
            ? `Обмен ${formatMoney(from!, fromCur)} → ${formatMoney(to!, toCur)}`
            : `Привёз с собой ${formatMoney(to!, toCur)}`,
      })
      return onDone()
    }
    if (error) return setError(errMsg(error))
    onDone()
  }

  const amountInput = (value: string, set: (v: string) => void, cur: string) => (
    <div className="flex items-center rounded-xl bg-card px-3.5 border focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      <input
        className="h-12 w-full bg-transparent text-xl font-semibold outline-none placeholder:text-muted-foreground/50"
        inputMode="decimal"
        placeholder="0"
        value={value}
        onChange={(e) => set(e.target.value)}
      />
      <span className="text-lg font-semibold text-muted-foreground">{sym(cur)}</span>
    </div>
  )

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        {kind === 'exchange' ? (
          <>
            <div className="space-y-2">
              <Label>Отдал</Label>
              {amountInput(fromStr, setFromStr, fromCur)}
              <CurrencyChips value={fromCur} onChange={setFromCur} exclude={toCur} />
            </div>
            <div className="space-y-2">
              <Label>Получил</Label>
              {amountInput(toStr, setToStr, toCur)}
              <CurrencyChips value={toCur} onChange={setToCur} exclude={fromCur} />
            </div>
            {from && to && fromCur !== toCur && (
              <div className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                Курс: 1 {fromCur} = <b>{+(to / from).toPrecision(5)}</b> {toCur}
              </div>
            )}
            <input
              className={inputCls}
              placeholder="Где менял (необязательно)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
            />
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Label>Сколько наличных взял</Label>
              {amountInput(toStr, setToStr, toCur)}
              <CurrencyChips value={toCur} onChange={setToCur} />
            </div>
            <input
              className={inputCls}
              placeholder="Комментарий (необязательно)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
            />
          </>
        )}
        <div>
          <Label>
            <label htmlFor="cash-date">Дата</label>
          </Label>
          <input id="cash-date" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <ErrorBox>{error}</ErrorBox>
        <Button className="w-full" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
          Сохранить
        </Button>
      </form>
    </Card>
  )
}
