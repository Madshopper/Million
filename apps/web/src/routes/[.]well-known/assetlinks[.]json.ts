import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { setEndpoint } from '~/lib/request-state'
import { androidAssetLinks, wellKnownJson } from '~/lib/well-known'

export const Route = createFileRoute('/.well-known/assetlinks.json')({
  server: {
    handlers: {
      GET: () => {
        setEndpoint('android_asset_links')
        return wellKnownJson(androidAssetLinks(env.ANDROID_CERT_SHA256))
      },
    },
  },
})
