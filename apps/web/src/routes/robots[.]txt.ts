import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { text } from '~/lib/http'
import { reqState } from '~/lib/request-state'

const BLOCKED_BOTS = [
  'GPTBot', 'CCBot', 'ClaudeBot', 'Claude-Web', 'anthropic-ai',
  'Google-Extended', 'Applebot-Extended', 'Bytespider',
  'meta-externalagent', 'FacebookBot', 'Amazonbot', 'cohere-ai', 'Diffbot',
  'omgili', 'ImagesiftBot', 'Timpibot', 'AhrefsBot', 'SemrushBot', 'MJ12bot',
  'DotBot', 'BLEXBot', 'DataForSeoBot', 'PetalBot', 'serpstatbot',
]
const DISALLOW = ['/api/', '/search', '/product/', '/turnstile-challenge', '/*?']
const ALLOW = ['/*?page=', '/*?subcategory=']

export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: () => {
        const siteUrl = (env.SITE_URL || 'https://madshopper.dk').replace(/\/$/, '')
        let body: string
        if (reqState().url.hostname.toLowerCase().endsWith('.workers.dev')) {
          body = 'User-agent: *\nDisallow: /\n'
        } else {
          const lines = ['User-agent: *', 'Allow: /', ...ALLOW.map((p) => `Allow: ${p}`), ...DISALLOW.map((p) => `Disallow: ${p}`), '']
          for (const bot of BLOCKED_BOTS) lines.push(`User-agent: ${bot}`, 'Disallow: /', '')
          lines.push(`Sitemap: ${siteUrl}/sitemap.xml`)
          body = lines.join('\n') + '\n'
        }
        return text('robots_txt', body, 'text/plain; charset=utf-8')
      },
    },
  },
})
