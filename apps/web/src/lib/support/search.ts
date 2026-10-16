// Port af søgedelen af app_support.py: search_match_score (inkl. kategori-
// prior), _normalized_match_fields, product_matches_query og den typo-
// tolerante product_matches_query_fuzzy.
import { BILKA_CATEGORY_RULES } from './catalog'
import { cpLen, pySplit, pyStr } from './py'
import {
  fieldMatchesTerm,
  fold,
  fuzzyTermHits,
  normalizeName,
  productFlavorSearchField,
  termCanFuzzyMatchFlavor,
  termCanMatchFlavor,
} from './text'

type Product = Record<string, any>

const get = (p: Product, k: string, d: any = '') => (k in p ? p[k] : d)

let priorsCache: Map<string, string> | null = null

/** _search_category_priors: søgeord → forventet kategori (kun entydige ét-ords-nøgleord). */
export function searchCategoryPriors(): Map<string, string> {
  if (priorsCache) return priorsCache
  const seen = new Map<string, string>()
  for (const [category, keywords] of BILKA_CATEGORY_RULES) {
    for (const kw of keywords) {
      const token = fold(normalizeName(kw))
      if (!token || token.includes(' ')) continue
      if (seen.has(token) && seen.get(token) !== category) seen.set(token, '')
      else if (!seen.has(token)) seen.set(token, category)
    }
  }
  priorsCache = new Map([...seen].filter(([, v]) => v))
  return priorsCache
}

/** _search_term_category */
export function searchTermCategory(terms: readonly string[]): string {
  const priors = searchCategoryPriors()
  const found = new Set<string>()
  for (const t of terms) {
    const f = fold(t)
    if (priors.has(f)) found.add(priors.get(f)!)
  }
  return found.size === 1 ? [...found][0] : ''
}

/** search_match_score: højere = bedre relevans. */
export function searchMatchScore(product: Product, query: string): number {
  let terms = pySplit(normalizeName(query)).filter((t) => t)
  if (!terms.length) return 0
  const name = normalizeName(pyStr(get(product, 'name')))
  const brand = normalizeName(pyStr(get(product, 'brand')))
  terms = terms.map(fold)
  const tokens = pySplit(name + ' ' + brand).map(fold)
  let score = 0
  for (const term of terms) {
    let best = 0
    const lt = cpLen(term)
    for (const tok of tokens) {
      if (tok === term) best = Math.max(best, 100)
      else if (tok.startsWith(term)) best = Math.max(best, 70)
      else if (tok.endsWith(term) && cpLen(tok) - lt >= 3) best = Math.max(best, 50)
    }
    score += best
  }
  const expected = searchTermCategory(terms)
  if (expected && pyStr(get(product, 'category')) === expected) score += 40
  return score * 1000 - Math.min(cpLen(name), 999)
}

/** _normalized_match_fields: (navn, mærke, beskrivelse) normaliseret, memoized på dict'en. */
export function normalizedMatchFields(product: Product): [string, string, string] {
  const cached = product._norm_fields
  if (cached !== undefined && cached !== null) return cached
  const fields: [string, string, string] = [
    normalizeName(pyStr(get(product, 'name'))),
    normalizeName(pyStr(get(product, 'brand'))),
    normalizeName(pyStr(get(product, 'description'))),
  ]
  product._norm_fields = fields
  return fields
}

/** product_matches_query: token-baseret (hele ord / præfiks / sammensætning). */
export function productMatchesQuery(product: Product, query: string): boolean {
  const terms = pySplit(normalizeName(query))
  if (!terms.length) return false
  const cheap = normalizedMatchFields(product)
  let flavor: string | undefined
  const fl = () => (flavor ??= productFlavorSearchField(product))
  return terms.every((term) => {
    if (cheap.some((f) => f && fieldMatchesTerm(f, term))) return true
    if (!termCanMatchFlavor(term)) return false
    const f = fl()
    return !!f && fieldMatchesTerm(f, term)
  })
}

/** product_matches_query_fuzzy: typo-tolerant fallback ved 0 strenge hits. */
export function productMatchesQueryFuzzy(product: Product, query: string): boolean {
  const terms = pySplit(normalizeName(query))
  if (!terms.length) return false
  const cheap = normalizedMatchFields(product)
  const cheapWords = pySplit(cheap[0] + ' ' + cheap[1])
  let flavor: string | undefined
  const fl = () => (flavor ??= productFlavorSearchField(product))
  return terms.every((term) => {
    if (cheap.some((f) => f && fieldMatchesTerm(f, term))) return true
    if (fuzzyTermHits(term, cheapWords)) return true
    if (!termCanFuzzyMatchFlavor(term)) return false
    const f = fl()
    return !!f && (fieldMatchesTerm(f, term) || fuzzyTermHits(term, pySplit(f)))
  })
}
