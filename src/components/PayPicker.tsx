import { BANKS, METHODS, type PayMethod } from '../types'

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
            className={`flex h-14 items-center justify-center gap-2 rounded-xl text-[15px] font-semibold transition ${
              method === m.id ? 'bg-teal-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'
            }`}
          >
            <span className="text-xl leading-none">{m.icon}</span>
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
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  active ? 'text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'
                }`}
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
