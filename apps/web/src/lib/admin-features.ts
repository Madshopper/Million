// Feature-panelet i /admin (app.py::admin_features + _admin_features_list).
// Body {} = list; {"key", "on": bool} = udgiv/skjul på madshopper.dk;
// {"key", "permanent": true} = fjern en udgivet funktion fra panelet (forbliver
// slået til for altid); {"key": <projekt>, "done": true} = marker et projekt
// som færdigt. Valget læses frisk fra KV her (ikke features.ts' memo), så
// panelet viser det der faktisk er gemt. Kun produktionens worker skriver.
import { FEATURE_KEYS, FEATURES, FEATURES_KV_KEY, PROJECT_KEYS, PROJECTS, PROJECTS_KV_KEY } from './feature-catalog'

type Flags = Record<string, unknown>

/** Det udsnit af KVNamespace der bruges - så testene kan give en falsk. */
export interface FeaturesKv {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

export interface FeaturesDeps {
  /** null = ikke redigerbar her (staging/lokalt): kun visning. */
  kv: FeaturesKv | null
  editable: boolean
  /** Miljø-varen tvinger funktionen til (fx RECIPES_ENABLED=1). */
  forced: (envName: string) => boolean
  now?: Date
}

export type FeaturesResult =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'abort'; status: 400 | 404 }

/** app.py::_parse_features - alt andet end et JSON-objekt bliver {}. */
export function parseFeatures(raw: unknown): Flags {
  let data: unknown = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return {}
    }
  }
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Flags) : {}
}

/** datetime.now(timezone.utc).isoformat(timespec='seconds') */
export function isoSecondsUtc(d: Date): string {
  return d.toISOString().slice(0, 19) + '+00:00'
}

const isDict = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Python-truthiness for de JSON-værdier KV kan indeholde. */
function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false
  if (Array.isArray(v)) return v.length > 0
  if (isDict(v)) return Object.keys(v).length > 0
  return true
}

export function adminFeaturesList(flags: Flags, forced: (envName: string) => boolean) {
  const out = []
  for (const f of FEATURES) {
    const entry = isDict(flags[f.key]) ? (flags[f.key] as Record<string, unknown>) : {}
    // Gjort permanent: hører ikke længere til i panelet.
    if (entry.permanent === true) continue
    out.push({
      key: f.key, name: f.name, desc: f.desc,
      app: f.app ?? null, parts: f.parts.map((p) => ({ ...p })),
      live: entry.on === true,
      changed_at: 'at' in entry ? entry.at : null,
      forced_here: forced(f.env),
    })
  }
  return out
}

const json = (status: number, body: unknown): FeaturesResult => ({ kind: 'json', status, body })

/** Selve logikken bag POST /api/admin/features (efter admin-tjekket). */
export async function handleAdminFeatures(body: unknown, deps: FeaturesDeps): Promise<FeaturesResult> {
  const { editable, forced } = deps
  const kv = editable ? deps.kv : null
  const now = isoSecondsUtc(deps.now ?? new Date())
  let flags: Flags = {}
  if (kv) {
    try {
      flags = parseFeatures(await kv.get(FEATURES_KV_KEY))
    } catch (e) {
      console.warn(`KV get ${FEATURES_KV_KEY} failed:`, e)
      return json(503, { success: false, error: 'Kunne ikke læse de gemte valg. Prøv igen.' })
    }
  }
  const b = isDict(body) ? body : {}
  let key: unknown = b.key ?? null
  if (key !== null && typeof key === 'string' && PROJECT_KEYS.has(key)) {
    // Projekt markeret som færdigt: forsvinder fra panelet.
    if (b.done !== true) return { kind: 'abort', status: 400 }
    if (!kv) return json(409, { success: false, error: 'Kan kun ændres på madshopper.dk/admin.' })
    try {
      const parsed = parseFeatures(await kv.get(PROJECTS_KV_KEY))
      const done: Flags = {}
      for (const [k, v] of Object.entries(parsed)) if (PROJECT_KEYS.has(k)) done[k] = v
      done[key] = now
      await kv.put(PROJECTS_KV_KEY, JSON.stringify(done))
    } catch (e) {
      console.warn(`KV ${PROJECTS_KV_KEY} failed:`, e)
      return json(503, { success: false, error: 'Valget blev ikke gemt. Prøv igen.' })
    }
    key = null
  }
  if (key !== null) {
    const permanent = b.permanent === true
    if (typeof key !== 'string' || !FEATURE_KEYS.has(key) || (!permanent && typeof b.on !== 'boolean')) {
      return { kind: 'abort', status: 400 }
    }
    if (!kv) return json(409, { success: false, error: 'Kan kun ændres på madshopper.dk/admin.' })
    const kept: Flags = {}
    for (const [k, v] of Object.entries(flags)) if (FEATURE_KEYS.has(k)) kept[k] = v
    flags = kept
    const current = isDict(flags[key]) ? (flags[key] as Record<string, unknown>) : {}
    let problem: string | null = null
    if (current.permanent === true) problem = 'Funktionen er permanent og kan ikke ændres.'
    else if (permanent && current.on !== true) problem = 'Funktionen skal være udgivet, før den kan fjernes fra panelet.'
    if (problem) return json(409, { success: false, error: problem })
    flags[key] = permanent ? { ...current, permanent: true, permanent_at: now } : { on: b.on, at: now }
    try {
      await kv.put(FEATURES_KV_KEY, JSON.stringify(flags))
    } catch (e) {
      console.warn(`KV put ${FEATURES_KV_KEY} failed:`, e)
      return json(503, { success: false, error: 'Valget blev ikke gemt. Prøv igen.' })
    }
  }
  let projectsDone: Flags = {}
  if (kv) {
    try {
      projectsDone = parseFeatures(await kv.get(PROJECTS_KV_KEY))
    } catch (e) {
      console.warn(`KV get ${PROJECTS_KV_KEY} failed:`, e)
    }
  }
  return json(200, {
    success: true,
    editable,
    features: adminFeaturesList(flags, forced),
    projects: PROJECTS.filter((p) => !truthy(projectsDone[p.key])).map((p) => ({ ...p, parts: p.parts.map((x) => ({ ...x })) })),
  })
}
