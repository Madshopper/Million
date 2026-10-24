import { createFileRoute } from '@tanstack/react-router'
import { PrivacyPage } from '~/components/pages/PrivacyPage'
import { req } from '~/lib/page'
import { setEndpoint } from '~/lib/request-state'
import { buildSite, loadSiteFlags } from '~/lib/site'

export const Route = createFileRoute('/privatliv')({
  loader: async () => {
    setEndpoint('privacy_policy')
    return { flags: await loadSiteFlags(), head: { title: 'Privatlivspolitik - MadShopper' } }
  },
  component: function Page() {
    const { flags } = Route.useLoaderData()
    return <PrivacyPage site={buildSite(flags)} req={req('privacy_policy')} />
  },
})
