import { createFileRoute } from '@tanstack/react-router'
import { FeedbackPage } from '~/components/pages/FeedbackPage'
import { req } from '~/lib/page'
import { setEndpoint } from '~/lib/request-state'
import { buildSite, loadSiteFlags } from '~/lib/site'

export const Route = createFileRoute('/feedback')({
  loader: async () => {
    setEndpoint('feedback_page')
    return { flags: await loadSiteFlags(), head: { title: 'Feedback - MadShopper' } }
  },
  component: function Page() {
    const { flags } = Route.useLoaderData()
    return <FeedbackPage site={buildSite(flags)} req={req('feedback_page')} />
  },
})
