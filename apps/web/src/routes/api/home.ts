import { createFileRoute } from '@tanstack/react-router'
import { allFeatures } from '~/lib/features'
import { json } from '~/lib/http'
import { buildHomeCategories, getActiveStores } from '~/lib/listings'
import { reqState } from '~/lib/request-state'
import { productsToApiList } from '~/lib/support'

export const Route = createFileRoute('/api/home')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const [home, f] = await Promise.all([
            buildHomeCategories(getActiveStores(), reqState().url.searchParams),
            allFeatures(),
          ])
          return json('api_home', {
            success: true,
            sections: Object.entries(home.categories).map(([title, products]) => ({
              key: title, title, href: home.templateMapping[title] ?? null, products: productsToApiList(products),
            })),
            recipes: home.recipes,
            recipes_clickable: f.recipes,
            push_enabled: f.push,
            stats_enabled: f.stats,
            swipe_enabled: f.swipe,
            mejeri_navn_enabled: f.mejeri_navn,
            subscription_enabled: f.subscription,
            personal_savings: { available: false, message: 'Log ind for at tracke besparelse' },
          })
        } catch (e) {
          console.error('api/home', e)
          return json('api_home', { success: false, error: 'Kunne ikke hente forsiden.' }, 500)
        }
      },
    },
  },
})
