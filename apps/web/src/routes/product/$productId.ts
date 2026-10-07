import { createFileRoute } from '@tanstack/react-router'
import { d1Products } from '~/lib/data'
import { json } from '~/lib/http'

export const Route = createFileRoute('/product/$productId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const [product] = await d1Products('SELECT data FROM products WHERE id = ? LIMIT 1', [String(params.productId)])
        if (!product) return json('get_product_info', { success: false, error: 'Product not found' }, 404)
        return json('get_product_info', {
          success: true,
          product: {
            rema_price: product['/product/price'] ?? null,
            bilka_price: product['/product/store_matches']?.bilka?.price ?? null,
          },
        })
      },
    },
  },
})
