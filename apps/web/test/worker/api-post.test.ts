import { beforeEach, describe, expect, it } from 'vitest'
import {
  cleanSearchTerms, getJsonSilent, handleAlternatives, handleCartEvent, handleFeedback, handleRefreshCache,
  parseCartItems, verifyTurnstileToken, type PostDeps,
} from '~/lib/api-post'
import { apiLimiter, cartEventLimiter } from '~/lib/rate-limit'
import { FLASK_HARNESS, hasPython, py } from './pyexec'

interface Case {
  path: string
  body: string
  contentType?: string
  supa?: [number, unknown]
  available?: boolean
  verify?: boolean
  stats?: boolean
}
interface Call { method: string; path: string; body: unknown; prefer: string | null }

/** Kør TS-handleren med mock-Supabase/Turnstile; samme form som Python-harnessen. */
async function runTs(c: Case): Promise<{ status: number; json: unknown; calls: Call[] }> {
  const calls: Call[] = []
  const supaFetch = (async (url: string, init: RequestInit) => {
    const u = new URL(url)
    calls.push({
      method: String(init.method),
      path: u.pathname.replace(/^\/rest\/v1\//, ''),
      body: init.body ? JSON.parse(String(init.body)) : null,
      prefer: (init.headers as Record<string, string>).Prefer ?? null,
    })
    const [st, data] = c.supa ?? [204, null]
    return new Response(st === 204 ? null : JSON.stringify(data), { status: st })
  }) as unknown as typeof fetch
  const verifyFetch = (async () => Response.json({ success: c.verify ?? true })) as unknown as typeof fetch
  const deps: PostDeps = {
    supabase: c.available === false ? {} : { url: 'https://example.supabase.co', key: 'anon', fetch: supaFetch },
    tableSuffix: '_dev',
    featureEnabled: async (k) => (k === 'stats' ? !!c.stats : false),
    fetch: verifyFetch,
  }
  const req = new Request(`https://madshopper.dk${c.path}`, {
    method: 'POST', body: c.body, headers: { 'Content-Type': c.contentType ?? 'application/json' },
  })
  const res = c.path === '/api/cart-event' ? await handleCartEvent(req, deps) : await handleFeedback(req, deps)
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: res.status, json, calls }
}

const J = JSON.stringify
const CART_CASES: Case[] = [
  { path: '/api/cart-event', body: 'ikke json' },
  { path: '/api/cart-event', body: '' },
  { path: '/api/cart-event', body: '[1,2]' },
  { path: '/api/cart-event', body: '{}' },
  { path: '/api/cart-event', body: J({ product_id: 'p1' }), contentType: 'text/plain' },
  { path: '/api/cart-event', body: J({ product_ids: ['a', 'a', ' b ', 7, null, ''] }) },
  { path: '/api/cart-event', body: J({ event: 'compare', items: [{ id: 'x', qty: '5' }, { id: 'y', qty: 500 }, { id: 'z', qty: 'abc' }, { id: 'w', qty: -3 }, { id: 'v', qty: 2.9 }] }) },
  { path: '/api/cart-event', body: J({ event: 'bogus', items: Array.from({ length: 60 }, (_, i) => ({ id: `id${i}` })) }) },
  { path: '/api/cart-event', body: J({ event: 'add', items: [{ id: 'æ'.repeat(80) }] }) },
  { path: '/api/cart-event', body: J({ event: 'view', items: [{ id: 'a' }] }), stats: false },
  { path: '/api/cart-event', body: J({ event: 'view', items: [{ id: 'a' }] }), stats: true },
  { path: '/api/cart-event', body: J({ items: [{ id: 'a' }] }), available: false },
  { path: '/api/cart-event', body: J({ items: [{ id: 'a' }] }), supa: [500, { message: 'boom' }] },
  { path: '/api/cart-event', body: J({ items: [{ id: 'a' }, { id: 'b' }] }), supa: [404, { code: 'PGRST202' }] },
  { path: '/api/cart-event', body: J({ items: [{ id: 'a' }] }), supa: [404, { message: 'function does not exist' }] },
  { path: '/api/cart-event', body: J({ event: 'search', terms: ['  Mælk   og  Brød ', 'a', 'x@y.dk', '12345678', 'ok', 5, 'z'.repeat(41)] }), stats: true },
  { path: '/api/cart-event', body: J({ event: 'search', terms: ['mælk'] }), stats: false },
  { path: '/api/cart-event', body: J({ event: 'search', terms: [1, 'a'] }) },
  { path: '/api/cart-event', body: J({ event: 'search', terms: 'mælk' }) },
]
const FB = { turnstile_token: 'tok', message: 'Hej med jer - det her er en test' }
const FEEDBACK_CASES: Case[] = [
  { path: '/api/feedback', body: '[]' },
  { path: '/api/feedback', body: '[1]' },
  { path: '/api/feedback', body: '"x"' },
  { path: '/api/feedback', body: 'ikke json' },
  { path: '/api/feedback', body: J(FB), contentType: 'text/plain' },
  { path: '/api/feedback', body: J({ ...FB, turnstile_token: '   ' }) },
  { path: '/api/feedback', body: J(FB), verify: false },
  { path: '/api/feedback', body: J({ ...FB, message: ' kort ' }) },
  { path: '/api/feedback', body: J({ ...FB, message: 'x'.repeat(501) }) },
  { path: '/api/feedback', body: J({ ...FB, message: 'æ'.repeat(500) }) },
  { path: '/api/feedback', body: J({ ...FB, type: 'bug', name: ' Kalle ', email: 'kalle@example.dk', subject: 'Emne', page_url: 'https://madshopper.dk/x' }) },
  { path: '/api/feedback', body: J({ ...FB, type: 'hack', email: 'ikke-en-mail', page_url: 'file:///C:/x' }) },
  { path: '/api/feedback', body: J({ ...FB, type: null, name: null, email: 'A@B.CO', page_url: 'HTTP://X.DK/a b' }) },
  { path: '/api/feedback', body: J({ ...FB, name: 'n'.repeat(200), subject: 's'.repeat(300), page_url: 'https://x.dk/' + 'p'.repeat(600) }) },
  { path: '/api/feedback', body: J(FB), supa: [500, null] },
  { path: '/api/feedback', body: J(FB), supa: [200, null] },
  { path: '/api/feedback', body: J(FB), supa: [201, null] },
]

beforeEach(() => {
  ;(apiLimiter as any).hits.clear()
  ;(cartEventLimiter as any).hits.clear()
})

describe.skipIf(!hasPython)('POST-validering = app.py (Flask test_client)', () => {
  for (const [name, cases] of [['/api/cart-event', CART_CASES], ['/api/feedback', FEEDBACK_CASES]] as const) {
    it(name, async () => {
      const want = py<Array<{ status: number; json: unknown; calls: Array<Call & { timeout: number }> }>>(FLASK_HARNESS, cases)
      for (let i = 0; i < cases.length; i++) {
        const got = await runTs(cases[i])
        const exp = { ...want[i], calls: want[i].calls.map(({ timeout: _t, ...c }) => c) }
        expect({ case: i, ...got }).toEqual({ case: i, ...exp })
      }
    })
  }
})

describe('enkeltdele', () => {
  it('parseCartItems: gamle former', () => {
    expect(parseCartItems({ product_id: 'x' })).toEqual([[{ pid: 'x', qty: 1 }], 'add'])
    expect(parseCartItems({})).toEqual([[], 'add'])
  })

  it('cleanSearchTerms', () => {
    expect(cleanSearchTerms(['  A  b ', 'x', 'tlf 12345'])).toEqual(['a b'])
    expect(cleanSearchTerms('x')).toEqual([])
  })

  it('getJsonSilent kræver JSON-Content-Type (også +json)', async () => {
    const mk = (ct: string) => new Request('https://x/', { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': ct } })
    expect(await getJsonSilent(mk('application/json; charset=utf-8'))).toEqual({ a: 1 })
    expect(await getJsonSilent(mk('application/vnd.x+json'))).toEqual({ a: 1 })
    expect(await getJsonSilent(mk('text/plain'))).toBeNull()
  })

  it('Turnstile: lukket uden token / ved nej, åben ved netværksfejl', async () => {
    const no = (async () => Response.json({ success: false })) as unknown as typeof fetch
    const err = (async () => { throw new Error('nede') }) as unknown as typeof fetch
    const arr = (async () => Response.json([1])) as unknown as typeof fetch
    expect(await verifyTurnstileToken('', err)).toBe(false)
    expect(await verifyTurnstileToken('t', no)).toBe(false)
    expect(await verifyTurnstileToken('t', err)).toBe(true)
    expect(await verifyTurnstileToken('t', arr)).toBe(true)
  })

  it('refresh-cache: 401 uden/forkert secret, ellers KV-nøglen slettes', async () => {
    const deleted: string[] = []
    const kv = { delete: async (k: string) => void deleted.push(k) } as unknown as KVNamespace
    const mk = (h: Record<string, string>) => new Request('https://x/api/refresh-cache', { method: 'POST', headers: h })
    expect((await handleRefreshCache(mk({ 'X-Cache-Secret': 's' }), undefined, kv)).status).toBe(401)
    expect((await handleRefreshCache(mk({ 'X-Cache-Secret': 'forkert' }), 'hemmelig', kv)).status).toBe(401)
    expect((await handleRefreshCache(mk({}), 'hemmelig', kv)).status).toBe(401)
    const ok = await handleRefreshCache(mk({ 'X-Cache-Secret': 'hemmelig' }), 'hemmelig', kv)
    expect(await ok.json()).toEqual({ ok: true, invalidated: true })
    expect(deleted).toEqual(['app_cache_v1'])
  })

  it('alternatives: body-validering', async () => {
    const none = async () => []
    const mk = (body: string, ct = 'application/json') =>
      new Request('https://x/api/alternatives', { method: 'POST', body, headers: { 'Content-Type': ct } })
    const r1 = await handleAlternatives(mk('[1]'), none)
    expect([r1.status, await r1.json()]).toEqual([400, { success: false, error: 'Ugyldig body' }])
    expect((await handleAlternatives(mk('{}', 'text/plain'), none)).status).toBe(400)
    const r2 = await handleAlternatives(mk('{"missing_items": 5}'), none)
    expect([r2.status, await r2.json()]).toEqual([200, { success: true, alternatives: [] }])
    const r3 = await handleAlternatives(mk('{"missing_items":[{"cart_id":1,"store":"Netto","category":["x"],"name":"mælk"}]}'), none)
    expect([r3.status, await r3.json()]).toEqual([500, { success: false, error: 'Kunne ikke finde alternativer.' }])
  })

  it('in-app rate limit på cart-event (20/min pr. IP)', async () => {
    const deps: PostDeps = { supabase: {}, tableSuffix: '', featureEnabled: async () => false }
    const mk = () => new Request('https://x/api/cart-event', { method: 'POST', body: '{}', headers: { 'CF-Connecting-IP': '9.9.9.9' } })
    const st: number[] = []
    for (let i = 0; i < 21; i++) st.push((await handleCartEvent(mk(), deps)).status)
    expect(st.slice(0, 20).every((s) => s === 400)).toBe(true)
    expect(st[20]).toBe(429)
  })
})
