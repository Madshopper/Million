// app.py::_inject_site_meta + _structured_data - kontekst til hver side.
import { env } from 'cloudflare:workers'
import type { SiteContext } from '~/components/context'
import { allFeatures } from './features'
import { reqState } from './request-state'

const VAPID_PUBLIC_KEY = 'BJ-6EyGJ8i36CgrtynD59AIkr57uidHCa7u_owJQMcPSi-js_xuZc3lqfEKZV9anQt8oqY6W8Dtau6VM7cvudQc'

export function siteUrl(): string {
  return (env.SITE_URL || 'https://madshopper.dk').replace(/\/$/, '')
}

function structuredData(site: string) {
  const orgId = `${site}/#organization`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization', '@id': orgId, name: 'MadShopper', url: `${site}/`,
        logo: { '@type': 'ImageObject', url: `${site}/static/icon-512.png`, width: 512, height: 512 },
      },
      {
        '@type': 'WebSite', '@id': `${site}/#website`, url: `${site}/`, name: 'MadShopper',
        description: 'Sammenlign dagligvarepriser på tværs af danske supermarkeder - billigste bud, før du går ud.',
        inLanguage: 'da-DK', publisher: { '@id': orgId },
      },
    ],
  }
}

/** Features læses i loaderen (async); data_degraded først ved render. */
export async function loadSiteFlags() {
  return allFeatures()
}

export type SiteFlags = Awaited<ReturnType<typeof loadSiteFlags>>

export function buildSite(flags: SiteFlags): SiteContext {
  const s = reqState()
  const site = siteUrl()
  const suffix = env.TABLE_SUFFIX ?? ''
  return {
    site_url: site,
    canonical_url: `${site}${decodeURIComponent(s.url.pathname)}`,
    structured_data: structuredData(site),
    supabase_url: env.SUPABASE_URL || '',
    supabase_anon_key: env.SUPABASE_KEY || '',
    carts_table: 'carts' + suffix,
    price_alerts_table: 'price_alerts' + suffix,
    rpc_suffix: suffix,
    recipes_enabled: flags.recipes,
    push_enabled: flags.push,
    stats_enabled: flags.stats,
    swipe_enabled: flags.swipe,
    mejeri_navn_enabled: flags.mejeri_navn,
    vapid_public_key: VAPID_PUBLIC_KEY,
    data_degraded: !!s.degraded,
  }
}
