// Kobler de rene POST-handlere (api-post.ts) på workerens `env`.
import { env } from 'cloudflare:workers'
import type { PostDeps } from './api-post'
import { featureEnabled } from './features'
import { setRateLimitEnvReader } from './rate-limit'

// api_limiter's API_RATE_LIMIT_PER_MIN læses ved første brug (som i Python).
setRateLimitEnvReader((name) => (env as unknown as Record<string, string | undefined>)[name])

export function postDeps(): PostDeps {
  return {
    supabase: { url: env.SUPABASE_URL, key: env.SUPABASE_KEY },
    tableSuffix: env.TABLE_SUFFIX ?? '',
    featureEnabled,
  }
}
