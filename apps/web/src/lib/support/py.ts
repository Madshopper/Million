// Små Python-semantik-hjælpere, så porten af app_support.py/app.py opfører
// sig som CPython: str(), truthiness, `x or y`, float()/int(), str.strip(),
// str.split(), len() i kodepunkter og Unicode-bevidste \w/\b/\s/\d.

/** Python's \w for str-mønstre (verificeret: præcis kategori L* + N* + '_'). */
export const W = '[\\p{L}\\p{N}_]'
/** \b foran et ordtegn. */
export const B_START = `(?<!${W})`
/** \b efter et ordtegn. */
export const B_END = `(?!${W})`
/** Python's \s / str.isspace() (afviger fra JS' \s: \x1c-\x1f og \x85 med, ﻿ ikke). */
export const WS_CLASS = '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]'
/** Python's \d (Unicode-kategori Nd). */
export const D = '\\p{Nd}'

const WS_RE_START = new RegExp(`^${WS_CLASS}+`, 'u')
const WS_RE_END = new RegExp(`${WS_CLASS}+$`, 'u')
const WS_SPLIT = new RegExp(`${WS_CLASS}+`, 'u')
const ND_RE = /\p{Nd}/u

/** str.strip() uden argument. */
export function pyStrip(s: string): string {
  return s.replace(WS_RE_START, '').replace(WS_RE_END, '')
}

/** str.split() uden argument: deler på whitespace-runs, dropper tomme. */
export function pySplit(s: string): string[] {
  if (!s) return []
  return s.split(WS_SPLIT).filter((t) => t !== '')
}

/** Python-truthiness. NaN er truthy i Python. */
export function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === '' || v === 0) return false
  if (Array.isArray(v)) return v.length > 0
  if (v instanceof Set || v instanceof Map) return v.size > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

/** `a or b` */
export function pyOr<A, B>(a: A, b: B): A | B {
  return pyTruthy(a) ? a : b
}

/** dict.get(k, default): default KUN når nøglen mangler (ikke ved None). */
export function pyGet(o: any, k: string, d: any = null): any {
  if (o === null || o === undefined || typeof o !== 'object' || Array.isArray(o)) {
    throw new TypeError(`'${o === null ? 'NoneType' : typeof o}' object has no attribute 'get'`)
  }
  return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : d
}

export function isDict(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * str(x). Tal: JS kan ikke skelne int fra float, så heltal skrives som int
 * ('5', ikke '5.0'). Kun relevant for ikke-streng-værdier, som dataene ikke har.
 */
export function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  if (typeof v === 'string') return v
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'nan'
    if (v === Infinity) return 'inf'
    if (v === -Infinity) return '-inf'
    return String(v)
  }
  return String(v)
}

/** Antal kodepunkter (Python len()). */
export function cpLen(s: string): number {
  let n = s.length
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        n--
        i++
      }
    }
  }
  return n
}

/** s[:n] i kodepunkter. */
export function cpSlice(s: string, n: number): string {
  if (cpLen(s) === s.length) return s.slice(0, n)
  return Array.from(s).slice(0, n).join('')
}

/** Python's strengsammenligning (kodepunkt-orden, ikke UTF-16-orden). */
export function cpCompare(a: string, b: string): number {
  if (a === b) return 0
  const ia = a[Symbol.iterator]()
  const ib = b[Symbol.iterator]()
  for (;;) {
    const x = ia.next()
    const y = ib.next()
    if (x.done) return y.done ? 0 : -1
    if (y.done) return 1
    const cx = x.value.codePointAt(0)!
    const cy = y.value.codePointAt(0)!
    if (cx !== cy) return cx < cy ? -1 : 1
  }
}

/** Unicode-ciffer (Nd) -> værdi. Nd-tegn ligger altid i hele løb af 10. */
function ndValue(ch: string): number {
  const cp = ch.codePointAt(0)!
  if (cp >= 0x30 && cp <= 0x39) return cp - 0x30
  let start = cp
  while (start > 0 && ND_RE.test(String.fromCodePoint(start - 1))) start--
  return (cp - start) % 10
}

function asciiDigits(s: string): string {
  let out = ''
  for (const ch of s) out += ND_RE.test(ch) ? String(ndValue(ch)) : ch
  return out
}

const FLOAT_RE = /^[+-]?(?:(?:\d(?:_?\d)*)?\.?(?:\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?)$/
const SPECIAL_FLOAT_RE = /^([+-]?)(inf|infinity|nan)$/i
const INT_RE = /^[+-]?\d(?:_?\d)*$/

/** float(x). Kaster TypeError/ValueError som Python. */
export function pyFloat(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v !== 'string') throw new TypeError('float() argument must be a string or a real number')
  const s = asciiDigits(pyStrip(v))
  const sp = SPECIAL_FLOAT_RE.exec(s)
  if (sp) {
    if (sp[2].toLowerCase() === 'nan') return NaN
    return sp[1] === '-' ? -Infinity : Infinity
  }
  // Mindst ét ciffer i mantissen (før evt. eksponent).
  if (!FLOAT_RE.test(s) || !/\d/.test(s.split(/[eE]/)[0])) {
    throw new RangeError(`could not convert string to float: '${v}'`)
  }
  // Underscore kun mellem cifre - allerede håndhævet af regex'en.
  return Number(s.replace(/_/g, ''))
}

/** float(x) med fallback ved fejl (try/except (TypeError, ValueError)). */
export function pyFloatOr<T>(v: unknown, fallback: T): number | T {
  try {
    return pyFloat(v)
  } catch {
    return fallback
  }
}

/** int(str) (kun streng-/tal-input). Kaster ved ugyldigt input. */
export function pyInt(v: unknown): number {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new RangeError('cannot convert float to integer')
    return Math.trunc(v)
  }
  if (typeof v !== 'string') throw new TypeError('int() argument must be a string or a number')
  const s = asciiDigits(pyStrip(v))
  if (!INT_RE.test(s)) throw new RangeError(`invalid literal for int() with base 10: '${v}'`)
  return Number(s.replace(/_/g, ''))
}

/** Escape til RegExp med u-flag (kun syntakstegn - u-flaget forbyder fx '\-'). */
export function reEscape(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')
}

/** Stabil sortering med Python-semantik for key + reverse (stabil også ved reverse). */
export function pySorted<T, K>(items: T[], key: (x: T) => K, reverse = false, cmp?: (a: K, b: K) => number): T[] {
  const compare = cmp ?? ((a: any, b: any) => (a < b ? -1 : b < a ? 1 : 0))
  const keyed = items.map((x) => ({ x, k: key(x) }))
  keyed.sort((a, b) => (reverse ? compare(b.k, a.k) : compare(a.k, b.k)))
  return keyed.map((e) => e.x)
}

/** Simpel størrelsesbegrænset memo (erstatter lru_cache; ryddes helt ved overløb). */
export class BoundedCache<K, V> {
  private map = new Map<K, V>()
  constructor(private max: number) {}
  get(k: K): V | undefined {
    return this.map.get(k)
  }
  has(k: K): boolean {
    return this.map.has(k)
  }
  set(k: K, v: V): void {
    if (this.map.size >= this.max) this.map.clear()
    this.map.set(k, v)
  }
}
