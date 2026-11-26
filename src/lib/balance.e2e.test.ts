// Сквозная проверка «кто кому должен» на локальном Supabase с 4 участниками.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { computeBalances, pairwiseDebts, splitEqual, type ExpenseLike } from './balance'

const URL = 'http://127.0.0.1:54321'
// ANON=… SERVICE=… npx vitest run src/lib/balance.e2e.test.ts (ключи — из `npx supabase status`)
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const ANON = env.ANON ?? ''
const SERVICE = env.SERVICE ?? ''
const PASS = 'qa-pass-123'
const people = [
  { email: 'qa.a@trip.local', name: 'Аня' },
  { email: 'qa.b@trip.local', name: 'Боря' },
  { email: 'qa.c@trip.local', name: 'Вика' },
  { email: 'qa.d@trip.local', name: 'Гена' },
]

describe.skipIf(!ANON)('кто кому должен — 4 участника, живая база', () => {
  it('балансы и переводы совпадают с независимым попарным расчётом у всех четверых', async () => {
    const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })
    for (const p of people.slice(2))
      await admin.auth.admin.createUser({ email: p.email, password: PASS, email_confirm: true, user_metadata: { name: p.name } })

    const cl: SupabaseClient[] = []
    const id: string[] = []
    for (const p of people) {
      const c = createClient(URL, ANON, { auth: { persistSession: false } })
      const { data, error } = await c.auth.signInWithPassword({ email: p.email, password: PASS })
      if (error) throw error
      cl.push(c)
      id.push(data.user!.id)
    }
    const [A, B, V, G] = id

    const trip = await cl[0].from('trips').insert({ name: 'QA 4 участника', base_currency: 'THB' }).select().single()
    if (trip.error) throw trip.error
    const T = trip.data.id
    try {
      for (const c of cl.slice(1)) {
        const j = await c.rpc('join_trip', { p_code: trip.data.invite_code })
        if (j.error) throw j.error
      }

      type E = { by: number; paid: string; amount: number; shares: { user_id: string; share_base: number }[]; mode?: string }
      const list: E[] = [
        { by: 0, paid: A, amount: 400000, shares: splitEqual(400000, [A, B, V, G]) },
        { by: 1, paid: B, amount: 300000, shares: splitEqual(300000, [B, V, G]) },
        { by: 2, paid: V, amount: 100000, shares: splitEqual(100000, [A, V]) },
        { by: 3, paid: G, amount: 200000, mode: 'custom', shares: [{ user_id: G, share_base: 150000 }, { user_id: B, share_base: 50000 }] },
        // Аня вносит расход, который оплатил Гена (99 999 на четверых — с остатком)
        { by: 0, paid: G, amount: 99999, shares: splitEqual(99999, [A, B, V, G]) },
        // Боря заплатил только за Вику
        { by: 1, paid: B, amount: 12345, shares: [{ user_id: V, share_base: 12345 }] },
      ]
      for (const [k, e] of list.entries()) {
        const r = await cl[e.by].rpc('save_expense', {
          p_id: null, p_trip_id: T, p_paid_by: e.paid, p_title: `QA ${k}`, p_note: null,
          p_amount: e.amount, p_currency: 'THB', p_rate: 1, p_amount_base: e.amount,
          p_method: 'card', p_bank: 'kaspi', p_split_mode: e.mode ?? 'equal', p_spent_at: new Date(Date.now() + k * 1000).toISOString(),
          p_shares: e.shares,
        })
        if (r.error) throw r.error
      }
      const st = await cl[2].from('settlements').insert({ trip_id: T, from_user: V, to_user: A, amount_base: 50000, method: 'card', bank: 'kaspi' })
      if (st.error) throw st.error

      // независимый попарный расчёт: debt[x][y] — сколько x должен y
      const debt: Record<string, Record<string, number>> = {}
      const add = (x: string, y: string, v: number) => ((debt[x] ??= {})[y] = (debt[x]?.[y] ?? 0) + v)
      for (const e of list) for (const s of e.shares) if (s.user_id !== e.paid) add(s.user_id, e.paid, s.share_base)
      add(A, V, 50000) // возврат: Вика отдала Ане 500 — обратный долг
      const net: Record<string, number> = Object.fromEntries(id.map((x) => [x, 0]))
      for (const [x, row] of Object.entries(debt)) for (const [y, v] of Object.entries(row)) { net[x] -= v; net[y] += v }

      // загрузка так же, как в приложении, — у каждого участника
      const views: string[] = []
      for (const [k, c] of cl.entries()) {
        const m = await c.from('trip_members').select('joined_at, profiles(id,name,avatar_color)').eq('trip_id', T).order('joined_at')
        const e = await c.from('expenses').select('*, shares:expense_shares(user_id,share_base)').eq('trip_id', T)
        const s = await c.from('settlements').select('*').eq('trip_id', T)
        if (m.error || e.error || s.error) throw m.error ?? e.error ?? s.error
        expect(m.data.length, `участники у ${people[k].name}`).toBe(4)
        expect(e.data.length, `расходы у ${people[k].name}`).toBe(list.length)
        const memberIds = m.data.map((r) => (r.profiles as unknown as { id: string }).id)
        const b = computeBalances(memberIds, e.data as ExpenseLike[], s.data)
        expect(b, `балансы у ${people[k].name}`).toEqual(net)
        const t = pairwiseDebts(e.data as ExpenseLike[], s.data)
        const after = { ...b }
        for (const x of t) { after[x.from] += x.amount; after[x.to] -= x.amount }
        expect(Object.values(after).every((v) => v === 0)).toBe(true)
        const nm = (x: string) => people[id.indexOf(x)].name
        views.push(t.map((x) => `${nm(x.from)}→${nm(x.to)} ${x.amount / 100}`).join(', '))
      }
      expect(new Set(views).size, 'все видят одно и то же').toBe(1)
      const nm = (x: string) => people[id.indexOf(x)].name
      console.info('балансы:', Object.fromEntries(Object.entries(net).map(([x, v]) => [nm(x), v / 100])))
      console.info('переводы:', views[0])
    } finally {
      await admin.from('trips').delete().eq('id', T)
    }
  }, 30_000)
})
