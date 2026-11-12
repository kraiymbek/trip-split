import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && key)

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
})

// Supabase Auth требует email — вход по логину делаем через служебный адрес, который пользователь не видит
export const LOGIN_RE = /^[a-z0-9._-]{3,20}$/
export const loginToEmail = (login: string) => `${login}@trip.local`

export function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = String((e as { message: unknown }).message)
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'Нет интернета — попробуй ещё раз'
    if (m.includes('rate limit')) return 'Слишком много попыток, подожди минуту'
    if (m.includes('Invalid login credentials')) return 'Неверный логин или пароль'
    if (m.includes('already registered')) return 'Такой логин уже занят'
    if (m.includes('Password should be')) return 'Пароль минимум 6 символов'
    if (m.includes('Email not confirmed')) return 'Выключи «Confirm email» в настройках Supabase'
    return m
  }
  return 'Что-то пошло не так'
}
