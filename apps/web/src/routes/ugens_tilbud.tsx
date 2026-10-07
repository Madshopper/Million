import { createFileRoute } from '@tanstack/react-router'
import { CategoryPage } from '~/components/pages/CategoryPage'
import { ProductGrid } from '~/components/ProductGrid'
import { argPage, buildSaleListing, getActiveStores } from '~/lib/listings'
import { htmlResponse, isXhr, req } from '~/lib/page'
import { reqState, setEndpoint } from '~/lib/request-state'
import { buildSite, loadSiteFlags } from '~/lib/site'

async function load() {
  const args = reqState().url.searchParams
  const [data, flags] = await Promise.all([buildSaleListing(getActiveStores(), args, argPage(args)), loadSiteFlags()])
  return { data, flags }
}

export const Route = createFileRoute('/ugens_tilbud')({
  server: {
    handlers: {
      GET: async ({ request, next }) => {
        if (!isXhr(request)) return next()
        const { data, flags } = await load()
        return htmlResponse('ugens_tilbud', (
          <ProductGrid site={buildSite(flags)} req={req('ugens_tilbud')} products={data.products}
            current_page={data.page} total_pages={data.totalPages} />
        ))
      },
    },
  },
  loader: async () => {
    setEndpoint('ugens_tilbud')
    return { ...(await load()), head: { title: 'Ugens Tilbud - MadShopper', breadcrumb: 'Ugens Tilbud' } }
  },
  component: function Sale() {
    const { data, flags } = Route.useLoaderData()
    return (
      <CategoryPage site={buildSite(flags)} req={req('ugens_tilbud')} category_name="Ugens Tilbud"
        products={data.products} current_page={data.page} total_pages={data.totalPages}
        available_subcategories={[]} current_subcategory={null} />
    )
  },
})
