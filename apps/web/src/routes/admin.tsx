import { createFileRoute } from '@tanstack/react-router'
import { renderPage } from '~/components/render'
import { NotFoundPage } from '~/components/pages/NotFoundPage'
import { ADMIN_HEADERS, isAdminSession } from '~/lib/admin'
import { req } from '~/lib/page'
import { reqState, setEndpoint } from '~/lib/request-state'
import { buildSite, loadSiteFlags } from '~/lib/site'

// /admin (app.py::admin_page). Ikke i CACHEABLE_ENDPOINTS: ingen CDN-header,
// så hverken zonen eller workerens Cache API gemmer den - heller ikke 404'en.
// Kun en verificeret admin (HttpOnly-cookien ms_session -> rpc/is_admin) får
// panelet, som renderes her i handleren med sit eget layout. Alle andre går
// videre til loaderen nedenfor, der giver præcis samme 404 som en ukendt sti
// ($category.tsx), så panelet ikke kan opdages.
export const Route = createFileRoute('/admin')({
  server: {
    handlers: {
      GET: async ({ request, next }) => {
        if (!(await isAdminSession(request))) return next()
        // Indlæses først her: admin.css/admin.js ligger uden for app-roden
        // (templates/admin/), og kun en admin skal nogensinde betale for dem.
        const { AdminPage } = await import('~/components/pages/AdminPage')
        const site = buildSite(await loadSiteFlags())
        setEndpoint('admin_page')
        return new Response(renderPage(<AdminPage site={site} />), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...ADMIN_HEADERS },
        })
      },
    },
  },
  loader: async () => {
    setEndpoint('admin_page')
    reqState().status = 404
    return { flags: await loadSiteFlags(), head: { title: 'Siden blev ikke fundet - MadShopper' } }
  },
  component: function AdminNotFound() {
    const { flags } = Route.useLoaderData()
    return <NotFoundPage site={buildSite(flags)} req={req('admin_page')} />
  },
})
