// Суммы в приложении — целые числа в сотых долях (1 бат = 100 сатангов, 1 тенге = 100 тиынов).

export const CURRENCIES: Record<string, { symbol: string; flag: string; name: string }> = {
  THB: { symbol: '฿', flag: '🇹🇭', name: 'Тайский бат' },
  KZT: { symbol: '₸', flag: '🇰🇿', name: 'Тенге' },
  USD: { symbol: '$', flag: '🇺🇸', name: 'Доллар США' },
  EUR: { symbol: '€', flag: '🇪🇺', name: 'Евро' },
  RUB: { symbol: '₽', flag: '🇷🇺', name: 'Рубль' },
  CNY: { symbol: '¥', flag: '🇨🇳', name: 'Юань' },
  AED: { symbol: 'AED', flag: '🇦🇪', name: 'Дирхам ОАЭ' },
  TRY: { symbol: '₺', flag: '🇹🇷', name: 'Турецкая лира' },
}

export const QUICK_CURRENCIES = ['THB', 'KZT', 'USD']

const nfInt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const nfFrac = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Целые — без копеек («1 000 ฿»), дробные — всегда два знака («23 885,60 ฿», а не «23 885,6 ฿») */
export function formatMoney(minor: number, currency: string): string {
  const sym = CURRENCIES[currency]?.symbol ?? currency
  return `${(minor % 100 === 0 ? nfInt : nfFrac).format(minor / 100)} ${sym}`
}

/** Максимум для одной суммы: 1 млрд единиц валюты */
export const MAX_AMOUNT = 100_000_000_000

const clean = (input: string) => input.replace(/[\s ']/g, '').replace(',', '.')

/** "1 234,56" | "1234.5" → 123456; null если не число, <= 0 (или < 0 при allowZero) или больше лимита */
export function parseMoney(input: string, allowZero = false): number | null {
  const cleaned = clean(input)
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(cleaned)) return null
  const value = Math.round(parseFloat(cleaned) * 100)
  if (value > MAX_AMOUNT) return null
  return value > 0 || (allowZero && value === 0) ? value : null
}

/** Человеческое объяснение, почему сумма не принята ('' — всё ок) */
export function moneyError(input: string): string {
  const cleaned = clean(input)
  if (!cleaned) return 'Введи сумму'
  if (/^\d+\.\d{3,}$/.test(cleaned)) return 'Не больше двух знаков после запятой'
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(cleaned)) return 'Сумма — только цифры, например 1250 или 99,50'
  const value = Math.round(parseFloat(cleaned) * 100)
  if (value <= 0) return 'Сумма должна быть больше нуля'
  if (value > MAX_AMOUNT) return 'Слишком большая сумма'
  return ''
}

/** Курс из поля ввода; null если пусто/ноль/мусор */
export function parseRate(input: string): number | null {
  const v = Number(clean(input))
  return Number.isFinite(v) && v > 0 && v < 1e7 ? v : null
}

/** 123456 → "1234.56" для поля ввода */
export function minorToInput(minor: number): string {
  const s = (minor / 100).toFixed(2)
  return s.endsWith('.00') ? s.slice(0, -3) : s
}

export function convert(minor: number, rate: number): number {
  return Math.round(minor * rate)
}
