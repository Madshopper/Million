import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { adminGate, adminJson, isEdge } from '~/lib/admin'
import { adminD1Budget } from '~/lib/admin-analytics'
import { d1Rows, d1Stats } from '~/lib/data'

// /api/admin/edge (app.py::admin_edge). POST (ikke GET), så svaret aldrig
// lægges i edge-cachen; GET giver 404 som en ukendt sti i stedet for 405, der
// ville afsløre at ruten findes. Kun læsning - D1-budgettet er stramt.
async function handle({ request }: { request: Request }) {
  const denied = await adminGate(request, 'admin_edge')
  if (denied) return denied
  const edge = isEdge()
  const out: Record<string, unknown> = { success: true, edge, d1_budget: await adminD1Budget() }
  if (edge) {
    // Rester fra den gamle D1-kø (før feedback gik direkte til Supabase).
    // Relay-jobbet er fjernet, så de bliver liggende her. Kun læsning.
    out.pending_feedback = await d1Rows(
      'SELECT id, feedback_type, name, email, subject, message, page_url, created_at ' +
      'FROM pending_feedback ORDER BY id DESC LIMIT 100',
    )
    // Fra seedets KV-statistik: COUNT(*) læste alle ~20k rækker pr. visning
    // (0,9 mio. rows_read på én dag, 02-10-2026).
    const stats = await d1Stats()
    out.d1_products = stats ? (stats.products ?? null) : null
    let version: string | null = null
    try {
      version = await env.CACHE_KV.get('cache_version')
    } catch {
      version = null
    }
    out.cache_version = version ? String(version) : null
  }
  return adminJson('admin_edge', out)
}

export const Route = createFileRoute('/api/admin/edge')({
  server: { handlers: { GET: handle, POST: handle } },
})
