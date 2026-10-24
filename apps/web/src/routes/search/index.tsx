import { createFileRoute } from '@tanstack/react-router'
import { ProductGrid } from '~/components/ProductGrid'
import { renderFragment } from '~/components/render'
import { json } from '~/lib/http'
import { argPage, buildSearchListing, getActiveStores } from '~/lib/listings'
import { req } from '~/lib/page'
import { markDataDegraded, reqState } from '~/lib/request-state'
import { buildSite, loadSiteFlags } from '~/lib/site'
import { cleanSearchQuery } from '~/lib/support'

// Det flydende søgepanel: JSON med færdig HTML (app.py::search).
export const Route = createFileRoute('/search/')({
  server: {
    handlers: {
      GET: async () => {
        const args = reqState().url.searchParams
        const query = cleanSearchQuery(args.get('q') ?? '')
        if (!query) return json('search', { html: '<div class="no-results">Indtast søgeord</div>' })
        try {
          const [r, flags] = await Promise.all([buildSearchListing(query, getActiveStores(), args, argPage(args)), loadSiteFlags()])
          if (r.total === 0) return json('search', { html: '<div class="no-results">Ingen resultater fundet</div>' })
          const html = renderFragment(
            <ProductGrid site={buildSite(flags)} req={req('search')} products={r.products} current_page={r.page}
              total_pages={r.totalPages} pagination_endpoint="search_page" />,
          )
          return json('search', { html, total: r.total, page: r.page, total_pages: r.totalPages })
        } catch (e) {
          console.error('search', e)
          markDataDegraded('search_exception')
          return json('search', { html: '<div class="error">Der opstod en fejl under søgningen</div>' })
        }
      },
    },
  },
})
