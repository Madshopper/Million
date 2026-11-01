// POST-ruterne fra app.py: /api/cart-event, /api/feedback, /api/alternatives
// og /api/refresh-cache. Logikken ligger her (ren, med injicerede
// afhængigheder), så den kan enhedstestes med en mock-fetch; ruterne under
// src/routes/api/ kobler den blot på `env`.
//
// Al skrivning går gennem SECURITY DEFINER-RPC'er (record_cart_activity,
// record_search_activity, submit_feedback, increment_cart_count(s)) med den
// offentlige nøgle - aldrig direkte tabelskrivning (CLAUDE.md § Sikkerhed).
import { json } from './http'
import { ALT_MAX_ITEMS, findAlternative, type D1ProductsFn } from './alternatives'
import { apiLimiter, cartEventLimiter, rateLimited } from './rate-limit'
import { supabaseAvailable, supabaseRest, type SupabaseConfig } from './supabase-rest'
import { timingSafeEqual } from './staging'
import { D, WS_CLASS, cpLen, cpSlice, isDict, pyInt, pyOr, pySplit, pyStr, pyStrip, pyTruthy } from './support/py'
import type { RawProduct } from './types'

export interface PostDeps {
  supabase: SupabaseConfig
  /** TABLE_SUFFIX ('' i produktion, '_dev' lokalt/staging). */
  tableSuffix: string
  featureEnabled(key: string): Promise<boolean>
  /** Til Turnstile-verificeringen (tests injicerer en mock). */
  fetch?: typeof fetch
}

// ── Request-body som Flask ──────────────────────────────────────────────────

/** request.get_json(silent=True, force=True): ignorerer Content-Type,
 * None ved tom/ugyldig body. */
export async function getJsonForce(request: Request): Promise<unknown> {
  let text: string
  try {
    text = await request.text()
  } catch {
    return null
  }
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** werkzeug Request.is_json */
export function isJsonContentType(request: Request): boolean {
  const mt = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
  return mt === 'application/json' || (mt.startsWith('application/') && mt.endsWith('+json'))
}

/** request.get_json(silent=True): None uden JSON-Content-Type. */
export async function getJsonSilent(request: Request): Promise<unknown> {
  if (!isJsonContentType(request)) return null
  return getJsonForce(request)
}

/** dict.get(k, d) */
function get(o: Record<string, any>, k: string, d: unknown = null): any {
  return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : d
}

const OK_STATUSES = new Set([200, 201, 204])

// ── /api/cart-event ─────────────────────────────────────────────────────────

/** Loft på produkter pr. event - en forfalsket request må ikke puste
 * vilkårligt mange varer op i Populære varer. */
export const CART_EVENT_MAX_IDS = 50
/** Fallback-stien laver ét kald pr. produkt (subrequest-loftet er 50). */
export const CART_EVENT_FALLBACK_MAX = 25
/** Samlet tidsbudget for fallback-kaskaden (best-effort analytics). */
export const CART_EVENT_FALLBACK_BUDGET_MS = 6000
export const CART_EVENT_MAX_QTY = 99

export interface CartItem {
  pid: string
  qty: number
}

/** app.py::_parse_cart_items - normaliser til ([{pid, qty}], event_type).
 * Accepterer den nye form ({event, items}) og de to ældre. Vægten udledes
 * af event-typen i RPC'en og sendes aldrig fra klienten. */
export function parseCartItems(data: Record<string, any>): [CartItem[], string] {
  const rawItems = get(data, 'items')
  let eventType: string
  let source: unknown[]
  if (Array.isArray(rawItems)) {
    const ev = get(data, 'event')
    eventType = ev === 'compare' || ev === 'view' ? ev : 'add'
    source = rawItems
  } else if (Array.isArray(get(data, 'product_ids'))) {
    eventType = 'compare'
    source = data.product_ids
  } else {
    eventType = 'add'
    source = [get(data, 'product_id', '')]
  }
  const items: CartItem[] = []
  const seen = new Set<string>()
  for (const raw of source.slice(0, CART_EVENT_MAX_IDS)) {
    let pid: string
    let qty: number
    if (isDict(raw)) {
      pid = cpSlice(pyStrip(pyStr(get(raw, 'id', ''))), 64)
      try {
        qty = pyInt(get(raw, 'qty', 1))
      } catch {
        qty = 1
      }
    } else {
      pid = cpSlice(pyStrip(pyStr(raw)), 64)
      qty = 1
    }
    if (!pid || seen.has(pid)) continue
    seen.add(pid)
    items.push({ pid, qty: Math.max(1, Math.min(qty, CART_EVENT_MAX_QTY)) })
  }
  return [items, eventType]
}

const SEARCH_TERMS_MAX = 10
const SEARCH_TERM_BAD_RE = new RegExp(`@|${D}{5,}`, 'u')

/** app.py::_clean_search_terms - samme regler som record_search_activity i
 * SQL: små bogstaver, 2-40 tegn, intet der ligner mail/telefon/CPR. */
export function cleanSearchTerms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const t of raw.slice(0, SEARCH_TERMS_MAX)) {
    if (typeof t !== 'string') continue
    const s = pySplit(t).join(' ').toLowerCase()
    const n = cpLen(s)
    if (n >= 2 && n <= 40 && !SEARCH_TERM_BAD_RE.test(s)) out.push(s)
  }
  return out
}

const EP_CART = 'cart_event'

async function recordSearches(rawTerms: unknown, deps: PostDeps): Promise<Response> {
  const terms = cleanSearchTerms(rawTerms)
  if (!terms.length) return json(EP_CART, { ok: false }, 400)
  if (!supabaseAvailable(deps.supabase) || !(await deps.featureEnabled('stats'))) {
    return json(EP_CART, { ok: true, persisted: false })
  }
  const [, st] = await supabaseRest(deps.supabase, 'POST', 'rpc/record_search_activity' + deps.tableSuffix, {
    jsonBody: { terms }, prefer: 'return=minimal',
  })
  return json(EP_CART, { ok: true, persisted: OK_STATUSES.has(st) })
}

/** POST /api/cart-event (app.py::cart_event). */
export async function handleCartEvent(request: Request, deps: PostDeps): Promise<Response> {
  const limited = rateLimited(cartEventLimiter, request, EP_CART)
  if (limited) return limited
  try {
    // force=True: Content-Type ignoreres; defekt JSON er klientens fejl (400).
    const data = await getJsonForce(request)
    if (!isDict(data)) return json(EP_CART, { ok: false, error: 'Ugyldig body' }, 400)
    if (get(data, 'event') === 'search') return await recordSearches(get(data, 'terms'), deps)
    const [items, eventType] = parseCartItems(data)
    if (!items.length) return json(EP_CART, { ok: false }, 400)
    if (!supabaseAvailable(deps.supabase)) return json(EP_CART, { ok: true, persisted: false })
    const rpc = (name: string, body: unknown) =>
      supabaseRest<any>(deps.supabase, 'POST', `rpc/${name}${deps.tableSuffix}`, { jsonBody: body, prefer: 'return=minimal' })

    if (eventType === 'view') {
      // Visninger tælles kun til varestatistikken - aldrig i cart_popularity.
      if (!(await deps.featureEnabled('stats'))) return json(EP_CART, { ok: true, persisted: false })
      const [, st] = await rpc('record_cart_activity', { items, etype: 'view' })
      return json(EP_CART, { ok: true, persisted: OK_STATUSES.has(st) })
    }

    const productIds = items.map((it) => it.pid)
    // Ét kald skriver både popularitet og time-aggregat.
    const cascadeStart = Date.now()
    const [resp, st] = await rpc('record_cart_activity', { items, etype: eventType })
    if (OK_STATUSES.has(st)) return json(EP_CART, { ok: true, persisted: true })

    // Kredsløbsafbryder: kun "RPC'en findes ikke" (404/PGRST202) må gå videre
    // til fallback-kæden; alt andet betyder at Supabase selv er i knibe.
    const code = isDict(resp) ? pyStr(pyOr(get(resp, 'code', ''), '')) : ''
    const message = isDict(resp) ? JSON.stringify(resp).toLowerCase() : ''
    const missingFunction = st === 404 && (
      code === 'PGRST202' || message.includes('does not exist') || message.includes('could not find the function'))
    if (!missingFunction) return json(EP_CART, { ok: true, persisted: false })

    // Fallbacks for et Supabase uden scripts/supabase-cart-increment.sql.
    if (Date.now() - cascadeStart > CART_EVENT_FALLBACK_BUDGET_MS) return json(EP_CART, { ok: true, persisted: false })
    if (productIds.length > 1) {
      const [, st2] = await rpc('increment_cart_counts', { pids: productIds })
      if (OK_STATUSES.has(st2)) return json(EP_CART, { ok: true, persisted: true })
      let ok = false
      for (const pid of productIds.slice(0, CART_EVENT_FALLBACK_MAX)) {
        if (Date.now() - cascadeStart > CART_EVENT_FALLBACK_BUDGET_MS) break
        const [, stOne] = await rpc('increment_cart_count', { pid })
        ok = ok || OK_STATUSES.has(stOne)
      }
      return json(EP_CART, { ok: true, persisted: ok })
    }
    const [, st3] = await rpc('increment_cart_count', { pid: productIds[0] })
    return json(EP_CART, { ok: true, persisted: OK_STATUSES.has(st3) })
  } catch (e) {
    console.error('cart-event error:', (e as Error)?.message || e)
    return json(EP_CART, { ok: false }, 500)
  }
}

// ── /api/feedback ───────────────────────────────────────────────────────────

/** verify.madshopper.dk (custom domain, se app.py::_TURNSTILE_VERIFY_URL). */
export const TURNSTILE_VERIFY_URL = 'https://verify.madshopper.dk'

/** app.py::_verify_turnstile_token - server-til-server, så et rent curl POST
 * ikke kan springe bot-tjekket over. LUKKET uden token eller ved "nej",
 * ÅBENT ved netværksfejl mod selve verificerings-workeren. */
export async function verifyTurnstileToken(token: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!token) return false
  try {
    const res = await fetchFn(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json()
    if (!isDict(data)) throw new TypeError('svaret er ikke et objekt')
    return pyTruthy(get(data, 'success'))
  } catch (e) {
    console.warn('Turnstile-verificering kunne ikke gennemføres, tillader alligevel:', (e as Error)?.message || e)
    return true
  }
}

const NON_WS = '[^' + WS_CLASS.slice(1)
const PAGE_URL_RE = new RegExp(`^https?://${NON_WS}+$`, 'iu')
const NON_AT_WS = '[^@' + WS_CLASS.slice(1)
const EMAIL_RE = new RegExp(`^${NON_AT_WS}+@${NON_AT_WS}+\\.${NON_AT_WS}{2,}$`, 'u')
const FEEDBACK_TYPES = new Set(['feedback', 'bug', 'feature', 'other'])
const EP_FEEDBACK = 'submit_feedback'

/** POST /api/feedback (app.py::submit_feedback) - gemmes via RPC'en
 * submit_feedback (validering + globalt loft i SQL). 503 ved fejl, aldrig en
 * falsk "tak for din besked". */
export async function handleFeedback(request: Request, deps: PostDeps): Promise<Response> {
  const limited = rateLimited(apiLimiter, request, EP_FEEDBACK)
  if (limited) return limited
  const parsed = await getJsonSilent(request)
  const data = pyTruthy(parsed) ? parsed : {}
  if (!isDict(data)) return json(EP_FEEDBACK, { success: false, error: 'Ugyldig body' }, 400)

  const token = pyStrip(pyStr(get(data, 'turnstile_token', '')))
  if (!(await verifyTurnstileToken(token, deps.fetch))) {
    return json(EP_FEEDBACK, { success: false, error: 'Bot-tjek fejlede. Prøv igen.' }, 400)
  }

  const field = (k: string, d: string, n?: number) => {
    const s = pyStrip(pyStr(get(data, k, d)))
    return n === undefined ? s : cpSlice(s, n)
  }
  let feedbackType = field('type', 'feedback', 50)
  const message = field('message', '')
  const name = field('name', '', 120)
  let email = field('email', '', 254)
  const subject = field('subject', '', 200)
  let pageUrl = field('page_url', '', 500)

  if (!FEEDBACK_TYPES.has(feedbackType)) feedbackType = 'feedback'
  // Kun http(s)-sider er en gyldig afsendeside; ugyldig e-mail droppes (valgfri).
  if (pageUrl && !PAGE_URL_RE.test(pageUrl)) pageUrl = ''
  if (email && !EMAIL_RE.test(email)) email = ''

  const len = cpLen(message)
  if (len < 10) return json(EP_FEEDBACK, { success: false, error: 'Beskeden skal være mindst 10 tegn.' }, 400)
  if (len > 500) return json(EP_FEEDBACK, { success: false, error: 'Beskeden er for lang (maks. 500 tegn).' }, 400)

  const [, st] = await supabaseRest(deps.supabase, 'POST', 'rpc/submit_feedback', {
    jsonBody: {
      p_type: feedbackType,
      p_name: name,
      p_email: email,
      p_subject: subject,
      p_message: message,
      p_page_url: pageUrl,
      // Staging og lokal kørsel skriver env='dev', så testbeskeder kan skelnes.
      p_env: deps.tableSuffix ? 'dev' : 'prod',
    },
    timeout: 8,
  })
  if (!(st === 200 || st === 204)) {
    console.error(`Feedback kunne ikke gemmes (type=${feedbackType})`)
    return json(EP_FEEDBACK, {
      success: false, persisted: false,
      error: 'Vi kunne ikke gemme din besked lige nu. Prøv igen om lidt.',
    }, 503)
  }
  return json(EP_FEEDBACK, { success: true, persisted: true })
}

// ── /api/alternatives ───────────────────────────────────────────────────────

const EP_ALT = 'find_alternatives'

/** POST /api/alternatives (app.py::find_alternatives). */
export async function handleAlternatives(request: Request, d1Products: D1ProductsFn): Promise<Response> {
  const limited = rateLimited(apiLimiter, request, EP_ALT)
  if (limited) return limited
  const data = await getJsonSilent(request)
  if (!isDict(data)) return json(EP_ALT, { success: false, error: 'Ugyldig body' }, 400)
  try {
    let missing = get(data, 'missing_items', [])
    if (!Array.isArray(missing)) missing = []
    // Hver vare koster et kandidatopslag - begræns antal.
    missing = missing.slice(0, ALT_MAX_ITEMS)
    if (!missing.length) return json(EP_ALT, { success: true, alternatives: [] })
    const poolCache = new Map<string, RawProduct[]>()
    const alternatives: unknown[] = []
    for (const item of missing) {
      if (!isDict(item)) continue
      const alt = await findAlternative(item, poolCache, d1Products)
      if (alt) alternatives.push(alt)
    }
    return json(EP_ALT, { success: true, alternatives })
  } catch (e) {
    // Ægte serverfejl -> 500, så den aggregerede sikkerhedslog tæller den.
    console.error('api/alternatives error:', (e as Error)?.message || e)
    return json(EP_ALT, { success: false, error: 'Kunne ikke finde alternativer.' }, 500)
  }
}

// ── /api/refresh-cache ──────────────────────────────────────────────────────

const EP_REFRESH = 'refresh_cache'
/** app.py::_KV_CACHE_KEY - den gamle hele-katalog-cache i KV. */
export const KV_CACHE_KEY = 'app_cache_v1'

/** POST /api/refresh-cache (app.py::refresh_cache), beskyttet af
 * CACHE_REFRESH_SECRET i X-Cache-Secret (konstant-tids-sammenligning).
 * Porten har ingen proces-cache at nulstille; som Python på edge slettes
 * KV-nøglen, og den næste request læser frisk. */
export async function handleRefreshCache(
  request: Request, secret: string | undefined, kv: KVNamespace | undefined,
): Promise<Response> {
  const limited = rateLimited(apiLimiter, request, EP_REFRESH)
  if (limited) return limited
  if (!secret || !timingSafeEqual(request.headers.get('X-Cache-Secret') || '', secret)) {
    return json(EP_REFRESH, { ok: false }, 401)
  }
  if (kv) {
    try {
      await kv.delete(KV_CACHE_KEY)
    } catch (e) {
      console.warn('KV delete failed:', (e as Error)?.message || e)
    }
  }
  return json(EP_REFRESH, { ok: true, invalidated: true })
}
