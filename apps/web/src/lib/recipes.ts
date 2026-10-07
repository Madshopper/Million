// Opskrifter: port af app.py::get_recipes, _fetch_recipe_detail,
// _recipe_nutrition_estimate, _parse_nutrition_number og _alt_store_prices.
// Opskrift-rækkerne og prissnapshottet hentes fra Supabase (kun læsning);
// ingrediensernes produkter genhentes live fra D1, samme princip som kurven.
import { env } from 'cloudflare:workers'
import { d1Products } from './data'
import { nutritionCandidateKeys } from './nutrition'
import { markDataDegraded } from './request-state'
import { supabaseGet, tableSuffix } from './supabase'
import { STORE_CONFIGS, productToApiDict, productToDisplayDict } from './support'
import { isDict, pyFloatOr, pyInt, pyGet, pyOr, pyStr, pyStrip, pyTruthy } from './support/py'
import type { RawProduct } from './types'

/** app.py::_supabase_available - URL + nøgle sat. */
export function supabaseAvailable(): boolean {
  return !!(env.SUPABASE_URL && env.SUPABASE_KEY)
}

/** Python round(x, n). Et binært tal kan aldrig ligge præcis midt mellem to
 *  decimaler med 1-3 cifre (nævneren er ikke en potens af 2), så toFixed's
 *  "nærmeste" giver samme resultat som Pythons korrekt afrundede round(). */
export function pyRound(x: number, n: number): number {
  return Number(x.toFixed(n))
}

// --- /api/recipes -------------------------------------------------------------

/** Liste-svaret: [status, body]. 503 ved fejl, se app.py::get_recipes. */
export async function fetchRecipeList(): Promise<[number, { success: boolean; recipes: any[] }]> {
  const [rows, status] = await supabaseGet<any[]>('recipes', {
    select: 'id,title,image_url,servings,total_time_minutes,source_name,source_url',
    status: 'eq.approved',
    order: 'created_at.desc',
    limit: '200',
  })
  if (status !== 200 || !Array.isArray(rows)) {
    // 503, ikke 200-med-tom-liste: en forbigående Supabase-fejl må ikke
    // fryses fast i edge-cachen som "der findes ingen opskrifter".
    return [503, { success: false, recipes: [] }]
  }
  const [snaps, snapStatus] = await supabaseGet<any[]>('recipe_price_snapshot', {
    select: 'recipe_id,cheapest_total_price,matched_ingredient_count,total_ingredient_count,ingredients_on_sale_count',
  })
  const byRecipe = new Map<unknown, any>()
  if (snapStatus === 200 && Array.isArray(snaps)) for (const s of snaps) byRecipe.set(s.recipe_id, s)

  const result = rows.map((r) => {
    const snap = byRecipe.get(r.id) ?? {}
    const total = pyOr(pyGet(snap, 'total_ingredient_count'), 0) as number
    const onSale = pyOr(pyGet(snap, 'ingredients_on_sale_count'), 0) as number
    return {
      ...r,
      cheapest_total_price: pyGet(snap, 'cheapest_total_price'),
      matched_ingredient_count: pyGet(snap, 'matched_ingredient_count', 0),
      total_ingredient_count: total,
      ingredients_on_sale_count: onSale,
      sale_ratio: pyTruthy(total) ? pyRound(onSale / total, 3) : 0.0,
    }
  })
  // sort(key=sale_ratio, reverse=True) - stabil, ligesom Pythons.
  result.sort((a, b) => (b.sale_ratio > a.sale_ratio ? 1 : b.sale_ratio < a.sale_ratio ? -1 : 0))
  return [200, { success: true, recipes: result }]
}

// --- Næring -------------------------------------------------------------------

/** app.py::_parse_nutrition_number - bedste-forsøg-tal ud af "9,4 g",
 *  "< 0,5 g" eller "1.542 KJ / 366 kcal" (prefer_kcal tager kun kcal-delen). */
export function parseNutritionNumber(value: unknown, preferKcal = false): number | null {
  if (!pyTruthy(value)) return null
  let text = pyStr(value)
  if (preferKcal && text.includes('/')) {
    const kcalPart = text.split('/').find((p) => p.toLowerCase().includes('kcal'))
    if (kcalPart !== undefined) text = kcalPart
  }
  text = pyStrip(text.replaceAll('<', '').replaceAll('≤', '').replaceAll('~', ''))
  if (text.includes(',')) text = text.replaceAll('.', '').replaceAll(',', '.')
  const m = /\p{Nd}+(?:\.\p{Nd}+)?/u.exec(text)
  if (!m) return null
  return pyFloatOr(m[0], null)
}

const NUTRITION_UNIT_TO_GRAMS: Record<string, number> = { g: 1, kg: 1000, ml: 1, cl: 10, dl: 100, l: 1000 }

/** app.py::_recipe_nutrition_estimate - kun ingredienser med vægt-/volumen-
 *  enhed OG næringstal tæller med; contributing/total vises som forbehold. */
export function recipeNutritionEstimate(ingredients: any[]): Record<string, number> | null {
  const total: Record<string, number> = { kcal: 0.0, protein: 0.0, fedt: 0.0, kulhydrat: 0.0 }
  let contributing = 0
  for (const ing of ingredients) {
    const product = pyGet(ing, 'matched_product')
    const qty = pyGet(ing, 'quantity')
    const unit = pyOr(pyGet(ing, 'unit'), '') as string
    if (!pyTruthy(product) || qty === null || !Object.prototype.hasOwnProperty.call(NUTRITION_UNIT_TO_GRAMS, unit)) continue
    const numeric = pyGet(product, 'nutrition_numeric')
    if (!pyTruthy(numeric)) continue
    const factor = (qty * NUTRITION_UNIT_TO_GRAMS[unit]) / 100.0
    let contributed = false
    for (const field of Object.keys(total)) {
      const v = pyGet(numeric, field)
      if (v !== null) {
        total[field] += v * factor
        contributed = true
      }
    }
    if (contributed) contributing += 1
  }
  if (contributing === 0) return null
  return {
    kcal: pyRound(total.kcal, 1),
    protein: pyRound(total.protein, 1),
    fedt: pyRound(total.fedt, 1),
    kulhydrat: pyRound(total.kulhydrat, 1),
    contributing_ingredient_count: contributing,
    total_ingredient_count: ingredients.length,
  }
}

/** _fetch_recipe_detail._nutrition_numeric: energi/protein/fedt/kulhydrat som
 *  rene tal pr. 100 g/ml - kun til estimatet, vises aldrig direkte. */
function nutritionNumeric(nutrition: any): Record<string, number | null> | null {
  if (!pyTruthy(nutrition) || !pyTruthy(pyGet(nutrition, 'rows'))) return null
  let kcal: number | null = null
  let protein: number | null = null
  let fedt: number | null = null
  let kulhydrat: number | null = null
  for (const row of nutrition.rows) {
    const label = pyStrip(pyStrip(pyStr(pyGet(row, 'label', ''))).toLowerCase().replace(/^[- ]+/, ''))
    const value = pyStr(pyGet(row, 'value', ''))
    if (label === 'energi' && value.toLowerCase().includes('kcal')) kcal = parseNutritionNumber(value, true)
    else if (label === 'protein' && protein === null) protein = parseNutritionNumber(value)
    else if (label === 'fedt' && fedt === null) fedt = parseNutritionNumber(value)
    else if (label.startsWith('kulhydrat') && kulhydrat === null) kulhydrat = parseNutritionNumber(value)
  }
  if (kcal === null && protein === null && fedt === null && kulhydrat === null) return null
  return { kcal, protein, fedt, kulhydrat }
}

// --- Kurv-felter ----------------------------------------------------------------

/** app.py::_alt_price - positiv pris eller null. */
function altPrice(value: unknown): number | null {
  const price = pyFloatOr(pyOr(value, 0), null)
  return price !== null && price > 0 ? price : null
}

/** dict-nøgle som Pythons json.dumps skriver den (None -> "null"). */
const pyKey = (k: unknown): string => (k === null ? 'null' : typeof k === 'string' ? k : pyStr(k))

/** app.py::_alt_store_prices - alle butikkers effektive pris for et kort. */
export function altStorePrices(p: RawProduct): Record<string, number> {
  const prices: Record<string, number> = {}
  const base = altPrice(pyOr(pyGet(p, '/product/sale_price'), pyGet(p, '/product/price')))
  if (base) prices[pyKey(pyGet(p, '/product/store', 'Rema 1000'))] = base
  const rema = altPrice(pyGet(p, '/product/rema_price'))
  if (rema && !Object.prototype.hasOwnProperty.call(prices, 'Rema 1000')) prices['Rema 1000'] = rema
  const matches = pyOr(pyGet(p, '/product/store_matches'), {}) as Record<string, any>
  for (const [key, match] of Object.entries(matches)) {
    if (!Object.prototype.hasOwnProperty.call(STORE_CONFIGS, key)) continue
    const mp = altPrice(pyOr(pyGet(match, 'price'), pyGet(match, 'normal_price')))
    if (mp) prices[STORE_CONFIGS[key].label] = mp
  }
  return prices
}

// --- Detalje ----------------------------------------------------------------------

/** D1 tillader højst 100 bundne parametre pr. forespørgsel. */
const D1_MAX_PARAMS = 100

/** app.py::load_products_by_ids (D1-grenen), delt op så den aldrig rammer
 *  D1's parameterloft - en opskrift kan have 15+ ingredienser x 5 kandidater. */
async function loadProductsByIds(ids: unknown[]): Promise<RawProduct[]> {
  const clean = ids.map((i) => pyStr(i)).filter((s) => pyStrip(s) !== '')
  const out: RawProduct[] = []
  for (let i = 0; i < clean.length; i += D1_MAX_PARAMS) {
    const chunk = clean.slice(i, i + D1_MAX_PARAMS)
    out.push(...(await d1Products(`SELECT data FROM products WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk)))
  }
  return out
}

export interface RecipeDetail {
  recipe: Record<string, any> | null
  ingredients: any[]
  snapshot: Record<string, any> | null
}

/** app.py::_fetch_recipe_detail - kun godkendte opskrifter. recipe=null hvis
 *  den ikke findes. Kaster ved uventede fejl (kalderen svarer 503/500). */
export async function fetchRecipeDetail(recipeId: string | number): Promise<RecipeDetail> {
  const [rows, status] = await supabaseGet<any[]>('recipes', {
    select: 'id,title,image_url,servings,total_time_minutes,instructions,source_name,source_url,nutrition_source',
    id: `eq.${recipeId}`,
    status: 'eq.approved',
    limit: '1',
  })
  if (status !== 200 || !Array.isArray(rows) || !rows.length) return { recipe: null, ingredients: [], snapshot: null }
  const recipe = rows[0]

  const [[ingRows, ingStatus], [snapRows, snapStatus]] = await Promise.all([
    supabaseGet<any[]>('recipe_ingredients', {
      select: 'id,position,raw_text,quantity,unit,ingredient_name,matched_product_id,match_confidence,candidate_product_ids',
      recipe_id: `eq.${recipeId}`,
      order: 'position.asc',
    }),
    supabaseGet<any[]>('recipe_price_snapshot', { select: '*', recipe_id: `eq.${recipeId}`, limit: '1' }),
  ])
  const ingredients: any[] = ingStatus === 200 && Array.isArray(ingRows) ? ingRows : []
  const snapshot = snapStatus === 200 && Array.isArray(snapRows) && snapRows.length ? snapRows[0] : null
  // Afvigelse fra app.py (bevidst): et fejlet opslag giver samme tomme svar
  // som "ingen ingredienser/intet snapshot" og må derfor ikke i edge-cachen
  // (CLAUDE.md § degraderede svar). app.py markerer ikke disse fejlveje.
  if (ingStatus !== 200 || !Array.isArray(ingRows)) markDataDegraded('recipe_ingredients')
  if (snapStatus !== 200 || !Array.isArray(snapRows)) markDataDegraded('recipe_snapshot')

  // Union af matched_product_id + candidate_product_ids - ét opslag for det
  // hele, så personer-skalering på siden kan skifte til en anden kandidat.
  const allIds = new Set<unknown>()
  for (const i of ingredients) {
    if (pyTruthy(pyGet(i, 'matched_product_id'))) allIds.add(i.matched_product_id)
    for (const c of (pyOr(pyGet(i, 'candidate_product_ids'), []) as unknown[])) allIds.add(c)
  }
  const productsById = new Map<string, RawProduct>()
  for (const p of await loadProductsByIds([...allIds])) productsById.set(pyStr(pyGet(p, '/product/id')), p)

  // Næringsindhold pr. produkt - ét batched opslag (samme nøgle-prioritet
  // som /api/nutrition/<id>).
  const allKeys = new Set<string>()
  const keysByProductId = new Map<string, string[]>()
  for (const [pid, product] of productsById) {
    const keys = nutritionCandidateKeys(product)
    keysByProductId.set(pid, keys)
    for (const k of keys) allKeys.add(k)
  }
  const nutritionByKey = new Map<unknown, any>()
  if (allKeys.size) {
    const [nrows, nstatus] = await supabaseGet<any[]>('nutrition_data', { select: 'key,payload', key: `in.(${[...allKeys].join(',')})` })
    if (nstatus === 200 && Array.isArray(nrows)) for (const r of nrows) nutritionByKey.set(pyGet(r, 'key'), pyGet(r, 'payload'))
    else markDataDegraded('recipe_nutrition')
  }
  const nutritionFor = (pid: string) => {
    for (const key of keysByProductId.get(pid) ?? []) if (pyTruthy(nutritionByKey.get(key))) return nutritionByKey.get(key)
    return null
  }

  const lineItem = (pid: unknown, product: RawProduct) => {
    const isSale = pyGet(product, '/product/sale_price') !== null
    const display = productToDisplayDict(product)
    // Fulde kurv-felter (samme form som addToCart's kurv-vare), card til den
    // skjulte product_card-makro og api til appen - for BÅDE match og kandidater.
    return {
      id: pid,
      name: pyGet(product, '/product/title', ''),
      image: pyGet(product, '/product/imageLink', ''),
      price: isSale ? pyGet(product, '/product/sale_price') : pyGet(product, '/product/price'),
      is_sale: isSale,
      store: pyGet(product, '/product/store', ''),
      category: pyGet(product, '/product/product_type', 'Andre varer'),
      unit_measure: pyGet(product, '/product/unit_pricing_measure', ''),
      weight_g: pyGet(product, '/product/weight_g'),
      stk_count: pyGet(product, '/product/stk_count'),
      kg_price: pyGet(product, '/product/price_per_kg'),
      multi_deal: pyGet(product, '/product/multi_deal', ''),
      store_prices: altStorePrices(product),
      nutrition_numeric: nutritionNumeric(nutritionFor(pyStr(pid))),
      card: display,
      api: productToApiDict(display),
    }
  }

  for (const ing of ingredients) {
    const pid = pyGet(ing, 'matched_product_id')
    const product = pyTruthy(pid) ? productsById.get(pyStr(pid)) : undefined
    ing.matched_product = product ? lineItem(pid, product) : null
    const candidates = []
    for (const cid of (pyOr(pyGet(ing, 'candidate_product_ids'), []) as unknown[])) {
      const cproduct = productsById.get(pyStr(cid))
      if (cproduct) candidates.push(lineItem(cid, cproduct))
    }
    ing.candidates = candidates
  }

  // Kildens egen næringserklæring vinder altid; ellers et estimat (vises
  // altid med forbehold i UI'et).
  recipe.nutrition_estimate = pyTruthy(pyGet(recipe, 'nutrition_source')) ? null : recipeNutritionEstimate(ingredients)
  return { recipe, ingredients, snapshot }
}

// --- Werkzeug-ækvivalenter --------------------------------------------------------

/** <int:...>-konverteren: kun cifre (Pythons \d er Unicode-cifre), ingen
 *  fortegn. Returnerer str(int(segment)) - som streng, så store tal ikke
 *  mister præcision på vej til Supabase (f"eq.{int(recipe_id)}"). */
export function parseIntSegment(segment: string): string | null {
  if (!/^\p{Nd}+$/u.test(segment)) return null
  if (/^[0-9]+$/.test(segment)) return segment.replace(/^0+(?=[0-9])/, '')
  return String(pyInt(segment)) // ikke-ASCII-cifre (kun teoretisk)
}

const WERKZEUG_404 =
  '<!doctype html>\n<html lang=en>\n<title>404 Not Found</title>\n<h1>Not Found</h1>\n' +
  '<p>The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again.</p>\n'

/** Flasks standard-404 for en sti ingen regel matcher (fx /opskrift/abc). */
export function werkzeugNotFound(): Response {
  return new Response(WERKZEUG_404, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

const WERKZEUG_405 =
  '<!doctype html>\n<html lang=en>\n<title>405 Method Not Allowed</title>\n<h1>Method Not Allowed</h1>\n' +
  '<p>The method is not allowed for the requested URL.</p>\n'

/** Flasks standard-405 for en POST-only-regel (fx GET /api/recipe-click). */
export function werkzeugMethodNotAllowed(allow: string): Response {
  return new Response(WERKZEUG_405, { status: 405, headers: { 'Content-Type': 'text/html; charset=utf-8', Allow: allow } })
}

/** request.get_json(silent=True): kun JSON-mimetyper, null ved parse-fejl. */
export async function readJsonSilent(request: Request): Promise<unknown> {
  const mime = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
  if (mime !== 'application/json' && !(mime.startsWith('application/') && mime.endsWith('+json'))) return null
  try {
    return JSON.parse(await request.text())
  } catch {
    return null
  }
}

// --- /api/recipe-click ------------------------------------------------------------

export const RECIPE_CLICK_MAX_ID = 10_000_000_000 // bigint-loft, ren sanity-grænse

/** POST til record_recipe_click-RPC'en (eneste skrivevej, SECURITY DEFINER).
 *  `fetchImpl` kan erstattes i tests, så RPC'en aldrig kaldes for alvor. */
export async function recordRecipeClick(recipeId: number, fetchImpl: typeof fetch = fetch): Promise<number> {
  const base = (env.SUPABASE_URL || '').replace(/\/$/, '')
  const key = env.SUPABASE_KEY || ''
  if (!base || !key) return 0
  try {
    const res = await fetchImpl(`${base}/rest/v1/rpc/record_recipe_click${tableSuffix()}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_recipe_id: recipeId }),
    })
    await res.text().catch(() => '')
    return res.status
  } catch (e) {
    console.warn('Supabase RPC record_recipe_click fejlede', e)
    return 0
  }
}

/** Flask int(payload.get('recipe_id', 0)) + grænsetjek. null = 400. */
export function parseRecipeClickId(payload: unknown): number | null {
  if (!isDict(payload)) return null
  let id: number
  try {
    const v = pyGet(payload, 'recipe_id', 0)
    if (typeof v === 'boolean') id = v ? 1 : 0
    else if (typeof v === 'number') {
      if (!Number.isFinite(v)) return null
      id = Math.trunc(v)
    } else if (typeof v === 'string') {
      const s = pyStrip(v)
      if (!/^[+-]?\d+(_\d+)*$/.test(s)) return null
      id = Number(s.replace(/_/g, ''))
    } else return null
  } catch {
    return null
  }
  if (id <= 0 || id > RECIPE_CLICK_MAX_ID) return null
  return id
}
