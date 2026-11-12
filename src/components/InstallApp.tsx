import { useEffect, useState, type ReactNode } from 'react'
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
        📲 Установить приложение
      </Button>
      {help && <InstallHelp onClose={() => setHelp(false)} />}
    </section>
  )
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-600 text-sm font-bold text-white">
        {n || '!'}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  )
}

const ShareIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="inline h-5 w-5 -translate-y-0.5 text-sky-600"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-label="Поделиться"
  >
    <path d="M12 3v12M8 7l4-4 4 4" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
)

function InstallHelp({ onClose }: { onClose: () => void }) {
  const ios = isIOS()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-white p-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Как установить приложение"
      >
        <div className="mb-4 flex items-center gap-3">
          <img src="/icons/apple-touch-icon.png" alt="" className="h-12 w-12 rounded-xl" />
          <div>
            <div className="font-bold">Trip Split на экран «Домой»</div>
            <div className="text-sm text-slate-500">Откроется как обычное приложение, без адресной строки</div>
          </div>
        </div>

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
                Открой меню браузера <b>⋮</b> (справа вверху).
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
              <Step n={3}>Android — Chrome → ⋮ → «Установить приложение».</Step>
            </>
          )}
        </ol>

        <Button className="mt-6 w-full" onClick={onClose}>
          Понятно
        </Button>
      </div>
    </div>
  )
}
