import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { Profile } from '../types'

export function Avatar({ p, size = 32 }: { p?: Profile; size?: number }) {
  const letter = (p?.name ?? '?').trim().charAt(0).toUpperCase()
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: p?.avatar_color ?? '#94a3b8', fontSize: size * 0.45 }}
      title={p?.name}
    >
      {letter}
    </span>
  )
}

export function Spinner({ full }: { full?: boolean }) {
  const s = <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-teal-600 border-t-transparent" />
  return full ? <div className="flex min-h-[60vh] items-center justify-center">{s}</div> : s
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }

export function Button({ variant = 'primary', className = '', ...rest }: BtnProps) {
  const v = {
    primary: 'bg-teal-600 text-white active:bg-teal-700 disabled:bg-slate-300',
    ghost: 'bg-white text-slate-700 ring-1 ring-slate-200 active:bg-slate-50',
    danger: 'bg-white text-red-600 ring-1 ring-red-200 active:bg-red-50',
  }[variant]
  return (
    <button
      className={`h-12 rounded-xl px-4 text-[15px] font-semibold transition disabled:cursor-not-allowed ${v} ${className}`}
      {...rest}
    />
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 ${className}`}>{children}</div>
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium transition ${
        active ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">{children}</div>
}

export const inputCls =
  'h-12 w-full rounded-xl bg-white px-3.5 text-[16px] ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-teal-500'

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null
  return <div className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{children}</div>
}
