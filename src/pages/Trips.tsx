import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { errMsg, supabase } from '../lib/supabase'
import { CURRENCIES } from '../lib/money'
import type { Trip } from '../types'
import { Avatar, Button, Card, Chip, ErrorBox, Label, Spinner, inputCls } from '../components/ui'

export default function Trips() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('Таиланд 🇹🇭')
  const [base, setBase] = useState('THB')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

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
        <h1 className="text-2xl font-bold">Поездки</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">{profile?.name}</span>
          <Avatar p={profile ?? undefined} />
        </div>
      </header>

      {trips === null ? (
        <Spinner full />
      ) : (
        <div className="space-y-3">
          {trips.map((t) => (
            <Link key={t.id} to={`/t/${t.id}`} className="block">
              <Card className="flex items-center justify-between active:bg-slate-50">
                <div>
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-sm text-slate-500">
                    Итог в {CURRENCIES[t.base_currency]?.flag} {t.base_currency}
                  </div>
                </div>
                <span className="text-xl text-slate-300">›</span>
              </Card>
            </Link>
          ))}
          {trips.length === 0 && !creating && (
            <p className="py-6 text-center text-slate-500">
              Пока нет поездок. Создай новую или вставь ссылку-приглашение от друга.
            </p>
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
              <Label>Название</Label>
              <input
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
              <p className="mt-1.5 text-xs text-slate-500">
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
          + Новая поездка
        </Button>
      )}

      <form onSubmit={join} className="mt-6">
        <Label>Есть приглашение?</Label>
        <div className="flex gap-2">
          <input
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

      <button
        onClick={() => supabase.auth.signOut({ scope: 'local' })}
        className="mt-10 w-full text-center text-sm text-slate-400 underline"
      >
        Выйти из аккаунта
      </button>
    </div>
  )
}
