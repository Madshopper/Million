// Port af app_support.py: _fold, normalize_name, smagslogikken
// (_FLAVOR_MAP, mønstre, forkortelser, ordforråd) og rapidfuzz-ækvivalenter.
import { B_END, B_START, BoundedCache, W, cpCompare, cpLen, pyOr, pySplit, pyStr, pyStrip, pyTruthy, reEscape } from './py'

// ── _fold ───────────────────────────────────────────────────────────────────
/** _fold: dansk→ASCII-folding til søgning ('mælk' == 'maelk'). */
export function fold(s: string): string {
  if (s.indexOf('æ') < 0 && s.indexOf('ø') < 0) return s
  return s.replace(/[æø]/g, (c) => (c === 'æ' ? 'ae' : 'oe'))
}

// ── rapidfuzz ───────────────────────────────────────────────────────────────
function lcsLen(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  let prev = new Array<number>(b.length + 1).fill(0)
  let cur = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const ai = a[i - 1]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = ai === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]
}

/** rapidfuzz.fuzz.ratio: normaliseret Indel-lighed * 100 (ingen processor). */
export function rapidRatio(a: string, b: string): number {
  const ca = Array.from(a)
  const cb = Array.from(b)
  const lensum = ca.length + cb.length
  if (lensum === 0) return 100
  const dist = lensum - 2 * lcsLen(ca, cb)
  return (1 - dist / lensum) * 100
}

/** rapidfuzz.fuzz.token_sort_ratio (rapidfuzz 3.x: ingen standard-processor). */
export function rapidTokenSort(a: string, b: string): number {
  const sa = pySplit(a).sort(cpCompare).join(' ')
  const sb = pySplit(b).sort(cpCompare).join(' ')
  return rapidRatio(sa, sb)
}

// ── normalize_name ──────────────────────────────────────────────────────────
const wb = (word: string) => new RegExp(`${B_START}${word}${B_END}`, 'gu')

/** _ABBREV_COMPILED (mønster med g-flag, erstatning). */
export const ABBREV_COMPILED: Array<[RegExp, string]> = [
  [wb('sc'), 'sour cream'],
  [wb('hk'), 'hakket'],
  [wb('fuldk'), 'fuldkorn'],
  [new RegExp(`(?<!f )${B_START}eks${B_END}`, 'gu'), 'ekstra'],
  [wb('kyl'), 'kylling'],
  [wb('kart'), 'kartoffel'],
  [wb('champ'), 'champignon'],
  [wb('sdj'), 'sønderjysk'],
  [wb('øko'), 'okologisk'],
  [wb('vanille'), 'vanilje'],
  [wb('vanilla'), 'vanilje'],
  [wb('vanill'), 'vanilje'],
  [wb('karam'), 'karamel'],
  [wb('jordbæ'), 'jordbaer'],
  [wb('rabarb'), 'rabarber'],
  [wb('smørbart'), 'smørbar'],
  [wb('smrbar'), 'smørbar'],
  [wb('hyldebl'), 'hyldeblomst'],
  [wb('hindb'), 'hindbaer'],
  [wb('jordb'), 'jordbaer'],
  [wb('peberm'), 'pebermynte'],
  [wb('chokol'), 'chokolade'],
  [wb('vanilj'), 'vanilje'],
]

// _OKOLOGISK_RE = \b[øo]kologi\w*
const OKOLOGISK_RE = new RegExp(`${B_START}[øo]kologi${W}*`, 'gu')
const MN_RE = /\p{Mn}/gu
const NOISE = ['%', ' eko', ' bio', ' a/s', ' i/s']

const normCache = new BoundedCache<string, string>(16384)

/** normalize_name (Python: @lru_cache). */
export function normalizeName(nameIn: unknown): string {
  if (!pyTruthy(nameIn)) return ''
  const raw = pyStr(nameIn)
  if (raw === 'nan') return ''
  const hit = normCache.get(raw)
  if (hit !== undefined) return hit
  let name = pyStrip(raw.toLowerCase())
  name = name.normalize('NFKD').replace(MN_RE, '')
  name = name.replaceAll('&', 'and').replaceAll('+', 'and').replaceAll(',', ' ')
  name = name.replaceAll("'", '').replaceAll('’', '')
  name = name.replaceAll('.', ' ')
  for (const [pattern, replacement] of ABBREV_COMPILED) name = name.replace(pattern, replacement)
  for (const noise of NOISE) name = name.replaceAll(noise, '')
  name = name.replace(OKOLOGISK_RE, '')
  name = name.replaceAll('/', ' ')
  const out = pySplit(name).join(' ')
  normCache.set(raw, out)
  return out
}

// ── Smag ────────────────────────────────────────────────────────────────────
type Canon = string | readonly string[]

/** _FLAVOR_MAP (samme rækkefølge som Python-dict'en). */
export const FLAVOR_MAP: ReadonlyArray<readonly [string, Canon]> = [
  ['cola', 'cola'],
  ['vindrue', 'grape'], ['grape', 'grape'],
  ['hyldeblomst', 'elderflower'], ['elderflower', 'elderflower'],
  ['mango', 'mango'],
  ['ananas', 'pineapple'], ['pineapple', 'pineapple'],
  ['appelsin', 'orange'], ['orange', 'orange'],
  ['citron', 'lemon'], ['lemon', 'lemon'],
  ['lime', 'lime'],
  ['sour', 'sour'], ['sour cream', 'sour'], ['sourcream', 'sour'],
  ['granatæble', 'pomegranate'], ['pomegranate', 'pomegranate'],
  ['tranebær', 'cranberry'], ['cranberry', 'cranberry'],
  ['hindbær', 'raspberry'], ['hindbaer', 'raspberry'], ['raspberry', 'raspberry'],
  ['jordbær', 'strawberry'], ['jordbaer', 'strawberry'], ['strawberry', 'strawberry'],
  ['blåbær', 'blueberry'], ['blueberry', 'blueberry'],
  ['solbær', 'blackcurrant'], ['blackcurrant', 'blackcurrant'],
  ['stikkelsbær', 'gooseberry'],
  ['boysenbær', 'boysenberry'], ['boysenbaer', 'boysenberry'],
  ['kirsebær', 'cherry'], ['cherry', 'cherry'],
  ['pære', 'pear'], ['pear', 'pear'],
  ['banan', 'banana'], ['banana', 'banana'],
  ['æble', 'apple'], ['apple', 'apple'],
  ['fersken', 'peach'], ['peach', 'peach'],
  ['abrikos', 'apricot'], ['apricot', 'apricot'],
  ['guava', 'guava'],
  ['passionsfrugt', 'passionfruit'], ['passion', 'passionfruit'],
  ['kokos', 'coconut'], ['coconut', 'coconut'],
  ['rabarber', 'rhubarb'], ['rhubarb', 'rhubarb'],
  ['melon', 'melon'],
  ['watermelon', ['watermelon', 'melon']], ['vandmelon', ['watermelon', 'melon']],
  ['drue', 'grape'],
  ['skovbær', 'forestberry'],
  ['timian', 'thyme'],
  ['basilikum', 'basil'],
  ['oregano', 'oregano'],
  ['hvidløg', 'garlic'],
  ['h.løg', 'garlic'],
  ['chili', 'chili'],
  ['karry', 'curry'],
  ['naturel', 'natural'], ['natural', 'natural'], ['naturlig', 'natural'],
  ['vanilje', 'vanilla'], ['vanilla', 'vanilla'],
  ['pink', 'pink'],
  ['kakao', 'cocoa'], ['cocoa', 'cocoa'],
  ['chokolade', 'chocolate'], ['chocolate', 'chocolate'],
  ['honning', 'honey'], ['honey', 'honey'],
  ['karamel', 'caramel'], ['caramel', 'caramel'],
  ['karameller', 'caramel'],
  ['mint', 'mint'], ['mynte', 'mint'],
  ['spearmint', 'mint'],
  ['kaffe', 'coffee'], ['coffee', 'coffee'],
  ['choko', 'chocolate'],
  ['choco', 'chocolate'],
  ['chokol', 'chocolate'],
  ['paprika', 'paprika'],
  ['bacon', 'bacon'],
  ['løg', 'onion'], ['onion', 'onion'],
  ['laks', 'laks'], ['tun', 'tun'], ['torsk', 'torsk'], ['makrel', 'makrel'],
  ['sild', 'sild'], ['ørred', 'ørred'], ['rødspætte', 'rødspætte'],
  ['reje', 'reje'], ['rejer', 'reje'],
  ['musling', 'musling'], ['blåmusling', 'musling'],
  ['mørksej', 'sej'], ['sejfilet', 'sej'],
]

const canonList = (c: Canon): string[] => (typeof c === 'string' ? [c] : [...c])

/** Mønster uden g-flag (search) til _extract_keywords. */
type KwPattern = { re: RegExp; canon: string[] }

/** _compile_keyword_patterns: længste nøgleord først, ordgrænse i mindst én ende. */
function compileKeywordPatterns(map: ReadonlyArray<readonly [string, Canon]>): KwPattern[] {
  const sorted = [...map].sort((a, b) => cpLen(b[0]) - cpLen(a[0]))
  return sorted.map(([kw, canon]) => {
    const esc = reEscape(kw)
    return { re: new RegExp(`(?<![a-zæøå])${esc}|${esc}(?![a-zæøå])`, 'u'), canon: canonList(canon) }
  })
}

// _SMAG_SUFFIX_RE: (?<=[a-zæøå])(?:smag(?:s|en)?|fyld|overtræk|stang|stænger)\b
const SMAG_SUFFIX_RE = new RegExp(`(?<=[a-zæøå])(?:smag(?:s|en)?|fyld|overtræk|stang|stænger)${B_END}`, 'gu')
const FLAVOR_BLOCKERS_RE = /druesukker|colada|løgismose|tunge|neptun/gu

/** _extract_keywords: konsumér længste nøgleord først, til fixpoint. */
function extractKeywords(textIn: string, patterns: KwPattern[]): Set<string> {
  let text = textIn
  const found = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const { re, canon } of patterns) {
      const m = re.exec(text)
      if (m) {
        for (const c of canon) found.add(c)
        text = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`
        changed = true
      }
    }
  }
  return found
}

const FLAVOR_PATTERNS = compileKeywordPatterns(FLAVOR_MAP)

/** _FLAVOR_ABBREV_PATTERNS: forkortelser der udvider TIL en smag. */
const FLAVOR_ABBREV_PATTERNS: Array<{ re: RegExp; canon: string[] }> = (() => {
  const out: Array<{ re: RegExp; canon: string[] }> = []
  for (const [pattern, replacement] of ABBREV_COMPILED) {
    const canon = extractKeywords(replacement.toLowerCase(), FLAVOR_PATTERNS)
    if (canon.size) out.push({ re: new RegExp(pattern.source, 'u'), canon: [...canon].sort(cpCompare) })
  }
  return out
})()

export function flavorAbbrevCanonicals(): string[][] {
  return FLAVOR_ABBREV_PATTERNS.map((p) => p.canon)
}

/** get_product_flavors */
export function getProductFlavors(text: unknown): Set<string> {
  const lowered = pyStr(pyOr(text, '')).toLowerCase()
  const cleaned = lowered.replace(FLAVOR_BLOCKERS_RE, ' ').replace(SMAG_SUFFIX_RE, ' ')
  const found = extractKeywords(cleaned, FLAVOR_PATTERNS)
  for (const { re, canon } of FLAVOR_ABBREV_PATTERNS) {
    if (re.test(cleaned)) for (const c of canon) found.add(c)
  }
  return found
}

/** extract_image_flavor_keywords */
export function extractImageFlavorKeywords(imageUrl: string): Set<string> {
  if (!imageUrl || ['nan', 'none', ''].includes(pyStr(imageUrl).toLowerCase())) return new Set()
  const urlClean = normalizeName(imageUrl.toLowerCase().replaceAll('-', ' ').replaceAll('_', ' ').replaceAll('/', ' '))
  return getProductFlavors(urlClean)
}

const REVERSE_FLAVOR_MAP: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>()
  for (const [kw, canon] of FLAVOR_MAP) {
    for (const c of canonList(canon)) {
      if (!m.has(c)) m.set(c, new Set())
      m.get(c)!.add(kw)
    }
  }
  return m
})()

/**
 * get_search_flavor_keywords. NB: Python samler ordene i et set, så
 * rækkefølgen er hash-tilfældig; her er den deterministisk. Alle forbrugere
 * er ordrækkefølge-uafhængige (token-match).
 */
export function getSearchFlavorKeywords(text: string, imageUrl = ''): string {
  const canonicals = getProductFlavors(text)
  if (imageUrl) for (const c of extractImageFlavorKeywords(imageUrl)) canonicals.add(c)
  if (!canonicals.size) return ''
  const words = new Set<string>()
  for (const c of canonicals) {
    words.add(c)
    for (const kw of REVERSE_FLAVOR_MAP.get(c) ?? []) words.add(kw)
  }
  return [...words].join(' ')
}

/** _FLAVOR_VOCAB: alle tokens et smagsfelt kan indeholde. */
export const FLAVOR_VOCAB: readonly string[] = (() => {
  const words = new Set<string>()
  for (const [kw] of FLAVOR_MAP) words.add(kw)
  for (const [, canon] of FLAVOR_MAP) for (const c of canonList(canon)) words.add(c)
  const tokens = new Set<string>()
  for (const w of words) for (const t of pySplit(normalizeName(w))) tokens.add(t)
  for (const t of pySplit(normalizeName([...words].sort(cpCompare).join(' ')))) tokens.add(t)
  return [...tokens].filter((t) => t).sort(cpCompare)
})()

// ── Token-match (bruges af smagsgenvejene og søgningen) ─────────────────────
/** _token_matches_term */
export function tokenMatchesTerm(token: string, term: string): boolean {
  if (!token || !term) return false
  if (token.includes('æ') || token.includes('ø') || term.includes('æ') || term.includes('ø')) {
    const ft = fold(token)
    const fm = fold(term)
    if (ft !== token || fm !== term) return tokenMatchesTerm(ft, fm)
  }
  if (token === term || token.startsWith(term)) return true
  if (token.endsWith(term) && cpLen(token) - cpLen(term) >= 3) return true
  return cpLen(token) >= 4 && term.startsWith(token)
}

/** _field_matches_term */
export function fieldMatchesTerm(field: string, term: string): boolean {
  for (const tok of pySplit(field)) if (tokenMatchesTerm(tok, term)) return true
  return false
}

/** _fuzzy_term_hits */
export function fuzzyTermHits(term: string, words: readonly string[], threshold = 82.0): boolean {
  const lt = cpLen(term)
  if (lt < 4) return false
  for (const w of words) {
    if (!w || Math.abs(cpLen(w) - lt) > 3) continue
    if (Math.max(rapidRatio(term, w), rapidTokenSort(term, w)) >= threshold) return true
  }
  return false
}

const canMatchCache = new Map<string, boolean>()
const canFuzzyCache = new Map<string, boolean>()

/** _term_can_match_flavor */
export function termCanMatchFlavor(term: string): boolean {
  let v = canMatchCache.get(term)
  if (v === undefined) {
    v = FLAVOR_VOCAB.some((vocab) => tokenMatchesTerm(vocab, term))
    if (canMatchCache.size > 1024) canMatchCache.clear()
    canMatchCache.set(term, v)
  }
  return v
}

/** _term_can_fuzzy_match_flavor */
export function termCanFuzzyMatchFlavor(term: string): boolean {
  let v = canFuzzyCache.get(term)
  if (v === undefined) {
    v = termCanMatchFlavor(term) || fuzzyTermHits(term, FLAVOR_VOCAB)
    if (canFuzzyCache.size > 1024) canFuzzyCache.clear()
    canFuzzyCache.set(term, v)
  }
  return v
}

const flavorFieldCache = new BoundedCache<string, string>(32768)

/** _cached_search_flavor_field */
export function cachedSearchFlavorField(rawText: string, img: string): string {
  const key = `${rawText}\u0000${img}`
  const hit = flavorFieldCache.get(key)
  if (hit !== undefined) return hit
  const kw = getSearchFlavorKeywords(rawText, img)
  const out = kw ? normalizeName(kw) : ''
  flavorFieldCache.set(key, out)
  return out
}

/** _product_flavor_search_field */
export function productFlavorSearchField(product: Record<string, any>): string {
  if ('_flavor_field' in product) return product._flavor_field || ''
  const g = (k: string, d: any = '') => (k in product ? product[k] : d)
  const rawText = [
    pyStr(pyOr(g('name', null), g('/product/title'))),
    pyStr(pyOr(g('brand', null), g('/product/brand'))),
    pyStr(pyOr(g('description', null), g('/product/description'))),
  ].join(' ')
  const img = pyStrip(pyStr(pyOr(g('image_url', null), g('/product/imageLink'))))
  return cachedSearchFlavorField(rawText, img)
}
