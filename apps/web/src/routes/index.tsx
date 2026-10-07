import { createFileRoute } from '@tanstack/react-router'
import { IndexProducts } from '~/components/IndexProducts'
import { IndexPage } from '~/components/pages/IndexPage'
import { buildHomeCategories, getActiveStores } from '~/lib/listings'
import { htmlResponse, isXhr, req } from '~/lib/page'
import { featureEnabled } from '~/lib/features'
import { reqState, setEndpoint } from '~/lib/request-state'
import { buildSite, loadSiteFlags } from '~/lib/site'

async function load() {
  const [home, flags] = await Promise.all([
    buildHomeCategories(getActiveStores(), reqState().url.searchParams),
    loadSiteFlags(),
  ])
  return { home, flags }
}

export const Route = createFileRoute('/')({
  server: {
    handlers: {
      GET: async ({ request, next }) => {
        if (!isXhr(request)) return next()
        const { home, flags } = await load()
        return htmlResponse('home', (
          <IndexProducts categories={home.categories} template_mapping={home.templateMapping}
            recipes={home.recipes} recipes_clickable={flags.recipes} />
        ))
      },
    },
  },
  loader: async () => {
    setEndpoint('home')
    return { ...(await load()), head: { title: 'MadShopper - Sammenlign dagligvarepriser' } }
  },
  component: function Home() {
    const { home, flags } = Route.useLoaderData()
    return (
      <IndexPage site={buildSite(flags)} req={req('home')} categories={home.categories}
        template_mapping={home.templateMapping} recipes={home.recipes} recipes_clickable={flags.recipes} />
    )
  },
})
