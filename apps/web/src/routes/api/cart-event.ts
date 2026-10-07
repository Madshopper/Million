import { createFileRoute } from '@tanstack/react-router'
import { werkzeugMethodNotAllowed } from '~/lib/recipes'
import { handleCartEvent } from '~/lib/api-post'
import { postDeps } from '~/lib/post-deps'

export const Route = createFileRoute('/api/cart-event')({
  server: {
    handlers: {
      // POST-only i Flask; GET giver Werkzeugs 405.
      GET: () => werkzeugMethodNotAllowed('OPTIONS, POST'),
      POST: ({ request }) => handleCartEvent(request, postDeps()),
    },
  },
})
