// D1/KV-adgang. Svarer til app.py's _d1_rows/_d1_products/_d1_scalar/_kv_get_json,
// men uden Pyodide-broen: D1 og KV er almindelige async kald i en JS-worker, så
// _sync_bridge_call, _SyncBridgeBusy og release_stale_sync_bridge har ingen
// modpart her - den fejlklasse findes ikke.
import { env } from 'cloudflare:workers'
import type { RawProduct } from './types'
import { markDataDegraded, reqState, type D1Stats } from './request-state'

const D1_RETRY_ATTEMPTS = 3

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown
  for (let i = 0; i < D1_RETRY_ATTEMPTS; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
    }
  }
  throw last
}

export async function d1Rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    const stmt = env.DB.prepare(sql)
    const bound = params.length ? stmt.bind(...params) : stmt
    const res = await withRetry(() => bound.all<T>())
    return res.results ?? []
  } catch (e) {
    console.error('D1 d1Rows fejlede', sql.slice(0, 80), e)
    // Tom liste er her en FEJL, ikke et resultat - se markDataDegraded.
    markDataDegraded('d1_rows:' + ((e as Error)?.name || 'Error'))
    return []
  }
}

export function parseRows(rows: Array<{ data?: unknown }>): RawProduct[] {
  const out: RawProduct[] = []
  for (const row of rows) {
    const raw = row?.data
    if (typeof raw !== 'string' || !raw) continue
    try {
      out.push(JSON.parse(raw))
    } catch {
      // samme som Python: ugyldig JSON springes over
    }
  }
  return out
}

export async function d1Products(sql: string, params: unknown[] = []): Promise<RawProduct[]> {
  return parseRows(await d1Rows<{ data?: string }>(sql, params))
}

export async function d1First<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  try {
    const stmt = env.DB.prepare(sql)
    const bound = params.length ? stmt.bind(...params) : stmt
    return await withRetry(() => bound.first<T>())
  } catch (e) {
    console.error('D1 d1First fejlede', sql.slice(0, 80), e)
    markDataDegraded('d1_scalar:' + ((e as Error)?.name || 'Error'))
    return null
  }
}

export async function kvGetJson<T = unknown>(key: string): Promise<T | null> {
  try {
    return (await env.CACHE_KV.get<T>(key, 'json')) ?? null
  } catch (e) {
    console.warn('KV get fejlede', key, e)
    return null
  }
}

/** app.py::_d1_stats - én KV-læsning pr. request, aldrig på tværs af requests. */
export async function d1Stats(): Promise<D1Stats | null> {
  const s = reqState()
  if (s.d1Stats !== undefined) return s.d1Stats
  const stats = await kvGetJson<D1Stats>('d1_stats_v1')
  s.d1Stats = stats && typeof stats === 'object' && stats.cats && typeof stats.cats === 'object' ? stats : null
  return s.d1Stats
}

export async function d1StatsCategory(category: string) {
  const stats = await d1Stats()
  const entry = stats?.cats[category]
  return entry && typeof entry === 'object' ? entry : null
}

export async function d1Subcategories(category: string): Promise<Set<string>> {
  const entry = await d1StatsCategory(category)
  if (entry && Array.isArray(entry.subs)) return new Set(entry.subs)
  const rows = await d1Rows<{ subcategory?: string }>(
    'SELECT DISTINCT subcategory FROM products WHERE category = ?', [category],
  )
  return new Set(rows.map((r) => r.subcategory ?? ''))
}
