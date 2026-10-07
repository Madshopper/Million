import { createFileRoute } from '@tanstack/react-router'
import { featureEnabled } from '~/lib/features'
import { json } from '~/lib/http'
import { fetchRecipeDetail, parseIntSegment, supabaseAvailable, werkzeugNotFound } from '~/lib/recipes'

// app.py::get_recipe (/api/recipes/<int:recipe_id>).
export const Route = createFileRoute('/api/recipes/$recipeId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const id = parseIntSegment(params.recipeId)
        if (id === null) return werkzeugNotFound()
        if (!(await featureEnabled('recipes')) || !supabaseAvailable()) return json('get_recipe', { success: true, recipe: null })
        try {
          const { recipe, ingredients, snapshot } = await fetchRecipeDetail(id)
          return json('get_recipe', { success: true, recipe, ingredients, snapshot })
        } catch (e) {
          console.error('recipe-detail error', e)
          return json('get_recipe', { success: false, recipe: null }, 503)
        }
      },
    },
  },
})
