import { createFileRoute } from '@tanstack/react-router'
import { werkzeugMethodNotAllowed } from '~/lib/recipes'
import { env } from 'cloudflare:workers'
import { handleRefreshCache } from '~/lib/api-post'
import '~/lib/post-deps'

export const Route = createFileRoute('/api/refresh-cache')({
  server: {
    handlers: {
      // POST-only i Flask; GET giver Werkzeugs 405.
      GET: () => werkzeugMethodNotAllowed('OPTIONS, POST'),
      POST: ({ request }) => handleRefreshCache(request, env.CACHE_REFRESH_SECRET, env.CACHE_KV),
    },
  },
})
