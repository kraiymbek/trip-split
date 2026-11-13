import { Link, NavLink, Outlet, useMatch, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useNotices } from '../hooks/useNotices'
import { getHomeTrip, setHomeTrip } from '../lib/homeTrip'
import { useAuth } from '../auth'
import { useTripData, type TripData } from '../hooks/useTrip'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../components/ui'
import { TripSkeleton } from '../components/Loading'
import { Button as UiButton } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { toast } from 'sonner'
import {
  Bell, CheckCheck, ChevronLeft, CloudUpload, HandCoins, Pencil, Receipt, RefreshCw, Scale, Settings, Trash2, Wallet, WifiOff,
} from 'lucide-react'
import type { CashOp, Expense, Settlement, Trip } from '../types'
import { discard, flushOutbox, retry, useOutbox, type OutboxItem } from '../lib/outbox'

// Записи из офлайн-очереди показываем сразу, как будто уже сохранены (с пометкой pending)
function mergePending(data: TripData, pending: OutboxItem[], me: string) {
  const ok = pending.filter((i) => !i.error)
  if (!ok.length) return data
  const expenses = [...data.expenses]
  const settlements = [...data.settlements]
  const cashOps = [...data.cashOps]
  for (const i of ok) {
    const p = i.payload as Record<string, never>
    if (i.kind === 'expense') {
      const e: Expense = {
        id: p.p_id, trip_id: p.p_trip_id, paid_by: p.p_paid_by, title: p.p_title, note: p.p_note || null,
        amount: p.p_amount, currency: p.p_currency, rate: p.p_rate, amount_base: p.p_amount_base,
        method: p.p_method, bank: p.p_bank, split_mode: p.p_split_mode, spent_at: p.p_spent_at,
        created_by: me, created_at: i.createdAt, shares: p.p_shares, pending: true,
      }
      const at = expenses.findIndex((x) => x.id === e.id)
      if (at >= 0) expenses[at] = e
      else expenses.push(e)
    } else if (i.kind === 'settlement') {
      if (!settlements.some((x) => x.id === i.id))
        settlements.push({ ...(i.payload as unknown as Settlement), created_at: i.createdAt, pending: true })
    } else if (!cashOps.some((x) => x.id === i.id)) {
      cashOps.push({ ...(i.payload as unknown as CashOp), user_id: me, pending: true })
    }
  }
  expenses.sort((a, b) => b.spent_at.localeCompare(a.spent_at))
  return { ...data, expenses, settlements, cashOps }
}

export type TripCtx = Omit<TripData, 'trip'> & {
  trip: Trip
  me: string
  unseenExpenses: Set<string> // расходы, которые добавили/изменили другие, а я ещё не смотрел
  markExpenseSeen: (id: string) => void
}

export const useTripCtx = () => useOutletContext<TripCtx>()

export default function TripLayout() {
  const { tripId } = useParams()
  const { session } = useAuth()
  const raw = useTripData(tripId)
  const pending = useOutbox(tripId)
  const me = session?.user.id ?? ''
  const data = useMemo(() => mergePending(raw, pending, me), [raw, pending, me])
  const [showPending, setShowPending] = useState(false)
  const [showNews, setShowNews] = useState(false)
  const news = useNotices(data, me, tripId)
  const nav = useNavigate()
  const tripPath = `/t/${tripId}`
  const editMatch = useMatch('/t/:tripId/e/:expenseId')
  const newMatch = useMatch('/t/:tripId/new')
  const inExpense = !!(editMatch || newMatch)
  const openNotice = (expenseId?: string) => {
    if (expenseId) {
      setShowNews(false)
      nav(`${tripPath}/e/${expenseId}`)
    } else setShowNews(true)
  }

  // отмеченная «при запуске» поездка удалена или ты из неё вышел — снимаем отметку, чтобы не открывать её каждый раз
  useEffect(() => {
    if (raw.notFound && me && tripId && getHomeTrip(me) === tripId) setHomeTrip(me, null)
  }, [raw.notFound, me, tripId])

  // свежие уведомления — всплывашкой (sonner), список целиком — в шторке по колокольчику
  useEffect(() => {
    const fresh = news.toast
    if (!fresh.length) return
    if (fresh.length === 1) {
      const n = fresh[0]
      toast(n.title, {
        id: n.key,
        description: n.body,
        action: n.expenseId ? { label: 'Открыть', onClick: () => openNotice(n.expenseId) } : undefined,
      })
    } else {
      toast(`Новых записей для тебя: ${fresh.length}`, { action: { label: 'Смотреть', onClick: () => setShowNews(true) } })
    }
    news.dismissToast()
    // openNotice зависит только от setState/nav/tripId — пересоздавать эффект из-за него не нужно
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [news.toast])

  if (data.loading && !data.trip) return <TripSkeleton />
  if (data.error || !data.trip)
    return (
      <div className="mx-auto max-w-md px-5 pt-24 text-center">
        <p className="mb-6 text-muted-foreground">{data.error ?? 'Поездка не найдена'}</p>
        <Button asChild variant="ghost">
          <Link to="/">К списку поездок</Link>
        </Button>
      </div>
    )

  const ctx: TripCtx = {
    ...data,
    trip: data.trip,
    me,
    unseenExpenses: news.unseenExpenses,
    markExpenseSeen: news.markExpense,
  }
  const closeNews = () => {
    setShowNews(false)
    news.markAll()
  }
  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-xs font-medium transition-colors ${
      isActive ? 'text-primary' : 'text-muted-foreground'
    }`

  return (
    <div className="mx-auto min-h-dvh max-w-md pb-[calc(env(safe-area-inset-bottom)+5.5rem)]">
      <header className="sticky top-0 z-10 flex items-center gap-1 border-b border-transparent bg-background/85 px-2 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2 backdrop-blur-md">
        <UiButton asChild variant="ghost" size="icon" aria-label={inExpense ? 'К списку расходов' : 'К списку поездок'}>
          <Link to={inExpense ? tripPath : '/'}>
            <ChevronLeft className="size-6" />
          </Link>
        </UiButton>
        <h1 className="flex-1 truncate text-lg font-bold tracking-tight">{data.trip.name}</h1>
        <UiButton
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={news.notices.length ? `Новое для тебя: ${news.notices.length}` : 'Уведомления'}
          onClick={() => {
            toast.dismiss()
            setShowNews(true)
          }}
        >
          <Bell className="size-5" />
          {news.notices.length > 0 && (
            <span className="absolute top-1.5 right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-white tabular">
              {news.notices.length > 99 ? '99+' : news.notices.length}
            </span>
          )}
        </UiButton>
      </header>

      <Sheet
        open={showNews}
        onOpenChange={(o) => {
          if (o) {
            toast.dismiss() // всплывашки дублируют список и под модальной шторкой не нажимаются
            setShowNews(true)
          } else closeNews()
        }}
      >
        <SheetContent side="bottom" className="max-h-[80dvh] rounded-t-3xl pb-[max(env(safe-area-inset-bottom),1rem)]">
          <SheetHeader className="text-left">
            <SheetTitle>Что нового для тебя</SheetTitle>
            <SheetDescription>Расходы и возвраты, которые добавили или изменили другие</SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto px-4">
            {news.notices.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                <CheckCheck className="size-8 text-primary" aria-hidden />
                Ничего нового — всё просмотрено
              </div>
            ) : (
              <ul className="divide-y">
                {news.notices.map((n) => {
                  const Icon = n.kind === 'settle' ? HandCoins : n.kind === 'edit' ? Pencil : Receipt
                  return (
                    <li key={n.key}>
                      <button
                        className="flex w-full cursor-pointer gap-3 py-3 text-left disabled:cursor-default"
                        disabled={!n.expenseId}
                        onClick={() => openNotice(n.expenseId)}
                      >
                        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-medium">{n.title}</span>
                          <span className="block text-sm text-muted-foreground">{n.body}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          {news.notices.length > 0 && (
            <div className="px-4">
              <Button className="w-full" onClick={closeNews}>
                Отметить всё прочитанным
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <div className="space-y-2 px-4 empty:hidden">
        {data.offline && (
          <Alert>
            <WifiOff />
            <AlertDescription>Нет связи с сервером — показаны последние загруженные данные</AlertDescription>
          </Alert>
        )}

        {pending.length > 0 && (
          <Alert className="border-sky-200 bg-sky-50 text-sky-950">
            <CloudUpload />
            <AlertTitle className="flex items-center justify-between gap-2">
              <span>
                {pending.length} {pending.length === 1 ? 'запись ждёт' : 'записи ждут'} отправки
                {pending.some((i) => i.error) && <span className="text-destructive"> · есть ошибка</span>}
              </span>
              <button className="-my-2 min-h-11 cursor-pointer px-1 text-sm font-semibold text-sky-800 underline underline-offset-2" aria-expanded={showPending} onClick={() => setShowPending((v) => !v)}>
                {showPending ? 'скрыть' : 'показать'}
              </button>
            </AlertTitle>
            {showPending && (
              <AlertDescription className="mt-2 space-y-2">
                {pending.map((i) => (
                  <div key={i.id} className="w-full rounded-lg border bg-card px-3 py-2 text-foreground">
                    <div className="font-medium">{i.label}</div>
                    <div className={i.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                      {i.error ? `Сервер не принял: ${i.error}` : 'Отправится само, когда появится интернет'}
                    </div>
                    <div className="mt-1 flex gap-1">
                      <UiButton variant="ghost" className="px-2 text-primary" onClick={() => retry(i.id)}>
                        <RefreshCw /> Отправить
                      </UiButton>
                      <UiButton
                        variant="ghost"
                        className="px-2 text-destructive"
                        onClick={() => confirm('Удалить эту запись? Она не сохранится.') && discard(i.id)}
                      >
                        <Trash2 /> Удалить
                      </UiButton>
                    </div>
                  </div>
                ))}
                <UiButton variant="outline" onClick={() => flushOutbox()}>
                  Отправить всё
                </UiButton>
              </AlertDescription>
            )}
          </Alert>
        )}
      </div>

      <main className="px-4 pt-2">
        <Outlet context={ctx} />
      </main>

      <nav
        aria-label="Разделы поездки"
        className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
      >
        <div className="mx-auto flex max-w-md">
          {TABS.map(({ to, label, Icon, end }) => (
            <NavLink key={label} to={to} end={end} className={tab}>
              {({ isActive }) => (
                <>
                  <span className={`flex h-7 w-14 items-center justify-center rounded-full transition-colors ${isActive ? 'bg-accent' : ''}`}>
                    <Icon className="size-5" strokeWidth={isActive ? 2.4 : 2} aria-hidden />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

const TABS = [
  { to: '', label: 'Расходы', Icon: Receipt, end: true },
  { to: 'cash', label: 'Наличные', Icon: Wallet, end: false },
  { to: 'summary', label: 'Итоги', Icon: Scale, end: false },
  { to: 'settings', label: 'Поездка', Icon: Settings, end: false },
]
