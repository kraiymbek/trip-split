// Курсы валют. Основной источник — официальные курсы Нацбанка РК (тенге за единицу валюты, на дату);
// любая пара считается через тенге. Сайт Нацбанка не отдаёт CORS, поэтому идём через свой адрес /api/nbk
// (rewrite в vercel.json, в dev — proxy в vite.config.ts).
// Если Нацбанк недоступен или такой валюты у него нет — запасной API: https://github.com/fawazahmed0/exchange-api

export interface RateInfo {
  rate: number // сколько единиц `to` за 1 `from`
  source: 'nbk' | 'market'
  date: string // YYYY-MM-DD — на какую дату курс
}

export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = () => ymd(new Date())

async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url)
    return r.ok ? await r.text() : null
  } catch {
    return null
  }
}

/** RSS Нацбанка → тенге за 1 единицу каждой валюты (с учётом <quant>, например AMD идёт за 10). */
export function parseNbk(xml: string): Record<string, number> {
  const out: Record<string, number> = {}
  const re = /<title>([A-Z]{3})<\/title>\s*<description>([\d.]+)<\/description>\s*<quant>(\d+)<\/quant>/g
  for (const m of xml.matchAll(re)) {
    const v = Number(m[2]) / Number(m[3])
    if (v > 0) out[m[1]] = v
  }
  return out
}

/** Кросс-курс через тенге: сколько `to` за 1 `from`. */
export function crossRate(kzt: Record<string, number>, from: string, to: string): number | null {
  const k = (c: string) => (c === 'KZT' ? 1 : kzt[c])
  const a = k(from)
  const b = k(to)
  return a && b ? a / b : null
}

const nbkMemo = new Map<string, Promise<Record<string, number> | null>>()

function nbkDay(day: string): Promise<Record<string, number> | null> {
  let p = nbkMemo.get(day)
  if (p) return p
  p = (async () => {
    const key = `ts:nbk:${day}`
    try {
      const cached = localStorage.getItem(key)
      if (cached) return JSON.parse(cached) as Record<string, number>
    } catch {
      /* нет localStorage */
    }
    const [y, m, d] = day.split('-')
    const xml = await fetchText(`/api/nbk?fdate=${d}.${m}.${y}`)
    // не RSS Нацбанка (страница ошибки, заглушка) — считаем, что источник недоступен
    if (xml === null || !/<rates>/.test(xml)) return null
    const kzt = parseNbk(xml)
    // прошедшие дни не меняются — запоминаем; сегодняшний может уточниться
    if (Object.keys(kzt).length && day < today()) {
      try {
        localStorage.setItem(key, JSON.stringify(kzt))
      } catch {
        /* нет места */
      }
    }
    return kzt
  })()
  nbkMemo.set(day, p)
  p.then((v) => v === null && nbkMemo.delete(day)) // сетевую ошибку можно повторить позже
  return p
}

/** Курсы Нацбанка на дату; если на этот день курса нет (выходной) — ближайший предыдущий. */
export async function nbkRates(date: string): Promise<{ date: string; kzt: Record<string, number> } | null> {
  const d = new Date(`${date > today() ? today() : date}T12:00:00`)
  for (let back = 0; back < 7; back++) {
    const day = ymd(d)
    const kzt = await nbkDay(day)
    if (kzt === null) return null // Нацбанк недоступен
    if (Object.keys(kzt).length) return { date: day, kzt }
    d.setDate(d.getDate() - 1)
  }
  return null
}

async function marketRate(from: string, to: string, date: string): Promise<RateInfo | null> {
  const f = from.toLowerCase()
  const t = to.toLowerCase()
  const tags = date < today() ? [date, 'latest'] : ['latest']
  for (const tag of tags) {
    for (const url of [
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/${f}.min.json`,
      `https://${tag}.currency-api.pages.dev/v1/currencies/${f}.min.json`,
    ]) {
      const txt = await fetchText(url)
      let data: Record<string, unknown> | null = null
      try {
        data = txt ? JSON.parse(txt) : null
      } catch {
        data = null
      }
      const rate = (data?.[f] as Record<string, number> | undefined)?.[t]
      if (typeof rate === 'number' && rate > 0)
        return { rate, source: 'market', date: typeof data?.date === 'string' ? data.date : tag === 'latest' ? today() : tag }
    }
  }
  return null
}

/** Курс from → to на дату (YYYY-MM-DD, по умолчанию сегодня) и откуда он взят. */
export async function fetchRateInfo(from: string, to: string, date?: string): Promise<RateInfo | null> {
  const day = !date || date > today() ? today() : date
  if (from === to) return { rate: 1, source: 'nbk', date: day }
  const nbk = await nbkRates(day)
  const rate = nbk && crossRate(nbk.kzt, from, to)
  if (nbk && rate) return { rate, source: 'nbk', date: nbk.date }
  return marketRate(from, to, day)
}

export async function fetchRate(from: string, to: string, date?: string): Promise<number | null> {
  return (await fetchRateInfo(from, to, date))?.rate ?? null
}

export const dmy = (date: string) => date.split('-').reverse().join('.')

/** «курс Нацбанка РК на 26.11.2026» / «рыночный курс на 26.11.2026». */
export const rateSourceLabel = (i: RateInfo) =>
  `${i.source === 'nbk' ? 'курс Нацбанка РК' : 'рыночный курс (Нацбанк недоступен)'} на ${dmy(i.date)}`
