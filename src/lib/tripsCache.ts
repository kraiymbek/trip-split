// Последний загруженный список поездок — на устройстве, отдельно для каждого пользователя.
// Список открывается мгновенно (и без сети), свежие данные подтягиваются фоном.
import type { Trip } from '../types'

const key = (userId: string) => `ts:trips:${userId}`

export function readCachedTrips(userId: string): Trip[] | null {
  if (!userId) return null
  try {
    const v = JSON.parse(localStorage.getItem(key(userId)) ?? 'null')
    return Array.isArray(v) ? (v as Trip[]) : null
  } catch {
    return null
  }
}

export function writeCachedTrips(userId: string, trips: Trip[]) {
  if (!userId) return
  try {
    localStorage.setItem(key(userId), JSON.stringify(trips))
  } catch {
    /* private mode / переполнено */
  }
}
