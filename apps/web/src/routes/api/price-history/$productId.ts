import { createFileRoute } from '@tanstack/react-router'
import { json } from '~/lib/http'
import { markDataDegraded } from '~/lib/request-state'
import { supabaseGet } from '~/lib/supabase'

const WINDOW_DAYS = 30
const isoDay = (d: Date) => d.toISOString().slice(0, 10)

/** app.py::_forward_fill_price_history - én pris pr. dag i vinduet. */
function forwardFill(rows: Array<{ store?: string; price?: number; date?: string }>, days: number) {
  const today = new Date(isoDay(new Date()) + 'T00:00:00Z')
  const cutoff = new Date(today.getTime() - (days - 1) * 86400_000)
  const byStore = new Map<string | undefined, typeof rows>()
  for (const r of rows) {
    if (!byStore.has(r.store)) byStore.set(r.store, [])
    byStore.get(r.store)!.push(r)
  }
  const out: Record<string, Array<{ price: number; date: string }>> = {}
  for (const [store, list] of byStore) {
    list.sort((a, b) => ((a.date || '') < (b.date || '') ? -1 : (a.date || '') > (b.date || '') ? 1 : 0))
    let idx = 0
    let last: number | undefined | null = null
    const filled: Array<{ price: number; date: string }> = []
    for (let d = cutoff; d <= today; d = new Date(d.getTime() + 86400_000)) {
      const ds = isoDay(d)
      while (idx < list.length && (list[idx].date || '') <= ds) last = list[idx++].price
      if (last !== null && last !== undefined) filled.push({ price: last, date: ds })
    }
    if (filled.length) out[String(store)] = filled
  }
  return out
}

export const Route = createFileRoute('/api/price-history/$productId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const pid = String(params.productId).slice(0, 64)
        const [rows, status] = await supabaseGet<any[]>('price_history', {
          select: 'store,price,date', product_id: `eq.${pid}`, order: 'store.asc,date.asc',
        })
        if (status !== 200 || !Array.isArray(rows)) {
          markDataDegraded('price_history_supabase')
          return json('get_price_history', { success: true, history: [], history_by_store: {} })
        }
        const byStore = forwardFill(rows, WINDOW_DAYS)
        const flat = byStore.rema || Object.values(byStore)[0] || []
        return json('get_price_history', { success: true, history: flat, history_by_store: byStore })
      },
    },
  },
})
