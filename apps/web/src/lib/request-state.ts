// Request-lokal tilstand (Flask's `g`). Sættes af src/server.tsx omkring hver
// request; loaders og hjælpere læser den via reqState().
import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestState {
  request: Request
  url: URL
  /** Sat af markDataDegraded() - svaret må så ikke i den delte cache. */
  degraded: string | null
  /** Endpoint-navnet (Flask's request.endpoint) - bestemmer cache-headers. */
  endpoint: string | null
  /** Overstyrer HTTP-status for en renderet side (fx 404 fra catch-all-ruten). */
  status?: number
  /** d1_stats_v1, læst højst én gang pr. request. */
  d1Stats?: D1Stats | null
  features?: Record<string, { on?: boolean }>
}

export interface D1Stats {
  products: number
  sale: number
  cats: Record<string, { n: number; subs: string[] }>
}

const als = new AsyncLocalStorage<RequestState>()

export function runWithRequestState<T>(state: RequestState, fn: () => T): T {
  return als.run(state, fn)
}

export function reqState(): RequestState {
  const s = als.getStore()
  if (!s) throw new Error('reqState() kaldt uden for en request')
  return s
}

/** app.py::_mark_data_degraded - første fejlvej vinder. */
export function markDataDegraded(reason: string): void {
  const s = als.getStore()
  if (s && !s.degraded) s.degraded = reason
}

export function setEndpoint(name: string): void {
  const s = als.getStore()
  if (s) s.endpoint = name
}
