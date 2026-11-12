// Курсы валют из бесплатного API без ключа: https://github.com/fawazahmed0/exchange-api

const today = () => new Date().toISOString().slice(0, 10)

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url)
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

/** Курс from → to на дату (YYYY-MM-DD). Сначала курс на дату, потом последний. */
export async function fetchRate(from: string, to: string, date?: string): Promise<number | null> {
  if (from === to) return 1
  const f = from.toLowerCase()
  const t = to.toLowerCase()
  const tags = date && date < today() ? [date, 'latest'] : ['latest']
  for (const tag of tags) {
    const urls = [
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/${f}.min.json`,
      `https://${tag}.currency-api.pages.dev/v1/currencies/${f}.min.json`,
    ]
    for (const url of urls) {
      const data = await fetchJson(url)
      const rate = (data?.[f] as Record<string, number> | undefined)?.[t]
      if (typeof rate === 'number' && rate > 0) return rate
    }
  }
  return null
}
