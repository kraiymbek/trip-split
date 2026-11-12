// «Открывать при запуске»: поездка, на которую приложение переходит сразу после старта.
// Хранится на устройстве, отдельно для каждого пользователя.

const key = (userId: string) => `ts:home-trip:${userId}`
const autoFlag = (userId: string) => `ts:auto-opened:${userId}` // свой у каждого: выход и вход другим — снова сработает

// с какого адреса стартовало приложение: авто-переход только при запуске на «/»,
// а не когда человек пришёл по ссылке на поездку или инвайт и потом вернулся к списку
const startPath = typeof location !== 'undefined' ? location.pathname : '/'

export function getHomeTrip(userId: string): string | null {
  try {
    return localStorage.getItem(key(userId))
  } catch {
    return null
  }
}

export function setHomeTrip(userId: string, tripId: string | null) {
  try {
    if (tripId) localStorage.setItem(key(userId), tripId)
    else localStorage.removeItem(key(userId))
  } catch {
    /* private mode */
  }
}

/** id поездки для авто-перехода — один раз за запуск (вкладку / окно PWA), иначе null */
export function takeAutoOpen(userId: string, start = startPath): string | null {
  try {
    if (!userId || sessionStorage.getItem(autoFlag(userId))) return null
    sessionStorage.setItem(autoFlag(userId), '1')
  } catch {
    return null
  }
  if (start !== '/' && start !== '/login') return null
  return getHomeTrip(userId)
}
