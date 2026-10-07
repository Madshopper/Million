// Port af rene hjælpere fra app.py: søgetekst-rensning, øko-intention,
// butiks-/produktfiltre, sortering og paginering + kategori-konstanter.
import type { ActiveStores, Args, RawProduct } from '../types'
import {
  CAT_BROED_KAGER,
  CAT_DRIKKEVARER,
  CAT_FROST,
  CAT_FRUGT_GROENT,
  CAT_KOED_FISK,
  CAT_KOLONIAL,
  CAT_MEJERI,
  CAT_SLIK,
  PLACEHOLDER_IMGS,
  isAgeRestricted,
  isLactoseFree,
  isNonFoodName,
  isOrganic,
  isRemaTobaccoId,
} from './catalog'
import { productAvailableAtActiveStores } from './display'
import { B_END, B_START, D, cpCompare, cpSlice, pyFloat, pyGet, pyOr, pySorted, pySplit, pyStr, pyStrip, pyTruthy } from './py'

/** _PUBLIC_CATEGORY_PATHS */
export const PUBLIC_CATEGORY_PATHS = [
  'Mejeri', 'Koed_og_fisk', 'Frugt_og_groent', 'Broed_og_kager',
  'Kolonial', 'Frost', 'Drikkevarer', 'Slik',
] as const

/** _CATEGORY_SLUG_MAP: URL-slug → intern kategorikonstant. */
export const CATEGORY_SLUG_MAP: Readonly<Record<string, string>> = {
  Kolonial: CAT_KOLONIAL,
  Drikkevarer: CAT_DRIKKEVARER,
  Mejeri: CAT_MEJERI,
  'Køl': CAT_MEJERI,
  Frugt_og_groent: CAT_FRUGT_GROENT,
  Frost: CAT_FROST,
  Broed_og_kager: CAT_BROED_KAGER,
  Koed_og_fisk: CAT_KOED_FISK,
  Slik: CAT_SLIK,
}

/** _LISTING_PER_PAGE */
export const LISTING_PER_PAGE = 60

/** _STAPLES */
export const STAPLES: ReadonlySet<string> = new Set([
  'mælk', 'brød', 'æg', 'smør', 'yoghurt', 'ost', 'juice',
  'havregryn', 'pasta', 'ris', 'rugbrød', 'fløde', 'kefir',
  'skyr', 'tomat', 'kartofler', 'løg', 'gulerødder', 'kylling',
  'hakket', 'leverpostej', 'syltetøj', 'marmelade', 'kaffe',
  'te', 'vand', 'cola', 'spaghetti', 'mel', 'sukker', 'salt',
])

const MAX_SEARCH_QUERY_LEN = 100

/** _clean_search_query */
export function cleanSearchQuery(raw: string | null | undefined): string {
  return cpSlice(pyStrip(raw || '').toLowerCase(), MAX_SEARCH_QUERY_LEN)
}

const OEKO_QUERY_SRC = `${B_START}(?:øko|oeko|økologisk|oekologisk|organic|org)${B_END}`
const OEKO_QUERY_RE = new RegExp(OEKO_QUERY_SRC, 'u')
const OEKO_QUERY_RE_G = new RegExp(OEKO_QUERY_SRC, 'gu')

/** _split_organic_intent: (søgetekst uden øko-ord, om brugeren bad om økologisk). */
export function splitOrganicIntent(query: string): [string, boolean] {
  if (!query || !OEKO_QUERY_RE.test(query)) return [query, false]
  const rest = query.replace(OEKO_QUERY_RE_G, ' ')
  return [pySplit(rest).join(' '), true]
}

// _TOBACCO_IMG_RE
const TOBACCO_IMG_RE = new RegExp(`rema-product-images\\.digital\\.rema1000\\.dk/(${D}+)/`, 'u')

/** _is_tobacco_image */
export function isTobaccoImage(url: string): boolean {
  const m = TOBACCO_IMG_RE.exec(url)
  return m ? isRemaTobaccoId(m[1]) : false
}

/** filter_products_by_stores: placeholder-/tobaksbilleder, tobak, ikke-mad, Deli-mærker, butikker. */
export function filterProductsByStores(products: RawProduct[], activeStores: ActiveStores): RawProduct[] {
  const isAllowed = (p: RawProduct): boolean => {
    const g = (k: string, d: any = '') => pyGet(p, k, d)
    const img = pyStrip(pyStr(g('/product/imageLink')))
    if (PLACEHOLDER_IMGS.has(img) || isTobaccoImage(img)) return false
    const remaImg = pyStrip(pyStr(g('/product/rema_image')))
    if (PLACEHOLDER_IMGS.has(remaImg) || isTobaccoImage(remaImg)) return false
    const title = pyStr(g('/product/title'))
    const brand = pyStr(g('/product/brand'))
    if (isAgeRestricted(title, brand, '', g('/product/id'))) return false
    if (isNonFoodName(title) || isNonFoodName(brand)) return false
    const sm = pyOr(g('/product/store_matches', null), {})
    const bilka = pyGet(sm, 'bilka', {})
    const bilkaBrand = pyStrip(pyStr(pyGet(bilka, 'brand', '')).toLowerCase())
    if (bilkaBrand.startsWith('deli')) return false
    if (pyStr(g('/product/store')).toLowerCase() === 'bilka' && pyStrip(pyStr(g('/product/brand')).toLowerCase()).startsWith('deli')) {
      return false
    }
    return true
  }
  const filtered = products.filter(isAllowed)
  if (activeStores === null) return filtered
  return filtered.filter((p) => productAvailableAtActiveStores(p, activeStores))
}

/** Werkzeug args.get(k, type=float): manglende eller ugyldig → null. */
export function argFloat(args: Args, key: string): number | null {
  const v = args.get(key)
  if (v === null) return null
  try {
    return pyFloat(v)
  } catch {
    return null
  }
}

type Display = Record<string, any>

const effPrice = (p: Display) => (pyTruthy(pyGet(p, 'is_sale')) ? pyGet(p, 'sale_price') : pyGet(p, 'price'))
const numCmp = (a: any, b: any) => (a < b ? -1 : b < a ? 1 : 0)

/** apply_product_filters: pris/tilbud/øko/laktose/vægt/underkategori + sortering. */
export function applyProductFilters<T extends object>(items: T[], args: Args): T[] {
  const products = items as unknown as Display[]
  const minPrice = argFloat(args, 'min_price')
  const maxPrice = argFloat(args, 'max_price')
  const saleOnly = args.get('sale') === 'true'
  const organicOnly = args.get('organic') === 'true'
  const lactoseOnly = args.get('lactose') === 'true'
  const minWeight = argFloat(args, 'min_weight')
  const maxWeight = argFloat(args, 'max_weight')
  const sortType = args.get('sort') ?? 'relevance'
  const subcategory = args.get('subcategory') || ''

  const filtered: Display[] = []
  for (const p of products) {
    let price = effPrice(p)
    if (price === null || price === undefined) price = 0
    if (minPrice !== null && price < minPrice) continue
    if (maxPrice !== null && price > maxPrice) continue
    if (saleOnly && !pyTruthy(pyGet(p, 'is_sale')) && !pyTruthy(pyGet(p, 'is_any_sale'))) continue
    if (subcategory && pyGet(p, 'subcategory', '') !== subcategory) continue
    if (organicOnly && !isOrganic(pyGet(p, 'name', ''), pyGet(p, 'description', ''), pyGet(p, 'brand', ''))) continue
    if (lactoseOnly && !isLactoseFree(pyGet(p, 'name', ''), pyGet(p, 'description', ''), pyGet(p, 'brand', ''))) continue
    const weightG = pyGet(p, 'weight_g')
    if (weightG !== null && weightG !== undefined) {
      if (minWeight !== null && weightG < minWeight) continue
      if (maxWeight !== null && weightG > maxWeight) continue
    } else if (minWeight !== null && minWeight > 0) {
      continue
    }
    filtered.push(p)
  }

  let out = filtered
  if (sortType === 'price-asc') out = pySorted(filtered, (x) => pyOr(effPrice(x), 0), false, numCmp)
  else if (sortType === 'price-desc') out = pySorted(filtered, (x) => pyOr(effPrice(x), 0), true, numCmp)
  else if (sortType === 'kg-price-asc') out = pySorted(filtered, (x) => pyOr(pyGet(x, 'price_per_kg'), 999999), false, numCmp)
  else if (sortType === 'name-asc') out = pySorted(filtered, (x) => pyStr(pyGet(x, 'name', '')).toLowerCase(), false, cpCompare)
  return out as unknown as T[]
}

/** _paginate: (side-elementer, side, antal sider, total). */
export function paginate<T>(items: T[], page: number, perPage = LISTING_PER_PAGE): [T[], number, number, number] {
  const total = items.length
  const totalPages = total ? Math.floor((total + perPage - 1) / perPage) : 0
  const p = totalPages > 0 ? Math.min(Math.max(page, 1), totalPages) : 1
  const start = (p - 1) * perPage
  return [items.slice(start, start + perPage), p, totalPages, total]
}

