// Общие обёртки приложения поверх shadcn/ui — страницы пользуются только ими,
// поэтому вид меняется в одном месте.
import type { ComponentProps, ReactNode } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Button as UiButton } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import type { Profile } from '../types'

export function Avatar({ p, size = 32, className }: { p?: Profile; size?: number; className?: string }) {
  const letter = (p?.name ?? '?').trim().charAt(0).toUpperCase()
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white',
        className,
      )}
      style={{ width: size, height: size, background: p?.avatar_color ?? '#94a3b8', fontSize: size * 0.42 }}
      aria-hidden
    >
      {letter}
    </span>
  )
}

export function Spinner({ full, className }: { full?: boolean; className?: string }) {
  const s = <Loader2 className={cn('size-7 animate-spin text-primary', className)} aria-label="Загрузка" />
  return full ? <div className="flex min-h-[60vh] items-center justify-center">{s}</div> : s
}

type BtnProps = Omit<ComponentProps<typeof UiButton>, 'variant'> & { variant?: 'primary' | 'ghost' | 'danger' }

/** primary — главное действие, ghost — второстепенное, danger — необратимое */
export function Button({ variant = 'primary', className, size = 'lg', ...rest }: BtnProps) {
  const map = { primary: 'default', ghost: 'outline', danger: 'outline' } as const
  return (
    <UiButton
      variant={map[variant]}
      size={size}
      className={cn(
        variant === 'danger' && 'border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive',
        className,
      )}
      {...rest}
    />
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-2xl border bg-card p-4 text-card-foreground shadow-xs', className)}>{children}</div>
}

/** Переключатель-«пилюля»: валюты, фильтры, участники */
export function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-foreground/80 hover:bg-accent',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-2 text-sm font-semibold text-muted-foreground', className)}>{children}</div>
}

export const inputCls =
  'h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircle />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}

/** Сумма со знаком: зелёная — тебе должны, красная — ты должен */
export function Signed({ value, children, className }: { value: number; children: ReactNode; className?: string }) {
  return (
    <span className={cn('tabular', value > 0 ? 'text-positive' : value < 0 ? 'text-negative' : 'text-muted-foreground', className)}>
      {children}
    </span>
  )
}
