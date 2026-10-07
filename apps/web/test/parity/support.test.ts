// Paritet: TS-porten af app_support.py (src/lib/support) mod Python-output på
// rigtige data. Fixturen bygges af gen_support_fixtures.py (se dens docstring).
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import * as S from '~/lib/support'
import { searchCategoryPriors } from '~/lib/support/search'
import {
  BLOCKED_NAME_FRAGMENTS,
  BILKA_CATEGORY_RULES,
  EXTRA_NON_FOOD_TERMS,
  SUBCATEGORY_RULES,
} from '~/lib/support/catalog'

// SUPPORT_FIXTURE=<sti> kører mod en anden (fx fuld, STEP=1) fixture.
const FIX = JSON.parse(readFileSync(process.env.SUPPORT_FIXTURE || new URL('./fixtures/support.json', import.meta.url), 'utf8'))

/** Samler afvigelser, så én kørsel viser dem alle (ikke kun den første). */
function checker() {
  const bad: string[] = []
  let n = 0
  return {
    eq(label: string, actual: unknown, expected: unknown) {
      n++
      if (!isDeepStrictEqual(actual, expected)) {
        bad.push(`${label}\n    TS: ${JSON.stringify(actual)}\n    PY: ${JSON.stringify(expected)}`)
      }
    },
    done() {
      if (bad.length) expect.fail(`${bad.length}/${n} afvigelser:\n` + bad.slice(0, 25).join('\n'))
      expect(n).toBeGreaterThan(0)
      if (process.env.PARITY_VERBOSE) console.log(`paritet: ${n} sammenligninger ok`)
      return n
    },
  }
}

/** Python-undtagelse ↔ TS-throw. */
function guard<T>(fn: () => T): { ok: T } | { error: true } {
  try {
    return { ok: fn() }
  } catch {
    return { error: true }
  }
}
const pyGuard = (r: any) => ('error' in r ? { error: true } : r)

const sortedTokens = (s: string) => s.split(/\s+/).filter(Boolean).sort()
const stripDisplay = (d: Record<string, any>) => {
  const { store_matches: _sm, _norm_fields: _nf, ...rest } = d
  return rest
}
const diffObj = (base: Record<string, any>, o: Record<string, any>) => {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(o)) if (!(k in base) || !isDeepStrictEqual(base[k], v)) out[k] = v
  return out
}

const STORE_SETS: Record<string, Set<string> | null> = {
  none: null,
  rema: new Set(['Rema 1000']),
  netto_foetex: new Set(['Netto', 'Føtex']),
  lidl: new Set(['Lidl']),
  empty: new Set(),
  dagrofa: new Set(['Meny', 'Spar', 'Min Købmand']),
  bilka: new Set(['Bilka']),
}

const raws: any[] = FIX.products.map((e: any) => e.raw)

describe('konstanter', () => {
  it('matcher Python', () => {
    const c = checker()
    const k = FIX.constants
    c.eq('flavor_vocab', [...S.FLAVOR_VOCAB], k.flavor_vocab)
    c.eq('priors', Object.fromEntries(searchCategoryPriors()), k.priors)
    c.eq('abbrev_canon', S.flavorAbbrevCanonicals(), k.abbrev_canon)
    c.eq('store_configs', S.STORE_CONFIGS, k.store_configs)
    c.eq('subcategory_rules', SUBCATEGORY_RULES, k.subcategory_rules)
    c.eq('bilka_rules', BILKA_CATEGORY_RULES, k.bilka_rules)
    c.eq('blocked', BLOCKED_NAME_FRAGMENTS, k.blocked)
    c.eq('extra_nonfood', EXTRA_NON_FOOD_TERMS, k.extra_nonfood)
    c.eq('placeholders', [...S.PLACEHOLDER_IMGS].sort(), k.placeholders)
    c.eq('staples', [...S.STAPLES].sort(), k.staples)
    c.eq('slug_map', S.CATEGORY_SLUG_MAP, k.slug_map)
    c.eq('public_paths', [...S.PUBLIC_CATEGORY_PATHS], k.public_paths)
    c.eq('per_page', S.LISTING_PER_PAGE, k.per_page)
    c.eq('catalog_version', S.STORE_CATALOG_VERSION, k.catalog_version)
    c.eq('added_in', S.STORES_ADDED_IN_VERSION, k.added_in)
    c.done()
  })
})

describe('strengfunktioner', () => {
  const s = FIX.strings
  it('normalize/fold/smag', () => {
    const c = checker()
    for (const [t, o] of s.normalize) c.eq(`normalize ${JSON.stringify(t)}`, S.normalizeName(t), o)
    for (const [t, o] of s.fold) c.eq(`fold ${t}`, S.fold(t), o)
    for (const [t, o] of s.flavors) c.eq(`flavors ${t}`, [...S.getProductFlavors(t)].sort(), o)
    for (const [u, o] of s.image_flavors) c.eq(`img ${u}`, [...S.extractImageFlavorKeywords(u)].sort(), o)
    c.done()
  })
  it('vægt/stk/flag', () => {
    const c = checker()
    for (const [u, o] of s.weight) c.eq(`weight ${JSON.stringify(u)}`, S.parseWeightToGrams(u), o)
    for (const [u, o] of s.stk) c.eq(`stk ${JSON.stringify(u)}`, S.parseStkCount(u), o)
    for (const [t, o] of s.organic) c.eq(`organic ${t}`, S.isOrganic(t), o)
    for (const [t, o] of s.lactose) c.eq(`lactose ${t}`, S.isLactoseFree(t), o)
    for (const [t, o] of s.nonfood) c.eq(`nonfood ${t}`, S.isNonFoodName(t), o)
    for (const [t, o] of s.age) c.eq(`age ${JSON.stringify(t)}`, S.isAgeRestricted(t), o)
    for (const [v, o] of s.tobacco_id) c.eq(`tobacco_id ${v}`, S.isRemaTobaccoId(v), o)
    for (const [u, o] of s.tobacco_image) c.eq(`tobacco_image ${u}`, S.isTobaccoImage(u), o)
    c.done()
  })
  it('kategorier', () => {
    const c = checker()
    for (const [t, cat, o] of s.subcat) c.eq(`subcat ${t}/${cat}`, S.getSubcategory(t, cat), o)
    for (const [r, t, b, o] of s.unify) c.eq(`unify ${r}/${t}/${b}`, S.unifyCategory(r, t, b), o)
    c.done()
  })
  it('dato/tekst/fuzzy/søgetekst', () => {
    const c = checker()
    for (const [d, o] of s.sale_end) {
      c.eq(`sale_end ${d}`, S.parseSaleEndDate({ '/product/sale_price_effective_date': 'x/' + d }), o)
    }
    for (const [v, o] of s.clean_display) c.eq(`clean ${v}`, S.cleanDisplayText(v), o)
    for (const [a, b, r, t] of s.ratio) {
      c.eq(`ratio ${a}|${b}`, S.rapidRatio(a, b), r)
      c.eq(`token_sort ${a}|${b}`, S.rapidTokenSort(a, b), t)
    }
    for (const [t, w, o] of s.fuzzy_hits) c.eq(`fuzzy_hits ${t}`, S.fuzzyTermHits(t, w), o)
    for (const [t, a, b] of s.term_can) {
      c.eq(`term_can ${t}`, S.termCanMatchFlavor(t), a)
      c.eq(`term_can_fuzzy ${t}`, S.termCanFuzzyMatchFlavor(t), b)
    }
    for (const [a, b, o] of s.token_match) c.eq(`token ${a}|${b}`, S.tokenMatchesTerm(a, b), o)
    for (const [q, o] of s.clean_query) c.eq(`clean_query ${q}`, S.cleanSearchQuery(q), o)
    for (const [q, o] of s.split_organic) c.eq(`split ${q}`, S.splitOrganicIntent(S.cleanSearchQuery(q)), o)
    for (const [v, o] of s.stores_since) c.eq(`since ${v}`, S.storesAutoEnableSince(v), o)
    for (const [n, page, per, o] of s.paginate) {
      const items = Array.from({ length: n }, (_, i) => i)
      c.eq(`paginate ${n}/${page}/${per}`, S.paginate(items, page, per).slice(1), o)
    }
    c.done()
  })
})

describe('pr. produkt (rigtige data)', () => {
  it('normalize, smag, flag, vægt, kategori', () => {
    const c = checker()
    FIX.per_product.forEach((rec: any, i: number) => {
      const p = raws[i]
      const has = (k: string) => k in p
      const title = has('/product/title') ? p['/product/title'] : ''
      const brand = has('/product/brand') ? p['/product/brand'] : ''
      const desc = has('/product/description') ? p['/product/description'] : ''
      const img = S.pyStr(has('/product/imageLink') ? p['/product/imageLink'] : '')
      const text = [title, brand, desc].map(S.pyStr).join(' ')
      const id = p['/product/id']
      c.eq(`${id} norm`, [S.normalizeName(title), S.normalizeName(brand), S.normalizeName(desc)], rec.norm)
      c.eq(`${id} flavors`, [...S.getProductFlavors(text)].sort(), rec.flavors)
      c.eq(`${id} img_flavors`, [...S.extractImageFlavorKeywords(img)].sort(), rec.img_flavors)
      c.eq(`${id} search_kw`, sortedTokens(S.getSearchFlavorKeywords(text, img)), rec.search_kw)
      const ptype = S.pyStr(p['/product/product_type'] || 'Andre varer')
      c.eq(`${id} subcat`, S.getSubcategory(S.pyStr(title), ptype), rec.subcat)
      c.eq(`${id} organic`, S.isOrganic(title, desc, brand), rec.organic)
      c.eq(`${id} lactose`, S.isLactoseFree(title, desc, brand), rec.lactose)
      c.eq(`${id} nonfood`, S.isNonFoodName(title), rec.nonfood)
      c.eq(`${id} age`, S.isAgeRestricted(title, brand, '', has('/product/id') ? id : ''), rec.age)
      const unit = has('/product/unit_pricing_measure') ? p['/product/unit_pricing_measure'] : null
      c.eq(`${id} weight`, S.parseWeightToGrams(unit), rec.weight)
      c.eq(`${id} stk`, S.parseStkCount(unit), rec.stk)
      c.eq(`${id} sale_end`, S.parseSaleEndDate(p), rec.sale_end)
      for (const [r, t, b, o] of rec.unify) c.eq(`${id} unify ${r}/${t}`, S.unifyCategory(r, t, b), o)
    })
    c.done()
  })

  it('display- og API-dicts', () => {
    const c = checker()
    const variants: Record<string, S.DisplayOptions> = {
      default: {},
      cat: { category: 'Frost' },
      force: { forceSale: true },
      sed: { saleEndDate: '24/12' },
      defcat: { defaultCategory: 'Kolonial' },
    }
    FIX.per_product.forEach((rec: any, i: number) => {
      const p = raws[i]
      const id = p['/product/id']
      let base: Record<string, any> | null = null
      for (const [key, opts] of Object.entries(variants)) {
        const r = guard(() => S.productToDisplayDict(p, opts) as Record<string, any>)
        const exp = rec.display[key]
        if ('error' in exp || 'error' in r) {
          c.eq(`${id} display.${key} fejl`, 'error' in r, 'error' in exp)
          continue
        }
        if (key === 'default') {
          base = stripDisplay(r.ok)
          c.eq(`${id} display`, base, exp.ok)
          const sm = '/product/store_matches' in p ? p['/product/store_matches'] : {}
          c.eq(`${id} display.store_matches`, r.ok.store_matches, sm)
        } else {
          c.eq(`${id} display.${key}`, diffObj(base!, stripDisplay(r.ok)), exp.diff)
        }
      }
      if (rec.api) {
        const api = S.productToApiDict(S.productToDisplayDict(p) as Record<string, any>) as Record<string, any>
        if (!('store_matches' in rec.api)) delete api.store_matches
        c.eq(`${id} api`, api, rec.api)
      }
    })
    c.done()
  })

  it('product_for_active_stores / available', () => {
    const c = checker()
    FIX.per_product.forEach((rec: any, i: number) => {
      const p = raws[i]
      const id = p['/product/id']
      for (const [name, ss] of Object.entries(STORE_SETS)) {
        const exp = rec.pfas[name]
        c.eq(`${id} avail ${name}`, S.productAvailableAtActiveStores(p, ss), exp.avail)
        const r = guard(() => S.productForActiveStores(p, ss))
        let got: any
        if ('error' in r) got = { error: true }
        else if (r.ok === null) got = { none: true }
        else if (r.ok === p) got = { same: true }
        else got = { diff: diffObj(p, r.ok) }
        c.eq(`${id} pfas ${name}`, got, pyGuard(exp.res))
      }
    })
    c.done()
  })
})

describe('lister og søgning', () => {
  const displays = (FIX.display_index as number[]).map((i) => S.productToDisplayDict(raws[i]) as Record<string, any>)

  it('filter_products_by_stores', () => {
    const c = checker()
    for (const [name, ss] of Object.entries(STORE_SETS)) {
      const idx = new Map(raws.map((p, i) => [p, i]))
      c.eq(`by_store ${name}`, S.filterProductsByStores(raws, ss).map((p) => idx.get(p)), FIX.by_store[name])
    }
    c.done()
  })

  it('apply_product_filters', () => {
    const c = checker()
    const idx = new Map(displays.map((d, i) => [d, i]))
    for (const [qs, exp] of FIX.apply_filters) {
      const got = S.applyProductFilters(displays, new URLSearchParams(qs)).map((d) => idx.get(d))
      c.eq(`apply ${qs}`, got, exp)
    }
    c.done()
  })

  it('product_matches_query(+fuzzy) og search_match_score', () => {
    const c = checker()
    for (const { q, strict, fuzzy, scores } of FIX.search) {
      const st: number[] = []
      const fz: number[] = []
      displays.forEach((d, i) => {
        if (S.productMatchesQuery(d, q)) st.push(i)
        if (S.productMatchesQueryFuzzy(d, q)) fz.push(i)
      })
      c.eq(`strict ${q}`, st, strict)
      c.eq(`fuzzy ${q}`, fz, fuzzy)
      const sc: Record<string, number> = {}
      for (const k of Object.keys(scores)) sc[k] = S.searchMatchScore(displays[Number(k)], q)
      c.eq(`score ${q}`, sc, scores)
    }
    c.done()
  })
})
