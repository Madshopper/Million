// Fælles kontekst for side-komponenterne: det som app.py::_inject_site_meta
// lægger i hver Jinja-render, plus request-informationen skabelonerne læser.
import { staticUrl } from '~/lib/static'

/** Svarer 1:1 til app.py::_inject_site_meta (samme nøgler og betydning). */
export interface SiteContext {
  /** SITE_URL uden afsluttende / (fx https://madshopper.dk) */
  site_url: string
  /** site_url + request.path */
  canonical_url: string
  /** JSON-LD-grafen fra app.py::_structured_data() */
  structured_data: unknown
  /** Offentlig Supabase-URL og publishable-nøgle til browseren */
  supabase_url: string
  supabase_anon_key: string
  /** 'carts' + TABLE_SUFFIX */
  carts_table: string
  /** 'price_alerts' + TABLE_SUFFIX */
  price_alerts_table: string
  /** TABLE_SUFFIX ('' i prod, '_dev' lokalt/staging) */
  rpc_suffix: string
  /** _recipes_enabled(): header-ikon til /opskrifter */
  recipes_enabled: boolean
  /** Feature 'push': prisalarmer som notifikation */
  push_enabled: boolean
  /** Feature 'stats': varestatistik */
  stats_enabled: boolean
  /** Feature 'swipe': swipe i kurven */
  swipe_enabled: boolean
  /** Feature 'mejeri_navn': "Køl & Mejeri" i stedet for "Køl" */
  mejeri_navn_enabled: boolean
  /** Offentlig VAPID-nøgle til web push */
  vapid_public_key: string
  /** Sandt når sidens render byggede på ufuldstændige data (_mark_data_degraded) */
  data_degraded: boolean
}

/** Erstatter request.path / request.endpoint / request.args / request.view_args. */
export interface RequestInfo {
  path: string
  endpoint: string
  args: URLSearchParams
  viewArgs: Record<string, string>
}

export function makeRequestInfo(
  url: string | URL,
  endpoint: string,
  viewArgs: Record<string, string> = {},
): RequestInfo {
  const u = typeof url === 'string' ? new URL(url, 'http://localhost') : url
  return { path: decodeURIComponent(u.pathname), endpoint, args: u.searchParams, viewArgs }
}

// --- url_for ------------------------------------------------------------------

/** Endpoints som skabelonerne bruger, med Flasks første registrerede regel. */
const RULES: Record<string, string> = {
  home: '/',
  category: '/<category_name>',
  ugens_tilbud: '/ugens_tilbud',
  search_page: '/search/results',
  about: '/about',
  terms_of_service: '/terms-of-service',
  privacy_policy: '/privatliv',
  feedback_page: '/feedback',
  submit_feedback: '/api/feedback',
}

export type Endpoint = keyof typeof RULES | 'static'

const ALNUM = /[A-Za-z0-9_.\-~]/

function pctEncode(s: string, safe: string, plusForSpace: boolean): string {
  let out = ''
  for (const ch of s) {
    if (ALNUM.test(ch) || safe.includes(ch)) out += ch
    else if (ch === ' ' && plusForSpace) out += '+'
    else {
      for (const b of new TextEncoder().encode(ch)) out += '%' + b.toString(16).toUpperCase().padStart(2, '0')
    }
  }
  return out
}

// Werkzeugs sikre tegn i hhv. sti og query (målt med url_for).
const PATH_SAFE = "!$&'()*+,/:;=@"
const QUERY_SAFE = "!$'()*,/:;?@"

export type UrlParams = Array<[string, string | number | null | undefined]> | Record<string, string | number | null | undefined>

/** Flask url_for: sti-variabler udfyldes, resten bliver query i given rækkefølge. */
export function urlFor(endpoint: Endpoint, params: UrlParams = []): string {
  const entries = Array.isArray(params) ? params : Object.entries(params)
  if (endpoint === 'static') {
    const fn = entries.find(([k]) => k === 'filename')?.[1]
    return staticUrl(String(fn))
  }
  const rule = RULES[endpoint]
  if (rule === undefined) throw new Error(`urlFor: ukendt endpoint ${endpoint}`)
  const used = new Set<string>()
  const path = rule.replace(/<([a-z_]+)>/g, (_, name: string) => {
    used.add(name)
    const v = entries.find(([k]) => k === name)?.[1]
    if (v === undefined || v === null) throw new Error(`urlFor: mangler ${name}`)
    return pctEncode(String(v), PATH_SAFE, false)
  })
  const q = entries
    .filter(([k, v]) => !used.has(k) && v !== null && v !== undefined)
    .map(([k, v]) => pctEncode(k, QUERY_SAFE, true) + '=' + pctEncode(String(v), QUERY_SAFE, true))
  return q.length ? `${path}?${q.join('&')}` : path
}

/** Python dict(a, **b): b overskriver, men en eksisterende nøgle beholder sin plads. */
export function dictMerge(
  a: Array<[string, string | number]>,
  b: Array<[string, string | number]>,
): Array<[string, string | number]> {
  const out = a.map((e) => [...e] as [string, string | number])
  for (const [k, v] of b) {
    const i = out.findIndex(([ok]) => ok === k)
    if (i >= 0) out[i][1] = v
    else out.push([k, v])
  }
  return out
}

/** request.args.to_dict(): første værdi pr. nøgle, i rækkefølge. */
export function argsToDict(args: URLSearchParams): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const seen = new Set<string>()
  for (const [k, v] of args) {
    if (seen.has(k)) continue
    seen.add(k)
    out.push([k, v])
  }
  return out
}
