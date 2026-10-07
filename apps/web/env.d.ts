declare module 'virtual:static-hashes' {
  const hashes: Record<string, string>
  export default hashes
}

declare namespace Cloudflare {
  interface Env {
    DB: D1Database
    CACHE_KV: KVNamespace
    SITE_URL?: string
    LOCAL_DEV?: string
    EDGE_CACHE?: string
    SUPABASE_URL?: string
    SUPABASE_KEY?: string
    TABLE_SUFFIX?: string
    BUILD_ID?: string
    RECIPES_ENABLED?: string
    PUSH_ENABLED?: string
    STATS_ENABLED?: string
    SWIPE_ENABLED?: string
    MEJERI_NAVN_ENABLED?: string
    SUBSCRIPTION_ENABLED?: string
  }
}
declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env
}
