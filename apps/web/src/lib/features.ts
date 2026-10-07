// Feature-panelet (app.py::_FEATURES/_feature_enabled). Valgene ligger i KV
// (features_v1); en miljø-var (fx RECIPES_ENABLED=1) tvinger en funktion til,
// som på staging. Læses én gang pr. request.
import { env } from 'cloudflare:workers'
import { kvGetJson } from './data'
import { reqState } from './request-state'

export const FEATURE_ENV: Record<string, keyof Cloudflare.Env> = {
  recipes: 'RECIPES_ENABLED',
  push: 'PUSH_ENABLED',
  stats: 'STATS_ENABLED',
  swipe: 'SWIPE_ENABLED',
  mejeri_navn: 'MEJERI_NAVN_ENABLED',
  subscription: 'SUBSCRIPTION_ENABLED',
}

let memo: { flags: Record<string, { on?: boolean }>; at: number } | null = null
const TTL_MS = 300_000

async function featureFlags(): Promise<Record<string, { on?: boolean }>> {
  const s = reqState()
  if (s.features) return s.features
  const now = Date.now()
  if (memo && now - memo.at < TTL_MS) return (s.features = memo.flags)
  const raw = await kvGetJson<Record<string, { on?: boolean }>>('features_v1')
  const flags = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  memo = { flags, at: now }
  return (s.features = flags)
}

export async function featureEnabled(key: string): Promise<boolean> {
  const envName = FEATURE_ENV[key]
  if (!envName) return false
  if ((env as any)[envName] === '1') return true
  const entry = (await featureFlags())[key]
  return !!entry && typeof entry === 'object' && entry.on === true
}

export async function allFeatures() {
  const [recipes, push, stats, swipe, mejeri_navn, subscription] = await Promise.all(
    ['recipes', 'push', 'stats', 'swipe', 'mejeri_navn', 'subscription'].map(featureEnabled),
  )
  return { recipes, push, stats, swipe, mejeri_navn, subscription }
}
