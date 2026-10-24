// Erstatningsvarer (POST /api/alternatives) - port af app.py::_find_alternative,
// _alt_candidate_pool, _alt_store_price(s), _alt_price, _alt_weight_range og de
// støttefunktioner fra app_support.py, som resten af porten ikke havde brug for
// (fuzzy_score, weights_compatible, kødtype-gaten, product_content_words,
// variant_flags). Ren: D1-opslaget injiceres, så logikken kan testes.
//
// En erstatningsvare skal ligne originalen MINDRE end to kort, updater.py
// lægger sammen - det er pointen at det er en anden vare. Gaterne er derfor
// løsere på vægt og navn end matchingen, men hårde på det der gør et forslag
// decideret forkert: variant, kødtype og prisens størrelsesorden.
import { pyFormat2f } from '~/components/jinja'
import { STORE_CONFIGS, getSubcategory, isLactoseFree, isOrganic, parseWeightToGrams } from './support/catalog'
import { B_END, B_START, D, W, cpCompare, cpLen, isDict, pyFloat, pyOr, pySplit, pyStr, pyStrip, pyTruthy, reEscape } from './support/py'
import { normalizeName, rapidRatio, rapidTokenSort } from './support/text'
import type { RawProduct } from './types'

export const ALT_MIN_SIM = 0.35 // under dette er navnene ikke i familie
export const ALT_STRONG_SIM = 0.75 // så tæt at fælles indholdsord ikke kræves
export const ALT_NEAR_SIM = 0.12 // "lige så godt forslag" -> vælg det billigste
export const ALT_WEIGHT_REL = 0.25 // størrelsesforskel; matchingen bruger 8%
export const ALT_PRICE_MAX = 2.0 // højst det dobbelte af originalens pris
export const ALT_PRICE_MIN = 0.4 // og ikke under 40%
export const ALT_MAX_ITEMS = 30 // manglende varer pr. kald
export const ALT_POOL_LIMIT = 600 // kandidater pr. (kategori, underkategori, butik)

// ── Støttefunktioner fra app_support.py ─────────────────────────────────────

/** Python's \b uden antagelse om nabotegnet. */
const B_ANY = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`

/** app_support.py::fuzzy_score */
export function fuzzyScore(a: string, b: string): number {
  if (!a || !b) return 0.0
  if (a === b) return 1.0
  const la = cpLen(a)
  const lb = cpLen(b)
  if ((2.0 * Math.min(la, lb)) / (la + lb) < 0.35) {
    // Det korteste navn som helt ord inde i det længste må stadig scores.
    const [shorter, longer] = la <= lb ? [a, b] : [b, a]
    if (!new RegExp(B_ANY + reEscape(shorter) + B_ANY, 'u').test(longer)) return 0.0
  }
  return Math.max(rapidRatio(a, b), rapidTokenSort(a, b)) / 100.0
}

/** app_support.py::weights_compatible (her altid med eksplicit tolerance). */
export function weightsCompatible(wA: number | null, wB: number | null, tolerance: number): boolean {
  if (wA === null || wB === null) return true
  return Math.abs(wA - wB) <= tolerance
}

const SUGAR_FREE_RE = new RegExp(
  `sukkerfri|sugar[- ]free|sukker fri|zero sugar|${B_START}zero${B_END}|no sugar|uden sukker|${B_START}nul suk|0% sugar`, 'u')
const GLUTEN_FREE_RE = /glutenfri|gluten[- ]free|gluten fri|uden gluten/u
const ALCOHOL_FREE_RE = new RegExp(
  `alkoholfri|alkohol fri|alcohol[- ]free|${B_START}nul ?%|${B_START}0[,.]0 ?%`, 'u')

export const isSugarFree = (name: string) => SUGAR_FREE_RE.test(name.toLowerCase())
export const isGlutenFree = (name: string) => GLUTEN_FREE_RE.test(name.toLowerCase())
export const isAlcoholFree = (name: string) => ALCOHOL_FREE_RE.test(name.toLowerCase())

/** app_support.py::variant_flags - (øko, laktosefri, sukkerfri, glutenfri, alkoholfri). */
export function variantFlags(name: string): boolean[] {
  // Python bygger f"{name} {desc} {brand}" med tomme desc/brand.
  const text = `${name}  `
  return [isOrganic(name), isLactoseFree(name), isSugarFree(text), isGlutenFree(text), isAlcoholFree(text)]
}

const MEAT_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['okse', new RegExp(`${B_START}okse`, 'u')],
  ['gris', new RegExp(`${B_START}gris${B_END}|${B_START}grise|${B_START}svin${B_END}|${B_START}svine`, 'u')],
  ['kylling', new RegExp(`${B_START}kylling`, 'u')],
  ['høns', new RegExp(`${B_START}høns`, 'u')],
  ['kalv', new RegExp(`${B_START}kalv${B_END}|${B_START}kalve`, 'u')],
  ['lam', new RegExp(`${B_START}lam${B_END}|${B_START}lamme(?!fjord)`, 'u')],
  ['skinke', new RegExp(`${B_START}skinke`, 'u')],
  ['kalkun', new RegExp(`${B_START}kalkun`, 'u')],
  ['tun', new RegExp(`${B_START}tun${B_END}|${B_START}tunfisk`, 'u')],
  ['laks', new RegExp(`${B_START}laks`, 'u')],
]

/** app_support.py::get_meat_types - kanoniske kødtyper i den normaliserede tekst. */
export function getMeatTypes(text: unknown): Set<string> {
  const norm = normalizeName(text)
  return new Set(MEAT_PATTERNS.filter(([, rx]) => rx.test(norm)).map(([name]) => name))
}

const setEq = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x))

/** app_support.py::meats_match - kun aktiv når BEGGE sider nævner kød. */
export function meatsMatch(base: Set<string>, cand: Set<string>): boolean {
  return !base.size || !cand.size || setEq(base, cand)
}

const UNIT_WORDS = new Set(['g', 'kg', 'l', 'ml', 'cl', 'dl', 'stk', 'pak', 'ltr', 'pcs'])
const GENERIC_WORDS = new Set([
  'med', 'uden', 'fedt', 'pakke', 'store', 'stor', 'lille', 'frisk', 'friske',
  'dansk', 'danske', 'style', 'type', 'blandet', 'blandede', 'klassisk',
  'original', 'mini', 'skind', 'skiver', 'skaret', 'snittet', 'tern',
  'stykker', 'hele', 'halve', 'fyldte', 'fyldt', 'flere', 'varianter',
  'sorter', 'assorteret', 'økologisk', 'okologisk', 'eller',
  'classic', 'classics', 'special', 'premium', 'family', 'selection',
])
const LEADING_DIGIT_RE = new RegExp(`^${D}`, 'u')

/** app_support.py::product_content_words - ord der siger hvad varen ER. */
export function productContentWords(name: unknown): Set<string> {
  return new Set(
    pySplit(normalizeName(name)).filter(
      (w) => cpLen(w) >= 4 && !LEADING_DIGIT_RE.test(w) && !UNIT_WORDS.has(w) && !GENERIC_WORDS.has(w),
    ),
  )
}

// ── app.py ──────────────────────────────────────────────────────────────────

/** dict.get(k, d) på et produkt. */
function g(p: RawProduct, k: string, d: unknown = null): any {
  return Object.prototype.hasOwnProperty.call(p, k) ? (p as any)[k] : d
}

/** app.py::_alt_weight_range - præcis samme interval som vægt-gaten. */
export function altWeightRange(weightG: number | null): [number | null, number | null] {
  if (!weightG) return [null, null]
  return [weightG * (1 - ALT_WEIGHT_REL), weightG / (1 - ALT_WEIGHT_REL)]
}

/** app.py::_alt_price - positivt tal, ellers null. */
export function altPrice(value: unknown): number | null {
  let price: number
  try {
    price = pyFloat(pyOr(value, 0))
  } catch {
    return null
  }
  return price > 0 ? price : null
}

function storeMatches(p: RawProduct): Array<[string, any]> {
  const sm = pyOr(g(p, '/product/store_matches'), {})
  return isDict(sm) ? Object.entries(sm) : []
}

/** app.py::_alt_store_price - (pris, navn, billede) set fra én butik. Prisen
 * er altid butikkens EFFEKTIVE pris, aldrig førprisen. */
export function altStorePrice(p: RawProduct, storeLabel: string): [unknown, unknown, unknown] {
  const name = g(p, '/product/title', '')
  let image = g(p, '/product/imageLink', '')
  if (g(p, '/product/store', 'Rema 1000') === storeLabel) {
    return [pyOr(g(p, '/product/sale_price'), g(p, '/product/price')), name, image]
  }
  for (const [matchKey, m] of storeMatches(p)) {
    const cfg = Object.prototype.hasOwnProperty.call(STORE_CONFIGS, matchKey) ? STORE_CONFIGS[matchKey] : null
    if (cfg && cfg.label === storeLabel) {
      const mImage = m?.image ?? null
      if (pyTruthy(mImage) && !['nan', 'none'].includes(pyStr(mImage).toLowerCase())) image = mImage
      return [pyOr(m?.price ?? null, m?.normal_price ?? null), pyOr(m?.name ?? null, name), image]
    }
  }
  // Kort promoveret til en anden butiks visning beholder Rema-prisen her.
  if (storeLabel === 'Rema 1000') {
    return [g(p, '/product/rema_price'), name, pyOr(g(p, '/product/rema_image'), image)]
  }
  return [null, name, image]
}

/** app.py::_alt_store_prices - alle butikkers effektive pris for et kort. */
export function altStorePrices(p: RawProduct): Record<string, number> {
  const prices: Record<string, number> = {}
  const base = altPrice(pyOr(g(p, '/product/sale_price'), g(p, '/product/price')))
  if (base) prices[pyStr(g(p, '/product/store', 'Rema 1000'))] = base
  const rema = altPrice(g(p, '/product/rema_price'))
  if (rema && !Object.prototype.hasOwnProperty.call(prices, 'Rema 1000')) prices['Rema 1000'] = rema
  for (const [matchKey, m] of storeMatches(p)) {
    const cfg = Object.prototype.hasOwnProperty.call(STORE_CONFIGS, matchKey) ? STORE_CONFIGS[matchKey] : null
    if (!cfg) continue
    const mp = altPrice(pyOr(m?.price ?? null, m?.normal_price ?? null))
    if (mp) prices[cfg.label] = mp
  }
  return prices
}

const escapeLike = (t: string) => t.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')

export type D1ProductsFn = (sql: string, params: unknown[]) => Promise<RawProduct[]>

/** app.py::_alt_candidate_pool (D1-vejen): alle grove filtre i SQL, så en
 * request aldrig henter en hel kategori hjem. Memoiseret pr. kald på
 * præcis de parametre forespørgslen bygges af. */
export async function altCandidatePool(
  category: string, subcategory: string, storeLabel: string, words: Set<string>,
  weightG: number | null, cache: Map<string, RawProduct[]>, d1Products: D1ProductsFn,
): Promise<RawProduct[]> {
  const [lo, hi] = altWeightRange(weightG)
  const terms = [...words].sort(cpCompare).slice(0, 6)
  const cacheKey = JSON.stringify([category, subcategory, storeLabel, lo, hi, terms])
  const cached = cache.get(cacheKey)
  if (cached) return cached
  let sql = 'SELECT data FROM products WHERE category = ? AND subcategory = ? AND stores LIKE ?'
  const params: unknown[] = [category, subcategory, `%|${storeLabel}|%`]
  if (lo !== null) {
    // NULL bevares: mangler vægten, er den ikke en modsigelse.
    sql += ' AND (weight_g IS NULL OR (weight_g >= ? AND weight_g <= ?))'
    params.push(lo, hi)
  }
  if (terms.length) {
    sql += ' AND (' + terms.map(() => "search_text LIKE ? ESCAPE '\\'").join(' OR ') + ')'
    params.push(...terms.map((t) => `%${escapeLike(t)}%`))
  }
  const pool = await d1Products(sql + ` ORDER BY eff_price ASC LIMIT ${ALT_POOL_LIMIT}`, params)
  cache.set(cacheKey, pool)
  return pool
}

/** Python ville kaste TypeError (unhashable) på en liste/dict som nøgle -
 * den brede except i ruten gør det til 500. Samme her. */
function hashable(v: unknown, what: string): void {
  if (v !== null && typeof v === 'object') throw new TypeError(`unhashable type in ${what}`)
}

const arrEq = (a: boolean[], b: boolean[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** app.py::_find_alternative - bedste erstatning for én manglende vare i én butik. */
export async function findAlternative(
  reqItem: Record<string, any>, poolCache: Map<string, RawProduct[]>, d1Products: D1ProductsFn,
): Promise<Record<string, unknown> | null> {
  const get = (k: string, d: unknown = null) => (Object.prototype.hasOwnProperty.call(reqItem, k) ? reqItem[k] : d)
  const cartId = get('cart_id')
  const storeLabel = get('store')
  const category = get('category')
  const name = pyStr(pyOr(get('name'), ''))
  // Uden kategori/navn er der intet at afgrænse eller sammenligne på.
  if (!(pyTruthy(cartId) && pyTruthy(storeLabel) && pyTruthy(category) && name)) return null
  hashable(category, 'category')

  const weightG = parseWeightToGrams(get('weight_str', ''))
  // float(price or 0) or None - NaN er truthy i Python og overlever derfor.
  let refPrice: number | null
  try {
    const v = pyFloat(pyOr(get('price'), 0))
    refPrice = v !== 0 ? v : null
  } catch {
    refPrice = null
  }
  // Kurv-id'er bærer et 'product'-præfiks; produkt-id'erne i cachen gør ikke.
  let excludeId = pyStrip(pyStr(pyOr(get('product_id'), '')))
  if (excludeId.startsWith('product')) excludeId = excludeId.slice('product'.length)

  // Ikke-strenge kategorier findes ikke i _SUBCATEGORY_RULES -> ''.
  const categoryStr = typeof category === 'string' ? category : null
  const subcategory = categoryStr !== null ? getSubcategory(name, categoryStr) : ''
  const normOrig = normalizeName(name)
  const origWords = productContentWords(name)
  const origFlags = variantFlags(name)
  const origMeats = getMeatTypes(name)
  hashable(storeLabel, 'store')
  const storeStr = pyStr(storeLabel)

  const candidates: Array<[number, number, RawProduct, unknown, unknown]> = []
  const pool = await altCandidatePool(
    categoryStr ?? pyStr(category), subcategory, storeStr, origWords, weightG, poolCache, d1Products,
  )
  for (const p of pool) {
    if (excludeId && pyStr(g(p, '/product/id', '')) === excludeId) continue

    // Billigste gates først - navne-normaliseringen er det dyre led.
    const [rawPrice, candName, candImage] = altStorePrice(p, storeStr)
    const price = altPrice(rawPrice)
    if (price === null) continue
    if (refPrice !== null && !(refPrice * ALT_PRICE_MIN <= price && price <= refPrice * ALT_PRICE_MAX)) continue

    const candWeight = pyOr(parseWeightToGrams(g(p, '/product/unit_pricing_measure', '')), g(p, '/product/weight_g'))
    if (weightG && pyTruthy(candWeight)) {
      const cw = Number(candWeight)
      if (!weightsCompatible(weightG, cw, ALT_WEIGHT_REL * Math.max(weightG, cw))) continue
    }

    // Underkategorien afgøres på grundtitlen - samme felt som D1-kolonnen.
    if (categoryStr === null || getSubcategory(pyStr(g(p, '/product/title', '')), categoryStr) !== subcategory) continue

    // Resten vurderes på butikkens EGET varenavn.
    const sim = fuzzyScore(normOrig, normalizeName(candName))
    if (sim < ALT_MIN_SIM) continue
    if (origWords.size) {
      const candWords = productContentWords(candName)
      const brandWords = productContentWords(g(p, '/product/brand', ''))
      if (![...origWords].some((w) => candWords.has(w) && !brandWords.has(w))) continue
    } else if (sim < ALT_STRONG_SIM) {
      continue
    }
    const candText = `${pyStr(g(p, '/product/title', ''))} ${pyStr(candName)} ${pyStr(g(p, '/product/brand', ''))}`
    if (!arrEq(variantFlags(candText), origFlags)) continue
    if (!meatsMatch(origMeats, getMeatTypes(candText))) continue

    candidates.push([sim, price, p, candName, candImage])
  }

  if (!candidates.length) return null

  // Blandt lige gode forslag er det billigste det mest brugbare.
  const topSim = Math.max(...candidates.map((c) => c[0]))
  let best: (typeof candidates)[number] | null = null
  for (const c of candidates) {
    if (!(c[0] >= topSim - ALT_NEAR_SIM)) continue
    if (!best || c[1] < best[1] || (c[1] === best[1] && -c[0] < -best[0])) best = c
  }
  const [, price, p, candName, candImage] = best!
  const kg = g(p, '/product/price_per_kg')
  return {
    cart_id: cartId,
    store: storeLabel,
    alt_id: pyStr(g(p, '/product/id', '')),
    alt_name: candName,
    alt_price: price,
    alt_image: candImage,
    alt_storePrices: altStorePrices(p),
    alt_category: g(p, '/product/product_type', ''),
    alt_unitMeasure: g(p, '/product/unit_pricing_measure', ''),
    // Bevidst uden "kr/kg" - webben tilføjer selv enheden.
    alt_kgPrice: typeof kg === 'number' || typeof kg === 'boolean' ? pyFormat2f(Number(kg)) : '',
    alt_store: g(p, '/product/store', 'Rema 1000'),
  }
}
