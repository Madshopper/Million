// Hjælpere der efterligner Jinja/Python-semantik præcist, så TSX-komponenterne
// giver samme HTML som templates/*.html.

// --- Inline event-handlere og "rå" attributter -----------------------------
// React dropper string-attributter der starter med "on" (onclick="...") og
// tomme src="". Der er ingen hydrering, så de udskrives under et
// pladsholder-navn og omdøbes bagefter af restoreRawAttrs().
const RAW_PREFIX = 'data-jsh-'

/** Inline-handlere som strenge: <button {...on({ onclick: 'toggleMenu()' })}> */
export function on(handlers: Record<string, string>): Record<string, never> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(handlers)) out[RAW_PREFIX + k.toLowerCase()] = v
  return out as unknown as Record<string, never>
}

/** Attributter React ellers ville fjerne (fx src=""). */
export const raw = on

/** src på <img>: React fjerner src="", Jinja skriver det. */
export function imgSrc(v: string): Record<string, never> {
  return (v === '' ? on({ src: '' }) : { src: v }) as Record<string, never>
}

/** Omdøber pladsholder-attributterne til deres rigtige navne. */
export function restoreRawAttrs(html: string): string {
  return html.replace(/ data-jsh-([a-z][a-z0-9-]*)=/g, ' $1=')
}

// --- Python-værdier som tekst ----------------------------------------------

/** Python-truthiness (tom liste/dict/streng, 0, None er falsy). */
export function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return Boolean(v)
}

/** repr(float) som Python: 12.0, 1e+16, 1e-05, 0.30000000000000004. */
export function pyFloatRepr(x: number): string {
  if (Number.isNaN(x)) return 'nan'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0'
  const sign = x < 0 ? '-' : ''
  const [mant, expStr] = Math.abs(x).toExponential().split('e')
  const exp = Number(expStr)
  const digits = mant.replace('.', '')
  if (exp >= -5 + 1 && exp < 16) {
    // fast notation (Python: -4 <= exp < 16)
    let s: string
    if (exp >= 0) {
      const intPart = digits.slice(0, exp + 1).padEnd(exp + 1, '0')
      const frac = digits.slice(exp + 1)
      s = intPart + '.' + (frac || '0')
    } else {
      s = '0.' + '0'.repeat(-exp - 1) + digits
    }
    return sign + s
  }
  const m = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits
  const e = Math.abs(exp).toString().padStart(2, '0')
  return `${sign}${m}e${exp < 0 ? '-' : '+'}${e}`
}

/** {{ v }} for en JSON-værdi: undefined = Jinja Undefined (''), null = None.
 *  Tal behandles som int når de er heltal. */
export function pyStr(v: unknown): string {
  if (v === undefined) return ''
  if (v === null) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : pyFloatRepr(v)
  return String(v)
}

/** str(v) hvor tallet vides at være float i Python (fx weight_g, pris). */
export function pyFloatStr(v: unknown): string {
  return typeof v === 'number' ? pyFloatRepr(v) : pyStr(v)
}

/** "%.2f"|format(x) - Pythons afrunding (halvt-til-lige ved eksakte ties). */
export function pyFormat2f(v: unknown): string {
  const x = Number(v)
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf'
  const a = Math.abs(x)
  let s: string
  // Eksakt tie på 2. decimal kan kun ske for x = m/8 med m ulige.
  const m8 = a * 8
  if (Number.isInteger(m8) && m8 % 2 === 1 && m8 < 2 ** 50) {
    const lo = Math.floor(a * 100)
    const n = lo % 2 === 0 ? lo : lo + 1
    s = (n / 100).toFixed(2)
  } else {
    s = a.toFixed(2)
  }
  return x < 0 || Object.is(x, -0) ? '-' + s : s
}

/** |round(0, 'floor') */
export const jinjaFloor = (x: number): number => Math.floor(x)

/** |int (trunkering mod nul) */
export const jinjaInt = (x: number): number => Math.trunc(x)

// --- JSON (Flask tojson) -----------------------------------------------------

function pyJsonStr(s: string): string {
  let out = '"'
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\b') out += '\\b'
    else if (ch === '\f') out += '\\f'
    else if (c < 0x20 || (c > 0x7e && c <= 0xffff)) out += '\\u' + c.toString(16).padStart(4, '0')
    else if (c > 0xffff) {
      // ensure_ascii: surrogatpar
      const hi = Math.floor((c - 0x10000) / 0x400) + 0xd800
      const lo = ((c - 0x10000) % 0x400) + 0xdc00
      out += '\\u' + hi.toString(16) + '\\u' + lo.toString(16)
    } else out += ch
  }
  return out + '"'
}

/** json.dumps(v, sort_keys=True, ensure_ascii=True) som Flasks DefaultJSONProvider. */
export function pyJsonDumps(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (v === true) return 'true'
  if (v === false) return 'false'
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v)
    if (Number.isNaN(v)) return 'NaN'
    if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity'
    return pyFloatRepr(v)
  }
  if (typeof v === 'string') return pyJsonStr(v)
  if (Array.isArray(v)) return '[' + v.map(pyJsonDumps).join(', ') + ']'
  const keys = Object.keys(v as object).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return '{' + keys.map((k) => pyJsonStr(k) + ': ' + pyJsonDumps((v as any)[k])).join(', ') + '}'
}

/** {{ v|tojson }} - htmlsafe som Flask: < > & ' som \u-escapes. */
export function tojson(v: unknown): string {
  return pyJsonDumps(v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/'/g, '\\u0027')
}
