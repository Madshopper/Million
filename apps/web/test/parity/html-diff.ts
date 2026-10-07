// Træ-sammenligning af to HTML-dokumenter (samme regler som templates.test.tsx).
import { parse, parseFragment } from 'parse5'

type NNode = { t: 'el'; tag: string; attrs: Record<string, string>; kids: NNode[] } | { t: 'text'; v: string }

const ws = (s: string) => s.replace(/\s+/g, ' ').trim()

function normStyle(v: string): string {
  return v
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(':')
      return d.slice(0, i).trim().toLowerCase() + ':' + ws(d.slice(i + 1))
    })
    .join(';')
}

function normalize(nodes: any[]): NNode[] {
  const out: NNode[] = []
  for (const n of nodes) {
    if (n.nodeName === '#comment' || n.nodeName === '#documentType') continue
    if (n.nodeName === '#text') {
      const last = out[out.length - 1]
      if (last && last.t === 'text') last.v += n.value
      else out.push({ t: 'text', v: n.value })
      continue
    }
    const attrs: Record<string, string> = {}
    for (const a of n.attrs ?? []) {
      const name = a.prefix ? `${a.prefix}:${a.name}` : a.name
      let v = ws(a.value)
      if (name === 'style') v = normStyle(a.value)
      if (v === name) v = '' // boolean-attribut: disabled="disabled" == disabled
      attrs[name] = v
    }
    const kids = n.content ? n.content.childNodes : n.childNodes
    out.push({ t: 'el', tag: n.tagName, attrs, kids: normalize(kids ?? []) })
  }
  return out
    .map((x) => (x.t === 'text' ? { t: 'text' as const, v: ws(x.v) } : x))
    .filter((x) => x.t !== 'text' || x.v !== '')
}

function label(n: NNode): string {
  if (n.t === 'text') return `"${n.v.slice(0, 40)}"`
  const id = n.attrs.id ? `#${n.attrs.id}` : ''
  const cls = n.attrs.class ? '.' + n.attrs.class.split(' ').join('.') : ''
  return `${n.tag}${id}${cls}`
}

/** Første forskel som læsbar sti, eller null. */
export function diff(a: NNode[], b: NNode[], path: string): string | null {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i], y = b[i]
    const here = `${path} > [${i}]`
    if (!x || !y) {
      return `${here}: ${x ? 'kun i Flask: ' + label(x) : 'kun i TSX: ' + label(y!)}`
    }
    if (x.t !== y.t) return `${here}: ${label(x)} (Flask) vs ${label(y)} (TSX)`
    if (x.t === 'text' && y.t === 'text') {
      if (x.v !== y.v) return `${here}: tekst\n  Flask: ${JSON.stringify(x.v.slice(0, 300))}\n  TSX:   ${JSON.stringify(y.v.slice(0, 300))}`
      continue
    }
    if (x.t === 'el' && y.t === 'el') {
      const p = `${path} > ${label(x)}`
      if (x.tag !== y.tag) return `${here}: tag ${x.tag} (Flask) vs ${y.tag} (TSX)`
      const keys = new Set([...Object.keys(x.attrs), ...Object.keys(y.attrs)])
      for (const k of keys) {
        if (x.attrs[k] !== y.attrs[k]) {
          return `${p}: attribut ${k}\n  Flask: ${JSON.stringify(x.attrs[k])}\n  TSX:   ${JSON.stringify(y.attrs[k])}`
        }
      }
      const d = diff(x.kids, y.kids, p)
      if (d) return d
    }
  }
  return null
}

export function tree(html: string, full: boolean): NNode[] {
  return normalize((full ? parse(html) : parseFragment(html)).childNodes as any[])
}

