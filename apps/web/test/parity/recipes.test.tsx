// Paritet for opskrifterne: lib/recipes.ts og RecipePage/RecipesPage mod
// app.py + Jinja (fixtures/recipes.json, genereres af gen_recipe_fixtures.py).
// Supabase og D1 er mocket med præcis de svar, Python-siden fik.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestInfo } from '~/components/context'
import { RecipePage } from '~/components/pages/RecipePage'
import { RecipesPage } from '~/components/pages/RecipesPage'
import { renderPage } from '~/components/render'
import { diff, tree } from './html-diff'
import { canonicalJson, canonicalizeRecipeJson } from './recipe-json'

vi.mock('cloudflare:workers', () => ({
  env: { SUPABASE_URL: 'https://example.supabase.co/', SUPABASE_KEY: 'pub-key', TABLE_SUFFIX: '_dev' },
}))

const fx = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/recipes.json', import.meta.url)), 'utf8'))

// Supabase-svar for den aktuelle test (sti -> [data, status]).
let responses: Record<string, [unknown, number]> = {}
const calls: string[] = []
vi.mock('~/lib/supabase', () => ({
  tableSuffix: () => '_dev',
  supabaseGet: vi.fn(async (path: string, params: Record<string, string>) => {
    calls.push(path)
    const [data, status] = responses[path]
    if (path === 'nutrition_data' && status === 200) {
      const keys = params.key.slice('in.('.length, -1).split(',')
      return [structuredClone((data as any[]).filter((r) => keys.includes(r.key))), status]
    }
    return [structuredClone(data), status]
  }),
}))
vi.mock('~/lib/data', () => ({
  d1Products: vi.fn(async (_sql: string, ids: string[]) =>
    structuredClone(fx.products.filter((p: any) => ids.includes(String(p['/product/id']))))),
}))

const recipes = await import('~/lib/recipes')

beforeEach(() => {
  calls.length = 0
})

describe('opskrift-logik (app.py vs lib/recipes.ts)', () => {
  for (const d of fx.details) {
    it(`_fetch_recipe_detail: ${d.name}`, async () => {
      responses = d.responses
      const got = await recipes.fetchRecipeDetail(String(d.recipe_id))
      expect(canonicalJson(got)).toBe(canonicalJson(d.expected))
      expect([...calls].sort()).toEqual([...d.paths].sort())
    })
  }
  for (const l of fx.lists) {
    it(`get_recipes: ${l.name}`, async () => {
      responses = l.responses
      const [status, body] = await recipes.fetchRecipeList()
      expect(status).toBe(l.status)
      expect(canonicalJson(body)).toBe(canonicalJson(l.expected))
    })
  }
  it('fejlede delopslag markerer svaret degraderet (ikke i edge-cachen)', async () => {
    const { runWithRequestState } = await import('~/lib/request-state')
    const run = async (name: string) => {
      responses = fx.details.find((x: any) => x.name === name).responses
      const state = { request: new Request('http://x/'), url: new URL('http://x/'), degraded: null, endpoint: null }
      await runWithRequestState(state, () => recipes.fetchRecipeDetail('1'))
      return state.degraded
    }
    expect(await run('ingredients_error')).toBe('recipe_ingredients')
    expect(await run('full')).toBeNull()
  })
  it('_parse_nutrition_number', () => {
    for (const [v, preferKcal, want] of fx.nutrition_numbers) {
      expect(recipes.parseNutritionNumber(v, preferKcal), `${v} ${preferKcal}`).toBe(want)
    }
  })
  it('_alt_store_prices', () => {
    for (const [p, want] of fx.store_prices) expect(canonicalJson(recipes.altStorePrices(p))).toBe(canonicalJson(want))
  })
})

describe('/api/recipe-click (validering + RPC-kald, uden netværk)', () => {
  it('int(payload.get("recipe_id", 0)) som Flask', () => {
    const cases: Array<[unknown, number | null]> = [
      [{ recipe_id: 5 }, 5], [{ recipe_id: '7' }, 7], [{ recipe_id: ' 8 ' }, 8], [{ recipe_id: 5.9 }, 5],
      [{ recipe_id: true }, 1], [{ recipe_id: '5.0' }, null], [{ recipe_id: 'x' }, null], [{ recipe_id: null }, null],
      [{ recipe_id: [1] }, null], [{}, null], [{ recipe_id: 0 }, null], [{ recipe_id: -3 }, null],
      [{ recipe_id: 10_000_000_000 }, 10_000_000_000], [{ recipe_id: 10_000_000_001 }, null], [[1], null], ['5', null], [null, null],
    ]
    for (const [payload, want] of cases) expect(recipes.parseRecipeClickId(payload), JSON.stringify(payload)).toBe(want)
  })
  it('get_json(silent=True): kun JSON-mimetyper, null ved fejl', async () => {
    const r = (ct: string, body: string) => new Request('http://x/api/recipe-click', { method: 'POST', headers: { 'Content-Type': ct }, body })
    expect(await recipes.readJsonSilent(r('application/json', '{"recipe_id":5}'))).toEqual({ recipe_id: 5 })
    expect(await recipes.readJsonSilent(r('application/json; charset=utf-8', '[1]'))).toEqual([1])
    expect(await recipes.readJsonSilent(r('application/vnd.api+json', '{}'))).toEqual({})
    expect(await recipes.readJsonSilent(r('text/plain', '{"recipe_id":5}'))).toBeNull()
    expect(await recipes.readJsonSilent(r('application/json', '{bad'))).toBeNull()
  })
  it('POST rpc/record_recipe_click<suffix> med p_recipe_id', async () => {
    const seen: Array<[string, RequestInit]> = []
    const fake = (async (url: string, init: RequestInit) => {
      seen.push([url, init])
      return new Response(null, { status: 204 })
    }) as unknown as typeof fetch
    expect(await recipes.recordRecipeClick(42, fake)).toBe(204)
    expect(seen).toHaveLength(1)
    const [url, init] = seen[0]
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/record_recipe_click_dev')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ apikey: 'pub-key', Authorization: 'Bearer pub-key', 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({ p_recipe_id: 42 })
    const failing = (async () => { throw new Error('net') }) as unknown as typeof fetch
    expect(await recipes.recordRecipeClick(42, failing)).toBe(0)
  })
  it('<int:...>-segmenter', () => {
    expect(recipes.parseIntSegment('5')).toBe('5')
    expect(recipes.parseIntSegment('007')).toBe('7')
    expect(recipes.parseIntSegment('0')).toBe('0')
    expect(recipes.parseIntSegment('١٢')).toBe('12')
    for (const bad of ['', 'abc', '-1', '+1', '1.0', '1 ']) expect(recipes.parseIntSegment(bad), bad).toBeNull()
  })
})

describe('skabelon-paritet (opskrift.html / opskrifter.html vs TSX)', () => {
  it('sammenligneren fanger forskelle', () => {
    const f = fx.pages.find((p: any) => p.name === 'opskrift_full')
    const html = canonicalizeRecipeJson(render(f))
    for (const [a, b] of [['recipe-ingredient--unmatched', 'recipe-ingredient'], ['data-base-kcal="', 'data-base-kcal="1'], [' kr)', ' kr']]) {
      expect(f.html.includes(a), a).toBe(true)
      expect(diff(tree(canonicalizeRecipeJson(f.html.replace(a, b)), true), tree(html, true), ''), a).not.toBeNull()
    }
  })
  for (const f of fx.pages) {
    it(`${f.name} (${f.template})`, () => {
      const d = diff(tree(canonicalizeRecipeJson(f.html), true), tree(canonicalizeRecipeJson(render(f)), true), '')
      expect(d, d ?? '').toBeNull()
    })
  }
})

function render(f: any): string {
  const req: RequestInfo = { path: f.path, endpoint: f.endpoint, args: new URLSearchParams(), viewArgs: f.view_args }
  if (f.template === 'opskrifter.html') return renderPage(<RecipesPage site={f.site_context} req={req} />)
  return renderPage(<RecipePage site={f.site_context} req={req} {...f.context} />)
}
