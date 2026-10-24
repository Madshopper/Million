import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { staticHashes } from './vite/static-hashes'

// Siderne hydreres ikke (se src/server.tsx), men TanStack bygger stadig et
// klient-bundle af ruterne. Server-moduler må ikke trække cloudflare:workers
// med derind - i klient-bygget peger den på en tom stub.
const clientStubs = {
  name: 'madshopper-client-stubs',
  resolveId(this: any, id: string) {
    if (id === 'cloudflare:workers' && this.environment?.name === 'client') return '\0cf-stub'
  },
  load(id: string) {
    if (id === '\0cf-stub') return 'export const env = {}'
  },
}

export default defineConfig({
  // ~/ -> src/ (samme som tsconfig paths). fs.allow: /admin indlejrer
  // templates/admin/*.css|js?raw fra repo-roden, uden for app-mappen.
  resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5002, fs: { allow: ['../..'] } },
  // /static/* serveres som assets fra repoets fælles static/-mappe (samme filer
  // som Python-workeren), via symlinket public/static.
  publicDir: 'public',
  plugins: [
    staticHashes(),
    clientStubs,
    cloudflare({ viteEnvironment: { name: 'ssr' }, persistState: { path: '.wrangler-state' } }),
    tanstackStart(),
    react(),
  ],
})
