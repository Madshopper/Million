import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { featureEnabled } from '~/lib/features'
import { text } from '~/lib/http'
import { PUBLIC_CATEGORY_PATHS } from '~/lib/support'

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async () => {
        const siteUrl = (env.SITE_URL || 'https://madshopper.dk').replace(/\/$/, '')
        const paths = ['/', '/ugens_tilbud', ...PUBLIC_CATEGORY_PATHS.map((s: string) => `/${s}`)]
        if (await featureEnabled('recipes')) paths.push('/opskrifter')
        paths.push('/about', '/feedback', '/terms-of-service', '/privatliv')
        const urls = paths.map((p) => `  <url><loc>${siteUrl}${p}</loc></url>`).join('\n')
        const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
        return text('sitemap_xml', body, 'application/xml; charset=utf-8')
      },
    },
  },
})
