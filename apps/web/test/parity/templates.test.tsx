// Paritet: TSX-porten mod Flask/Jinja-renderinger (fixtures/templates.json,
// genereres af gen_template_fixtures.py). Sammenligner DOM-træer, ikke bytes.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse, parseFragment } from 'parse5'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { RequestInfo, SiteContext } from '~/components/context'
import { IndexProducts } from '~/components/IndexProducts'
import { ProductGrid } from '~/components/ProductGrid'
import { AboutPage } from '~/components/pages/AboutPage'
import { CategoryPage } from '~/components/pages/CategoryPage'
import { FeedbackPage } from '~/components/pages/FeedbackPage'
import { IndexPage } from '~/components/pages/IndexPage'
import { NotFoundPage } from '~/components/pages/NotFoundPage'
import { PrivacyPage } from '~/components/pages/PrivacyPage'
import { SearchResultsPage } from '~/components/pages/SearchResultsPage'
import { TermsPage } from '~/components/pages/TermsPage'
import { renderFragment, renderPage } from '~/components/render'

interface Fixture {
  name: string
  template: string
  path: string
  query: string
  endpoint: string
  view_args: Record<string, string>
  context: Record<string, any>
  site_context: SiteContext
  html: string
}

const fixtures: Fixture[] = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/templates.json', import.meta.url)), 'utf8'),
)

function render(f: Fixture): { html: string; full: boolean } {
  const site = f.site_context
  const req: RequestInfo = {
    path: f.path,
    endpoint: f.endpoint,
    args: new URLSearchParams(f.query),
    viewArgs: f.view_args,
  }
  const c = f.context as any
  const page = (el: ReactElement) => ({ html: renderPage(el), full: true })
  const frag = (el: ReactElement) => ({ html: renderFragment(el), full: false })
  switch (f.template) {
    case 'index.html': return page(<IndexPage site={site} req={req} {...c} />)
    case 'partials/index_products.html': return frag(<IndexProducts {...c} />)
    case 'category.html': return page(<CategoryPage site={site} req={req} {...c} />)
    case 'partials/product_grid.html': return frag(<ProductGrid site={site} req={req} {...c} />)
    case 'search_results.html': return page(<SearchResultsPage site={site} req={req} {...c} />)
    case 'about.html': return page(<AboutPage site={site} req={req} />)
    case 'terms.html': return page(<TermsPage site={site} req={req} />)
    case 'privacy.html': return page(<PrivacyPage site={site} req={req} />)
    case 'feedback.html': return page(<FeedbackPage site={site} req={req} />)
    case 'not_found.html': return page(<NotFoundPage site={site} req={req} />)
  }
  throw new Error(`Ingen komponent for ${f.template}`)
}

// --- Normalisering ---------------------------------------------------------------

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
function diff(a: NNode[], b: NNode[], path: string): string | null {
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

function tree(html: string, full: boolean): NNode[] {
  return normalize((full ? parse(html) : parseFragment(html)).childNodes as any[])
}

describe('template-paritet (Jinja vs TSX)', () => {
  it('har fixtures', () => {
    expect(fixtures.length).toBeGreaterThan(10)
  })
  it('sammenligneren fanger forskelle', () => {
    const f = fixtures.find((x) => x.name === 'category_p2')!
    const { html, full } = render(f)
    const mutations: Array<[string, string]> = [
      ['data-rema-kg-price="', 'data-rema-kg-price="9'],
      ['onclick="openOverlay(this)"', 'onclick="openOverlay(that)"'],
      ['class="page-btn active"', 'class="page-btn"'],
      [' kr</div>', ' kr.</div>'],
    ]
    for (const [a, b] of mutations) {
      expect(f.html.includes(a), a).toBe(true)
      expect(diff(tree(f.html.replace(a, b), full), tree(html, full), ''), a).not.toBeNull()
    }
  })
  for (const f of fixtures) {
    it(`${f.name} (${f.template})`, () => {
      const { html, full } = render(f)
      const d = diff(tree(f.html, full), tree(html, full), '')
      expect(d, d ?? '').toBeNull()
    })
  }
})
