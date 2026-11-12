import { beforeEach, describe, expect, it } from 'vitest'

// хранилища браузера в памяти (тесты идут в node)
const mem = () => {
  let m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => void (m = new Map()),
  }
}
const local = mem()
const session = mem()
Object.assign(globalThis, { localStorage: local, sessionStorage: session })

const { getHomeTrip, setHomeTrip, takeAutoOpen } = await import('./homeTrip')

beforeEach(() => {
  local.clear()
  session.clear()
})

describe('поездка «при запуске»', () => {
  it('отметить, прочитать, снять', () => {
    expect(getHomeTrip('u1')).toBeNull()
    setHomeTrip('u1', 't1')
    expect(getHomeTrip('u1')).toBe('t1')
    setHomeTrip('u1', 't2') // отмечена может быть только одна
    expect(getHomeTrip('u1')).toBe('t2')
    setHomeTrip('u1', null)
    expect(getHomeTrip('u1')).toBeNull()
  })

  it('у каждого пользователя своя отметка', () => {
    setHomeTrip('u1', 't1')
    expect(getHomeTrip('u2')).toBeNull()
    expect(takeAutoOpen('u2', '/')).toBeNull()
  })

  it('авто-переход срабатывает один раз за запуск', () => {
    setHomeTrip('u1', 't1')
    expect(takeAutoOpen('u1', '/')).toBe('t1')
    expect(takeAutoOpen('u1', '/')).toBeNull() // вернулся к списку — остаётся на списке
    session.clear() // новый запуск (новая вкладка / окно PWA)
    expect(takeAutoOpen('u1', '/')).toBe('t1')
  })

  it('после входа (старт на /login) — тоже переход', () => {
    setHomeTrip('u1', 't1')
    expect(takeAutoOpen('u1', '/login')).toBe('t1')
  })

  it('пришёл по ссылке на поездку или инвайт — потом список без авто-перехода', () => {
    setHomeTrip('u1', 't1')
    expect(takeAutoOpen('u1', '/join/abc123')).toBeNull()
    session.clear()
    expect(takeAutoOpen('u1', '/t/other')).toBeNull()
  })

  it('выход и вход другим пользователем в той же вкладке — у него свой авто-переход', () => {
    setHomeTrip('u1', 't1')
    setHomeTrip('u2', 't2')
    expect(takeAutoOpen('u1', '/')).toBe('t1')
    expect(takeAutoOpen('u2', '/')).toBe('t2')
  })

  it('без отметки — null', () => {
    expect(takeAutoOpen('u1', '/')).toBeNull()
  })
})
