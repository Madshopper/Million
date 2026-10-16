import { createFileRoute } from '@tanstack/react-router'
import { redirect301 } from '~/lib/page'

export const Route = createFileRoute('/om-os')({
  server: { handlers: { GET: () => redirect301('/about') } },
})
