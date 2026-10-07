import { beforeEach, describe, expect, it } from 'vitest'
import { RateLimiter, clientIp, rateLimited } from '~/lib/rate-limit'
import { _secResetForTests, _secSnapshotForTests } from '~/lib/security-log'
import { CART_EVENT_PATHS, cartRateOk, rateOk, tooMany, workerCrashFallback } from '~/lib/worker-guard'

const post = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://madshopper.dk${path}`, { method: 'POST', headers })

/** Falsk Cloudflare-ratelimit-binding: `limit` kald pr. nøgle. */
function fakeLimiter(limit: number) {
  const seen = new Map<string, number>()
  const keys: string[] = []
  return {
    keys,
    binding: {
      async limit({ key }: { key: string }) {
        keys.push(key)
        const n = (seen.get(key) ?? 0) + 1
        seen.set(key, n)
        return { success: n <= limit }
      },
    } as RateLimit,
  }
}

beforeEach(() => _secResetForTests())

describe('worker-lagets rate limit (worker.py::_rate_ok/_cart_rate_ok)', () => {
  it('nøgle = CF-Connecting-IP, ellers rå X-Forwarded-For, ellers anon', async () => {
    const { binding, keys } = fakeLimiter(100)
    await rateOk({ RATE_LIMITER: binding }, post('/api/x', { 'CF-Connecting-IP': '1.2.3.4', 'X-Forwarded-For': '9.9.9.9' }))
    await rateOk({ RATE_LIMITER: binding }, post('/api/x', { 'X-Forwarded-For': '5.5.5.5, 6.6.6.6' }))
    await rateOk({ RATE_LIMITER: binding }, post('/api/x'))
    expect(keys).toEqual(['1.2.3.4', '5.5.5.5, 6.6.6.6', 'anon'])
  })

  it('afviser over grænsen', async () => {
    const { binding } = fakeLimiter(2)
    const e = { RATE_LIMITER: binding }
    const r = () => post('/api/feedback', { 'CF-Connecting-IP': '1.1.1.1' })
    expect([await rateOk(e, r()), await rateOk(e, r()), await rateOk(e, r())]).toEqual([true, true, false])
  })

  it('fail-open (aggregeret signal) når bindingen mangler eller kaster', async () => {
    expect(await rateOk({}, post('/api/x'))).toBe(true)
    expect(await cartRateOk({ CART_RATE_LIMITER: { limit: async () => { throw new Error('nede') } } as RateLimit }, post('/api/cart-event'))).toBe(true)
    expect(_secSnapshotForTests()).toEqual([
      ['rate_limiter_unavailable', '/api/x', 1],
      ['cart_rate_limiter_unavailable', '/api/cart-event', 1],
    ])
  })

  it('cart-grænsen gælder kun cart-event/recipe-click', () => {
    expect([...CART_EVENT_PATHS].sort()).toEqual(['/api/cart-event', '/api/recipe-click'])
  })

  it('429-svaret: JSON for /api/*, tekst ellers', async () => {
    const a = tooMany(post('/api/cart-event'))
    expect(a.status).toBe(429)
    expect(a.headers.get('Retry-After')).toBe('10')
    expect(a.headers.get('Cache-Control')).toBe('no-store')
    expect(a.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(await a.json()).toEqual({ success: false, error: 'For mange forespørgsler - prøv igen om lidt.' })
    const b = tooMany(post('/Mejeri'))
    expect(b.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await b.text()).toBe('For mange forespørgsler - prøv igen om lidt.')
  })

  it('crash-fallback: 503 + Retry-After 2', async () => {
    const a = workerCrashFallback(post('/api/alternatives'))
    expect(a.status).toBe(503)
    expect(a.headers.get('Retry-After')).toBe('2')
    expect(await a.json()).toEqual({ success: false, error: 'MadShopper svarer ikke lige nu. Prøv igen om lidt.' })
    const b = workerCrashFallback(post('/'))
    expect(b.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await b.text()).toContain('MadShopper svarer ikke lige nu.')
  })
})

describe('in-app RateLimiter (app_support.py)', () => {
  it('glidende vindue pr. nøgle', () => {
    let now = 1000
    const rl = new RateLimiter(3, 60, null, undefined, () => now)
    expect([rl.allow('a'), rl.allow('a'), rl.allow('a'), rl.allow('a'), rl.allow('b')]).toEqual([true, true, true, false, true])
    now += 59.9
    expect(rl.allow('a')).toBe(false)
    now += 0.2
    expect(rl.allow('a')).toBe(true)
  })

  it('env-var overstyrer grænsen ved første brug, ugyldig værdi ignoreres', () => {
    expect(new RateLimiter(60, 60, 'X', () => '5').maxCalls).toBe(5)
    expect(new RateLimiter(60, 60, 'X', () => 'abc').maxCalls).toBe(60)
    expect(new RateLimiter(60, 60, 'X', () => '0').maxCalls).toBe(60)
  })

  it('_client_ip: SIDSTE led af X-Forwarded-For', () => {
    expect(clientIp(post('/', { 'X-Forwarded-For': '6.6.6.6, 7.7.7.7' }))).toBe('7.7.7.7')
    expect(clientIp(post('/', { 'CF-Connecting-IP': ' 1.2.3.4 ' }))).toBe('1.2.3.4')
    expect(clientIp(post('/'))).toBe('unknown')
  })

  it('@rate_limit-svaret', async () => {
    const rl = new RateLimiter(1, 60)
    const r = () => post('/api/feedback', { 'CF-Connecting-IP': '1.1.1.1' })
    expect(rateLimited(rl, r(), 'submit_feedback')).toBeNull()
    const res = rateLimited(rl, r(), 'submit_feedback')!
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ success: false, error: 'For mange forespørgsler. Prøv igen om lidt.' })
    // Nøglen inkluderer funktionsnavnet.
    expect(rateLimited(rl, r(), 'find_alternatives')).toBeNull()
  })
})
