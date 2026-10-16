import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { setEndpoint } from '~/lib/request-state'
import { appleAppSiteAssociation, wellKnownJson } from '~/lib/well-known'

export const Route = createFileRoute('/.well-known/apple-app-site-association')({
  server: {
    handlers: {
      GET: () => {
        setEndpoint('apple_app_site_association')
        return wellKnownJson(appleAppSiteAssociation(env.APPLE_TEAM_ID))
      },
    },
  },
})
