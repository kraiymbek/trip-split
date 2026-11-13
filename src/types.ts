import type { PayMethod } from './lib/balance'

export type { PayMethod }

export interface Profile {
  id: string
  name: string
  avatar_color: string
}

export interface Trip {
  id: string
  name: string
  base_currency: string
  invite_code: string
  created_by: string
  created_at: string
}

export interface Share {
  user_id: string
  share_base: number
}

export interface Expense {
  id: string
  trip_id: string
  paid_by: string
  title: string
  note: string | null
  amount: number
  currency: string
  rate: number
  amount_base: number
  method: PayMethod
  bank: string | null
  split_mode: 'equal' | 'custom'
  spent_at: string
  created_by: string
  created_at?: string
  updated_at?: string
  updated_by?: string
  shares: Share[]
  pending?: boolean // лежит в офлайн-очереди
  syncing?: boolean // из очереди и прямо сейчас отправляется (а не ждёт сети)
}

export interface Settlement {
  id: string
  trip_id: string
  from_user: string
  to_user: string
  amount_base: number
  method: PayMethod
  bank: string | null
  created_at: string
  created_by?: string
  pending?: boolean
}

export const METHODS: { id: PayMethod; label: string; icon: string }[] = [
  { id: 'card', label: 'Карта', icon: '💳' },
  { id: 'cash', label: 'Наличные', icon: '💵' },
]

/** Банки для оплаты картой. id хранится в базе — не переименовывать, только добавлять. */
export const BANKS: { id: string; label: string; color: string }[] = [
  { id: 'kaspi', label: 'Kaspi', color: '#f14635' },
  { id: 'halyk', label: 'Halyk', color: '#1d8a50' },
  { id: 'freedom', label: 'Freedom', color: '#5aa832' },
  { id: 'jusan', label: 'Jusan', color: '#f2741f' },
  { id: 'forte', label: 'Forte', color: '#a3195b' },
  { id: 'bcc', label: 'BCC', color: '#00a19a' },
  { id: 'homecredit', label: 'Home Credit', color: '#e30613' },
  { id: 'bereke', label: 'Bereke', color: '#0c8a6e' },
  { id: 'eurasian', label: 'Евразийский', color: '#c8102e' },
  { id: 'altyn', label: 'Altyn', color: '#b8860b' },
  { id: 'other', label: 'Другой банк', color: '#64748b' },
]

export const bankLabel = (id: string | null | undefined) =>
  BANKS.find((b) => b.id === id)?.label ?? (id ? id : 'Карта')

/** «Kaspi» или «Наличные» (иконку рисует MethodIcon) */
export const methodLabel = (m: PayMethod, bank?: string | null) =>
  m === 'card' ? (bank ? bankLabel(bank) : 'Карта') : 'Наличные'

export interface CashOp {
  id: string
  trip_id: string
  user_id: string
  kind: 'deposit' | 'exchange'
  from_amount: number | null
  from_currency: string | null
  to_amount: number
  to_currency: string
  note: string | null
  happened_at: string
  pending?: boolean
}
