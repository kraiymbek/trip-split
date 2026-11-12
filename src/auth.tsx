import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import type { Profile } from './types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (uid: string | undefined) => {
    if (!uid) return setProfile(null)
    // сначала из кеша на телефоне — имя видно сразу и без сети, потом свежее с сервера
    const cached = readCachedProfile(uid)
    if (cached) setProfile(cached)
    const { data } = await supabase.from('profiles').select('id,name,avatar_color').eq('id', uid).single()
    if (data) {
      setProfile(data)
      writeCachedProfile(data)
    }
  }, [])

  useEffect(() => {
    // сессия хранится локально — вход известен сразу, приложение не ждёт сеть ради профиля
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
      loadProfile(data.session?.user.id)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      // не await внутри колбэка — иначе supabase-js может зависнуть
      setTimeout(() => loadProfile(s?.user.id), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const refreshProfile = useCallback(() => loadProfile(session?.user.id), [loadProfile, session])

  return (
    <AuthContext.Provider value={{ session, profile, loading, refreshProfile }}>{children}</AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

const PROFILE_KEY = 'ts:profile'

function readCachedProfile(uid: string): Profile | null {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as Profile | null
    return p?.id === uid ? p : null
  } catch {
    return null
  }
}

function writeCachedProfile(p: Profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
  } catch {
    /* private mode */
  }
}
