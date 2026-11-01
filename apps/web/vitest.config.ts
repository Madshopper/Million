import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Egen config til tests (vite.config.ts har Cloudflare/TanStack-plugins, som
// ikke hører hjemme i node-testene).
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
      // Paritetstests: samme ?v=-hashes som Flask brugte i fixtures.
      'virtual:static-hashes': fileURLToPath(new URL('./test/parity/static-hashes.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
})
