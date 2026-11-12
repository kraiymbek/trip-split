import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errMsg, supabase } from '../lib/supabase'
import { subscribeOutbox } from '../lib/outbox'

const snapKey = (id: string) => `ts:trip:${id}`
import type { CashOp, Expense, Profile, Settlement, Trip } from '../types'

export interface TripData {
  trip: Trip | null
  members: Profile[]
  memberById: Record<string, Profile>
  expenses: Expense[]
  settlements: Settlement[]
  cashOps: CashOp[]
  loading: boolean
  error: string | null
  offline: boolean
  notFound: boolean // поездки нет или нет доступа (а не просто нет сети)
  reload: () => Promise<void>
}

export function useTripData(tripId: string | undefined): TripData {
  const [trip, setTrip] = useState<Trip | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [cashOps, setCashOps] = useState<CashOp[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const loaded = useRef(false)

  const reload = useCallback(async () => {
    if (!tripId) return
    const [t, m, e, s, c] = await Promise.all([
      supabase.from('trips').select('*').eq('id', tripId).single(),
      supabase
        .from('trip_members')
        .select('joined_at, profiles(id,name,avatar_color)')
        .eq('trip_id', tripId)
        .order('joined_at'),
      supabase
        .from('expenses')
        .select('*, shares:expense_shares(user_id,share_base)')
        .eq('trip_id', tripId)
        .order('spent_at', { ascending: false }),
      supabase.from('settlements').select('*').eq('trip_id', tripId).order('created_at', { ascending: false }),
      supabase.from('cash_ops').select('*').eq('trip_id', tripId).order('happened_at', { ascending: false }),
    ])
    const firstErr = t.error ?? m.error ?? e.error ?? s.error ?? c.error
    if (t.error?.code === 'PGRST116') {
      // строки нет: поездку удалили, ты из неё вышел или ссылка чужая
      setTrip(null)
      setNotFound(true)
      setError('Поездка не найдена или у тебя нет к ней доступа')
      setOffline(false)
    } else if (firstErr) {
      // сеть/сервер: если данные уже есть — оставляем их и показываем плашку
      setOffline(true)
      if (!loaded.current) {
        // открыли без интернета — берём последний сохранённый снимок поездки
        let snap: { trip: Trip; members: Profile[]; expenses: Expense[]; settlements: Settlement[]; cashOps: CashOp[] } | null = null
        try {
          snap = JSON.parse(localStorage.getItem(snapKey(tripId)) ?? 'null')
        } catch {
          snap = null
        }
        if (snap?.trip) {
          setTrip(snap.trip)
          setMembers(snap.members)
          setExpenses(snap.expenses)
          setSettlements(snap.settlements)
          setCashOps(snap.cashOps ?? [])
          loaded.current = true
        } else setError(errMsg(firstErr))
      }
    } else {
      loaded.current = true
      setNotFound(false)
      setOffline(false)
      setError(null)
      setTrip(t.data as Trip)
      setMembers(((m.data ?? []) as unknown as { profiles: Profile }[]).map((r) => r.profiles).filter(Boolean))
      // bigint/numeric из PostgREST могут прийти строками — приводим к числам
      setExpenses(
        ((e.data ?? []) as Expense[]).map((x) => ({
          ...x,
          rate: Number(x.rate),
          amount: Number(x.amount),
          amount_base: Number(x.amount_base),
          shares: x.shares.map((sh) => ({ ...sh, share_base: Number(sh.share_base) })),
        })),
      )
      setSettlements(((s.data ?? []) as Settlement[]).map((x) => ({ ...x, amount_base: Number(x.amount_base) })))
      setCashOps(
        ((c.data ?? []) as CashOp[]).map((x) => ({
          ...x,
          to_amount: Number(x.to_amount),
          from_amount: x.from_amount === null ? null : Number(x.from_amount),
        })),
      )
      try {
        localStorage.setItem(
          snapKey(tripId),
          JSON.stringify({ trip: t.data, members: ((m.data ?? []) as unknown as { profiles: Profile }[]).map((r) => r.profiles).filter(Boolean), expenses: e.data, settlements: s.data, cashOps: c.data }),
        )
      } catch {
        /* нет места / private mode */
      }
    }
    setLoading(false)
  }, [tripId])

  useEffect(() => {
    if (!tripId) return
    loaded.current = false
    setNotFound(false) // флаг относится к прошлой поездке
    setLoading(true)
    reload()

    let timer: ReturnType<typeof setTimeout> | undefined
    const debounced = () => {
      clearTimeout(timer)
      timer = setTimeout(reload, 300)
    }
    const f = `trip_id=eq.${tripId}`
    const channel = supabase
      .channel(`trip-${tripId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: f }, debounced)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter: f }, debounced)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_members', filter: f }, debounced)
      // Supabase не доставляет DELETE-события в подписки с фильтром — слушаем удаления отдельно, без фильтра
      // (в событии только id строки, поэтому просто перечитываем данные)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'expenses' }, debounced)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'settlements' }, debounced)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'trip_members' }, debounced)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_ops', filter: f }, debounced)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'cash_ops' }, debounced)
      .subscribe()

    // при возврате в PWA из фона — подтянуть свежие данные
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', reload)
    // запись из офлайн-очереди дошла — перечитываем
    const unsubOutbox = subscribeOutbox(debounced)

    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', reload)
      unsubOutbox()
    }
  }, [tripId, reload])

  const memberById = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members])

  return { trip, members, memberById, expenses, settlements, cashOps, loading, error, offline, notFound, reload }
}
