// app.py::_supabase_rest med skrive-RPC'er - kun med den offentlige nøgle,
// som efter scripts/supabase-hardening.sql ikke har nogen direkte
// tabelskrivning; al skrivning går gennem SECURITY DEFINER-RPC'er.
// Ren (ingen cloudflare:workers-import), så ruternes logik kan enhedstestes
// med en mock-fetch.

export interface SupabaseConfig {
  url?: string
  key?: string
  /** Injicérbar fetch (tests). */
  fetch?: typeof fetch
}

export interface SupabaseRestOptions {
  params?: Record<string, string>
  jsonBody?: unknown
  prefer?: string
  /** Sekunder, som Python's timeout (standard 15). */
  timeout?: number
}

/** app.py::_supabase_available */
export function supabaseAvailable(cfg: SupabaseConfig): boolean {
  return !!(cfg.url && cfg.key)
}

/** Returnerer [data, status]. status 0 = netværks-/opsætningsfejl. */
export async function supabaseRest<T = unknown>(
  cfg: SupabaseConfig, method: string, path: string, opts: SupabaseRestOptions = {},
): Promise<[T | null, number]> {
  const base = (cfg.url || '').replace(/\/+$/, '')
  const key = cfg.key || ''
  if (!base || !key) return [null, 0]
  let url = `${base}/rest/v1/${path}`
  if (opts.params) url += '?' + new URLSearchParams(opts.params).toString()
  const headers: Record<string, string> = { apikey: key, Authorization: `Bearer ${key}` }
  if (opts.jsonBody !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.prefer) headers.Prefer = opts.prefer
  try {
    const res = await (cfg.fetch ?? fetch)(url, {
      method,
      headers,
      body: opts.jsonBody !== undefined ? JSON.stringify(opts.jsonBody) : undefined,
      signal: AbortSignal.timeout((opts.timeout ?? 15) * 1000),
    })
    let data: T | null = null
    try {
      const text = await res.text()
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }
    return [data, res.status]
  } catch (e) {
    console.warn(`Supabase REST ${method} ${path} fejlede:`, (e as Error)?.name || e)
    return [null, 0]
  }
}
