import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { LayoutHead, ShellContext } from '~/components/Layout'
import { BreadcrumbJsonLd } from '~/components/pages/breadcrumb'
import { req } from '~/lib/page'
import { reqState } from '~/lib/request-state'
import { buildSite, type SiteFlags } from '~/lib/site'

/** Det en side-loader returnerer til dokumentets <head>. */
export interface PageHead {
  title: string
  breadcrumb?: string
}

const NO_FLAGS: SiteFlags = { recipes: false, push: false, stats: false, swipe: false, mejeri_navn: false, subscription: false }

// <html>/<head> renderes her, uden for rutens Suspense-grænse (se Layout.tsx).
function Shell({ children }: { children: ReactNode }) {
  const leaf = useRouterState({ select: (s) => s.matches[s.matches.length - 1] })
  const data = (leaf?.loaderData ?? {}) as { head?: PageHead; flags?: SiteFlags }
  const head = data.head ?? { title: 'Siden blev ikke fundet - MadShopper' }
  const site = buildSite(data.flags ?? NO_FLAGS)
  return (
    <html lang="da">
      <LayoutHead site={site} req={req(reqState().endpoint ?? '')} title={head.title}
        structuredData={head.breadcrumb ? <BreadcrumbJsonLd siteUrl={site.site_url} name={head.breadcrumb} /> : undefined} />
      <body>
        <ShellContext.Provider value={true}>{children}</ShellContext.Provider>
      </body>
    </html>
  )
}

export const Route = createRootRoute({
  shellComponent: Shell,
  component: () => <Outlet />,
})
