// Worker-entry. Erstatter src/worker.py: staging-spærring, rate limiting
// (RATE_LIMITER + CART_RATE_LIMITER), edge-cache (Cache API, versioneret
// nøgle), single-flight ved cache-miss, headers, aggregeret sikkerhedslogning
// til D1 security_events og et sidste sikkerhedsnet mod ufangede fejl.
//
// BEVIDST UDELADT: CPU-budgettet, render-køen/_render_exclusive ("travlt"-
// svaret) og release_stale_sync_bridge. De beskytter Pyodide-broen, hvor hver
// D1/KV-kald suspenderer en synkron Flask-render; i en JS-worker er D1/KV
// almindelige async kald, så den fejlklasse findes ikke. Se lib/worker-guard.ts.
import { createStartHandler } from '@tanstack/react-start/server'
import { RouterServer, getSsrStatus } from '@tanstack/react-router/ssr/server'
import { renderToString } from 'react-dom/server'
import { restoreRawAttrs } from './components/jinja'
import { applyResponseHeaders } from './lib/headers'
import { reqState, runWithRequestState, type RequestState } from './lib/request-state'
import { secFlush, secNote } from './lib/security-log'
import { stagingBlocked } from './lib/staging-gate'
import { CART_EVENT_PATHS, cartRateOk, rateOk, tooMany, workerCrashFallback } from './lib/worker-guard'

const reqStateStatus = () => reqState().status

// Ren server-rendering uden hydrering: siderne er statisk HTML, som
// static/js/script.js arbejder videre på - præcis som med Jinja i dag. Derfor
// renderToString og ikke defaultStreamHandler (som tilføjer router-state og
// hydrerings-scripts, vi ikke bruger).
const startFetch = createStartHandler(async ({ request, router, responseHeaders }) => {
  void request
  try {
    const html = restoreRawAttrs(renderToString(<RouterServer router={router} />))
    responseHeaders.set('Content-Type', 'text/html; charset=utf-8')
    return new Response('<!DOCTYPE html>' + html, { status: reqStateStatus() ?? getSsrStatus(router), headers: responseHeaders })
  } finally {
    router.serverSsr?.cleanup()
  }
})

// De eneste query-parametre ruterne læser (worker.py::_CACHEABLE_QUERY_PARAMS).
const CACHEABLE_QUERY_PARAMS = new Set([
  'lactose', 'max_price', 'max_weight', 'min_price', 'min_weight',
  'organic', 'page', 'q', 'sale', 'sort', 'stores', 'subcategory',
])
const CACHE_VER_TTL_MS = 300_000
let cacheVer: string | null = null
let cacheVerAt = 0
let cacheVerKv: string | null = null
let featuresRaw = ''

function crc(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

async function cacheVersion(env: Cloudflare.Env): Promise<string> {
  const now = Date.now()
  if (cacheVer !== null && now - cacheVerAt < CACHE_VER_TTL_MS) return cacheVer
  try {
    const [v, f] = await Promise.all([env.CACHE_KV.get('cache_version'), env.CACHE_KV.get('features_v1')])
    if (v) cacheVerKv = v
    featuresRaw = f || ''
  } catch {
    // behold sidst kendte version
  }
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  cacheVer = `${cacheVerKv || '0'}-${day}-${env.BUILD_ID || '0'}-f${featuresRaw ? crc(featuresRaw) : '0'}`
  cacheVerAt = now
  return cacheVer
}

async function cacheKey(url: URL, env: Cloudflare.Env): Promise<Request> {
  const kept = [...url.searchParams.entries()]
    .filter(([k]) => CACHEABLE_QUERY_PARAMS.has(k))
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
  const q = new URLSearchParams(kept).toString()
  const base = `${url.origin}${url.pathname}`
  return new Request(`${q ? `${base}?${q}&` : `${base}?`}__cv=${await cacheVersion(env)}`)
}

const inflight = new Map<string, Promise<void>>()

async function render(request: Request, url: URL, env: Cloudflare.Env): Promise<Response> {
  const state: RequestState = { request, url, degraded: null, endpoint: null }
  let response = await runWithRequestState(state, () => startFetch(request))
  // TanStack kan returnere immutable headers (fx redirects) - kopiér.
  response = new Response(response.body, response)
  return applyResponseHeaders(request, url, response, state.endpoint, state.degraded, !env.LOCAL_DEV)
}

/** Render med sidste sikkerhedsnet (worker.py::_worker_crash_fallback) og
 * aggregeret optælling af 5xx/degraderede svar - aldrig en log pr. request. */
async function renderGuarded(request: Request, url: URL, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
  let response: Response
  try {
    response = await render(request, url, env)
  } catch (e) {
    console.error('Ufanget fejl i render', (e as Error)?.name || e)
    secNote('server_error', request)
    secFlush(env, ctx)
    return workerCrashFallback(request)
  }
  if (response.status >= 500) secNote('server_error', request)
  if (response.headers.get('X-Data-Degraded')) secNote('degraded', request)
  secFlush(env, ctx)
  return response
}

/** Generel rate limit; null = tilladt. */
async function rateLimit(request: Request, env: Cloudflare.Env, ctx: ExecutionContext, cart = false): Promise<Response | null> {
  if (await rateOk(env, request)) {
    // Ekstra GLOBAL grænse oveni (aldrig i stedet for) for cart-event/recipe-click.
    if (!cart || (await cartRateOk(env, request))) return null
  }
  secNote('rate_limit', request)
  secFlush(env, ctx)
  return tooMany(request)
}

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
    // Staging: afvis alt uden adgang FØR der laves noget arbejde.
    const blocked = await stagingBlocked(request, env, ctx)
    if (blocked) return blocked

    const url = new URL(request.url)
    // Ikke-GET (POST mv.) er skrivende/dyre: rate limit før arbejde. HEAD
    // følger GET-vejen, så link-previews og crawlere rammer cachen.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const limited = await rateLimit(request, env, ctx, CART_EVENT_PATHS.has(url.pathname))
      return limited ?? renderGuarded(request, url, env, ctx)
    }

    // AJAX-fragmenter deler URL med den fulde side, men mangler <head>; de må
    // derfor hverken læse eller skrive edge-cachen.
    const isAjax = request.headers.get('X-Requested-With') === 'XMLHttpRequest'
    let cache: Cache | null = null
    let key: Request | null = null
    if (!isAjax && env.EDGE_CACHE !== 'off') {
      try {
        cache = (caches as unknown as { default: Cache }).default
        key = await cacheKey(url, env)
        const hit = await cache.match(key)
        if (hit) return hit
      } catch {
        cache = null
        key = null
      }
    }
    if (!cache || !key) {
      // Rate limit KUN cache-miss-stien - cache-hits returnerede ovenfor.
      return (await rateLimit(request, env, ctx)) ?? renderGuarded(request, url, env, ctx)
    }

    // Single-flight: samtidige misses på samme nøgle venter på den første.
    const pending = inflight.get(key.url)
    if (pending) {
      await pending
      const again = await cache.match(key).catch(() => undefined)
      if (again) return again
    }
    let done!: () => void
    inflight.set(key.url, new Promise<void>((r) => (done = r)))
    try {
      const limited = await rateLimit(request, env, ctx)
      if (limited) return limited
      const response = await renderGuarded(request, url, env, ctx)
      const cdn = response.headers.get('CDN-Cache-Control') || ''
      if (request.method === 'GET' && cdn.includes('public') && !cdn.includes('no-store')) {
        // Await put FØR single-flight slippes, så ventende rammer cachen.
        const put = cache.put(key, response.clone())
        ctx.waitUntil(put.catch(() => undefined))
        await put.catch(() => undefined)
      }
      return response
    } finally {
      inflight.delete(key.url)
      done()
    }
  },
}
