import { describe, expect, it } from 'vitest'
import {
  altStorePrice, altStorePrices, findAlternative, fuzzyScore, getMeatTypes, productContentWords, variantFlags,
} from '~/lib/alternatives'
import { normalizeName } from '~/lib/support'
import { hasPython, py } from './pyexec'

const NAMES = [
  'Arla Økologisk Letmælk 1L', 'Coca-Cola Zero 0,0%', 'Hakket kyl. 8-12%', 'HK. OKSEKØD 8-12%', 'Hakket okse- og kyllingekød',
  'Lammefjord gulerødder', 'Lam i tern', 'Tun i vand', 'Tunfisk', 'Laksefilet med skind', 'Glutenfri brød', 'Sukkerfri Nul Suk.',
  'Carlsberg Nul % Alkoholfri', 'Æg fra frilandshøns, 10 stk', 'æg', 'Rød peberfrugt', 'Peberfrugt rød', 'Senseo Classic',
  'Kalvefilet', 'Svinekotelet', 'grisemørbrad', 'Kyllingelårfilet u. skind', '', 'Pepsi Max Zero sugar', 'lactose free milk',
]
const PAIRS: Array<[string, string]> = [
  ['æg', 'økologiske æg fra frilandshøns 10 stk'], ['rød peberfrugt', 'peberfrugt rød'], ['kaffe', 'kaffe filter'],
  ['english earl grey', 'grillpølser 450g'], ['mælk', 'letmælk'], ['a', 'abcdefghij'], ['(x)', 'a (x) b'], ['ost', 'ost'],
]

describe.skipIf(!hasPython)('støttefunktioner = app_support.py', () => {
  it('fuzzy_score, product_content_words, variant_flags, get_meat_types', () => {
    const want = py<any>(`
import json, sys
import app_support as A
d = json.load(sys.stdin)
print(json.dumps({
  'fz': [A.fuzzy_score(a, b) for a, b in d['pairs']],
  'fzn': [A.fuzzy_score(A.normalize_name(a), A.normalize_name(b)) for a in d['names'] for b in d['names'][:6]],
  'cw': [sorted(A.product_content_words(n)) for n in d['names']],
  'vf': [list(A.variant_flags(n)) for n in d['names']],
  'mt': [sorted(A.get_meat_types(n)) for n in d['names']],
}))`, { pairs: PAIRS, names: NAMES })
    expect(PAIRS.map(([a, b]) => fuzzyScore(a, b))).toEqual(want.fz.map((x: number) => expect.closeTo(x, 12)))
    const fzn = NAMES.flatMap((a) => NAMES.slice(0, 6).map((b) => fuzzyScore(normalizeName(a), normalizeName(b))))
    expect(fzn).toEqual(want.fzn.map((x: number) => expect.closeTo(x, 12)))
    expect(NAMES.map((n) => [...productContentWords(n)].sort())).toEqual(want.cw)
    expect(NAMES.map(variantFlags)).toEqual(want.vf)
    expect(NAMES.map((n) => [...getMeatTypes(n)].sort())).toEqual(want.mt)
  })

  it('_alt_store_price og _alt_store_prices', () => {
    const products = [
      { '/product/store': 'Netto', '/product/price': 10, '/product/sale_price': 8, '/product/title': 'A', '/product/imageLink': 'i' },
      { '/product/store': 'Bilka', '/product/price': '12.5', '/product/title': 'B', '/product/rema_price': 11, '/product/rema_image': 'r',
        '/product/store_matches': { netto: { price: 0, normal_price: 9, name: 'Bn', image: 'nan' }, meny: { price: 'x', name: '' }, ukendt: { price: 3 } } },
      { '/product/title': 'C', '/product/price': null, '/product/store_matches': null },
    ]
    const stores = ['Netto', 'Bilka', 'Rema 1000', 'Meny', 'Spar']
    const want = py<any>(`
import json, sys
import os; os.environ.pop('CLOUDFLARE_WORKERS', None)
import logging; logging.disable(logging.CRITICAL)
import app as A
d = json.load(sys.stdin)
print(json.dumps({'sp': [[list(A._alt_store_price(p, s)) for s in d['s']] for p in d['p']],
                  'sps': [A._alt_store_prices(p) for p in d['p']]}))`, { p: products, s: stores })
    expect(products.map((p) => stores.map((s) => altStorePrice(p as any, s)))).toEqual(want.sp)
    expect(products.map((p) => altStorePrices(p as any))).toEqual(want.sps)
  })
})

describe('findAlternative', () => {
  it('mangler felter -> null; liste som kategori -> kaster (500 i ruten)', async () => {
    const none = async () => []
    expect(await findAlternative({ cart_id: 1, store: 'Netto', category: 'Køl' }, new Map(), none)).toBeNull()
    await expect(findAlternative({ cart_id: 1, store: 'Netto', category: ['Køl'], name: 'mælk' }, new Map(), none)).rejects.toThrow()
  })

  it('SQL-puljen bygges som i app.py og memoiseres', async () => {
    const seen: Array<[string, unknown[]]> = []
    const q = async (sql: string, params: unknown[]) => {
      seen.push([sql, params])
      return []
    }
    const cache = new Map()
    const item = { cart_id: 'c1', store: 'Netto', category: 'Køl', name: 'Arla Letmælk 1L', weight_str: '1 l', price: 12 }
    await findAlternative(item, cache, q)
    await findAlternative({ ...item, cart_id: 'c2' }, cache, q)
    expect(seen.length).toBe(1)
    expect(seen[0][0]).toBe(
      'SELECT data FROM products WHERE category = ? AND subcategory = ? AND stores LIKE ?' +
      ' AND (weight_g IS NULL OR (weight_g >= ? AND weight_g <= ?))' +
      " AND (search_text LIKE ? ESCAPE '\\' OR search_text LIKE ? ESCAPE '\\') ORDER BY eff_price ASC LIMIT 600",
    )
    expect(seen[0][1]).toEqual(['Køl', 'Mælk & Fløde', '%|Netto|%', 750, 1000 / 0.75, '%arla%', '%letmælk%'])
  })
})
