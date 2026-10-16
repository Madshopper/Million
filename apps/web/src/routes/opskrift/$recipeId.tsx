import { createFileRoute } from '@tanstack/react-router'
import { RecipePage, validateRecipeRender } from '~/components/pages/RecipePage'
import { pyStr } from '~/components/jinja'
import { req } from '~/lib/page'
import { fetchRecipeDetail, supabaseAvailable, werkzeugNotFound, parseIntSegment } from '~/lib/recipes'
import { reqState, setEndpoint } from '~/lib/request-state'
import { buildSite, loadSiteFlags } from '~/lib/site'

// app.py::get_recipe_page (/opskrift/<int:recipe_id>). Klik registreres IKKE
// her (det ville underminere edge-cachen) - siden selv POST'er til
// /api/recipe-click ved hver visning.
export const Route = createFileRoute('/opskrift/$recipeId')({
  server: {
    handlers: {
      // <int:...> matcher kun cifre; alt andet er Werkzeugs egen 404.
      GET: async ({ params, next }) => (parseIntSegment(params.recipeId) === null ? werkzeugNotFound() : next()),
    },
  },
  loader: async ({ params }) => {
    setEndpoint('get_recipe_page')
    const flags = await loadSiteFlags()
    const notFound = (status: number) => {
      reqState().status = status
      return { flags, recipe: null, ingredients: [] as any[], snapshot: null, head: { title: 'Opskrift ikke fundet - MadShopper' } }
    }
    const id = parseIntSegment(params.recipeId)
    if (id === null || !flags.recipes || !supabaseAvailable()) return notFound(404)
    try {
      const { recipe, ingredients, snapshot } = await fetchRecipeDetail(id)
      if (!recipe) return notFound(404)
      validateRecipeRender(ingredients, snapshot)
      return { flags, recipe, ingredients, snapshot, head: { title: `${pyStr(recipe.title)} - MadShopper` } }
    } catch (e) {
      console.error('recipe-page error', e)
      return notFound(500)
    }
  },
  component: function Page() {
    const { flags, recipe, ingredients, snapshot } = Route.useLoaderData()
    return <RecipePage site={buildSite(flags)} req={req('get_recipe_page')} recipe={recipe} ingredients={ingredients} snapshot={snapshot} />
  },
})
