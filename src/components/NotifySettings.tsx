import { useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
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
        : 'Этот браузер не умеет показывать уведомления. Новое всё равно видно по колокольчику в шапке поездки.'

  return (
    <section>
      <Label>Уведомления</Label>
      <Card className="space-y-3">
        <p className="text-sm text-muted-foreground">{hint}</p>
        <p className="text-xs text-muted-foreground">
          Приходят, пока приложение открыто или свёрнуто. Если оно было закрыто — всё новое покажет колокольчик в шапке
          поездки.
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
                systemNotify('Trip Split', 'Уведомления включены', location.pathname, 'ts-test')
              } else if (p === 'denied')
                setMsg('Уведомления запрещены в настройках браузера или телефона для этого сайта — разреши их там.')
            }}
          >
            {on ? <BellOff /> : <Bell />}
            {on ? 'Выключить уведомления' : 'Включить уведомления'}
          </Button>
        )}
        {msg && <p className="text-sm text-negative">{msg}</p>}
      </Card>
    </section>
  )
}
