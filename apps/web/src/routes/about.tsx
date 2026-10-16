import { createFileRoute } from '@tanstack/react-router'
import { AboutPage } from '~/components/pages/AboutPage'
import { req } from '~/lib/page'
import { setEndpoint } from '~/lib/request-state'
import { buildSite, loadSiteFlags } from '~/lib/site'

export const Route = createFileRoute('/about')({
  loader: async () => {
    setEndpoint('about')
    return { flags: await loadSiteFlags(), head: { title: 'Om MadShopper - MadShopper' } }
  },
  component: function Page() {
    const { flags } = Route.useLoaderData()
    return <AboutPage site={buildSite(flags)} req={req('about')} />
  },
})
