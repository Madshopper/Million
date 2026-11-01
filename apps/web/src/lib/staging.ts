// Signaturer til staging-adgangen (dev.madshopper.dk). Port af
// app.py::staging_link_sig og src/worker.py::_staging_link_sig /
// _staging_session_token - SKAL give byte-for-byte samme hex-streng, så et
// link fra den ene worker virker i den anden. Ingen env-afhængigheder her, så
// staging-spærringen i src/server.tsx kan bygge direkte ovenpå.

/** Produktionens /admin linker hertil ("Se dev-siden"). */
export const STAGING_URL = 'https://dev.madshopper.dk'
/** Kort levetid: linket er et engangsadgangskort til staging, ikke en session. */
export const STAGING_LINK_TTL = 120
/** Stier knappen må pege på (app.py::_STAGING_LINK_PATHS). */
export const STAGING_LINK_PATHS = ['/', '/admin'] as const
/** Staging-workeren accepterer udløb op til 300 s ude i fremtiden (worker.py). */
export const STAGING_LINK_MAX_AHEAD = 300
/** Cookien staging-workeren sætter efter gyldigt link eller ?k=. */
export const STAGING_COOKIE = 'ms_staging'

const enc = new TextEncoder()

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  // WebCrypto afviser en tom nøgle; HMAC nul-udfylder nøglen til blokstørrelsen,
  // så én 0-byte giver præcis samme MAC som Pythons hmac.new(b'', ...).
  const raw = secret ? enc.encode(secret) : new Uint8Array(1)
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
  let out = ''
  for (const b of sig) out += b.toString(16).padStart(2, '0')
  return out
}

/** HMAC-SHA256(secret, "staging-link:<exp>") som hex (worker.py::_staging_link_sig). */
export function stagingLinkSig(secret: string, exp: number): Promise<string> {
  return hmacSha256Hex(secret, `staging-link:${Math.trunc(exp)}`)
}

/** Afledt sessionsværdi til ms_staging-cookien - aldrig selve secret'et
 *  (worker.py::_staging_session_token, "-v2" siden 05-10-2026). */
export function stagingSessionToken(secret: string): Promise<string> {
  return hmacSha256Hex(secret, 'staging-session-v2')
}

/** hmac.compare_digest for strenge: konstant tid i forhold til indholdet. */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

/** Gyldigt ?t=<udløb>.<hmac>? Samme regler som worker.py::_staging_blocked:
 *  udløbet er kun cifre og ligger i [nu, nu + 300]. */
export async function verifyStagingLink(secret: string, token: string, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const dot = token.indexOf('.')
  if (dot < 0) return false
  const expS = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!/^[0-9]+$/.test(expS)) return false
  const exp = Number(expS)
  if (!(nowSec <= exp && exp <= nowSec + STAGING_LINK_MAX_AHEAD)) return false
  return timingSafeEqual(sig, await stagingLinkSig(secret, exp))
}

/** Engangslinket fra /admin (app.py::admin_staging_link). Uden secret peges
 *  blot på dev-siden (lokalt og på staging selv). */
export async function buildStagingLink(
  secret: string | undefined | null, path: unknown, nowSec = Math.floor(Date.now() / 1000),
): Promise<{ url: string; direct: boolean }> {
  const p = typeof path === 'string' && (STAGING_LINK_PATHS as readonly string[]).includes(path) ? path : '/'
  if (!secret) return { url: `${STAGING_URL}${p}`, direct: false }
  const exp = nowSec + STAGING_LINK_TTL
  return { url: `${STAGING_URL}${p}?t=${exp}.${await stagingLinkSig(secret, exp)}`, direct: true }
}
