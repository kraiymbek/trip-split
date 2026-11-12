import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useNotices } from '../hooks/useNotices'
import { useAuth } from '../auth'
import { useTripData, type TripData } from '../hooks/useTrip'
import { useMemo, useState } from 'react'
import { Spinner } from '../components/ui'
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
        created_by: me, shares: p.p_shares, pending: true,
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

  if (data.loading && !data.trip) return <Spinner full />
  if (data.error || !data.trip)
    return (
      <div className="mx-auto max-w-md px-5 pt-24 text-center">
        <p className="mb-6 text-slate-600">{data.error ?? 'Поездка не найдена'}</p>
        <Link to="/" className="font-semibold text-teal-700">
          К списку поездок
        </Link>
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
  const openNotice = (expenseId?: string) => {
    news.dismissToast()
    if (expenseId) {
      setShowNews(false)
      nav(`/t/${data.trip!.id}/e/${expenseId}`)
    } else setShowNews(true)
  }
  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
      isActive ? 'text-teal-700' : 'text-slate-400'
    }`

  return (
    <div className="mx-auto min-h-dvh max-w-md pb-[calc(env(safe-area-inset-bottom)+5rem)]">
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-slate-50/90 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 backdrop-blur">
        <Link to="/" className="-ml-2 px-2 text-2xl leading-none text-slate-400" aria-label="Назад">
          ‹
        </Link>
        <h1 className="flex-1 truncate text-lg font-bold">{data.trip.name}</h1>
        <button
          className="relative -mr-1 rounded-full p-2 text-xl leading-none"
          aria-label={`Новое: ${news.notices.length}`}
          onClick={() => (showNews ? closeNews() : setShowNews(true))}
        >
          🔔
          {news.notices.length > 0 && (
            <span className="absolute top-0.5 right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
              {news.notices.length > 99 ? '99+' : news.notices.length}
            </span>
          )}
        </button>
      </header>

      {news.toast.length > 0 && !showNews && (
        <button
          className="fixed inset-x-3 top-[max(env(safe-area-inset-top),0.75rem)] z-30 mx-auto block max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-left text-white shadow-xl"
          onClick={() => openNotice(news.toast.length === 1 ? news.toast[0].expenseId : undefined)}
        >
          {news.toast.length === 1 ? (
            <>
              <div className="text-sm font-semibold">🔔 {news.toast[0].title}</div>
              <div className="mt-0.5 truncate text-sm text-slate-300">{news.toast[0].body}</div>
            </>
          ) : (
            <div className="text-sm font-semibold">
              🔔 Новых записей для тебя: {news.toast.length}{' '}
              <span className="font-normal text-slate-300">— посмотреть</span>
            </div>
          )}
        </button>
      )}

      {showNews && (
        <div className="mx-4 mb-3 rounded-xl bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-200">
          <div className="mb-1 flex items-center justify-between">
            <b>Что нового для тебя</b>
            <button className="text-xs font-semibold text-teal-700" onClick={closeNews}>
              {news.notices.length ? 'Прочитано' : 'Закрыть'}
            </button>
          </div>
          {news.notices.length === 0 && <div className="py-2 text-slate-500">Ничего нового — всё просмотрено ✨</div>}
          <div className="divide-y divide-slate-100">
            {news.notices.map((n) => (
              <button
                key={n.key}
                className="block w-full py-2 text-left disabled:cursor-default"
                disabled={!n.expenseId}
                onClick={() => openNotice(n.expenseId)}
              >
                <div className="font-medium">
                  {n.kind === 'settle' ? '🤝' : n.kind === 'edit' ? '✏️' : '🧾'} {n.title}
                </div>
                <div className="text-slate-500">{n.body}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {data.offline && (
        <div className="mx-4 mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Нет связи с сервером — показаны последние загруженные данные
        </div>
      )}

      {pending.length > 0 && (
        <div className="mx-4 mb-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <button className="flex w-full items-center justify-between" onClick={() => setShowPending((v) => !v)}>
            <span>
              ⏳ {pending.length} {pending.length === 1 ? 'запись ждёт' : 'записи ждут'} отправки
              {pending.some((i) => i.error) && <b className="text-rose-700"> · есть ошибка</b>}
            </span>
            <span className="text-sky-700 underline">{showPending ? 'скрыть' : 'показать'}</span>
          </button>
          {showPending && (
            <div className="mt-2 space-y-2">
              {pending.map((i) => (
                <div key={i.id} className="rounded-lg bg-white px-3 py-2">
                  <div className="font-medium">{i.label}</div>
                  {i.error ? (
                    <div className="mt-0.5 text-xs text-rose-700">Сервер не принял: {i.error}</div>
                  ) : (
                    <div className="mt-0.5 text-xs text-slate-500">Отправится само, когда появится интернет</div>
                  )}
                  <div className="mt-1 flex gap-4 text-xs font-semibold">
                    <button className="text-teal-700" onClick={() => retry(i.id)}>
                      Отправить сейчас
                    </button>
                    <button
                      className="text-rose-600"
                      onClick={() => confirm('Удалить эту запись? Она не сохранится.') && discard(i.id)}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
              <button className="text-xs font-semibold text-teal-700" onClick={() => flushOutbox()}>
                Отправить всё
              </button>
            </div>
          )}
        </div>
      )}

      <main className="px-4">
        <Outlet context={ctx} />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-md">
          <NavLink to="" end className={tab}>
            <span className="text-xl">🧾</span>Расходы
          </NavLink>
          <NavLink to="cash" className={tab}>
            <span className="text-xl">💵</span>Наличные
          </NavLink>
          <NavLink to="summary" className={tab}>
            <span className="text-xl">⚖️</span>Итоги
          </NavLink>
          <NavLink to="settings" className={tab}>
            <span className="text-xl">⚙️</span>Поездка
          </NavLink>
        </div>
      </nav>
    </div>
  )
}
