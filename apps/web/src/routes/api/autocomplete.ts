import { createFileRoute } from '@tanstack/react-router'
import { json } from '~/lib/http'
import { getActiveStores, searchDisplayProducts } from '~/lib/listings'
import { markDataDegraded, reqState } from '~/lib/request-state'
import { cleanSearchQuery, normalizeName, searchMatchScore } from '~/lib/support'

const round2 = (x: number) => Math.round(x * 100) / 100

export const Route = createFileRoute('/api/autocomplete')({
  server: {
    handlers: {
      GET: async () => {
        const query = cleanSearchQuery(reqState().url.searchParams.get('q') ?? '')
        if ([...query].length < 2) return json('autocomplete', { suggestions: [], query_suggestion: null })
        try {
          const matched = await searchDisplayProducts(query, getActiveStores(), 60)
          const keyed = matched.map((d, i) => [searchMatchScore(d, query), i, d] as const)
          keyed.sort((a, b) => b[0] - a[0] || a[1] - b[1])
          const seen = new Set<string>()
          const suggestions = []
          for (const [, , d] of keyed) {
            if (suggestions.length >= 8) break
            const key = normalizeName(d.name)
            if (seen.has(key)) continue
            seen.add(key)
            const price = Number(d.sale_price || d.price || 0)
            suggestions.push({
              name: d.name, brand: d.brand ?? '', price: round2(price), is_sale: !!d.is_sale,
              image: d.image_url ?? '', category: d.category ?? '',
            })
          }
          return json('autocomplete', { suggestions, query_suggestion: query })
        } catch (e) {
          console.error('autocomplete', e)
          markDataDegraded('autocomplete_exception')
          return json('autocomplete', { suggestions: [], query_suggestion: null })
        }
      },
    },
  },
})
