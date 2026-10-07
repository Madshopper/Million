import { createFileRoute } from '@tanstack/react-router'
import { werkzeugMethodNotAllowed } from '~/lib/recipes'
import { handleAlternatives } from '~/lib/api-post'
import { d1Products } from '~/lib/data'
import '~/lib/post-deps'

export const Route = createFileRoute('/api/alternatives')({
  server: {
    handlers: {
      // POST-only i Flask; GET giver Werkzeugs 405.
      GET: () => werkzeugMethodNotAllowed('OPTIONS, POST'),
      POST: ({ request }) => handleAlternatives(request, d1Products),
    },
  },
})
