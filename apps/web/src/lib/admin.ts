// Admin (/admin) og serversessionen - port af app.py (~linje 3705-4208).
// Kun en verificeret admin får siden; alle andre (også logget ind) får sitets
// almindelige 404, så panelet ikke kan ses eller opdages. Browseren har
// Supabase-sessionen i localStorage, som serveren ikke kan se, så auth.js
// lægger access-tokenen i HttpOnly-cookien ms_session via POST /api/session.
// Admin-tjekket er ét PostgREST-kald (rpc/is_admin) med brugerens egen JWT:
// PostgREST verificerer signaturen, og is_admin() slår auth.uid() op i
// admin_users - adminlisten bor kun i Supabase.
import { env } from 'cloudflare:workers'
import { getCookie } from './headers'
import { setEndpoint } from './request-state'

export const SESSION_COOKIE = 'ms_session'

/** app.py::_ADMIN_HEADERS - aldrig i nogen cache, aldrig i søgemaskiner. */
export const ADMIN_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
}

const ADMIN_BEARER_RE = /^Bearer ([A-Za-z0-9._-]{20,4096})$/
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const SESSION_MAX_AGE = 86400

// --- Werkzeug-fejlsider ------------------------------------------------------
// abort(404) i Flask giver Werkzeugs standardside - samme svar som en ukendt
// sti med flere segmenter. Ruterne svarer byte-for-byte det samme, så en
// ikke-admin ikke kan skelne /api/admin/* fra en sti der ikke findes.
const WERKZEUG_ERRORS: Record<number, [string, string]> = {
  400: ['400 Bad Request', 'The browser (or proxy) sent a request that this server could not understand.'],
  404: ['404 Not Found', 'The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again.'],
  405: ['405 Method Not Allowed', 'The method is not allowed for the requested URL.'],
}

export function werkzeugErrorBody(status: 400 | 404 | 405): string {
  const [title, text] = WERKZEUG_ERRORS[status]
  return `<!doctype html>\n<html lang=en>\n<title>${title}</title>\n<h1>${title.slice(4)}</h1>\n<p>${text}</p>\n`
}

/** abort(status) - endpoint-navnet sættes, men svaret er aldrig cachebart. */
export function abortResponse(endpoint: string, status: 400 | 404 | 405, allow?: string): Response {
  setEndpoint(endpoint)
  const headers: Record<string, string> = { 'Content-Type': 'text/html; charset=utf-8' }
  if (allow) headers.Allow = allow
  return new Response(werkzeugErrorBody(status), { status, headers })
}

/** jsonify(...) + _ADMIN_HEADERS. */
export function adminJson(endpoint: string, body: unknown, status = 200): Response {
  setEndpoint(endpoint)
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
  })
}

// --- JWT og sessionscookien --------------------------------------------------

function b64urlDecode(part: string): Uint8Array | null {
  // base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)): én rest-karakter
  // er en ugyldig længde og fejler i Python.
  if (part.length % 4 === 1) return null
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4)
  try {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/** int(x) som Python for de typer et JSON-payload kan give - null hvis int() fejler. */
function pyIntOrNull(v: unknown): number | null {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null
  if (typeof v === 'string') {
    const s = v.trim()
    if (!/^[+-]?\d+(_\d+)*$/.test(s)) return null
    return Number(s.replace(/_/g, ''))
  }
  return null
}

/** app.py::_jwt_exp - exp fra en JWT's payload, UVERIFICERET og kun til
 *  cookiens levetid. Signaturen tjekkes af PostgREST, hver gang tokenen bruges. */
export function jwtExp(token: string): number | null {
  const part = token.split('.')[1]
  if (part === undefined) return null
  const bytes = b64urlDecode(part)
  if (!bytes) return null
  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('exp' in payload)) return null
  return pyIntOrNull((payload as { exp: unknown }).exp)
}

/** Tokenen fra "Authorization: Bearer <jwt>", hvis den har JWT-form. */
export function bearerJwt(authorization: string | null): string | null {
  const m = ADMIN_BEARER_RE.exec(authorization || '')
  return m && JWT_RE.test(m[1]) ? m[1] : null
}

/** urllib.parse.urlparse(origin).netloc */
export function originNetloc(origin: string): string {
  let rest = origin
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(rest)
  if (scheme) rest = rest.slice(scheme[0].length)
  if (!rest.startsWith('//')) return ''
  const m = /^[^/?#]*/.exec(rest.slice(2))
  return m ? m[0] : ''
}

function cookieExpires(epochSec: number): string {
  // Werkzeug: "Wed, 07 Oct 2026 08:43:56 GMT" - samme format som toUTCString().
  return new Date(epochSec * 1000).toUTCString()
}

/** Set-Cookie-headeren som api_session sætter (Werkzeugs rækkefølge).
 *  Uden gyldig token (eller udløbet) slettes cookien - det er "log ud". */
export function sessionSetCookie(token: string | null, nowSec = Math.floor(Date.now() / 1000)): string {
  const exp = token ? jwtExp(token) : null
  // Python: min(exp - now, 86400) if exp else 0 - exp=0 tæller som intet exp.
  const maxAge = exp ? Math.min(exp - nowSec, SESSION_MAX_AGE) : 0
  if (token && maxAge > 0) {
    return `${SESSION_COOKIE}=${token}; Expires=${cookieExpires(nowSec + maxAge)}; Max-Age=${maxAge}; Secure; HttpOnly; Path=/; SameSite=Lax`
  }
  return `${SESSION_COOKIE}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Secure; HttpOnly; Path=/; SameSite=Lax`
}

/** POST /api/session (app.py::api_session). Ingen Supabase-kald: tokenen
 *  verificeres først, når den bruges. Cookien lever kun til tokenens exp
 *  (højst et døgn); auth.js kalder igen ved hver fornyelse. */
export function sessionResponse(request: Request, nowSec = Math.floor(Date.now() / 1000)): Response {
  setEndpoint('api_session')
  const origin = request.headers.get('Origin')
  // Flask: request.host = Host-headeren (inkl. port).
  const host = request.headers.get('Host') ?? new URL(request.url).host
  if (origin && originNetloc(origin) !== host) {
    return new Response(JSON.stringify({ success: false }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }
  const token = bearerJwt(request.headers.get('Authorization'))
  return new Response(null, {
    status: 204,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': sessionSetCookie(token, nowSec),
    },
  })
}

// --- Admin-tjekket -----------------------------------------------------------

/** app.py::_is_admin_token - ét kald til rpc/is_admin med brugerens egen JWT.
 *  Kun en læsning; fejl af enhver art = ikke admin. */
export async function isAdminToken(token: string | null | undefined): Promise<boolean> {
  if (!token || token.length > 4096 || !JWT_RE.test(token)) return false
  const base = (env.SUPABASE_URL || '').replace(/\/$/, '')
  const key = env.SUPABASE_KEY || ''
  if (!base || !key) return false
  try {
    const res = await fetch(`${base}/rest/v1/rpc/is_admin`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    })
    const text = await res.text()
    if (res.status !== 200) return false
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }
    return data === true
  } catch (e) {
    console.warn('Supabase rpc/is_admin fejlede', (e as Error)?.name)
    return false
  }
}

/** /admin: sessionen fra HttpOnly-cookien. */
export function isAdminSession(request: Request): Promise<boolean> {
  return isAdminToken(getCookie(request, SESSION_COOKIE) ?? '')
}

/** app.py::_admin_request_ok - /api/admin/* bærer tokenen som Bearer. */
export function adminRequestOk(request: Request): Promise<boolean> {
  const m = ADMIN_BEARER_RE.exec(request.headers.get('Authorization') || '')
  return m ? isAdminToken(m[1]) : Promise.resolve(false)
}

/** Fælles indgang for /api/admin/*: POST og admin, ellers samme 404 som en
 *  ukendt sti. GET er kun registreret for at give 404 i stedet for 405, der
 *  ville afsløre at ruten findes. Returnerer null når requesten må fortsætte. */
export async function adminGate(request: Request, endpoint: string): Promise<Response | null> {
  if (request.method !== 'POST' || !(await adminRequestOk(request))) return abortResponse(endpoint, 404)
  setEndpoint(endpoint)
  return null
}

/** Body som request.get_json(silent=True): kun ved JSON-Content-Type (eller
 *  force), ellers null. */
export async function requestJson(request: Request, force = false): Promise<unknown> {
  if (!force) {
    const mime = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
    const isJson = mime === 'application/json' || (mime.startsWith('application/') && mime.endsWith('+json'))
    if (!isJson) return null
  }
  try {
    const text = await request.text()
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

/** Ikke-tomt objekt (Pythons `body or {}` + .get). */
export function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** app.py::_IS_EDGE - i den lokale Python-udgave False; her er D1/KV altid
 *  bundet, så kun LOCAL_DEV slår "edge" fra (samme regel som src/server.tsx). */
export function isEdge(): boolean {
  return !env.LOCAL_DEV
}

/** app.py::_features_editable - kun produktionens worker skriver valgene:
 *  staging har alt slået til via miljø-varerne. */
export function featuresEditable(): boolean {
  return isEdge() && (env.TABLE_SUFFIX ?? '') === ''
}
