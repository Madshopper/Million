import { createFileRoute } from '@tanstack/react-router'
import { json } from '~/lib/http'
import { STORE_CATALOG_VERSION, STORE_CONFIGS, STORES_ADDED_IN_VERSION } from '~/lib/support'

export const Route = createFileRoute('/api/stores')({
  server: {
    handlers: {
      GET: () => json('get_stores', {
        stores: Object.entries(STORE_CONFIGS).map(([key, v]: [string, any]) => ({ key, label: v.label, logo: v.logo })),
        version: STORE_CATALOG_VERSION,
        stores_added: STORES_ADDED_IN_VERSION,
      }),
    },
  },
})
