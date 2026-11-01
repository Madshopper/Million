import { createFileRoute } from '@tanstack/react-router'
import { redirect301 } from '~/lib/page'

export const Route = createFileRoute('/vilkaar.html')({
  server: { handlers: { GET: () => redirect301('/terms-of-service') } },
})
