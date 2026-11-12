import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { LOGIN_RE, errMsg, loginToEmail, supabase } from '../lib/supabase'
import { Loader2 } from 'lucide-react'
import { Button, Card, ErrorBox } from '../components/ui'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
        <img src="/icons/icon-192.png" alt="" className="mx-auto mb-4 size-16 rounded-2xl shadow-lg shadow-primary/20" />
        <h1 className="text-3xl font-bold tracking-tight">Trip Split</h1>
        <p className="mt-1.5 text-muted-foreground">Кто кому сколько должен в поездке</p>
      </div>

      <Card className="p-5">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'login' | 'register')}>
          <TabsList className="mb-3 grid h-11 w-full grid-cols-2">
            <TabsTrigger value="login">Вход</TabsTrigger>
            <TabsTrigger value="register">Регистрация</TabsTrigger>
          </TabsList>
          <TabsContent value={mode} forceMount>
        <form onSubmit={submit} className="space-y-4" noValidate={false}>
          {mode === 'register' && (
            <div className="space-y-1.5">
              <Label htmlFor="name">Имя</Label>
              <Input
                id="name"
                placeholder="Имя (видят друзья)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="given-name"
                maxLength={40}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="login">Логин</Label>
            <Input
              id="login"
              placeholder="Логин (латиницей)"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={20}
              required
              aria-describedby={mode === 'register' ? 'login-help' : undefined}
            />
            {mode === 'register' && (
              <p id="login-help" className="text-xs text-muted-foreground">
                3–20 символов: латиница, цифры, точка, дефис
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Пароль</Label>
            <Input
              id="password"
              type="password"
              placeholder="Пароль (мин. 6 символов)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
          </div>
          <ErrorBox>{error}</ErrorBox>
          <Button className="w-full" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </Button>
        </form>
          </TabsContent>
        </Tabs>
      </Card>

      <InstallApp className="mt-4" />
    </div>
  )
}
