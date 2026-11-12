// Экраны загрузки: фирменная заставка при старте и скелетоны, повторяющие будущую раскладку
// (ничего не прыгает, когда данные приходят). Скелетоны показываются с небольшой задержкой,
// чтобы при быстрой загрузке не мигать.
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Button as UiButton } from '@/components/ui/button'

function useDelayed(ms: number) {
  const [show, setShow] = useState(ms <= 0)
  useEffect(() => {
    if (ms <= 0) return
    const t = setTimeout(() => setShow(true), ms)
    return () => clearTimeout(t)
  }, [ms])
  return show
}

function Busy({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

/** Та же заставка, что в index.html, — переход от «до JS» к «проверяем вход» без скачка */
export function AppSplash({ text }: { text?: string }) {
  return (
    <Busy label={text ?? 'Загрузка Trip Split'}>
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3.5">
        <img src="/icons/icon-192.png" alt="" className="size-[72px] rounded-[18px] shadow-[0_10px_30px_-8px_rgba(4,120,87,.45)]" />
        <div className="text-[22px] font-bold tracking-tight">Trip Split</div>
        {text && <div className="text-sm text-muted-foreground">{text}</div>}
        <div className="mt-1.5 h-1 w-24 overflow-hidden rounded bg-primary/15">
          <span className="block h-full w-2/5 animate-[boot-slide_1.1s_ease-in-out_infinite] rounded bg-primary motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-50" />
        </div>
      </div>
    </Busy>
  )
}

/** Список поездок */
export function TripsSkeleton() {
  const show = useDelayed(150)
  if (!show) return <div className="h-40" />
  return (
    <Busy label="Загружаем поездки">
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-xs">
            <Skeleton className="size-11 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3.5 w-1/4" />
            </div>
            <Skeleton className="size-9 rounded-full" />
          </div>
        ))}
      </div>
    </Busy>
  )
}

/** Открытие поездки: шапка, итоги, фильтры, лента и нижнее меню — как на настоящем экране */
export function TripSkeleton() {
  const show = useDelayed(150)
  return (
    <div className="mx-auto min-h-dvh max-w-md">
      <header className="flex items-center gap-1 px-2 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2">
        <UiButton asChild variant="ghost" size="icon" aria-label="К списку поездок">
          <Link to="/">
            <ChevronLeft className="size-6" />
          </Link>
        </UiButton>
        {show && <Skeleton className="h-6 w-40" />}
      </header>
      {show && (
        <Busy label="Загружаем поездку">
          <div className="space-y-4 px-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-[84px] rounded-2xl bg-primary/15" />
              <Skeleton className="h-[84px] rounded-2xl" />
            </div>
            <div className="flex gap-2">
              {[56, 88, 112].map((w) => (
                <Skeleton key={w} className="h-10 rounded-full" style={{ width: w }} />
              ))}
            </div>
            <Skeleton className="h-4 w-28" />
            <div className="divide-y rounded-2xl border bg-card shadow-xs">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3 px-4 py-3.5">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex-1 space-y-2 pt-0.5">
                    <div className="flex justify-between gap-4">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Busy>
      )}
      <div className="fixed inset-x-0 bottom-0 border-t bg-card/95 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-md justify-around py-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <Skeleton className="size-6 rounded-lg" />
              <Skeleton className="h-2.5 w-12" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
