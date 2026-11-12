import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { computeNotices, loadSeen, saveSeen, snapshotSeen, systemNotify, type Notice, type Seen } from '../lib/notify'
import type { TripData } from './useTrip'

/** Новое для меня в поездке: список, отметка «прочитано», всплывашки и системные уведомления о свежем. */
export function useNotices(data: TripData, me: string, tripId: string | undefined) {
  const { trip, expenses, settlements, memberById } = data
  const ready = !!trip && trip.id === tripId && !!me
  const [seen, setSeen] = useState<Seen | null>(null)
  const [toast, setToast] = useState<Notice[]>([])
  const shown = useRef<Set<string> | null>(null)

  // другая поездка / другой человек — начинаем заново
  useEffect(() => {
    setSeen(null)
    setToast([])
    shown.current = null
  }, [tripId, me])

  useEffect(() => {
    if (!ready || seen || !tripId) return
    let s = loadSeen(tripId, me)
    if (!s) {
      s = snapshotSeen(expenses, settlements, me)
      saveSeen(tripId, me, s)
    }
    setSeen(s)
  }, [ready, seen, tripId, me, expenses, settlements])

  const notices = useMemo(
    () => (seen && trip ? computeNotices(expenses, settlements, me, seen, memberById, trip.base_currency) : []),
    [seen, trip, expenses, settlements, me, memberById],
  )

  // всплывашка и системное уведомление — только о том, что появилось сейчас
  useEffect(() => {
    if (!seen || !tripId) return
    const ids = notices.map((n) => `${n.key}@${n.version}`)
    const first = shown.current === null
    const fresh = first ? notices : notices.filter((n) => !shown.current!.has(`${n.key}@${n.version}`))
    shown.current = new Set([...(shown.current ?? []), ...ids])
    if (!fresh.length) return
    setToast(fresh)
    if (!first && document.visibilityState === 'hidden') {
      const url = `/t/${tripId}`
      if (fresh.length <= 3) fresh.forEach((n) => systemNotify(n.title, n.body, url, n.key))
      else systemNotify(trip?.name ?? 'Trip Split', `${fresh.length} новых записей`, url, `trip-${tripId}`)
    }
  }, [notices, seen, tripId, trip?.name])

  useEffect(() => {
    if (!toast.length) return
    const t = setTimeout(() => setToast([]), 6000)
    return () => clearTimeout(t)
  }, [toast])

  const update = useCallback(
    (next: Seen) => {
      if (!tripId) return
      saveSeen(tripId, me, next)
      setSeen(next)
    },
    [tripId, me],
  )

  const markAll = useCallback(() => {
    update(snapshotSeen(expenses, settlements, me, seen ?? {}))
    setToast([])
  }, [update, expenses, settlements, me, seen])

  const markExpense = useCallback(
    (expenseId: string) => {
      const n = notices.find((x) => x.expenseId === expenseId)
      if (n && seen) update({ ...seen, [n.key]: n.version })
    },
    [notices, seen, update],
  )

  const unseenExpenses = useMemo(
    () => new Set(notices.flatMap((n) => (n.expenseId ? [n.expenseId] : []))),
    [notices],
  )

  return { notices, unseenExpenses, toast, dismissToast: () => setToast([]), markAll, markExpense }
}
