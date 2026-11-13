import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTripCtx } from './TripLayout'
import { baseToCustom, customToBase, splitEqual, type ShareLike } from '../lib/balance'
import {
  CURRENCIES,
  QUICK_CURRENCIES,
  convert,
  formatMoney,
  minorToInput,
  moneyError,
  parseMoney,
  parseRate,
} from '../lib/money'
import { fetchRate } from '../lib/rates'
import { errMsg, supabase } from '../lib/supabase'
import { discard, enqueue, isNetworkError, uuid } from '../lib/outbox'
import type { PayMethod } from '../types'
import { PayPicker, lastBank } from '../components/PayPicker'
import { lastUsed, quickTitles } from '../lib/quick'
import { Check, Loader2, Lock, Trash2 } from 'lucide-react'
import { canModify } from '../lib/rights'
import { Avatar, Button, Card, Chip, ErrorBox, Label, inputCls } from '../components/ui'

const pad = (n: number) => String(n).padStart(2, '0')
const addedFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* private mode */
  }
}

export default function ExpenseForm() {
  const { trip, members, memberById, expenses, me, markExpenseSeen, unseenExpenses } = useTripCtx()
  const { expenseId } = useParams()
  const nav = useNavigate()
  const editing = expenseId ? expenses.find((e) => e.id === expenseId) : undefined
  // чужой расход — только просмотр (сервер тоже не даст изменить или удалить)
  const readOnly = !!editing && !canModify(editing, me)
  const quick = useMemo(() => quickTitles(expenses.filter((e) => !e.pending)), [expenses])

  // открыл расход, о котором было уведомление, — значит, посмотрел
  useEffect(() => {
    if (editing && unseenExpenses.has(editing.id)) markExpenseSeen(editing.id)
  }, [editing, unseenExpenses, markExpenseSeen])
  const base = trip.base_currency
  const curKey = `ts:cur:${trip.id}`

  const [amountStr, setAmountStr] = useState(editing ? minorToInput(editing.amount) : '')
  const [currency, setCurrency] = useState(editing?.currency ?? lsGet(curKey) ?? base)
  const [rateStr, setRateStr] = useState(editing ? String(editing.rate) : '1')
  const [rateState, setRateState] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [title, setTitle] = useState(editing?.title ?? '')
  const [note, setNote] = useState(editing?.note ?? '')
  const [paidBy, setPaidBy] = useState(editing?.paid_by ?? me)
  const [method, setMethod] = useState<PayMethod>(editing?.method ?? 'card')
  const [bank, setBank] = useState<string | null>(
    editing ? editing.bank : lastBank(),
  )
  const [forIds, setForIds] = useState<string[]>(
    editing ? editing.shares.map((s) => s.user_id) : members.map((m) => m.id),
  )
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>(editing?.split_mode ?? 'equal')
  const [custom, setCustom] = useState<Record<string, string>>(() =>
    editing?.split_mode === 'custom'
      ? Object.fromEntries(
          Object.entries(baseToCustom(editing.shares, editing.rate, editing.amount)).map(([id, v]) => [
            id,
            minorToInput(v),
          ]),
        )
      : {},
  )
  const [date, setDate] = useState(toDateInput(editing ? new Date(editing.spent_at) : new Date()))
  const [busy, setBusy] = useState(false)
  // id выдаём заранее: повторная отправка из офлайн-очереди не создаст дубль
  const expenseUid = useRef(editing?.id ?? uuid())
  const [error, setError] = useState('')
  const [otherCur, setOtherCur] = useState(!QUICK_CURRENCIES.includes(currency) && currency !== base)

  // курс: подтягиваем автоматически при смене валюты/даты (но не при открытии старого расхода)
  const skipRate = useRef(Boolean(editing))
  useEffect(() => {
    if (skipRate.current) {
      skipRate.current = false
      return
    }
    if (currency === base) {
      setRateStr('1')
      setRateState('idle')
      return
    }
    let cancelled = false
    setRateState('loading')
    fetchRate(currency, base, date).then((r) => {
      if (cancelled) return
      if (r) {
        setRateStr(String(+r.toPrecision(6)))
        setRateState('idle')
      } else setRateState('failed')
    })
    return () => {
      cancelled = true
    }
  }, [currency, date, base])

  const amount = parseMoney(amountStr)
  const rate = currency === base ? 1 : (parseRate(rateStr) ?? 0)
  const rateOk = rate > 0
  const amountBase = amount && rateOk ? convert(amount, rate) : null

  const orderedFor = members.map((m) => m.id).filter((id) => forIds.includes(id))

  const customParsed = useMemo(() => {
    const vals: Record<string, number> = {}
    let sum = 0
    let bad = false
    for (const m of members) {
      const s = (custom[m.id] ?? '').trim()
      if (!s) continue
      const v = parseMoney(s, true)
      if (v === null) {
        bad = true
        continue
      }
      vals[m.id] = v
      sum += v
    }
    return { vals, sum, bad }
  }, [custom, members])

  const shares: ShareLike[] | null = useMemo(() => {
    if (!amount || !amountBase) return null
    if (splitMode === 'equal') return orderedFor.length ? splitEqual(amountBase, orderedFor) : null
    if (customParsed.bad || customParsed.sum !== amount) return null
    // поправка на округление при конвертации — сумма долей точно равна итогу
    const list = customToBase(customParsed.vals, rate, amountBase)
    return list.length ? list : null
  }, [amount, amountBase, splitMode, orderedFor.join(','), customParsed, rate]) // eslint-disable-line react-hooks/exhaustive-deps

  const remaining = amount ? amount - customParsed.sum : 0

  function toggleFor(id: string) {
    setForIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }

  // при переходе на «свои суммы» подставляем текущее деление поровну — дальше его удобно поправить
  function switchSplit(m: 'equal' | 'custom') {
    if (m === 'custom' && amount && orderedFor.length && Object.values(custom).every((v) => !v.trim())) {
      setCustom(Object.fromEntries(splitEqual(amount, orderedFor).map((s) => [s.user_id, minorToInput(s.share_base)])))
    }
    setSplitMode(m)
  }

  function pickCurrency(c: string) {
    setCurrency(c)
    lsSet(curKey, c)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (readOnly) return
    setError('')
    const amtErr = moneyError(amountStr)
    if (amtErr || !amount) return setError(amtErr || 'Введи сумму')
    if (!title.trim()) return setError('Напиши, на что потратили')
    if (!rateOk) return setError('Укажи курс валюты — число больше нуля')
    if (!amountBase || amountBase < 1) return setError('Сумма слишком маленькая после пересчёта по курсу')
    if (amountBase > 10_000_000_000_000) return setError('Слишком большая сумма после пересчёта по курсу')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Укажи дату')
    if (!members.some((m) => m.id === paidBy)) return setError('Выбери, кто платил')
    if (method === 'card' && !bank) return setError('Выбери банк карты')
    if (!shares) {
      if (splitMode === 'equal') return setError('Отметь, за кого платили')
      if (customParsed.bad) return setError('В долях есть неправильная сумма')
      return setError('Доли должны в сумме давать всю сумму расхода')
    }

    // время: при изменении старого расхода в тот же день сохраняем исходное
    let spentAt: string
    if (editing && toDateInput(new Date(editing.spent_at)) === date) spentAt = editing.spent_at
    else if (date === toDateInput(new Date())) spentAt = new Date().toISOString()
    else spentAt = new Date(`${date}T12:00:00`).toISOString()

    setBusy(true)
    const payload = {
      p_id: expenseUid.current,
      p_create: !editing || !!editing.pending, // ожидающий в очереди на сервере ещё не создан
      p_trip_id: trip.id,
      p_paid_by: paidBy,
      p_title: title.trim(),
      p_note: note.trim(),
      p_amount: amount,
      p_currency: currency,
      p_rate: rate,
      p_amount_base: amountBase,
      p_method: method,
      p_bank: method === 'card' ? bank : null,
      p_split_mode: splitMode,
      p_spent_at: spentAt,
      p_shares: shares,
    }
    let error: { message: string } | null
    try {
      error = (await supabase.rpc('save_expense', payload)).error
    } catch (e) {
      error = { message: e instanceof Error ? e.message : String(e) }
    }
    setBusy(false)
    if (error && isNetworkError(error)) {
      // нет интернета — сохраняем на телефоне, отправится само
      enqueue({
        id: expenseUid.current,
        tripId: trip.id,
        kind: 'expense',
        payload,
        label: `${editing ? 'Изменение: ' : ''}${title.trim()} · ${formatMoney(amount, currency)}`,
      })
      return nav(`/t/${trip.id}`, { replace: true })
    }
    if (error) return setError(errMsg(error))
    nav(`/t/${trip.id}`, { replace: true })
  }

  async function remove() {
    if (!editing || !confirm(`Удалить «${editing.title}»?`)) return
    if (editing.pending) {
      discard(editing.id) // ещё не отправлен — просто убираем из очереди
      return nav(`/t/${trip.id}`, { replace: true })
    }
    setBusy(true)
    // без прав RLS не возвращает ошибку, а просто ничего не удаляет — проверяем, что строка ушла
    const { data, error } = await supabase.from('expenses').delete().eq('id', editing.id).select('id')
    setBusy(false)
    if (error) return setError(errMsg(error))
    if (!data?.length) return setError('Удалить расход может только автор')
    nav(`/t/${trip.id}`, { replace: true })
  }

  if (expenseId && !editing) return <p className="py-16 text-center text-muted-foreground">Расход не найден</p>

  return (
    <form onSubmit={submit} className="space-y-5 pb-6">
      <h2 className="text-2xl font-bold tracking-tight">
        {readOnly ? 'Расход' : editing ? 'Изменить расход' : 'Новый расход'}
      </h2>
      {editing?.created_at && (
        <p className="-mt-3 text-sm text-muted-foreground">
          Добавлен <time dateTime={editing.created_at}>{addedFmt.format(new Date(editing.created_at))}</time>
        </p>
      )}
      {readOnly && (
        <p className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" aria-hidden />
          Изменить или удалить может только автор: {memberById[editing.created_by]?.name ?? 'бывший участник'}
        </p>
      )}

      {/* выбранные варианты остаются цветными — это информация; без hover, чтобы не выглядели нажимаемыми */}
      <fieldset disabled={readOnly} className={readOnly ? 'contents [&_button]:pointer-events-none' : 'contents'}>

      {/* сумма и валюта */}
      <Card className="space-y-3">
        <label htmlFor="amount" className="text-sm font-semibold text-muted-foreground">
          Сумма
        </label>
        <div className="flex items-baseline gap-2">
          <input
            id="amount"
            className="w-full bg-transparent text-5xl font-bold tracking-tight outline-none tabular placeholder:text-muted-foreground/40"
            inputMode="decimal"
            placeholder="0"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            autoFocus={!editing}
          />
          <span className="text-3xl font-bold text-muted-foreground">{CURRENCIES[currency]?.symbol ?? currency}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {[...new Set([base, ...QUICK_CURRENCIES])].map((c) => (
            <Chip
              key={c}
              active={currency === c && !otherCur}
              onClick={() => {
                setOtherCur(false)
                pickCurrency(c)
              }}
            >
              {CURRENCIES[c]?.flag} {c}
            </Chip>
          ))}
          <Chip active={otherCur} onClick={() => setOtherCur(true)}>
            Другая…
          </Chip>
        </div>
        {otherCur && (
          <select className={inputCls} value={currency} onChange={(e) => pickCurrency(e.target.value)}>
            {Object.entries(CURRENCIES).map(([code, c]) => (
              <option key={code} value={code}>
                {c.flag} {code} — {c.name}
              </option>
            ))}
          </select>
        )}
        {currency !== base && (
          <div className="rounded-xl bg-muted p-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-muted-foreground">1 {currency} =</span>
              <input
                className="h-9 w-28 rounded-lg bg-card px-2 border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                inputMode="decimal"
                value={rateStr}
                onChange={(e) => setRateStr(e.target.value)}
              />
              <span className="text-muted-foreground">{base}</span>
              {rateState === 'loading' && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> курс
                </span>
              )}
            </div>
            {rateState === 'failed' && (
              <div className="mt-1 text-xs text-amber-700">Не удалось загрузить курс — введи вручную</div>
            )}
            {rateOk && (
              <div className="mt-1 text-xs text-muted-foreground">
                1 {base} = {+(1 / rate).toPrecision(5)} {currency}
                {amountBase ? ` · итого ${formatMoney(amountBase, base)}` : ''}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* на что */}
      <div className="space-y-3">
        <div>
          <Label>На что потратили</Label>
          <input
            className={inputCls}
            placeholder="Ужин на Пхукете, такси до аэропорта…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
          />
          {!editing && (
            <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {quick.map((q) => (
                <Chip
                  key={q}
                  active={title.trim().toLowerCase() === q.toLowerCase()}
                  onClick={() => {
                    setTitle(q)
                    // платил за это раньше — подставляем ту же валюту и способ оплаты
                    const last = lastUsed(expenses, q, paidBy)
                    if (!last) return
                    setCurrency(last.currency)
                    setOtherCur(!QUICK_CURRENCIES.includes(last.currency) && last.currency !== base)
                    setMethod(last.method)
                    setBank(last.bank)
                  }}
                >
                  {q}
                </Chip>
              ))}
            </div>
          )}
        </div>
        <textarea
          className={`${inputCls} h-auto min-h-[64px] py-3`}
          placeholder="Комментарий (необязательно)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
        />
      </div>

      {/* способ оплаты */}
      <div>
        <Label>Чем платили</Label>
        <PayPicker
          method={method}
          bank={bank}
          onChange={(m, b) => {
            setMethod(m)
            setBank(b)
          }}
        />
      </div>

      {/* кто платил */}
      <div>
        <Label>Кто платил</Label>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {members.map((m) => (
            <Chip key={m.id} active={paidBy === m.id} onClick={() => setPaidBy(m.id)}>
              {m.id === me ? 'Я' : m.name}
            </Chip>
          ))}
        </div>
      </div>

      {/* за кого */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <Label>За кого</Label>
          <div className="flex rounded-lg bg-muted p-1 text-sm font-semibold" role="group" aria-label="Как делить">
            {(['equal', 'custom'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchSplit(m)}
                aria-pressed={splitMode === m}
                className={`min-h-10 cursor-pointer rounded-md px-3 ${splitMode === m ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
              >
                {m === 'equal' ? 'Поровну' : 'Свои суммы'}
              </button>
            ))}
          </div>
        </div>

        <Card className="divide-y divide-border !p-0">
          {members.map((m) => {
            const share = shares?.find((s) => s.user_id === m.id)?.share_base
            return splitMode === 'equal' ? (
              <label key={m.id} className="flex cursor-pointer items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-primary"
                  checked={forIds.includes(m.id)}
                  onChange={() => toggleFor(m.id)}
                />
                <Avatar p={m} size={28} />
                <span className="flex-1">{m.id === me ? `${m.name} (я)` : m.name}</span>
                {share !== undefined && <span className="text-sm text-muted-foreground">{formatMoney(share, base)}</span>}
              </label>
            ) : (
              <div key={m.id} className="flex items-center gap-3 px-4 py-2">
                <Avatar p={m} size={28} />
                <span className="flex-1">{m.id === me ? `${m.name} (я)` : m.name}</span>
                <input
                  className="h-10 w-28 rounded-lg bg-muted px-2 text-right border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  inputMode="decimal"
                  placeholder="0"
                  value={custom[m.id] ?? ''}
                  onChange={(e) => setCustom((c) => ({ ...c, [m.id]: e.target.value }))}
                />
                <span className="w-6 text-muted-foreground">{CURRENCIES[currency]?.symbol ?? currency}</span>
              </div>
            )
          })}
        </Card>
        {splitMode === 'equal' && !readOnly && (
          <div className="mt-1 flex gap-1 text-sm">
            <button type="button" className="inline-flex min-h-11 cursor-pointer items-center rounded-md px-2 font-medium text-primary hover:bg-accent" onClick={() => setForIds(members.map((m) => m.id))}>
              Все
            </button>
            <button type="button" className="inline-flex min-h-11 cursor-pointer items-center rounded-md px-2 font-medium text-primary hover:bg-accent" onClick={() => setForIds([paidBy])}>
              Только платящий
            </button>
            <button type="button" className="inline-flex min-h-11 cursor-pointer items-center rounded-md px-2 font-medium text-primary hover:bg-accent" onClick={() => setForIds([])}>
              Никто
            </button>
          </div>
        )}
        {splitMode === 'custom' && amount && (
          <div className={`mt-2 text-sm ${remaining === 0 ? 'text-primary' : 'text-amber-700'}`}>
            {remaining === 0
              ? '✓ Всё распределено'
              : remaining > 0
                ? `Осталось распределить ${formatMoney(remaining, currency)}`
                : `Перебор на ${formatMoney(-remaining, currency)}`}
          </div>
        )}
      </div>

      <div>
        <Label>
          <label htmlFor="date">Дата</label>
        </Label>
        <input id="date" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      </fieldset>

      <ErrorBox>{error}</ErrorBox>

      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={() => nav(`/t/${trip.id}`, { replace: true })}>
          {readOnly ? 'Назад' : 'Отмена'}
        </Button>
        {!readOnly && (
          <Button className="flex-[2]" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />}
            Сохранить
          </Button>
        )}
      </div>
      {editing && !readOnly && (
        <Button type="button" variant="danger" className="w-full" onClick={remove} disabled={busy}>
          <Trash2 /> Удалить расход
        </Button>
      )}
    </form>
  )
}
