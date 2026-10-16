import { createFileRoute } from '@tanstack/react-router'
import { RecipesPage } from '~/components/pages/RecipesPage'
import { featureEnabled } from '~/lib/features'
import { text } from '~/lib/http'
import { req } from '~/lib/page'
import { setEndpoint } from '~/lib/request-state'
import { buildSite, loadSiteFlags } from '~/lib/site'

// app.py::recipes_page - opskrift-oversigten. Selve listen hentes client-side
// fra /api/recipes. Bag Feature 'recipes' (_recipes_enabled()).
export const Route = createFileRoute('/opskrifter')({
  server: {
    handlers: {
      GET: async ({ next }) => {
        if (!(await featureEnabled('recipes'))) return text('recipes_page', 'Page not found', 'text/html; charset=utf-8', 404)
        return next()
      },
    },
  },
  loader: async () => {
    setEndpoint('recipes_page')
    return { flags: await loadSiteFlags(), head: { title: 'Opskrifter - MadShopper' } }
  },
  component: function Page() {
    const { flags } = Route.useLoaderData()
    return <RecipesPage site={buildSite(flags)} req={req('recipes_page')} />
  },
})
