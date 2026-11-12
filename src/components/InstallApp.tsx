import { useEffect, useState, type ReactNode } from 'react'
import { EllipsisVertical, Share, Smartphone } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button, Label } from './ui'

// Событие установки (Chrome / Edge / Samsung Internet на Android и десктопе).
// Ловим его сразу при загрузке модуля — оно может прийти раньше, чем кнопка появится на экране.
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const subs = new Set<() => void>()
const notify = () => subs.forEach((f) => f())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // показываем свою кнопку вместо мини-баннера браузера
    deferred = e as InstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

const ua = () => navigator.userAgent
// iPadOS представляется как Mac — отличаем по тач-экрану
const isIOS = () => /iPhone|iPad|iPod/.test(ua()) || (/Macintosh/.test(ua()) && navigator.maxTouchPoints > 1)
const isIOSNotSafari = () => isIOS() && /CriOS|FxiOS|EdgiOS|YaBrowser|OPiOS/.test(ua())
const isAndroid = () => /Android/.test(ua())

export function InstallApp({ className = '', title }: { className?: string; title?: string }) {
  const [, rerender] = useState(0)
  const [installed, setInstalled] = useState(isStandalone)
  const [help, setHelp] = useState(false)

  useEffect(() => {
    const f = () => {
      rerender((n) => n + 1)
      setInstalled(isStandalone())
    }
    subs.add(f)
    const mq = window.matchMedia('(display-mode: standalone)')
    mq.addEventListener?.('change', f)
    return () => {
      subs.delete(f)
      mq.removeEventListener?.('change', f)
    }
  }, [])

  if (installed) return null

  async function install() {
    if (deferred) {
      const ev = deferred
      await ev.prompt()
      const { outcome } = await ev.userChoice
      if (outcome === 'accepted') deferred = null
      notify()
      return
    }
    setHelp(true)
  }

  return (
    <section className={className}>
      {title && <Label>{title}</Label>}
      <Button type="button" variant="ghost" className="w-full" onClick={install}>
        <Smartphone />
        Установить приложение
      </Button>
      <InstallHelp open={help} onClose={() => setHelp(false)} />
    </section>
  )
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
        {n || '!'}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  )
}

const ShareIcon = () => <Share className="inline size-5 -translate-y-0.5 text-sky-600" aria-label="Поделиться" />

function InstallHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ios = isIOS()

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-3xl px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        <SheetHeader className="flex-row items-center gap-3 px-0 text-left">
          <img src="/icons/apple-touch-icon.png" alt="" className="size-12 rounded-xl" />
          <div>
            <SheetTitle>Trip Split на экран «Домой»</SheetTitle>
            <SheetDescription>Откроется как обычное приложение, без адресной строки</SheetDescription>
          </div>
        </SheetHeader>

        <ol className="space-y-3 text-[15px]">
          {ios ? (
            <>
              {isIOSNotSafari() && (
                <Step n={0}>
                  Лучше открыть эту страницу в <b>Safari</b> — в других браузерах на iPhone пункта может не быть.
                </Step>
              )}
              <Step n={1}>
                Нажми <b>«Поделиться»</b> <ShareIcon /> внизу экрана (на iPad — вверху справа).
              </Step>
              <Step n={2}>
                Пролистай вниз и выбери <b>«На экран „Домой“»</b>.
              </Step>
              <Step n={3}>
                Нажми <b>«Добавить»</b> — иконка появится на рабочем столе.
              </Step>
            </>
          ) : isAndroid() ? (
            <>
              <Step n={1}>
                Открой меню браузера <EllipsisVertical className="inline size-4 -translate-y-px" aria-label="меню" /> (справа вверху).
              </Step>
              <Step n={2}>
                Выбери <b>«Установить приложение»</b> или <b>«Добавить на главный экран»</b>.
              </Step>
              <Step n={3}>Подтверди — иконка появится на рабочем столе.</Step>
            </>
          ) : (
            <>
              <Step n={1}>
                Открой этот адрес на телефоне: <b className="break-all">{window.location.origin}</b>
              </Step>
              <Step n={2}>iPhone — Safari → «Поделиться» → «На экран „Домой“».</Step>
              <Step n={3}>Android — Chrome → меню → «Установить приложение».</Step>
            </>
          )}
        </ol>

        <Button className="mt-2 w-full" onClick={onClose}>
          Понятно
        </Button>
      </SheetContent>
    </Sheet>
  )
}
