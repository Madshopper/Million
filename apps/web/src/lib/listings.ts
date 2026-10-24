// Side-data: port af app.py's _build_home_categories, _build_sale_listing,
// _build_category_listing, _build_search_listing, _d1_listing og
// get_active_stores (edge-grenene - PoC'en kører altid mod D1/KV).
import type { ActiveStores, Args, DisplayProduct, RawProduct } from './types'
import { d1First, d1Products, d1Stats, d1StatsCategory, d1Subcategories, kvGetJson } from './data'
import { markDataDegraded, reqState } from './request-state'
import { getCookie } from './headers'
import { loadSearchRaw } from './search-index'
import {
  CAT_KOLONIAL, CAT_MEJERI, CATEGORY_SLUG_MAP, LISTING_PER_PAGE, PLACEHOLDER_IMGS, STAPLES,
  STORE_CATALOG_VERSION, STORE_CONFIGS, SUBCATEGORY_RULES,
  applyProductFilters, filterProductsByStores, normalizeName, paginate, parseSaleEndDate,
  productForActiveStores, productMatchesQuery, productMatchesQueryFuzzy, productToDisplayDict,
  searchMatchScore, splitOrganicIntent, storesAutoEnableSince,
  argFloat,
} from './support'

const VALID_STORE_LABELS = new Set(Object.values(STORE_CONFIGS).map((c: any) => c.label as string))
const HOME_SALE_MAX_PER_STORE = 2

export { argFloat }

/** args.get('page', 1, type=int) */
export function argPage(args: Args): number {
  const v = args.get('page')
  if (v === null || !/^\s*[+-]?\d+\s*$/.test(v)) return 1
  return parseInt(v, 10)
}

/** app.py::get_active_stores - ?stores= vinder over madshopper_stores-cookien. */
export function getActiveStores(): ActiveStores {
  const { url, request } = reqState()
  const param = url.searchParams.get('stores')
  if (param !== null) {
    const labels = new Set<string>()
    for (const s of param.split(',').slice(0, 20)) {
      const t = s.trim()
      if (t && VALID_STORE_LABELS.has(t)) labels.add(t)
    }
    return labels
  }
  let saved = 0
  const savedRaw = getCookie(request, 'madshopper_store_version')
  if (savedRaw && /^\s*[+-]?\d+\s*$/.test(savedRaw)) saved = parseInt(savedRaw, 10)
  let labels: Set<string> | null = null
  const cookie = getCookie(request, 'madshopper_stores')
  if (cookie) {
    try {
      const list = JSON.parse(decodeURIComponent(cookie))
      if (Array.isArray(list) && list.length > 0) {
        labels = new Set(list.map((s) => String(s).trim()).filter(Boolean))
      }
    } catch {
      // ugyldig cookie = ingen valg
    }
  }
  if (labels && labels.size && saved < STORE_CATALOG_VERSION) {
    for (const label of storesAutoEnableSince(saved)) labels.add(label)
  }
  return labels
}

/** app.py::_d1_listing - én side direkte fra D1. */
async function d1Listing(
  baseWhere: string[], baseParams: unknown[], args: Args, page: number, perPage: number,
  activeStores: ActiveStores,
): Promise<[RawProduct[], number, number]> {
  const where = [...baseWhere]
  const params = [...baseParams]
  if (activeStores !== null) {
    if (activeStores.size === 0) return [[], 0, 1]
    where.push('(' + [...activeStores].map(() => 'stores LIKE ?').join(' OR ') + ')')
    for (const s of activeStores) params.push(`%|${s}|%`)
  }
  const sub = args.get('subcategory') || ''
  if (sub) {
    where.push('subcategory = ?')
    params.push(sub)
  }
  if (args.get('sale') === 'true') where.push('is_sale = 1')
  const minPrice = argFloat(args, 'min_price')
  const maxPrice = argFloat(args, 'max_price')
  if (minPrice !== null) { where.push('eff_price >= ?'); params.push(minPrice) }
  if (maxPrice !== null) { where.push('eff_price <= ?'); params.push(maxPrice) }
  if (args.get('organic') === 'true') where.push('organic = 1')
  if (args.get('lactose') === 'true') where.push('lactose = 1')
  const minWeight = argFloat(args, 'min_weight')
  const maxWeight = argFloat(args, 'max_weight')
  if (minWeight !== null && minWeight > 0) { where.push('weight_g >= ?'); params.push(minWeight) }
  if (maxWeight !== null) { where.push('(weight_g IS NULL OR weight_g <= ?)'); params.push(maxWeight) }
  const whereSql = where.join(' AND ')

  const sort = args.get('sort') ?? 'relevance'
  let order = ''
  if (sort === 'price-asc') order = ' ORDER BY eff_price ASC'
  else if (sort === 'price-desc') order = ' ORDER BY eff_price DESC'
  else if (sort === 'name-asc') order = ' ORDER BY title COLLATE NOCASE ASC'
  else if (sort === 'kg-price-asc') {
    order = ' ORDER BY CASE WHEN weight_g IS NULL OR weight_g <= 0 THEN 1 ELSE 0 END ASC, eff_price / weight_g ASC'
  }

  let row: { c: number } | null = null
  if (where.length === 1 && where[0] === 'category = ?' && params.length === 1) {
    const entry = await d1StatsCategory(String(params[0]))
    if (entry && Number.isInteger(entry.n)) row = { c: entry.n }
  } else if (where.length === 1 && where[0] === 'is_sale = 1' && !params.length) {
    const stats = await d1Stats()
    if (stats && Number.isInteger(stats.sale)) row = { c: stats.sale }
  }
  // COUNT og siden hentes samtidigt - i Python var de to synkrone bro-kald efter hinanden.
  const countP = row ? Promise.resolve(row) : d1First<{ c: number }>(`SELECT COUNT(*) AS c FROM products WHERE ${whereSql}`, params)
  const counted = await countP
  if (counted === null) markDataDegraded('d1_listing_count')
  const total = Number(counted?.c ?? 0)
  const totalPages = Math.floor((total + perPage - 1) / perPage)
  page = totalPages > 0 ? Math.min(Math.max(page, 1), totalPages) : 1
  const offset = (page - 1) * perPage
  const products = await d1Products(
    `SELECT data FROM products WHERE ${whereSql}${order} LIMIT ${perPage} OFFSET ${offset}`, params,
  )
  return [products, totalPages, page]
}

// ---------------------------------------------------------------------------

export interface HomeData {
  categories: Record<string, DisplayProduct[]>
  templateMapping: Record<string, string | null>
  recipes: any[]
}

/** app.py::_build_home_categories (edge-grenen med home_data_v1 fra KV). */
export async function buildHomeCategories(activeStores: ActiveStores, args: Args): Promise<HomeData> {
  const adjust = (products: RawProduct[]) => {
    const out: RawProduct[] = []
    for (const p of products) {
      const a = productForActiveStores(p, activeStores)
      if (a) out.push(a)
    }
    return out
  }
  const pre = await kvGetJson<any>('home_data_v1')
  let saleRaw: RawProduct[]
  let mejeriRaw: RawProduct[]
  let recipePool: any[]
  let popIds: string[]
  let favPool: RawProduct[]
  if (pre) {
    saleRaw = adjust(pre.sale_raw || [])
    mejeriRaw = adjust(pre.mejeri_raw || [])
    recipePool = pre.recipe_pool || []
    popIds = pre.pop_ids || []
    favPool = adjust(pre.fav_pool || [])
  } else {
    // Fejler åbent som i Python: live-hentning fra D1 (uden Supabase-favoritter).
    const [s, m] = await Promise.all([
      d1Products('SELECT data FROM products WHERE is_sale = 1 LIMIT 200'),
      d1Products('SELECT data FROM products WHERE category = ? LIMIT 200', [CAT_MEJERI]),
    ])
    saleRaw = adjust(filterProductsByStores(s, activeStores))
    mejeriRaw = adjust(filterProductsByStores(m, activeStores))
    recipePool = []
    popIds = []
    favPool = []
  }

  const byCat: Record<string, DisplayProduct[]> = { 'Ugens Tilbud': [], 'Populære varer': [] }
  const stapleScore = (name: string) => {
    const n = name.toLowerCase()
    let score = 0
    for (const kw of STAPLES) if (n.includes(kw)) score++
    return score
  }
  const seenFavImgs = new Set<string>()
  const usedFavIds = new Set<string>()
  const tryAddFav = (product: RawProduct): boolean => {
    const price = Number(product['/product/price'] ?? 0)
    if (!(price > 0)) return false
    const pid = String(product['/product/id'] ?? '')
    if (usedFavIds.has(pid)) return false
    const img = String(product['/product/imageLink'] ?? '').trim()
    if (img && img !== 'nan' && img !== 'None' && !PLACEHOLDER_IMGS.has(img)) {
      if (seenFavImgs.has(img)) return false
      seenFavImgs.add(img)
    }
    byCat['Populære varer'].push(productToDisplayDict(product, {
      category: product['/product/product_type'] ?? CAT_KOLONIAL,
    }))
    usedFavIds.add(pid)
    return true
  }

  const seenTilbudImgs = new Set<string>()
  const perStore = new Map<string, number>()
  const first: RawProduct[] = []
  const rest: RawProduct[] = []
  for (const product of saleRaw) {
    const img = String(product['/product/imageLink'] ?? '').trim()
    const valid = !!img && img !== 'nan' && img !== 'None' && !PLACEHOLDER_IMGS.has(img)
    if (valid && seenTilbudImgs.has(img)) continue
    if (valid) seenTilbudImgs.add(img)
    const store = String(product['/product/store'] ?? 'Rema 1000')
    if ((perStore.get(store) ?? 0) < HOME_SALE_MAX_PER_STORE) {
      perStore.set(store, (perStore.get(store) ?? 0) + 1)
      first.push(product)
    } else rest.push(product)
  }
  for (const product of [...first, ...rest].slice(0, 60)) {
    byCat['Ugens Tilbud'].push(productToDisplayDict(product, {
      category: product['/product/product_type'] || CAT_MEJERI,
      saleEndDate: parseSaleEndDate(product),
    }))
  }
  for (const d of byCat['Ugens Tilbud']) if (d?.id) usedFavIds.add(String(d.id))

  if (popIds.length) {
    const byId = new Map(favPool.map((p) => [String(p['/product/id'] ?? ''), p]))
    for (const pid of popIds) {
      if (byCat['Populære varer'].length >= 20) break
      const p = byId.get(pid)
      if (p) tryAddFav(p)
    }
  }
  if (byCat['Populære varer'].length < 20) {
    const scored: Array<[number, RawProduct]> = []
    for (const product of [...mejeriRaw, ...saleRaw]) {
      const score = stapleScore(String(product['/product/title'] ?? ''))
      if (score > 0) scored.push([score, product])
    }
    // Python's sort(reverse=True) er stabil og bevarer rækkefølgen ved lige score.
    scored.sort((a, b) => b[0] - a[0])
    for (const [, product] of scored) {
      if (byCat['Populære varer'].length >= 20) break
      tryAddFav(product)
    }
  }
  const categories: Record<string, DisplayProduct[]> = {}
  for (const [cat, products] of Object.entries(byCat)) {
    if (!products.length) continue
    const filtered = applyProductFilters(products, args)
    if (filtered.length) categories[cat] = filtered.slice(0, 60)
  }
  return { categories, templateMapping: { 'Ugens Tilbud': '/ugens_tilbud', 'Populære varer': null }, recipes: recipePool }
}

export interface Listing {
  products: DisplayProduct[]
  page: number
  totalPages: number
  total: number | null
}

/** app.py::_build_sale_listing */
export async function buildSaleListing(activeStores: ActiveStores, args: Args, page: number): Promise<Listing> {
  const [rawPage, totalPages, p] = await d1Listing(['is_sale = 1'], [], args, page, LISTING_PER_PAGE, activeStores)
  const out: DisplayProduct[] = []
  for (const product of filterProductsByStores(rawPage, activeStores)) {
    if (!(product['/product/sale_price'] || product['/product/is_any_sale'])) continue
    try {
      const adjusted = productForActiveStores(product, activeStores)
      if (!adjusted) continue
      out.push(productToDisplayDict(adjusted, {
        defaultCategory: 'Andre varer',
        saleEndDate: parseSaleEndDate(adjusted),
        forceSale: !!adjusted['/product/sale_price'],
      }))
    } catch (e) {
      console.warn('Fejl ved tilbudsvare', product['/product/id'], e)
    }
  }
  return { products: applyProductFilters(out, args), page: p, totalPages, total: null }
}

export interface CategoryListing extends Listing {
  categoryName: string
  availableSubcategories: string[]
  currentSubcategory: string
}

/** app.py::_build_category_listing - null = ukendt kategori. */
export async function buildCategoryListing(
  slug: string, activeStores: ActiveStores, args: Args, page: number,
): Promise<CategoryListing | null> {
  const actual = (CATEGORY_SLUG_MAP as Record<string, string>)[slug]
  if (!actual) return null
  const perPage = LISTING_PER_PAGE
  const currentSubcategory = args.get('subcategory') || ''
  const presentSubs = await d1Subcategories(actual)
  const rules: Array<[string, unknown]> = (SUBCATEGORY_RULES as any)[actual] ?? []
  const availableSubcategories = rules.map(([sub]) => sub).filter((sub) => presentSubs.has(sub))
  if (presentSubs.has('Øvrige')) availableSubcategories.push('Øvrige')

  const toDisplay = (raw: RawProduct[]) => {
    const out: DisplayProduct[] = []
    for (const product of filterProductsByStores(raw, activeStores)) {
      const adjusted = productForActiveStores(product, activeStores)
      if (!adjusted) continue
      try {
        out.push(productToDisplayDict(adjusted, { category: actual }))
      } catch (e) {
        console.warn('Fejl ved kategorivare', e)
      }
    }
    return out
  }

  // Se kommentaren i app.py: uden Rema blandt de valgte butikker kan kortet
  // forfremmes til en anden butiks pris, så SQL kan ikke sortere/paginere.
  const needsPromotion = activeStores !== null && !activeStores.has('Rema 1000')
  if (needsPromotion) {
    let rawAll: RawProduct[] = []
    if (activeStores!.size) {
      const params: unknown[] = [actual, ...[...activeStores!].map((s) => `%|${s}|%`)]
      rawAll = await d1Products(
        `SELECT data FROM products WHERE category = ? AND (${[...activeStores!].map(() => 'stores LIKE ?').join(' OR ')})`,
        params,
      )
    }
    const all = applyProductFilters(toDisplay(rawAll), args)
    const [items, p, totalPages, total] = paginate(all, page, perPage)
    return { categoryName: actual, products: items, page: p, totalPages, total, availableSubcategories, currentSubcategory }
  }
  const [rawPage, totalPages, p] = await d1Listing(['category = ?'], [actual], args, page, perPage, activeStores)
  return {
    categoryName: actual,
    products: applyProductFilters(toDisplay(rawPage), args),
    page: p,
    totalPages,
    total: null,
    availableSubcategories,
    currentSubcategory,
  }
}

async function organicDisplayProducts(activeStores: ActiveStores): Promise<DisplayProduct[]> {
  const raw = await d1Products('SELECT data FROM products WHERE organic = 1 LIMIT 600')
  const out: DisplayProduct[] = []
  for (const p of filterProductsByStores(raw, activeStores)) {
    const adjusted = productForActiveStores(p, activeStores)
    if (!adjusted) continue
    const d = productToDisplayDict(adjusted, { defaultCategory: 'Andre varer' })
    if (d) out.push(d)
  }
  return out
}

function safeMatchFilter(products: DisplayProduct[], query: string, matcher: (p: DisplayProduct, q: string) => boolean) {
  const out: DisplayProduct[] = []
  for (const p of products) {
    try {
      if (matcher(p, query)) out.push(p)
    } catch (e) {
      console.error('matcher afbrudt', query.slice(0, 40), e)
      markDataDegraded('match_filter_afbrudt')
      break
    }
  }
  return out
}

/** app.py::search_display_products */
export async function searchDisplayProducts(query: string, activeStores: ActiveStores, limit = 350): Promise<DisplayProduct[]> {
  query = [...(query || '')].slice(0, 60).join('')
  const raw = await loadSearchRaw(query, limit)
  const displayed: DisplayProduct[] = []
  for (const p of filterProductsByStores(raw, activeStores)) {
    if (!p['/product/title'] || !p['/product/id']) continue
    const adjusted = productForActiveStores(p, activeStores)
    if (!adjusted) continue
    const d = productToDisplayDict(adjusted, { defaultCategory: 'Andre varer' })
    if (d) displayed.push(d)
  }
  const results = safeMatchFilter(displayed, query, productMatchesQuery)
  if (results.length) return results
  return safeMatchFilter(displayed, query, productMatchesQueryFuzzy)
}

/** app.py::_build_search_listing */
export async function buildSearchListing(query: string, activeStores: ActiveStores, args: Args, page: number) {
  const [textQuery, wantOrganic] = splitOrganicIntent(query)
  let all = textQuery ? await searchDisplayProducts(textQuery, activeStores) : await organicDisplayProducts(activeStores)
  if (wantOrganic) all = all.filter((p) => p.is_organic)
  all = applyProductFilters(all, args)
  if ((args.get('sort') ?? 'relevance') === 'relevance') {
    const q = textQuery || query
    // Python sorterer stabilt på nøglen; beregn den én gang pr. vare.
    const keyed = all.map((d, i) => [searchMatchScore(d, q), i, d] as const)
    keyed.sort((a, b) => b[0] - a[0] || a[1] - b[1])
    all = keyed.map((k) => k[2])
  }
  const [items, p, totalPages, total] = paginate(all, page, LISTING_PER_PAGE)
  return { products: items, page: p, totalPages, total }
}

export { normalizeName }
