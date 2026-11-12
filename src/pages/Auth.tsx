import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { LOGIN_RE, errMsg, loginToEmail, supabase } from '../lib/supabase'
import { Button, ErrorBox, inputCls } from '../components/ui'
import { InstallApp } from '../components/InstallApp'

export default function Auth() {
  const { session } = useAuth()
  const [params] = useSearchParams()
  // только внутренние пути — защита от редиректа на чужой сайт через ?next=
  const rawNext = params.get('next') ?? '/'
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'
  const [mode, setMode] = useState<'login' | 'register'>(next.startsWith('/join') ? 'register' : 'login')
  const [name, setName] = useState('')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (session) return <Navigate to={next} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const l = login.trim().toLowerCase()
    if (!LOGIN_RE.test(l)) return setError('Логин: 3–20 символов, латиница, цифры, точка, _ или -')
    setBusy(true)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: loginToEmail(l), password })
        if (error) throw error
      } else {
        if (!name.trim()) throw new Error('Как тебя зовут?')
        const { data, error } = await supabase.auth.signUp({
          email: loginToEmail(l),
          password,
          options: { data: { name: name.trim() } },
        })
        if (error) throw error
        if (!data.session) throw new Error('Регистрация требует подтверждения email — выключи «Confirm email» в Supabase')
      }
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-600 text-3xl text-white shadow-lg">
          ฿
        </div>
        <h1 className="text-2xl font-bold">Trip Split</h1>
        <p className="mt-1 text-slate-500">Кто кому сколько должен в поездке</p>
      </div>

      <div className="mb-4 grid grid-cols-2 rounded-xl bg-slate-200/70 p-1">
        {(['login', 'register'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg py-2 text-sm font-semibold ${mode === m ? 'bg-white shadow-sm' : 'text-slate-500'}`}
          >
            {m === 'login' ? 'Вход' : 'Регистрация'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-3">
        {mode === 'register' && (
          <input
            className={inputCls}
            placeholder="Имя (видят друзья)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="given-name"
            maxLength={40}
          />
        )}
        <input
          className={inputCls}
          placeholder="Логин (латиницей)"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={20}
          required
        />
        <input
          className={inputCls}
          type="password"
          placeholder="Пароль (мин. 6 символов)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={6}
          required
        />
        <ErrorBox>{error}</ErrorBox>
        <Button className="w-full" disabled={busy}>
          {busy ? '…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
        </Button>
      </form>

      <InstallApp className="mt-6" />
    </div>
  )
}
