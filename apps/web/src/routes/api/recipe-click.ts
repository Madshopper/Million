import { createFileRoute } from '@tanstack/react-router'
import { featureEnabled } from '~/lib/features'
import { json } from '~/lib/http'
import { cartEventLimiter, rateLimited } from '~/lib/rate-limit'
import { parseRecipeClickId, readJsonSilent, recordRecipeClick, supabaseAvailable, werkzeugMethodNotAllowed } from '~/lib/recipes'

// app.py::record_recipe_click_endpoint - ét anonymt opskrift-klik via
// record_recipe_click-RPC'en. SKRIVE-rute: spærret helt, når featuren er slået
// fra, så produktionens recipe_clicks-tal ikke forurenes. Rate limiting
// (cart_event_limiter i app.py) hører til worker-laget.
export const Route = createFileRoute('/api/recipe-click')({
  server: {
    handlers: {
      // Ruten er POST-only i Flask; GET giver Werkzeugs 405.
      GET: () => werkzeugMethodNotAllowed('OPTIONS, POST'),
      POST: async ({ request }) => {
        const endpoint = 'record_recipe_click_endpoint'
        // @rate_limit(cart_event_limiter) - før alt andet, som i app.py.
        const limited = rateLimited(cartEventLimiter, request, endpoint)
        if (limited) return limited
        if (!(await featureEnabled('recipes'))) return json(endpoint, { success: false }, 404)
        const recipeId = parseRecipeClickId(await readJsonSilent(request))
        if (recipeId === null) return json(endpoint, { success: false }, 400)
        if (!supabaseAvailable()) return json(endpoint, { success: true }) // stille no-op
        const status = await recordRecipeClick(recipeId)
        return json(endpoint, { success: status === 200 || status === 204 })
      },
    },
  },
})
