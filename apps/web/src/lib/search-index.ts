// Søgning via ordindekset i KV (app.py::_sidx_* / load_search_raw). Indekset
// bygges af scripts/seed-d1.py::build_search_shards. Alt fejler åbent til
// LIKE-søgningen, præcis som i Python.
import type { RawProduct } from './types'
import { d1Products, d1Rows, kvGetJson, parseRows } from './data'
import { fold, normalizeName } from './support'

const SIDX_ROW_SPAN = 100_000 // skal matche scripts/seed-d1.py
const SIDX_SUFFIX_MIN_LEN = 5 // skal matche scripts/seed-d1.py
const SIDX_VER_TTL_MS = 60_000
const SIDX_MAX_SHARDS = 16

type Manifest = { v: number; p: Set<string>; s: Set<string> }
type Shard = [string[], number[][]]

let manifest: Manifest | null = null
let manifestAt = 0
const shards = new Map<string, Shard>()

class SidxUnavailable extends Error {}

async function sidxCurrent(): Promise<Manifest | null> {
  const now = Date.now()
  if (manifestAt && now - manifestAt < SIDX_VER_TTL_MS) return manifest
  const m = await kvGetJson<{ v: number; p?: string[]; s?: string[] }>('sidx_ver')
  if (!m || typeof m !== 'object' || !Number.isInteger(m.v)) return null
  manifest = { v: m.v, p: new Set(m.p ?? []), s: new Set(m.s ?? []) }
  manifestAt = now
  return manifest
}

function forgetVersion() {
  manifestAt = 0
}

// Python: format(ord(ch), 'x') - kodepunkt, ikke UTF-16-enhed.
const shardId = (ch: string) => ch.codePointAt(0)!.toString(16)

async function getShard(m: Manifest, kind: 'p' | 's', ch: string): Promise<Shard | null> {
  const sid = shardId(ch)
  if (!m[kind].has(sid)) return null
  const key = `${m.v}:${kind}:${sid}`
  const hit = shards.get(key)
  if (hit) return hit
  const raw = await kvGetJson<{ t: string[]; p: number[][] }>(`sidx:${m.v}:${kind}:${sid}`)
  if (!raw || !Array.isArray(raw.t) || !Array.isArray(raw.p) || raw.t.length !== raw.p.length) {
    throw new SidxUnavailable(`shard ${kind}:${sid}`)
  }
  if (shards.size >= SIDX_MAX_SHARDS) shards.delete(shards.keys().next().value!)
  const shard: Shard = [raw.t, raw.p]
  shards.set(key, shard)
  return shard
}

// bisect.bisect_left på en sorteret liste af str (Python sammenligner kodepunkter;
// JS' < sammenligner UTF-16-enheder - ens for BMP-tegn, som er alt i kataloget).
function bisectLeft(arr: string[], x: string): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

function prefixIds(shard: Shard, prefix: string, minLen: number, out: Set<number>) {
  const [toks, posts] = shard
  for (let i = bisectLeft(toks, prefix); i < toks.length && toks[i].startsWith(prefix); i++) {
    if ([...toks[i]].length >= minLen) for (const id of posts[i]) out.add(id)
  }
}

const cpLen = (s: string) => [...s].length
const cpSlice = (s: string, a: number, b?: number) => [...s].slice(a, b).join('')
const reverse = (s: string) => [...s].reverse().join('')

async function termIds(get: (k: 'p' | 's', ch: string) => Promise<Shard | null>, term: string) {
  const out = new Set<number>()
  const first = cpSlice(term, 0, 1)
  const pre = await get('p', first)
  if (pre) {
    prefixIds(pre, term, 0, out)
    // Omvendt præfiks: søgeordet udvider et trunkeret token (>= 4 tegn).
    const [toks, posts] = pre
    for (let n = 4; n < cpLen(term); n++) {
      const head = cpSlice(term, 0, n)
      const i = bisectLeft(toks, head)
      if (i < toks.length && toks[i] === head) for (const id of posts[i]) out.add(id)
    }
  }
  const minLen = Math.max(cpLen(term) + 3, SIDX_SUFFIX_MIN_LEN)
  const suf = await get('s', cpSlice(term, -1))
  if (suf) prefixIds(suf, reverse(term), minLen, out)
  return out
}

async function sidxCandidates(
  get: (k: 'p' | 's', ch: string) => Promise<Shard | null>, terms: string[], typo: string[],
): Promise<number[]> {
  let result: Set<number> | null = null
  for (const term of terms) {
    const ids = await termIds(get, term)
    const prev: Set<number> | null = result
    result = prev === null ? ids : new Set([...prev].filter((x: number) => (ids as Set<number>).has(x)))
    if (!result.size) break
  }
  if ((!result || !result.size) && typo.length) {
    result = new Set()
    for (const prefix of typo) {
      const shard = await get('p', cpSlice(prefix, 0, 1))
      if (shard) prefixIds(shard, prefix, 0, result)
    }
  }
  return [...(result ?? [])].sort((a, b) => a - b)
}

async function sidxSearch(tokens: string[], limit: number): Promise<RawProduct[] | null> {
  const m = await sidxCurrent()
  if (!m) return null
  const terms = tokens.filter(Boolean).map(fold)
  const typo = [...new Set(tokens.filter((t) => cpLen(t) >= 5).map((t) => cpSlice(fold(t), 0, 3)))].sort()
  let ids: number[]
  try {
    ids = (await sidxCandidates((k, ch) => getShard(m, k, ch), terms, typo)).slice(0, limit)
  } catch (e) {
    if (e instanceof SidxUnavailable) {
      console.warn('søgeindeks utilgængeligt - bruger LIKE', e.message)
      return null
    }
    throw e
  }
  if (!ids.length) return []
  if (!ids.every((i) => Math.floor(i / SIDX_ROW_SPAN) === m.v)) return null
  const rows = await d1Rows<{ r: number; data: string }>(
    `SELECT rowid AS r, data FROM products WHERE rowid IN (${ids.map((i) => Math.trunc(i)).join(',')})`,
  )
  if (rows.length !== ids.length) {
    forgetVersion()
    return null
  }
  rows.sort((a, b) => (a.r ?? 0) - (b.r ?? 0))
  return parseRows(rows)
}

const escapeLike = (t: string) => t.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')

function termSearchVariants(term: string): string[] {
  const variants = [term]
  const danish = term.replaceAll('ae', 'æ').replaceAll('oe', 'ø')
  if (danish !== term) variants.push(danish)
  const ascii = term.replaceAll('æ', 'ae').replaceAll('ø', 'oe')
  if (ascii !== term) variants.push(ascii)
  return variants
}

function termLikePatterns(term: string): string[] {
  const patterns: string[] = []
  for (const variant of termSearchVariants(term)) {
    const t = escapeLike(variant)
    patterns.push(`${t}%`, `% ${t}%`, `%${t}`, `%${t} %`)
    if (cpLen(t) >= 5) patterns.push(`%${cpSlice(t, 0, 5)}%`)
  }
  return [...new Set(patterns)]
}

/** app.py::load_search_raw (edge-grenen). */
export async function loadSearchRaw(query: string, limit = 800): Promise<RawProduct[]> {
  const normQuery = normalizeName(query)
  let tokens = normQuery.split(/\s+/).filter((t) => cpLen(t) >= 2)
  if (!tokens.length) tokens = [normQuery.trim()]
  tokens = tokens.slice(0, 8).filter(Boolean)
  if (!tokens.length) return []
  const indexed = await sidxSearch(tokens, limit)
  if (indexed !== null) return indexed
  const clauses: string[] = []
  const params: string[] = []
  for (const term of tokens) {
    const pats = termLikePatterns(term)
    clauses.push('(' + pats.map(() => "search_text LIKE ? ESCAPE '\\'").join(' OR ') + ')')
    params.push(...pats)
  }
  const rows = await d1Products(
    `SELECT data FROM products WHERE ${clauses.join(' AND ')} LIMIT ${Math.trunc(limit)}`, params,
  )
  if (rows.length) return rows
  const prefixes = [...new Set(tokens.filter((t) => cpLen(t) >= 5).map((t) => escapeLike(cpSlice(t, 0, 3))))]
  if (!prefixes.length) return rows
  return d1Products(
    `SELECT data FROM products WHERE ${prefixes.map(() => "search_text LIKE ? ESCAPE '\\'").join(' OR ')} LIMIT ${Math.trunc(limit)}`,
    prefixes.map((p) => `%${p}%`),
  )
}
