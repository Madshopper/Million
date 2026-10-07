import { createFileRoute } from '@tanstack/react-router'
import { d1First } from '~/lib/data'
import { json, text } from '~/lib/http'
import { markDataDegraded } from '~/lib/request-state'

// Hele svaret bygges i D1 (app.py::_API_PRODUCTS_SQL) - D1's CPU tæller ikke
// mod workerens.
const API_PRODUCTS_SQL = `
SELECT json_group_array(json_object(
  '/product/id', json_extract(data, '$."/product/id"'),
  '/product/price', CAST(json_extract(data, '$."/product/rema_price"') AS REAL),
  '/product/sale_price', NULL,
  '/product/store_matches', json(COALESCE((
    SELECT json_group_object(je.key, json_object('price', json_extract(je.value, '$.price')))
    FROM json_each(data, '$."/product/store_matches"') AS je
  ), '{}'))
)) AS payload
FROM (SELECT data FROM products WHERE stores LIKE '%|Rema 1000|%' LIMIT 6000)
WHERE CAST(json_extract(data, '$."/product/rema_price"') AS REAL) > 0
`

export const Route = createFileRoute('/api/products')({
  server: {
    handlers: {
      GET: async () => {
        const row = await d1First<{ payload?: string }>(API_PRODUCTS_SQL)
        const payload = row?.payload
        if (typeof payload !== 'string' || !payload.startsWith('[')) {
          markDataDegraded('api_products_exception')
          return json('get_separate_products', { success: false, error: 'Kunne ikke hente produktdata.' })
        }
        return text('get_separate_products', `{"success":true,"rema_products":${payload},"bilka_products":[]}`, 'application/json')
      },
    },
  },
})
