import { createFileRoute } from '@tanstack/react-router'
import { featureEnabled } from '~/lib/features'
import { json } from '~/lib/http'
import { fetchRecipeList, supabaseAvailable } from '~/lib/recipes'

// app.py::get_recipes - godkendte opskrifter + forudberegnet prissnapshot.
export const Route = createFileRoute('/api/recipes/')({
  server: {
    handlers: {
      GET: async () => {
        if (!(await featureEnabled('recipes')) || !supabaseAvailable()) return json('get_recipes', { success: true, recipes: [] })
        try {
          const [status, body] = await fetchRecipeList()
          return json('get_recipes', body, status)
        } catch (e) {
          console.error('recipes-list error', e)
          return json('get_recipes', { success: false, recipes: [] }, 503)
        }
      },
    },
  },
})
