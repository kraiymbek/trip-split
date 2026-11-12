import { useState } from 'react'
import { disableNotify, enableNotify, notifyEnabled, notifySupported, systemNotify } from '../lib/notify'
import { Button, Card, Label } from './ui'

const standalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true)
const isIOS = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent)

export function NotifySettings() {
  const [on, setOn] = useState(notifyEnabled)
  const [msg, setMsg] = useState('')

  let hint = 'Покажем уведомление, когда тебе добавят или изменят расход или отметят возврат долга.'
  if (!notifySupported())
    hint =
      isIOS() && !standalone()
        ? 'На iPhone уведомления работают только у приложения, поставленного на экран «Домой» (iOS 16.4+).'
        : 'Этот браузер не умеет показывать уведомления. В приложении всё равно будет 🔔 со списком нового.'

  return (
    <section>
      <Label>Уведомления</Label>
      <Card className="space-y-3">
        <p className="text-sm text-slate-600">{hint}</p>
        <p className="text-xs text-slate-500">
          Приходят, пока приложение открыто или свёрнуто. Если оно было закрыто — всё новое покажет 🔔 при следующем
          входе.
        </p>
        {notifySupported() && (
          <Button
            variant={on ? 'ghost' : 'primary'}
            className="w-full"
            onClick={async () => {
              setMsg('')
              if (on) {
                disableNotify()
                setOn(false)
                return
              }
              const p = await enableNotify()
              if (p === 'granted') {
                setOn(true)
                systemNotify('Trip Split', 'Уведомления включены 👍', location.pathname, 'ts-test')
              } else if (p === 'denied')
                setMsg('Уведомления запрещены в настройках браузера или телефона для этого сайта — разреши их там.')
            }}
          >
            {on ? '🔕 Выключить уведомления' : '🔔 Включить уведомления'}
          </Button>
        )}
        {msg && <p className="text-sm text-rose-700">{msg}</p>}
      </Card>
    </section>
  )
}
