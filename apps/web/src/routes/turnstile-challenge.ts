import { createFileRoute } from '@tanstack/react-router'
import { setEndpoint } from '~/lib/request-state'
import { turnstileChallengeHtml, turnstileReturnUrl } from '~/lib/well-known'

// Bot-tjek til den native app (apps/mobile/src/auth/turnstile.ts). Bevidst
// ikke cachebar: kortlivet og afhængig af ?returnUrl=.
export const Route = createFileRoute('/turnstile-challenge')({
  server: {
    handlers: {
      GET: ({ request }) => {
        setEndpoint('turnstile_challenge')
        const returnUrl = turnstileReturnUrl(new URL(request.url).searchParams.get('returnUrl'))
        return new Response(turnstileChallengeHtml(returnUrl), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        })
      },
    },
  },
})
