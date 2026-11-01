import { createFileRoute } from '@tanstack/react-router'
import { json } from '~/lib/http'
import { argPage, buildCategoryListing, getActiveStores } from '~/lib/listings'
import { reqState } from '~/lib/request-state'
import { LISTING_PER_PAGE, productsToApiList } from '~/lib/support'

export const Route = createFileRoute('/api/category/$slug')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const args = reqState().url.searchParams
          const d = await buildCategoryListing(params.slug, getActiveStores(), args, argPage(args))
          if (!d) return json('api_category', { success: false, error: 'Ukendt kategori.' }, 404)
          const payload: Record<string, unknown> = {
            success: true, slug: params.slug, category: d.categoryName,
            products: productsToApiList(d.products), page: d.page, per_page: LISTING_PER_PAGE,
            total_pages: d.totalPages, available_subcategories: d.availableSubcategories,
            current_subcategory: d.currentSubcategory || null,
          }
          if (d.total !== null) payload.total = d.total
          return json('api_category', payload)
        } catch (e) {
          console.error('api/category', e)
          return json('api_category', { success: false, error: 'Kunne ikke hente kategori.' }, 500)
        }
      },
    },
  },
})
