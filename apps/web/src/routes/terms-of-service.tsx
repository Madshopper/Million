import { createFileRoute } from '@tanstack/react-router'
import { TermsPage } from '~/components/pages/TermsPage'
import { req } from '~/lib/page'
import { setEndpoint } from '~/lib/request-state'
import { buildSite, loadSiteFlags } from '~/lib/site'

export const Route = createFileRoute('/terms-of-service')({
  loader: async () => {
    setEndpoint('terms_of_service')
    return { flags: await loadSiteFlags(), head: { title: 'Vilkår og betingelser - MadShopper' } }
  },
  component: function Page() {
    const { flags } = Route.useLoaderData()
    return <TermsPage site={buildSite(flags)} req={req('terms_of_service')} />
  },
})
