import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTripCtx } from './TripLayout'
import { useAuth } from '../auth'
import { CURRENCIES } from '../lib/money'
import { errMsg, supabase } from '../lib/supabase'
import { Avatar, Button, Card, Chip, ErrorBox, Label, inputCls } from '../components/ui'
import { InstallApp } from '../components/InstallApp'
import { NotifySettings } from '../components/NotifySettings'
import { buildTripCsv, exportFileName, saveFile } from '../lib/exportCsv'

export default function TripSettings() {
  const { trip, members, memberById, expenses, settlements, cashOps, me, reload } = useTripCtx()
  const [exporting, setExporting] = useState(false)
  const { profile, refreshProfile } = useAuth()
  const nav = useNavigate()
  const [tripName, setTripName] = useState(trip.name)
  const [myName, setMyName] = useState(profile?.name ?? '')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const link = `${window.location.origin}/join/${trip.invite_code}`
  const canChangeBase = expenses.length === 0 && settlements.length === 0
  const involved =
    expenses.some((e) => e.paid_by === me || e.shares.some((s) => s.user_id === me)) ||
    settlements.some((s) => s.from_user === me || s.to_user === me)

  async function share() {
    const text = `Присоединяйся к «${trip.name}» в Trip Split — будем считать общие расходы`
    if (navigator.share) {
      try {
        await navigator.share({ title: trip.name, text, url: link })
        return
      } catch {
        /* отменили — fallback на копирование */
      }
    }
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // нет доступа к буферу (http / старый браузер) — показываем ссылку для ручного копирования
      window.prompt('Скопируй ссылку:', link)
    }
  }

  async function run(fn: () => PromiseLike<{ error: unknown }>, msg: string) {
    setError('')
    setSaved('')
    const { error } = await fn()
    if (error) setError(errMsg(error))
    else {
      setSaved(msg)
      setTimeout(() => setSaved(''), 2000)
    }
    return !error
  }

  return (
    <div className="space-y-5 pb-6">
      <section>
        <Label>Пригласить друзей</Label>
        <Card className="space-y-3">
          <p className="text-sm text-slate-600">
            Отправь ссылку в чат — друг зарегистрируется и сразу попадёт в эту поездку.
          </p>
          <div className="truncate rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm text-slate-600">{link}</div>
          <Button className="w-full" onClick={share}>
            {copied ? 'Скопировано ✓' : 'Поделиться ссылкой'}
          </Button>
        </Card>
      </section>

      <section>
        <Label>Участники · {members.length}</Label>
        <Card className="divide-y divide-slate-100 !p-0">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar p={m} />
              <span className="flex-1">
                {m.name}
                {m.id === me && <span className="text-slate-400"> (я)</span>}
              </span>
              {m.id === trip.created_by && <span className="text-xs text-slate-400">создатель</span>}
            </div>
          ))}
        </Card>
      </section>

      <section>
        <Label>Моё имя</Label>
        <div className="flex gap-2">
          <input className={inputCls} value={myName} onChange={(e) => setMyName(e.target.value)} maxLength={40} />
          <Button
            variant="ghost"
            disabled={!myName.trim() || myName.trim() === profile?.name}
            onClick={async () => {
              if (await run(() => supabase.from('profiles').update({ name: myName.trim() }).eq('id', me), 'Имя сохранено')) {
                refreshProfile()
                reload()
              }
            }}
          >
            OK
          </Button>
        </div>
      </section>

      <section>
        <Label>Поездка</Label>
        <Card className="space-y-4">
          <div className="flex gap-2">
            <input className={inputCls} value={tripName} onChange={(e) => setTripName(e.target.value)} maxLength={80} />
            <Button
              variant="ghost"
              disabled={!tripName.trim() || tripName.trim() === trip.name}
              onClick={async () => {
                if (await run(() => supabase.from('trips').update({ name: tripName.trim() }).eq('id', trip.id), 'Сохранено'))
                  reload()
              }}
            >
              OK
            </Button>
          </div>
          <div>
            <div className="mb-1.5 text-sm text-slate-600">Валюта итогов</div>
            <div className="flex gap-2">
              {['THB', 'KZT', 'USD'].map((c) => (
                <Chip
                  key={c}
                  active={trip.base_currency === c}
                  onClick={async () => {
                    if (!canChangeBase || c === trip.base_currency) return
                    if (await run(() => supabase.from('trips').update({ base_currency: c }).eq('id', trip.id), 'Сохранено'))
                      reload()
                  }}
                >
                  {CURRENCIES[c].flag} {c}
                </Chip>
              ))}
            </div>
            {!canChangeBase && (
              <p className="mt-1.5 text-xs text-slate-500">Менять можно только пока нет расходов.</p>
            )}
          </div>
        </Card>
        <div className="mt-2 space-y-2">
          <ErrorBox>{error}</ErrorBox>
          {saved && <div className="text-sm text-teal-700">{saved}</div>}
        </div>
      </section>

      <section>
        <Label>Выгрузка и бэкап</Label>
        <Card className="space-y-3">
          <p className="text-sm text-slate-600">
            Один файл со всем: итоги и переводы, все расходы с долей каждого, возвраты, наличные. Открывается в Excel,
            Numbers и Google Таблицах. Удобно скачивать раз в пару дней — на всякий случай.
          </p>
          <Button
            className="w-full"
            disabled={exporting}
            onClick={async () => {
              setExporting(true)
              try {
                const real = (x: { pending?: boolean }) => !x.pending // в файл — только то, что уже на сервере
                await saveFile(
                  exportFileName(trip),
                  buildTripCsv({
                    trip,
                    members,
                    memberById,
                    expenses: expenses.filter(real),
                    settlements: settlements.filter(real),
                    cashOps: cashOps.filter(real),
                  }),
                )
              } catch (e) {
                setError(errMsg(e))
              } finally {
                setExporting(false)
              }
            }}
          >
            {exporting ? '…' : '📥 Скачать всё (Excel / CSV)'}
          </Button>
        </Card>
      </section>

      <NotifySettings />

      <InstallApp title="Поставить на телефон" />

      <div className="space-y-2">
        {involved ? (
          <p className="text-center text-xs text-slate-500">
            Покинуть поездку нельзя — ты уже есть в расходах. Иначе у остальных сломаются итоги.
          </p>
        ) : (
          <Button
            variant="danger"
            className="w-full"
            onClick={async () => {
              if (!confirm('Выйти из поездки?')) return
              if (await run(() => supabase.rpc('leave_trip', { p_trip: trip.id }), '')) nav('/', { replace: true })
            }}
          >
            Покинуть поездку
          </Button>
        )}
        {trip.created_by === me && (
          <Button
            variant="danger"
            className="w-full"
            onClick={async () => {
              if (!confirm(`Удалить «${trip.name}» со всеми расходами для всех участников?`)) return
              if (await run(() => supabase.from('trips').delete().eq('id', trip.id), '')) nav('/', { replace: true })
            }}
          >
            Удалить поездку
          </Button>
        )}
        <button
          onClick={() => supabase.auth.signOut()}
          className="w-full pt-2 text-center text-sm text-slate-400 underline"
        >
          Выйти из аккаунта
        </button>
      </div>
    </div>
  )
}
