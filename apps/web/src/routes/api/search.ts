import { createFileRoute } from '@tanstack/react-router'
import { json } from '~/lib/http'
import { argPage, buildSearchListing, getActiveStores } from '~/lib/listings'
import { reqState } from '~/lib/request-state'
import { LISTING_PER_PAGE, cleanSearchQuery, productsToApiList } from '~/lib/support'

export const Route = createFileRoute('/api/search')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const args = reqState().url.searchParams
          const query = cleanSearchQuery(args.get('q') ?? '')
          if (!query) {
            return json('api_search', { success: true, query: '', products: [], page: 1, per_page: LISTING_PER_PAGE, total_pages: 0, total: 0 })
          }
          const r = await buildSearchListing(query, getActiveStores(), args, argPage(args))
          return json('api_search', {
            success: true, query, products: productsToApiList(r.products), page: r.page,
            per_page: LISTING_PER_PAGE, total_pages: r.totalPages, total: r.total,
          })
        } catch (e) {
          console.error('api/search', e)
          return json('api_search', { success: false, error: 'Kunne ikke søge.' }, 500)
        }
      },
    },
  },
})
