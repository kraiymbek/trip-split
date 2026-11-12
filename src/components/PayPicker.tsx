import { Banknote, CreditCard } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BANKS, METHODS, type PayMethod } from '../types'

export const MethodIcon = ({ m, className }: { m: PayMethod; className?: string }) =>
  m === 'card' ? <CreditCard className={className} aria-hidden /> : <Banknote className={className} aria-hidden />

const KEY = 'ts:bank'

/** Последний выбранный банк — подставляется по умолчанию */
export function lastBank(): string {
  try {
    const b = localStorage.getItem(KEY)
    if (b && BANKS.some((x) => x.id === b)) return b
  } catch {
    /* private mode */
  }
  return BANKS[0].id
}

function rememberBank(b: string) {
  try {
    localStorage.setItem(KEY, b)
  } catch {
    /* private mode */
  }
}

export function PayPicker({
  method,
  bank,
  onChange,
}: {
  method: PayMethod
  bank: string | null
  onChange: (method: PayMethod, bank: string | null) => void
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id, m.id === 'card' ? (bank ?? lastBank()) : null)}
            aria-pressed={method === m.id}
            className={cn(
              'flex h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border text-[15px] font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              method === m.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-accent',
            )}
          >
            <MethodIcon m={m.id} className="size-5" />
            {m.label}
          </button>
        ))}
      </div>

      {method === 'card' && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Банк">
          {BANKS.map((b) => {
            const active = bank === b.id
            return (
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  rememberBank(b.id)
                  onChange('card', b.id)
                }}
                className={cn(
                  'flex h-10 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  active ? 'border-transparent text-white' : 'bg-card text-foreground hover:bg-accent',
                )}
                style={active ? { background: b.color } : undefined}
              >
                {!active && <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />}
                {b.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
