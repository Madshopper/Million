import { createFileRoute } from '@tanstack/react-router'
import { d1Products } from '~/lib/data'
import { json } from '~/lib/http'
import { nutritionCandidateKeys } from '~/lib/nutrition'
import { markDataDegraded } from '~/lib/request-state'
import { supabaseGet } from '~/lib/supabase'

export const Route = createFileRoute('/api/nutrition/$productId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const [product] = await d1Products('SELECT data FROM products WHERE id = ? LIMIT 1', [String(params.productId).slice(0, 64)])
        if (!product) return json('get_nutrition', { success: true, nutrition: null })
        const keys = nutritionCandidateKeys(product)
        if (!keys.length) return json('get_nutrition', { success: true, nutrition: null })
        const [rows, status] = await supabaseGet<any[]>('nutrition_data', { select: 'key,payload', key: `in.(${keys.join(',')})` })
        if (status !== 200 || !Array.isArray(rows)) {
          markDataDegraded('nutrition_supabase')
          return json('get_nutrition', { success: true, nutrition: null })
        }
        const byKey = new Map(rows.map((r) => [r.key, r.payload]))
        for (const k of keys) if (byKey.get(k)) return json('get_nutrition', { success: true, nutrition: byKey.get(k) })
        return json('get_nutrition', { success: true, nutrition: null })
      },
    },
  },
})
