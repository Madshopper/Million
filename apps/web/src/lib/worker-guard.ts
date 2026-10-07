// Worker-lagets beskyttelse - port af src/worker.py: rate limiting via
// Cloudflares native binding (_rate_ok/_cart_rate_ok), 429-svaret
// (_too_many) og sidste sikkerhedsnet ved en ufanget undtagelse
// (_worker_crash_fallback).
//
// BEVIDST UDELADT fra worker.py: CPU-budgettet (_cpu_admit/_CPU_BUDGET_*),
// render-køen (_render_exclusive, _RENDER_QUEUE_MAX, "travlt"-svaret) og
// release_stale_sync_bridge. De beskytter Pyodide-broen, hvor hele
// Flask-renderingen kører synkront og hvert D1/KV-kald suspenderer via
// run_sync - to samtidige renders i samme isolate kolliderede dér. I en
// JS-worker er D1/KV almindelige async kald, så den fejlklasse findes ikke,
// og en render koster en brøkdel af CPU'en. Baggrunds-opvarmningen
// (_WARM_PATHS) er heller ikke porteret.
import { secNote } from './security-log'

/** Ruter der kan manipulere cart_popularity/recipe-kliktal - kun de rammes af
 * den ekstra, globale CART_RATE_LIMITER (oveni RATE_LIMITER). */
export const CART_EVENT_PATHS: ReadonlySet<string> = new Set(['/api/cart-event', '/api/recipe-click'])

function pathOf(request: Request): string {
  try {
    return new URL(request.url).pathname
  } catch {
    return ''
  }
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
  })
}

/** worker.py::_too_many - JSON for /api/* så fetch().json() i browseren ikke
 * fejler på rate limit. */
export function tooMany(request: Request): Response {
  const headers = { 'Retry-After': '10', 'Cache-Control': 'no-store' }
  if (pathOf(request).startsWith('/api/')) {
    return jsonResponse({ success: false, error: 'For mange forespørgsler - prøv igen om lidt.' }, 429, headers)
  }
  return new Response('For mange forespørgsler - prøv igen om lidt.', {
    status: 429,
    headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' },
  })
}

/** worker.py::_worker_crash_fallback - brugervendt 503 i stedet for
 * Cloudflares rå "error code: 1101". */
export function workerCrashFallback(request: Request): Response {
  const headers = { 'Retry-After': '2', 'Cache-Control': 'no-store' }
  if (pathOf(request).startsWith('/api/')) {
    return jsonResponse({ success: false, error: 'MadShopper svarer ikke lige nu. Prøv igen om lidt.' }, 503, headers)
  }
  return new Response(
    '<!doctype html><html lang="da"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>MadShopper</title></head>' +
      '<body style="font-family:system-ui,sans-serif;display:flex;' +
      'min-height:100vh;align-items:center;justify-content:center;' +
      'margin:0;background:#111;color:#eee;text-align:center;padding:1.5rem">' +
      '<p>MadShopper svarer ikke lige nu.<br>Prøv at genindlæse siden om et ' +
      'øjeblik.</p></body></html>',
    { status: 503, headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } },
  )
}

/** Nøglen til Cloudflares tæller: præcis som worker.py (rå header-værdi). */
function limiterKey(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'anon'
}

async function limitOk(limiter: RateLimit | undefined, request: Request, unavailableKind: string): Promise<boolean> {
  try {
    if (!limiter) {
      // Bindingen burde altid findes - fejler ÅBENT, men synligt (aggregeret).
      secNote(unavailableKind, request)
      return true
    }
    const outcome = await limiter.limit({ key: limiterKey(request) })
    return outcome?.success ?? true
  } catch {
    secNote(unavailableKind, request)
    return true
  }
}

/** worker.py::_rate_ok - generel grænse pr. IP (RATE_LIMITER). Fail-open:
 * beskyttelsen må aldrig kunne bryde kernefunktionen. */
export function rateOk(env: { RATE_LIMITER?: RateLimit }, request: Request): Promise<boolean> {
  return limitOk(env.RATE_LIMITER, request, 'rate_limiter_unavailable')
}

/** worker.py::_cart_rate_ok - ekstra, GLOBAL grænse (20/min pr. IP) for
 * CART_EVENT_PATHS. Kaldes OVENI rateOk, aldrig i stedet for. */
export function cartRateOk(env: { CART_RATE_LIMITER?: RateLimit }, request: Request): Promise<boolean> {
  return limitOk(env.CART_RATE_LIMITER, request, 'cart_rate_limiter_unavailable')
}
