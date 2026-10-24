import { createFileRoute } from '@tanstack/react-router'
import { CategoryPage } from '~/components/pages/CategoryPage'
import { NotFoundPage } from '~/components/pages/NotFoundPage'
import { ProductGrid } from '~/components/ProductGrid'
import { argPage, buildCategoryListing, getActiveStores } from '~/lib/listings'
import { htmlResponse, isXhr, redirect301, req } from '~/lib/page'
import { reqState, setEndpoint } from '~/lib/request-state'
import { buildSite, loadSiteFlags } from '~/lib/site'
import { CAT_MEJERI } from '~/lib/support'

const SAFE_SEGMENT_RE = /^[\p{L}\p{N}_-]+$/u

async function load(slug: string) {
  const args = reqState().url.searchParams
  const [data, flags] = await Promise.all([
    buildCategoryListing(slug, getActiveStores(), args, argPage(args)),
    loadSiteFlags(),
  ])
  return { data, flags }
}

export const Route = createFileRoute('/$category')({
  server: {
    handlers: {
      GET: async ({ request, params, next }) => {
        // /<navn>.html -> /<navn> (app.py::category_html_redirect)
        if (params.category.endsWith('.html')) {
          const name = params.category.slice(0, -5)
          if (SAFE_SEGMENT_RE.test(name)) return redirect301(`/${name}`)
          return next()
        }
        if (!isXhr(request)) return next()
        const { data, flags } = await load(params.category)
        if (!data) return next()
        return htmlResponse('category', (
          <ProductGrid site={buildSite(flags)} req={req('category', { category_name: params.category })}
            products={data.products} current_page={data.page} total_pages={data.totalPages} />
        ))
      },
    },
  },
  loader: async ({ params }) => {
    setEndpoint('category')
    const { data, flags } = await load(params.category)
    // Ruten er sitets catch-all: ukendt sti = 404 med sitets egen side.
    if (!data) {
      reqState().status = 404
      return { data: null, flags, head: { title: 'Siden blev ikke fundet - MadShopper' } }
    }
    const name = data.categoryName === CAT_MEJERI && flags.mejeri_navn ? 'Køl & Mejeri' : data.categoryName
    return { data, name, flags, head: { title: `${name} - MadShopper`, breadcrumb: name } }
  },
  component: function Category() {
    const { data, name, flags } = Route.useLoaderData()
    const { category } = Route.useParams()
    const site = buildSite(flags)
    if (!data) return <NotFoundPage site={site} req={req('category')} />
    return (
      <CategoryPage site={site} req={req('category', { category_name: category })}
        category_name={name!} products={data.products} current_page={data.page} total_pages={data.totalPages}
        available_subcategories={data.availableSubcategories} current_subcategory={data.currentSubcategory} />
    )
  },
})
