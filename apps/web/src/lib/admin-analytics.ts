// Cloudflare GraphQL-analytics til /admin (app.py::_admin_d1_budget,
// _cf_graphql, _admin_traffic). Kræver læsetokenen CF_ANALYTICS_TOKEN
// (*Account Analytics: Read*) og CLOUDFLARE_ACCOUNT_ID som vars på workeren.
// Ingen af delene skriver noget. Omsætningen af svaret er rene funktioner, så
// paritetstesten kan køre dem mod Python uden at kalde Cloudflare.
import { env } from 'cloudflare:workers'

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql'

// Gratis-planens døgngrænser for D1 (konto-brede, prod + staging tilsammen).
export const D1_DAILY_ROWS_WRITTEN = 100_000
export const D1_DAILY_ROWS_READ = 5_000_000

// Cloudflare Web Analytics (cookiefri besøgsstatistik, som zonen selv
// indsætter). Site-tagget er offentligt: det står i beaconens data-attribut.
const CF_WEB_ANALYTICS_SITE_TAG_DEFAULT = 'cea571a2d49c4915b43feffe6e773784'
const CF_WORKER_SCRIPT = 'madshopper'

export const D1_BUDGET_QUERY =
  'query($a:String!,$d:Date!){viewer{accounts(filter:{accountTag:$a}){' +
  'd1AnalyticsAdaptiveGroups(limit:100,filter:{date_geq:$d,date_leq:$d}){' +
  'sum{rowsWritten rowsRead}dimensions{databaseId}}}}}'

const ADMIN_TRAFFIC_QUERY = `
query($a:String!,$s:String!,$t:Time!,$d:Date!,$w:String!){viewer{accounts(filter:{accountTag:$a}){
 days:rumPageloadEventsAdaptiveGroups(limit:10,filter:$f,orderBy:[date_ASC]){count sum{visits} dimensions{date}}
 pages:rumPageloadEventsAdaptiveGroups(limit:10,filter:$f,orderBy:[count_DESC]){count dimensions{requestPath}}
 countries:rumPageloadEventsAdaptiveGroups(limit:8,filter:$f,orderBy:[count_DESC]){count dimensions{countryName}}
 devices:rumPageloadEventsAdaptiveGroups(limit:5,filter:$f,orderBy:[count_DESC]){count dimensions{deviceType}}
 referers:rumPageloadEventsAdaptiveGroups(limit:8,filter:$f,orderBy:[count_DESC]){count dimensions{refererHost}}
 browsers:rumPageloadEventsAdaptiveGroups(limit:6,filter:$f,orderBy:[count_DESC]){count dimensions{userAgentBrowser}}
 vitals:rumWebVitalsEventsAdaptiveGroups(limit:1,filter:$f){count quantiles{largestContentfulPaintP75 interactionToNextPaintP75 cumulativeLayoutShiftP75}}
 worker:workersInvocationsAdaptive(limit:50,filter:{scriptName:$w,date_geq:$d}){sum{requests errors} quantiles{cpuTimeP50 cpuTimeP99} dimensions{status}}
}}}
`

// Kun madshopper.dk: site-tagget dækker hele zonen, og dev.madshopper.dk er
// kun os selv (målt 03-10-2026: 20 af dagens 29 besøg). Headless-browsere
// tælles heller ikke.
const RUM_FILTER = '{siteTag:$s,datetime_geq:$t,requestHost:"madshopper.dk",userAgentBrowser_neq:"ChromeHeadless",bot:0}'
export const TRAFFIC_QUERY = ADMIN_TRAFFIC_QUERY.replaceAll('filter:$f', 'filter:' + RUM_FILTER)

type Json = any

/** int(v or 0) */
function pyInt0(v: unknown): number {
  if (!v) return 0
  if (v === true) return 1
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/** round(x, nd) som Python: halvt-til-lige ved eksakte ties (binært eksakte). */
export function pyRound(x: number, nd = 0): number {
  const f = 10 ** nd
  // En eksakt tie på nd decimaler kræver x = m / 2^(nd+1) med m ulige.
  const m = x * 2 ** (nd + 1)
  if (Number.isInteger(m) && Math.abs(m) % 2 === 1 && Math.abs(m) < 2 ** 50) {
    const lo = Math.floor(x * f)
    return (lo % 2 === 0 ? lo : lo + 1) / f
  }
  return Number(x.toFixed(nd))
}

/** Datoen (UTC) som date.isoformat(). */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** os.environ / env-objektet (app.py::_edge_var) - tom streng og "undefined" = mangler. */
function edgeVar(name: 'CF_ANALYTICS_TOKEN' | 'CLOUDFLARE_ACCOUNT_ID'): string | null {
  const v = (env as unknown as Record<string, unknown>)[name]
  if (v === undefined || v === null) return null
  const s = String(v)
  return s && s !== 'undefined' ? s : null
}

async function postGraphql(token: string, body: string): Promise<Json> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(8000),
  })
  return res.json()
}

// --- D1-budgettet ------------------------------------------------------------

export function d1BudgetFromGroups(groups: Json[], day: string) {
  const databases = groups.map((g) => ({
    // .get('databaseId', '') - en eksplicit null bevares som null.
    id: 'databaseId' in (g?.dimensions || {}) ? g.dimensions.databaseId : '',
    rows_written: pyInt0((g?.sum || {}).rowsWritten),
    rows_read: pyInt0((g?.sum || {}).rowsRead),
  }))
  return {
    configured: true,
    day,
    rows_written: databases.reduce((s, d) => s + d.rows_written, 0),
    rows_read: databases.reduce((s, d) => s + d.rows_read, 0),
    limit_written: D1_DAILY_ROWS_WRITTEN,
    limit_read: D1_DAILY_ROWS_READ,
    databases,
  }
}

/** app.py::_admin_d1_budget - dagens rows_written/rows_read for hele kontoen. */
export async function adminD1Budget(now = new Date()) {
  const token = edgeVar('CF_ANALYTICS_TOKEN')
  const account = edgeVar('CLOUDFLARE_ACCOUNT_ID')
  if (!token || !account) return { configured: false }
  const day = utcDay(now)
  try {
    const data = await postGraphql(token, JSON.stringify({ query: D1_BUDGET_QUERY, variables: { a: account, d: day } }))
    const groups = data.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups
    // Python itererer: None/ikke-liste fejler som "error".
    if (!Array.isArray(groups)) throw new TypeError('groups')
    return d1BudgetFromGroups(groups, day)
  } catch (e) {
    console.warn('Admin: D1-analytics fejlede:', (e as Error)?.name)
    return { configured: true, error: true }
  }
}

// --- Trafik ------------------------------------------------------------------

/** app.py::_cf_graphql - konto-objektet, eller en fejlkode. */
async function cfGraphql(query: string, variables: Record<string, string>): Promise<[Json, null] | [null, 'not_configured' | 'error']> {
  const token = edgeVar('CF_ANALYTICS_TOKEN')
  const account = edgeVar('CLOUDFLARE_ACCOUNT_ID')
  if (!token || !account) return [null, 'not_configured']
  try {
    const data = await postGraphql(token, JSON.stringify({ query, variables: { a: account, ...variables } }))
    const acc = data.data.viewer.accounts[0]
    if (acc === undefined) throw new TypeError('accounts')
    return [acc, null]
  } catch (e) {
    console.warn('Admin: Cloudflare-analytics fejlede:', (e as Error)?.name)
    return [null, 'error']
  }
}

/** Variablerne til TRAFFIC_QUERY (uden kontoen): 7 hele dage bagud. */
export function trafficVariables(now: Date, siteTag = CF_WEB_ANALYTICS_SITE_TAG_DEFAULT) {
  const since = new Date(now.getTime() - 7 * 86400_000)
  since.setUTCHours(0, 0, 0, 0)
  return {
    s: siteTag,
    t: since.toISOString().slice(0, 19) + 'Z',
    d: utcDay(now),
    w: CF_WORKER_SCRIPT,
  }
}

/** Omsætter GraphQL-kontoen til svaret admin.js viser (app.py::_admin_traffic). */
export function trafficFromAccount(acc: Json, now: Date) {
  const dims = (g: Json) => g?.dimensions || {}
  const top = (key: string, dim: string) =>
    ((acc?.[key] || []) as Json[]).map((g) => ({ name: dims(g)[dim] || '', count: pyInt0(g?.count) }))

  const days = ((acc?.days || []) as Json[]).map((g) => ({
    date: dims(g).date ?? null,
    pageviews: pyInt0(g?.count),
    visits: pyInt0((g?.sum || {}).visits),
  }))
  const vitals = acc?.vitals
  const vit: Json = vitals && vitals.length ? (vitals[0] ?? {}) : {}
  const q: Json = vit?.quantiles || {}
  const worker = {
    requests: 0,
    errors: 0,
    by_status: {} as Record<string, number>,
    cpu_p50_ms: null as number | null,
    cpu_p99_ms: null as number | null,
  }
  for (const g of (acc?.worker || []) as Json[]) {
    const n = pyInt0((g?.sum || {}).requests)
    const status = dims(g).status || 'ukendt'
    worker.requests += n
    worker.errors += pyInt0((g?.sum || {}).errors)
    worker.by_status[status] = (worker.by_status[status] ?? 0) + n
    if (status === 'success') {
      const gq = g?.quantiles || {}
      // cpuTime er i mikrosekunder.
      if (gq.cpuTimeP50 !== undefined && gq.cpuTimeP50 !== null) worker.cpu_p50_ms = pyRound(gq.cpuTimeP50 / 1000, 1)
      if (gq.cpuTimeP99 !== undefined && gq.cpuTimeP99 !== null) worker.cpu_p99_ms = pyRound(gq.cpuTimeP99 / 1000, 1)
    }
  }
  const usToMs = (v: unknown) => (typeof v === 'number' && v >= 0 ? pyRound(v / 1000) : null)
  const cls = q.cumulativeLayoutShiftP75
  return {
    configured: true,
    today: utcDay(now),
    days,
    pages: top('pages', 'requestPath'),
    countries: top('countries', 'countryName'),
    devices: top('devices', 'deviceType'),
    referers: top('referers', 'refererHost'),
    browsers: top('browsers', 'userAgentBrowser'),
    vitals: {
      samples: pyInt0(vit?.count),
      lcp_ms: usToMs(q.largestContentfulPaintP75),
      inp_ms: usToMs(q.interactionToNextPaintP75),
      cls: typeof cls === 'number' && cls >= 0 ? cls : null,
    },
    worker,
  }
}

/** app.py::_admin_traffic - besøg (7 dage) + workerens sundhed i dag. */
export async function adminTraffic(now = new Date()) {
  const siteTag = env.CF_WEB_ANALYTICS_SITE_TAG
  const [acc, err] = await cfGraphql(
    TRAFFIC_QUERY,
    trafficVariables(now, typeof siteTag === 'string' && siteTag ? siteTag : undefined),
  )
  if (err) {
    const out: Record<string, unknown> = { configured: err !== 'not_configured', error: err === 'error' }
    if (err === 'not_configured') {
      // Kun navnene - aldrig værdierne. Gør fejlsøgning mulig uden logs.
      out.missing = (['CF_ANALYTICS_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] as const).filter((n) => !edgeVar(n))
    }
    return out
  }
  return trafficFromAccount(acc, now)
}
