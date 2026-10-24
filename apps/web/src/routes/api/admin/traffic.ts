import { createFileRoute } from '@tanstack/react-router'
import { adminGate, adminJson } from '~/lib/admin'
import { adminTraffic } from '~/lib/admin-analytics'

// /api/admin/traffic (app.py::admin_traffic): Cloudflare Web Analytics +
// workerens sundhed. POST, kun admins, ellers samme 404 som en ukendt sti.
async function handle({ request }: { request: Request }) {
  const denied = await adminGate(request, 'admin_traffic')
  if (denied) return denied
  return adminJson('admin_traffic', { success: true, traffic: await adminTraffic() })
}

export const Route = createFileRoute('/api/admin/traffic')({
  server: { handlers: { GET: handle, POST: handle } },
})
