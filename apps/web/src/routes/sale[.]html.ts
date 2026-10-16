import { createFileRoute } from '@tanstack/react-router'
import { redirect301 } from '~/lib/page'

export const Route = createFileRoute('/sale.html')({
  server: { handlers: { GET: () => redirect301('/ugens_tilbud') } },
})
