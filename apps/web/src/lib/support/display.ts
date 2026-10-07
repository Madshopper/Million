// Port af visningslaget i app_support.py: display-/API-dicts, tilbudsdato
// og forfremmelse af kortet til den billigste valgte butik.
import type { ActiveStores, DisplayProduct, RawProduct } from '../types'
import {
  CAT_ANDET,
  STORE_CONFIGS,
  getSubcategory,
  isLactoseFree,
  isOrganic,
  parseStkCount,
  parseWeightToGrams,
  storeLabel,
  unifyCategory,
} from './catalog'
import { isDict, pyFloat, pyFloatOr, pyGet, pyOr, pyStr, pyStrip, pyTruthy } from './py'

// ── parse_sale_end_date ─────────────────────────────────────────────────────
// datetime.strptime(s, '%Y-%m-%dT%H:%M:%S%z') som CPython 3.13's _strptime:
// 1-cifrede måned/dag/time/min/sek accepteres, 'T' er case-insensitiv, 'Z'
// er ikke. Ingen tidszonekonvertering - datoen bevares i den givne offset.
const STRPTIME_RE =
  /^(\d{4})-(1[0-2]|0[1-9]|[1-9])-(3[01]|[12]\d|0[1-9]|[1-9]| [1-9])[Tt](2[0-3]|[0-1]\d|\d):([0-5]\d|\d):(6[0-1]|[0-5]\d|\d)(?:([+-])(\d\d)(:?)([0-5]\d)(?:(:?)([0-5]\d)(?:\.\d{1,6})?)?|Z)$/

function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28
  return [4, 6, 9, 11].includes(m) ? 30 : 31
}

export function parseSaleEndDate(product: RawProduct): string | null {
  const saleDates = pyStr(pyGet(product, '/product/sale_price_effective_date', '')).split('/')
  if (saleDates.length <= 1) return null
  const m = STRPTIME_RE.exec(pyStrip(saleDates[1]))
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3].trim())
  const sec = Number(m[6])
  if (y < 1 || d > daysInMonth(y, mo) || sec > 59) return null
  if (m[7]) {
    // timezone() kræver |offset| < 24 timer.
    if (Number(m[8]) >= 24) return null
    // "Inconsistent use of :" - kolon skal bruges ens før minutter og sekunder.
    if (m[11] !== undefined && m[9] !== m[11]) return null
  }
  return `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}`
}

// ── clean_display_text ──────────────────────────────────────────────────────
const JUNK_TEXT_VALUES = new Set(['none', 'nan', 'null', 'undefined', 'nat', '<na>'])

/** clean_display_text: 'None'/'nan'/... bliver til ''. */
export function cleanDisplayText(value: unknown): string {
  const text = pyStrip(pyStr(value !== null && value !== undefined ? value : ''))
  return JUNK_TEXT_VALUES.has(text.toLowerCase()) ? '' : text
}

// ── product_to_display_dict ─────────────────────────────────────────────────
export interface DisplayOptions {
  category?: string | null
  saleEndDate?: string | null
  defaultCategory?: string
  forceSale?: boolean
}

export function productToDisplayDict(product: RawProduct, opts: DisplayOptions = {}): DisplayProduct {
  const { category = null, saleEndDate = null, defaultCategory = 'Andre varer', forceSale = false } = opts
  const g = (k: string, d: any = null) => pyGet(product, k, d)
  const salePrice = g('/product/sale_price')
  const ptype = pyOr(pyOr(category, g('/product/product_type')), defaultCategory)
  const nameStr = pyStr(g('/product/title', 'Ukendt vare'))
  const unitMeasure = pyStr(pyOr(g('/product/unit_pricing_measure', ''), ''))
  const isSale = forceSale || salePrice !== null
  let weightG = parseWeightToGrams(unitMeasure)
  if (weightG === null) weightG = pyFloatOr(g('/product/weight_g'), null)
  const result: DisplayProduct = {
    id: pyStr(g('/product/id', '')),
    name: nameStr,
    price: pyFloat(g('/product/price', 0)),
    sale_price: salePrice !== null ? pyFloat(salePrice) : null,
    description: cleanDisplayText(g('/product/description', '')),
    category: pyStr(ptype),
    brand: cleanDisplayText(g('/product/brand', '')),
    image_url: pyStr(g('/product/imageLink', '')),
    rema_image: g('/product/rema_image', ''),
    is_sale: isSale,
    is_any_sale: g('/product/is_any_sale', false),
    sale_end_date: saleEndDate !== null ? saleEndDate : parseSaleEndDate(product),
    store: pyStr(g('/product/store', 'Rema 1000')),
    unit_measure: unitMeasure,
    weight_g: weightG,
    stk_count: pyOr(g('/product/stk_count'), parseStkCount(unitMeasure)),
    price_per_kg: g('/product/price_per_kg'),
    store_matches: g('/product/store_matches', {}),
    cheaper_at: g('/product/cheaper_at'),
    cheapest_at: g('/product/cheapest_at'),
    rema_price: g('/product/rema_price'),
    rema_is_sale: g('/product/rema_is_sale'),
    multi_deal: g('/product/multi_deal', ''),
    lowest_price_30d: g('/product/lowest_price_30d'),
    subcategory: pyOr(g('/product/subcategory'), getSubcategory(nameStr, pyStr(ptype))),
    is_organic:
      '/product/is_organic' in product
        ? product['/product/is_organic']
        : isOrganic(nameStr, pyStr(g('/product/description', '')), pyStr(g('/product/brand', ''))),
    is_lactose_free:
      '/product/is_lactose_free' in product
        ? product['/product/is_lactose_free']
        : isLactoseFree(nameStr, pyStr(g('/product/description', '')), pyStr(g('/product/brand', ''))),
  }
  if ('/product/flavor_kw' in product) result._flavor_field = product['/product/flavor_kw'] || ''
  if (!isSale) result.sale_end_date = saleEndDate
  return result
}

// ── API-dicts ───────────────────────────────────────────────────────────────
export interface ApiStoreMatch {
  name: string
  price: number | null
  normal_price: number | null
  is_sale: boolean
  image: string
  brand: string
  description: string
  weight: string
  kg_price: number | null
  multi_deal: string
  ean: string
  Kategori: string
}

/** _serialize_store_match */
export function serializeStoreMatch(match: unknown): ApiStoreMatch | Record<string, never> {
  if (!isDict(match)) return {}
  const g = (k: string) => pyGet(match, k, null)
  const kg = g('kg_price')
  const kgPrice = kg !== null && kg !== '' ? pyFloatOr(kg, null) : null
  const price = g('price')
  const normal = g('normal_price')
  return {
    name: pyStr(pyOr(g('name'), '')),
    price: price !== null ? pyFloatOr(price, null) : null,
    normal_price: normal !== null ? pyFloatOr(normal, null) : null,
    is_sale: pyTruthy(g('is_sale')),
    image: pyStr(pyOr(g('image'), '')),
    brand: cleanDisplayText(g('brand')),
    description: cleanDisplayText(g('description')),
    weight: cleanDisplayText(g('weight')),
    kg_price: kgPrice,
    multi_deal: pyStr(pyOr(g('multi_deal'), '')),
    ean: pyStr(pyOr(g('ean'), '')),
    Kategori: pyStr(pyOr(g('Kategori'), '')),
  }
}

export interface ApiProduct {
  id: string
  name: string
  brand: string
  description: string
  image: string
  main_image: string
  rema_image: string
  category: string
  subcategory: string
  store: string
  price: number
  normal_price: number
  is_sale: boolean
  is_any_sale: boolean
  sale_end_date: string | null
  unit_measure: string
  weight_g: number | null
  stk_count: number | null
  kg_price: number | null
  multi_deal: string
  is_organic: boolean
  is_lactose_free: boolean
  has_match: boolean
  has_match_rema: boolean
  cheapest_at: any
  cheaper_at: any
  rema_price: number | null
  rema_is_sale: boolean
  lowest_price_30d: any
  store_matches: Record<string, ApiStoreMatch | Record<string, never>>
}

/** product_to_api_dict: native listing-JSON fra en display-dict. */
export function productToApiDict(display: Record<string, any>): ApiProduct {
  const g = (k: string) => pyGet(display, k, null)
  const isSale = pyTruthy(g('is_sale'))
  const listPrice = g('price')
  const salePrice = g('sale_price')
  const normalPrice = listPrice !== null ? pyFloatOr(listPrice, 0.0) : 0.0
  let price = normalPrice
  if (isSale && salePrice !== null) price = pyFloatOr(salePrice, normalPrice)

  const remRaw = g('rema_price')
  const remPrice = remRaw !== null && remRaw !== '' ? pyFloatOr(remRaw, 0.0) : 0.0

  let smRaw = pyOr(g('store_matches'), {})
  if (!isDict(smRaw)) smRaw = {}
  const storeMatches: Record<string, ApiStoreMatch | Record<string, never>> = {}
  for (const [key, match] of Object.entries(smRaw as Record<string, any>)) {
    if (isDict(match)) storeMatches[pyStr(key)] = serializeStoreMatch(match)
  }

  const image = pyStr(pyOr(g('image_url'), ''))
  const kg = g('price_per_kg')
  const kgPrice = kg !== null && kg !== '' ? pyFloatOr(kg, null) : null

  return {
    id: pyStr(pyOr(g('id'), '')),
    name: pyStr(pyOr(g('name'), '')),
    brand: cleanDisplayText(g('brand')),
    description: cleanDisplayText(g('description')),
    image,
    main_image: image,
    rema_image: pyStr(pyOr(g('rema_image'), '')),
    category: pyStr(pyOr(g('category'), 'Andre varer')),
    subcategory: pyStr(pyOr(g('subcategory'), '')),
    store: pyStr(pyOr(g('store'), 'Rema 1000')),
    price,
    normal_price: normalPrice,
    is_sale: isSale,
    is_any_sale: pyTruthy(g('is_any_sale')),
    sale_end_date: g('sale_end_date'),
    unit_measure: pyStr(pyOr(g('unit_measure'), '')),
    weight_g: g('weight_g'),
    stk_count: g('stk_count'),
    kg_price: kgPrice,
    multi_deal: pyStr(pyOr(g('multi_deal'), '')),
    is_organic: pyTruthy(g('is_organic')),
    is_lactose_free: pyTruthy(g('is_lactose_free')),
    has_match: Object.keys(storeMatches).length > 0 || remPrice > 0,
    has_match_rema: remPrice > 0,
    cheapest_at: pyOr(g('cheapest_at'), null),
    cheaper_at: pyOr(g('cheaper_at'), null),
    rema_price: remPrice > 0 ? remPrice : null,
    rema_is_sale: pyTruthy(g('rema_is_sale')),
    lowest_price_30d: g('lowest_price_30d'),
    store_matches: storeMatches,
  }
}

/** products_to_api_list */
export function productsToApiList(products: Array<Record<string, any>>): ApiProduct[] {
  return products.map(productToApiDict)
}

// ── Aktive butikker ─────────────────────────────────────────────────────────
function matchKeys(product: RawProduct): string[] {
  const sm = pyOr(pyGet(product, '/product/store_matches'), {})
  if (Array.isArray(sm)) return sm.map((x) => pyStr(x))
  return isDict(sm) ? Object.keys(sm) : []
}

/** product_available_at_active_stores */
export function productAvailableAtActiveStores(product: RawProduct, activeStores: ActiveStores): boolean {
  if (activeStores === null) return true
  if (activeStores.size === 0) return false
  const displayStore = pyGet(product, '/product/store', 'Rema 1000')
  if (activeStores.has(displayStore)) return true
  if (activeStores.has('Rema 1000') && pyTruthy(pyGet(product, '/product/rema_price'))) return true
  for (const key of matchKeys(product)) {
    const label = storeLabel(key)
    if (label !== null && activeStores.has(label)) return true
  }
  return false
}

/** _promote_match_to_product */
export function promoteMatchToProduct(product: RawProduct, storeKey: string, match: Record<string, any>): RawProduct {
  const out: RawProduct = { ...product }
  const mg = (k: string, d: any = null) => pyGet(match, k, d)
  if (!('name' in match)) throw new Error("KeyError: 'name'")
  out['/product/title'] = match.name
  out['/product/store'] = STORE_CONFIGS[storeKey].label
  // Begge grene læser match['price'] (KeyError hvis den mangler).
  if (!('price' in match)) throw new Error("KeyError: 'price'")
  if (pyTruthy(mg('is_sale'))) {
    out['/product/price'] = pyOr(mg('normal_price'), match.price)
    out['/product/sale_price'] = match.price
  } else {
    out['/product/price'] = match.price
    out['/product/sale_price'] = null
  }
  if (pyTruthy(mg('image')) && pyStr(match.image).toLowerCase() !== 'nan') out['/product/imageLink'] = match.image
  out['/product/brand'] = pyOr(mg('brand'), '')
  out['/product/description'] = pyOr(mg('description'), '')
  out['/product/unit_pricing_measure'] = pyOr(mg('weight'), pyGet(out, '/product/unit_pricing_measure'))
  out['/product/price_per_kg'] = mg('kg_price')
  out['/product/multi_deal'] = mg('multi_deal', '')
  out['/product/cheapest_at'] = storeKey
  const newType = unifyCategory(mg('Kategori', ''), match.name, mg('brand', ''))
  if (newType && newType !== CAT_ANDET) out['/product/product_type'] = newType
  return out
}

/** _promote_rema_to_product: vis kortet som Rema-varen (effektiv pris, intet SPAR). */
export function promoteRemaToProduct(product: RawProduct, remaPrice: number): RawProduct {
  const out: RawProduct = { ...product }
  out['/product/store'] = 'Rema 1000'
  out['/product/price'] = remaPrice
  out['/product/sale_price'] = null
  out['/product/multi_deal'] = ''
  const remaImg = pyStrip(pyStr(pyOr(pyGet(product, '/product/rema_image'), '')))
  if (remaImg && remaImg.toLowerCase() !== 'nan') out['/product/imageLink'] = remaImg
  out['/product/cheapest_at'] = 'rema'
  return out
}

/** product_for_active_stores: kortet vist hos den billigste VALGTE butik, eller null. */
export function productForActiveStores(product: RawProduct, activeStores: ActiveStores): RawProduct | null {
  if (!productAvailableAtActiveStores(product, activeStores)) return null
  if (activeStores === null) return product
  const displayStore = pyGet(product, '/product/store', 'Rema 1000')
  if (activeStores.has(displayStore)) return product
  const matches = pyOr(pyGet(product, '/product/store_matches'), {}) as Record<string, any>
  let bestKey: string | null = null
  let bestPrice: number | null = null
  if (activeStores.has('Rema 1000')) {
    const remaPrice = pyFloatOr(pyOr(pyGet(product, '/product/rema_price'), 0), 0)
    if (remaPrice > 0) {
      bestKey = 'rema'
      bestPrice = remaPrice
    }
  }
  for (const [key, match] of Object.entries(matches)) {
    const label = storeLabel(key)
    if (label === null || !activeStores.has(label)) continue
    let price: number
    try {
      price = pyFloat(pyGet(match, 'price', 0))
    } catch (e) {
      if (e instanceof TypeError && !isDict(match)) throw e
      continue
    }
    if (price <= 0) continue
    if (bestPrice === null || price < bestPrice) {
      bestPrice = price
      bestKey = key
    }
  }
  if (bestKey === 'rema') return promoteRemaToProduct(product, bestPrice!)
  if (bestKey) return promoteMatchToProduct(product, bestKey, matches[bestKey])
  return null
}
