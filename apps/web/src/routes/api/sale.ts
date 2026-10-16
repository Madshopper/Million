import { createFileRoute } from '@tanstack/react-router'
import { json } from '~/lib/http'
import { argPage, buildSaleListing, getActiveStores } from '~/lib/listings'
import { reqState } from '~/lib/request-state'
import { LISTING_PER_PAGE, productsToApiList } from '~/lib/support'

export const Route = createFileRoute('/api/sale')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const args = reqState().url.searchParams
          const l = await buildSaleListing(getActiveStores(), args, argPage(args))
          const payload: Record<string, unknown> = {
            success: true, category: 'Ugens Tilbud', products: productsToApiList(l.products),
            page: l.page, per_page: LISTING_PER_PAGE, total_pages: l.totalPages,
          }
          if (l.total !== null) payload.total = l.total
          return json('api_sale', payload)
        } catch (e) {
          console.error('api/sale', e)
          return json('api_sale', { success: false, error: 'Kunne ikke hente tilbud.' }, 500)
        }
      },
    },
  },
})
