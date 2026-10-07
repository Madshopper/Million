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
    // Admin (lib/admin-analytics.ts): D1-budget og Trafik-fanen via Cloudflares
    // GraphQL-analytics. Kontotoken med *Account Analytics: Read*.
    CF_ANALYTICS_TOKEN?: string
    CLOUDFLARE_ACCOUNT_ID?: string
    /** Overstyrer Web Analytics-site-tagget (som os.environ i app.py). */
    CF_WEB_ANALYTICS_SITE_TAG?: string
    // Kun produktionen: signerer engangslinket "Se dev-siden" (lib/staging.ts).
    STAGING_LINK_SECRET?: string
  }
}
// Worker-laget (src/server.tsx) og POST-/diverse-ruterne. Egen blok, så
// tilføjelser fra andre ruter kan flettes uden konflikt.
declare namespace Cloudflare {
  interface Env {
    /** Generel rate limit pr. IP (worker.py::_rate_ok). */
    RATE_LIMITER?: RateLimit
    /** Ekstra global grænse for /api/cart-event og /api/recipe-click. */
    CART_RATE_LIMITER?: RateLimit
    /** Kun sat på staging: slår adgangsspærringen til (worker.py::_staging_blocked). */
    STAGING_ACCESS_SECRET?: string
    /** Beskytter POST /api/refresh-cache (secret, aldrig i vars). */
    CACHE_REFRESH_SECRET?: string
    /** Overstyrer api_limiter's 60/min - kun til kapacitetsmåling på staging. */
    API_RATE_LIMIT_PER_MIN?: string
    /** Universal Links / App Links (/.well-known/*). */
    APPLE_TEAM_ID?: string
    ANDROID_CERT_SHA256?: string
  }
}
declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env
}
