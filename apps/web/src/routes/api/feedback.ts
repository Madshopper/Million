import { createFileRoute } from '@tanstack/react-router'
import { werkzeugMethodNotAllowed } from '~/lib/recipes'
import { handleFeedback } from '~/lib/api-post'
import { postDeps } from '~/lib/post-deps'

export const Route = createFileRoute('/api/feedback')({
  server: {
    handlers: {
      // POST-only i Flask; GET giver Werkzeugs 405.
      GET: () => werkzeugMethodNotAllowed('OPTIONS, POST'),
      POST: ({ request }) => handleFeedback(request, postDeps()),
    },
  },
})
