// Adgangsspærringen på staging-workeren - port af
// src/worker.py::_staging_blocked/_staging_cookie_response.
//
// Slået til KUN når STAGING_ACCESS_SECRET er sat (kun i staging-bygget).
// Produktionen sætter den aldrig, så den gren rammes på hver eneste
// produktionsrequest og må derfor IKKE logge. Alle uden adgang får samme 404
// som /admin (Kalle, 05-10-2026): et 401 eller en login-side ville bekræfte at
// der ER noget bag. To veje ind: engangslinket ?t= fra "Se dev-siden" i
// produktionens /admin og ?k=-nøglen til CI. Der er ingen login-side, og der
// må ikke komme en igen.
import { secFlush, secNote } from './security-log'
import { STAGING_COOKIE, stagingSessionToken, timingSafeEqual, verifyStagingLink } from './staging'

/** Den tidligere login-side. Svarer 404 som alt andet, men logger ikke:
 * uptime-worker/ rammer den hvert 5. minut for at se at dev er lukket. */
export const STAGING_PROBE_PATH = '/staging-login'

interface GateEnv {
  STAGING_ACCESS_SECRET?: string
  DB?: D1Database
}
interface WaitCtx {
  waitUntil(p: Promise<unknown>): void
}

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
  })
}

/** worker.py::_cookie_value - første cookie med præcis det navn. */
export function cookieValue(cookieHeader: string, name: string): string {
  for (const raw of (cookieHeader || '').split(';')) {
    const part = raw.trim()
    if (part.startsWith(name + '=')) return part.slice(name.length + 1)
  }
  return ''
}

/** urllib.parse.quote_plus: sikre tegn er A-Z a-z 0-9 _ . - ~ (ikke ! ' ( ) *). */
export function pyQuotePlus(s: string): string {
  return encodeURIComponent(s)
    .replace(/%20/g, '+')
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

/** parse_qs(q).get(name, [''])[0]: parse_qs dropper tomme værdier, så
 * `?k=&k=x` giver 'x' (URLSearchParams.get ville give ''). */
function firstNonBlank(params: URLSearchParams, name: string): string {
  return params.getAll(name).find((v) => v !== '') ?? ''
}

async function cookieResponse(secret: string, location: string): Promise<Response> {
  // Cookien bærer den AFLEDTE sessionstoken, aldrig selve secret'et.
  const token = await stagingSessionToken(secret)
  return new Response('', {
    status: 302,
    headers: {
      Location: location || '/',
      'Set-Cookie': `${STAGING_COOKIE}=${token}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`,
      'Cache-Control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    },
  })
}

/** Returnerer et svar hvis requesten skal afvises/omdirigeres, ellers null.
 * `nowSec` kan overstyres i tests. */
export async function stagingBlocked(
  request: Request, env: GateEnv, ctx: WaitCtx, nowSec = Math.floor(Date.now() / 1000),
): Promise<Response | null> {
  const secret = env.STAGING_ACCESS_SECRET
  if (!secret) return null
  try {
    const url = new URL(request.url)
    const path = url.pathname || '/'
    const params = url.searchParams

    // ?k=<secret> sætter cookien. Resten af query'en bevares (k/t fjernes),
    // så CI kan ramme fx /search/results?q=... i ÉN navigation.
    const gotKey = firstNonBlank(params, 'k')
    if (gotKey && timingSafeEqual(gotKey, secret)) {
      const rest = [...params.entries()]
        .filter(([k]) => k !== 'k' && k !== 't')
        .map(([k, v]) => `${pyQuotePlus(k)}=${pyQuotePlus(v)}`)
        .join('&')
      return await cookieResponse(secret, path + (rest ? '?' + rest : ''))
    }

    // ?t=<udløb>.<hmac>: engangslinket fra produktionens /admin.
    const gotLink = firstNonBlank(params, 't')
    if (gotLink && gotLink.includes('.') && (await verifyStagingLink(secret, gotLink, nowSec))) {
      return await cookieResponse(secret, path)
    }

    const gotToken = cookieValue(request.headers.get('Cookie') || '', STAGING_COOKIE)
    if (gotToken && timingSafeEqual(gotToken, await stagingSessionToken(secret))) return null

    if (path === STAGING_PROBE_PATH) return notFound()

    // Eneste sti hvor spærringen reelt lukker nogen ude - her bliver
    // angrebsforsøg mod staging synlige (aggregeret, se security-log.ts).
    secNote('staging_gate_denied', request)
    secFlush(env, ctx)
    return notFound()
  } catch {
    return notFound()
  }
}
