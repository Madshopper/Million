import { createFileRoute, redirect } from '@tanstack/react-router'
import { SearchResultsPage } from '~/components/pages/SearchResultsPage'
import { ProductGrid } from '~/components/ProductGrid'
import { argPage, buildSearchListing, getActiveStores } from '~/lib/listings'
import { htmlResponse, isXhr, req } from '~/lib/page'
import { markDataDegraded, reqState, setEndpoint } from '~/lib/request-state'
import { buildSite, loadSiteFlags } from '~/lib/site'
import { cleanSearchQuery } from '~/lib/support'

async function load() {
  const args = reqState().url.searchParams
  const query = cleanSearchQuery(args.get('q') ?? '')
  const flags = await loadSiteFlags()
  if (!query) return { query, flags, r: null, error: null as string | null }
  try {
    const r = await buildSearchListing(query, getActiveStores(), args, argPage(args))
    return { query, flags, r, error: null as string | null }
  } catch (e) {
    console.error('search', e)
    markDataDegraded('search_page_exception')
    return { query, flags, r: null, error: 'Der opstod en fejl under søgningen' as string | null }
  }
}

export const Route = createFileRoute('/search/results')({
  server: {
    handlers: {
      GET: async ({ request, next }) => {
        if (!isXhr(request)) return next()
        const { query, flags, r } = await load()
        if (!query || !r || r.total === 0) return next()
        return htmlResponse('search_page', (
          <ProductGrid site={buildSite(flags)} req={req('search_page')} products={r.products}
            current_page={r.page} total_pages={r.totalPages} />
        ))
      },
    },
  },
  loader: async () => {
    setEndpoint('search_page')
    const d = await load()
    if (!d.query) throw redirect({ href: '/' })
    const heading = `Søgeresultater for "${d.query}"`
    return { ...d, head: { title: `${heading} - MadShopper`, breadcrumb: heading } }
  },
  component: function Search() {
    const { query, flags, r, error } = Route.useLoaderData()
    const empty = !r || r.total === 0
    return (
      <SearchResultsPage site={buildSite(flags)} req={req('search_page')} query={query}
        products={empty ? [] : r!.products} total_products={empty ? 0 : r!.total}
        current_page={empty ? 1 : r!.page} total_pages={empty ? 1 : r!.totalPages} error={error} />
    )
  },
})
