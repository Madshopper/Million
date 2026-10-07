import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { abortResponse, adminGate, adminJson, featuresEditable, requestJson } from '~/lib/admin'
import { handleAdminFeatures } from '~/lib/admin-features'

// /api/admin/features (app.py::admin_features): Feature-panelet. POST, kun
// admins, ellers samme 404 som en ukendt sti. Skriver kun KV i produktionen
// (featuresEditable); staging og lokalt viser panelet uden at kunne ændre det.
async function handle({ request }: { request: Request }) {
  const denied = await adminGate(request, 'admin_features')
  if (denied) return denied
  const editable = featuresEditable()
  const result = await handleAdminFeatures(await requestJson(request), {
    kv: editable ? env.CACHE_KV : null,
    editable,
    forced: (name) => (env as unknown as Record<string, unknown>)[name] === '1',
  })
  if (result.kind === 'abort') return abortResponse('admin_features', result.status)
  return adminJson('admin_features', result.body, result.status)
}

export const Route = createFileRoute('/api/admin/features')({
  server: { handlers: { GET: handle, POST: handle } },
})
