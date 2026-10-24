import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { adminGate, adminJson, asObject, requestJson } from '~/lib/admin'
import { buildStagingLink } from '~/lib/staging'

// /api/admin/staging-link (app.py::admin_staging_link): engangslink fra
// /admin til dev.madshopper.dk - eneste vej ind for et menneske. Signaturen
// deles med staging-spærringen (lib/staging.ts). Uden STAGING_LINK_SECRET
// (lokalt, på staging) peges blot på dev-siden. POST, kun admins, ellers 404.
async function handle({ request }: { request: Request }) {
  const denied = await adminGate(request, 'admin_staging_link')
  if (denied) return denied
  const body = asObject(await requestJson(request))
  const secret = env.STAGING_LINK_SECRET && env.STAGING_LINK_SECRET !== 'undefined' ? env.STAGING_LINK_SECRET : null
  const { url, direct } = await buildStagingLink(secret, body.path)
  return adminJson('admin_staging_link', { success: true, url, direct })
}

export const Route = createFileRoute('/api/admin/staging-link')({
  server: { handlers: { GET: handle, POST: handle } },
})
