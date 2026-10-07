// In-app rate limit pr. isolate - port af app_support.py::RateLimiter,
// api_limiter, cart_event_limiter, _client_ip og @rate_limit. Ligger OVENI
// worker-lagets globale RATE_LIMITER/CART_RATE_LIMITER (worker-guard.ts),
// præcis som i Python.
import { setEndpoint } from './request-state'

export class RateLimiter {
  private hits = new Map<string, number[]>()
  private lastSweep: number
  private maxResolved: boolean
  private max: number

  constructor(
    maxCalls = 60,
    readonly windowSeconds = 60,
    /** Navn på en env-var der kan overstyre grænsen (læses ved første brug). */
    private readonly envVar: string | null = null,
    private readonly readEnv: (name: string) => string | undefined = () => undefined,
    private readonly clock: () => number = () => Date.now() / 1000,
  ) {
    this.max = maxCalls
    this.maxResolved = envVar === null
    this.lastSweep = clock()
  }

  get maxCalls(): number {
    if (!this.maxResolved) {
      this.maxResolved = true
      const raw = this.readEnv(this.envVar || '')
      const v = raw && /^\s*[+-]?\d+\s*$/.test(raw) ? Number.parseInt(raw, 10) : 0
      if (v >= 1) this.max = v
    }
    return this.max
  }

  private sweepStale(now: number): void {
    for (const [k, hits] of this.hits) {
      while (hits.length && now - hits[0] >= this.windowSeconds) hits.shift()
      if (!hits.length) this.hits.delete(k)
    }
    this.lastSweep = now
  }

  allow(key: string): boolean {
    const now = this.clock()
    let hits = this.hits.get(key)
    if (!hits) this.hits.set(key, (hits = []))
    while (hits.length && now - hits[0] >= this.windowSeconds) hits.shift()
    const allowed = hits.length < this.maxCalls
    if (allowed) hits.push(now)
    if (now - this.lastSweep >= this.windowSeconds) this.sweepStale(now)
    return allowed
  }
}

let envReader: (name: string) => string | undefined = () => undefined

/** Sættes af ruterne (som har adgang til `env`), så API_RATE_LIMIT_PER_MIN
 * kan læses uden at dette modul importerer cloudflare:workers. */
export function setRateLimitEnvReader(fn: (name: string) => string | undefined): void {
  envReader = fn
}

/** 60/min pr. IP; API_RATE_LIMIT_PER_MIN findes kun til kapacitetsmåling. */
export const apiLimiter = new RateLimiter(60, 60, 'API_RATE_LIMIT_PER_MIN', (n) => envReader(n))
/** Strammere grænse for /api/cart-event (manipulerer cart_popularity). */
export const cartEventLimiter = new RateLimiter(20, 60)

/** app_support.py::_client_ip - CF-Connecting-IP, ellers SIDSTE led af
 * X-Forwarded-For (første led er klient-kontrolleret). */
export function clientIp(request: Request): string {
  const cf = request.headers.get('CF-Connecting-IP')
  if (cf) return cf.trim()
  const xff = request.headers.get('X-Forwarded-For')
  if (xff) return xff.split(',').at(-1)!.trim()
  return 'unknown'
}

// Aggregeret tæller for afviste requests - aldrig en log-linje pr. request
// og aldrig IP'en (app_support.py::_note_rate_limited).
const RL_FLUSH_INTERVAL_S = 60
const rlCounts = new Map<string, number>()
let rlLastFlush = 0

function noteRateLimited(fnName: string): void {
  const now = Date.now() / 1000
  rlCounts.set(fnName, (rlCounts.get(fnName) ?? 0) + 1)
  if (now - rlLastFlush < RL_FLUSH_INTERVAL_S) return
  const snapshot = [...rlCounts.entries()].sort((a, b) => b[1] - a[1])
  rlCounts.clear()
  rlLastFlush = now
  const total = snapshot.reduce((s, [, n]) => s + n, 0)
  console.warn(
    `Rate limit: ${total} afviste requests sidste minut (${snapshot.slice(0, 5).map(([k, v]) => `${k}=${v}`).join(', ')})`,
  )
}

/** @rate_limit(limiter) - returnerer 429-svaret, eller null hvis tilladt.
 * `fnName` er Flask-funktionens navn (en del af nøglen, som i Python). */
export function rateLimited(limiter: RateLimiter, request: Request, fnName: string): Response | null {
  if (limiter.allow(`${clientIp(request)}:${fnName}`)) return null
  noteRateLimited(fnName)
  setEndpoint(fnName)
  return new Response(JSON.stringify({ success: false, error: 'For mange forespørgsler. Prøv igen om lidt.' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json' },
  })
}
