import { describe, expect, it } from 'vitest'
import { crossRate, parseNbk } from './rates'
import { computeBalances, convertTrip, daysToConvert, pairwiseDebts } from './balance'

const xml = `<rates><date>26.11.2026</date>
  <item><fullname>ДОЛЛАР США</fullname><title>USD</title><description>458.57</description><quant>1</quant></item>
  <item><fullname>АРМЯНСКИЙ ДРАМ</fullname><title>AMD</title><description>12.79</description><quant>10</quant></item>
  <item><fullname>БАТ</fullname><title>THB</title><description>13.45</description><quant>1</quant></item></rates>`

describe('курсы Нацбанка РК', () => {
  it('разбирает RSS с учётом quant', () => {
    expect(parseNbk(xml)).toEqual({ USD: 458.57, AMD: 1.279, THB: 13.45 })
    expect(parseNbk('<rates></rates>')).toEqual({})
  })
  it('кросс-курс через тенге', () => {
    const k = parseNbk(xml)
    expect(crossRate(k, 'THB', 'KZT')).toBe(13.45)
    expect(crossRate(k, 'KZT', 'THB')).toBeCloseTo(1 / 13.45)
    expect(crossRate(k, 'USD', 'THB')).toBeCloseTo(458.57 / 13.45)
    expect(crossRate(k, 'EUR', 'KZT')).toBeNull()
  })
})

describe('пересчёт поездки по курсу на день оплаты', () => {
  const day1 = '2026-11-20T10:00:00'
  const day2 = '2026-11-25T10:00:00'
  const rates = (d: string) => ({ '2026-11-20': { THB: 13, USD: 450 }, '2026-11-25': { THB: 14, USD: 460 } })[d]
  const e = (paid_by: string, amount: number, currency: string, amount_base: number, spent_at: string, ids: string[]) => ({
    paid_by, amount, currency, amount_base, spent_at, method: 'card' as const,
    shares: ids.map((u, i) => ({ user_id: u, share_base: Math.floor(amount_base / ids.length) + (i < amount_base % ids.length ? 1 : 0) })),
  })

  it('каждый расход — по своему дню, тенге — как есть, доли сходятся', () => {
    const expenses = [
      e('a', 100000, 'THB', 100000, day1, ['a', 'b']), // 1000 ฿ × 13 = 13 000 ₸
      e('b', 100000, 'THB', 100000, day2, ['a', 'b']), // 1000 ฿ × 14 = 14 000 ₸
      e('a', 1300000, 'KZT', 100000, day2, ['a', 'b', 'c']), // в тенге — ровно 13 000 ₸, без пересчёта
      e('c', 10000, 'USD', 34500, day1, ['c', 'b']), // 100 $ × 450 = 45 000 ₸ (по курсу доллара, а не через бат)
    ]
    const settlements = [{ from_user: 'b', to_user: 'a', amount_base: 10000, created_at: day2 }] // 100 ฿
    expect(daysToConvert(expenses, settlements)).toEqual(['2026-11-20', '2026-11-25'])
    const r = convertTrip(expenses, settlements, 'THB', 'KZT', rates)!
    expect(r.expenses.map((x) => x.amount_base)).toEqual([1300000, 1400000, 1300000, 4500000])
    for (const x of r.expenses) expect(x.shares.reduce((s, y) => s + y.share_base, 0)).toBe(x.amount_base)
    // расход в тенге поровну на троих остаётся поровну, хотя курс в нём (0,0769) не равен курсу Нацбанка
    expect(r.expenses[2].shares.map((x) => x.share_base)).toEqual([433342, 433329, 433329]) // 333,34 / 333,33 / 333,33 ฿ в той же пропорции
    expect(r.settlements[0].amount_base).toBe(130000) // гасит долг b за расход 20.11 — по его курсу (13), а не по курсу дня возврата
    // в тенге всё по-прежнему сходится: сумма балансов 0, переводы обнуляют
    const b = computeBalances(['a', 'b', 'c'], r.expenses, r.settlements)
    expect(Object.values(b).reduce((s, v) => s + v, 0)).toBe(0)
    for (const t of pairwiseDebts(r.expenses, r.settlements)) { b[t.from] += t.amount; b[t.to] -= t.amount }
    expect(Object.values(b).every((v) => v === 0)).toBe(true)
  })

  it('возвращённый долг остаётся закрытым, хоть курс в день возврата другой', () => {
    const expenses = [e('a', 200000, 'THB', 200000, day1, ['a', 'b'])] // b должен a 1000 ฿ (13 ₸ за бат)
    const settlements = [{ from_user: 'b', to_user: 'a', amount_base: 100000, created_at: day2 }] // вернул 1000 ฿ (курс уже 14)
    const r = convertTrip(expenses, settlements, 'THB', 'KZT', rates)!
    expect(pairwiseDebts(r.expenses, r.settlements)).toEqual([])
    expect(computeBalances(['a', 'b'], r.expenses, r.settlements)).toEqual({ a: 0, b: 0 })
  })

  it('нет курса на день — null (показываем в базовой валюте)', () => {
    expect(convertTrip([e('a', 100, 'THB', 100, '2026-11-01T10:00:00', ['a'])], [], 'THB', 'KZT', rates)).toBeNull()
  })
})
