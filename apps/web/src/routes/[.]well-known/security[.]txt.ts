import { createFileRoute } from '@tanstack/react-router'
import { text } from '~/lib/http'
import { siteUrl } from '~/lib/site'
import { securityTxt } from '~/lib/well-known'

export const Route = createFileRoute('/.well-known/security.txt')({
  server: { handlers: { GET: () => text('security_txt', securityTxt(siteUrl()), 'text/plain; charset=utf-8') } },
})
