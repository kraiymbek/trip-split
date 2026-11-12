import { useEffect, useState, type FormEvent } from 'react'
import { ChevronRight, LogOut, Luggage, Pin, Plane, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button as UiButton } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getHomeTrip, setHomeTrip, takeAutoOpen } from '../lib/homeTrip'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { errMsg, supabase } from '../lib/supabase'
import { CURRENCIES } from '../lib/money'
import type { Trip } from '../types'
import { Avatar, Button, Card, Chip, ErrorBox, Label, inputCls } from '../components/ui'
import { TripsSkeleton } from '../components/Loading'

export default function Trips() {
  const { profile, session } = useAuth()
  const nav = useNavigate()
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('Таиланд 🇹🇭')
  const [base, setBase] = useState('THB')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const me = session?.user.id ?? ''
  const [home, setHome] = useState(() => (me ? getHomeTrip(me) : null))

  // запуск приложения: сразу в отмеченную поездку (не дожидаясь списка — работает и без сети)
  useEffect(() => {
    if (!me) return
    const id = takeAutoOpen(me)
    if (id) nav(`/t/${id}`)
  }, [me, nav])

  function togglePin(t: Trip) {
    if (!me) return
    const next = home === t.id ? null : t.id
    setHomeTrip(me, next)
    setHome(next)
    toast(next ? `«${t.name}» будет открываться при запуске` : 'Отметка снята — при запуске откроется список', {
      id: 'home-trip',
    })
  }

  useEffect(() => {
    supabase
      .from('trips')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(errMsg(error))
        setTrips((data as Trip[]) ?? [])
      })
  }, [])

  async function create(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) return setError('Назови поездку')
    const { data, error } = await supabase
      .from('trips')
      .insert({ name: name.trim(), base_currency: base })
      .select('id')
      .single()
    if (error) return setError(errMsg(error))
    nav(`/t/${data.id}`)
  }

  function join(e: FormEvent) {
    e.preventDefault()
    // принимает и код, и полную ссылку (с хвостовым слэшем, ?query или #hash)
    const c = code.trim().split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop()?.toLowerCase()
    if (!c || !/^[0-9a-f]{6,32}$/.test(c)) return setError('Не похоже на код приглашения')
    nav(`/join/${c}`)
  }

  return (
    <div className="mx-auto max-w-md px-4 pt-[max(env(safe-area-inset-top),1.25rem)] pb-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Поездки</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{profile?.name}</span>
          <Avatar p={profile ?? undefined} />
        </div>
      </header>

      {trips === null ? (
        <TripsSkeleton />
      ) : (
        <div className="space-y-3">
          {trips.map((t) => {
            const pinned = home === t.id
            return (
              <Card
                key={t.id}
                className={`flex items-center gap-1 !p-0 transition-colors hover:bg-accent/40 ${pinned ? 'border-primary/40' : ''}`}
              >
                <Link to={`/t/${t.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-4 pl-4 active:opacity-70">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                    <Plane className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{t.name}</div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                      <span>
                        Итог в {CURRENCIES[t.base_currency]?.flag} {t.base_currency}
                      </span>
                      {pinned && (
                        <Badge variant="secondary" className="font-medium">
                          Открывается при запуске
                        </Badge>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
                <button
                  type="button"
                  onClick={() => togglePin(t)}
                  aria-pressed={pinned}
                  aria-label={`Открывать «${t.name}» при запуске`}
                  title={pinned ? 'Открывается при запуске — нажми, чтобы снять' : 'Открывать при запуске'}
                  className={`mr-2 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                    pinned ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                  }`}
                >
                  <Pin className={`size-5 ${pinned ? 'fill-current' : ''}`} aria-hidden />
                </button>
              </Card>
            )
          })}
          {trips.length === 0 && !creating && (
            <div className="flex flex-col items-center gap-3 py-8 text-center text-muted-foreground">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                <Luggage className="size-7" aria-hidden />
              </span>
              Пока нет поездок. Создай новую или вставь ссылку-приглашение от друга.
            </div>
          )}
        </div>
      )}

      <div className="mt-4">
        <ErrorBox>{error}</ErrorBox>
      </div>

      {creating ? (
        <Card className="mt-5">
          <form onSubmit={create} className="space-y-4">
            <div>
              <Label>
                <label htmlFor="trip-name">Название</label>
              </Label>
              <input
                id="trip-name"
                placeholder="Таиланд 2026"
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={80}
              />
            </div>
            <div>
              <Label>В какой валюте считать итог</Label>
              <div className="flex gap-2">
                {['THB', 'KZT', 'USD'].map((c) => (
                  <Chip key={c} active={base === c} onClick={() => setBase(c)}>
                    {CURRENCIES[c].flag} {c}
                  </Chip>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Расходы можно вносить в любой валюте (баты, тенге…) — они пересчитаются по курсу.
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" className="flex-1" onClick={() => setCreating(false)}>
                Отмена
              </Button>
              <Button className="flex-1">Создать</Button>
            </div>
          </form>
        </Card>
      ) : (
        <Button className="mt-5 w-full" onClick={() => setCreating(true)}>
          <Plus />
          Новая поездка
        </Button>
      )}

      <form onSubmit={join} className="mt-6">
        <Label>
          <label htmlFor="invite">Есть приглашение?</label>
        </Label>
        <div className="flex gap-2">
          <input
            id="invite"
            className={inputCls}
            placeholder="Ссылка или код"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button variant="ghost" disabled={!code.trim()}>
            Войти
          </Button>
        </div>
      </form>

      <UiButton
        variant="ghost"
        onClick={() => supabase.auth.signOut({ scope: 'local' })}
        className="mt-10 w-full text-muted-foreground"
      >
        <LogOut />
        Выйти из аккаунта
      </UiButton>
    </div>
  )
}
