// Paritet: admin + session (lib/admin*.ts, lib/staging.ts, routes/api/admin/*)
// mod app.py og src/worker.py. Fixturen bygges af gen_admin_fixtures.py, som
// kører Python-funktionerne direkte (uden netværk).
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakeEnv = vi.hoisted(() => ({}) as Record<string, string | undefined>)
vi.mock('cloudflare:workers', () => ({ env: fakeEnv }))
// Vitest stubber CSS-importer (også ?raw) til en tom streng; Vite selv giver
// filens indhold (tjekket med ssrLoadModule). Her læses filen direkte.
vi.mock('../../../../templates/admin/admin.css?raw', async () => {
  const { readFileSync: read } = await import('node:fs')
  return { default: read(new URL('../../../../templates/admin/admin.css', import.meta.url), 'utf8') }
})

import {
  abortResponse, adminGate, bearerJwt, isAdminSession, isAdminToken, jwtExp,
  originNetloc, sessionResponse, sessionSetCookie, werkzeugErrorBody,
} from '~/lib/admin'
import { d1BudgetFromGroups, pyRound, TRAFFIC_QUERY, trafficFromAccount, trafficVariables } from '~/lib/admin-analytics'
import { handleAdminFeatures, type FeaturesKv } from '~/lib/admin-features'
import { FEATURES, PROJECTS } from '~/lib/feature-catalog'
import { buildStagingLink, stagingLinkSig, stagingSessionToken, verifyStagingLink } from '~/lib/staging'
import { runWithRequestState } from '~/lib/request-state'
import { adminProductIds } from '~/routes/api/admin/products'

const FIX = JSON.parse(readFileSync(new URL('./fixtures/admin.json', import.meta.url), 'utf8'))
const NOW: number = FIX.now
const NOW_DATE = new Date(NOW * 1000)

const inRequest = <T>(request: Request, fn: () => T) =>
  runWithRequestState({ request, url: new URL(request.url), degraded: null, endpoint: null }, fn)

beforeEach(() => {
  for (const k of Object.keys(fakeEnv)) delete fakeEnv[k]
  fakeEnv.SUPABASE_URL = 'https://supabase.test'
  fakeEnv.SUPABASE_KEY = 'anon-key'
})
afterEach(() => vi.unstubAllGlobals())

describe('staging-signaturer', () => {
  it('stagingLinkSig = app.staging_link_sig = worker._staging_link_sig', async () => {
    for (const c of FIX.sigs) {
      expect(c.app).toBe(c.worker)
      expect(await stagingLinkSig(c.secret, c.exp)).toBe(c.app)
    }
  })
  it('stagingSessionToken = worker._staging_session_token', async () => {
    for (const c of FIX.session_tokens) expect(await stagingSessionToken(c.secret)).toBe(c.token)
  })
  it('verifyStagingLink følger worker.py-reglerne', async () => {
    const sig = await stagingLinkSig('k', NOW + 60)
    expect(await verifyStagingLink('k', `${NOW + 60}.${sig}`, NOW)).toBe(true)
    expect(await verifyStagingLink('andet', `${NOW + 60}.${sig}`, NOW)).toBe(false)
    expect(await verifyStagingLink('k', `${NOW + 60}.${sig}`, NOW + 61)).toBe(false) // udløbet
    const far = await stagingLinkSig('k', NOW + 301)
    expect(await verifyStagingLink('k', `${NOW + 301}.${far}`, NOW)).toBe(false) // for langt ude
    expect(await verifyStagingLink('k', `²${NOW + 60}.${sig}`, NOW)).toBe(false)
    expect(await verifyStagingLink('k', 'uden-punktum', NOW)).toBe(false)
  })
})

describe('staging-link', () => {
  it('samme url/direct som admin_staging_link', async () => {
    for (const c of FIX.staging) {
      const got = await buildStagingLink(c.secret, c.body.path, NOW)
      expect({ success: true, ...got }).toEqual(c.json)
    }
  })
})

describe('session', () => {
  it('jwtExp = _jwt_exp', () => {
    for (const c of FIX.jwt_exp) expect([c.token, jwtExp(c.token)]).toEqual([c.token, c.exp])
  })

  it('POST /api/session = api_session (status, cookie, cache-control)', async () => {
    for (const c of FIX.session) {
      const request = new Request('http://localhost/api/session', { method: 'POST', headers: c.headers })
      const res = inRequest(request, () => sessionResponse(request, NOW))
      expect(res.status).toBe(c.status)
      const cookie = res.headers.get('Set-Cookie')
      const stripped = cookie ? [cookie.split('; ').filter((p) => !p.startsWith('Expires=')).join('; ')] : []
      expect(stripped).toEqual(c.set_cookie)
      if (c.status === 204) expect(res.headers.get('Cache-Control')).toBe(c.cache_control)
      else expect(JSON.parse(await res.text())).toEqual(JSON.parse(c.body))
    }
  })

  it('Expires i Werkzeug-format og = nu + Max-Age', () => {
    const token = FIX.session[1].set_cookie[0].split(';')[0].split('=')[1]
    const cookie = sessionSetCookie(token, NOW)
    expect(cookie).toContain(`Expires=${new Date((NOW + 3600) * 1000).toUTCString()}; Max-Age=3600;`)
    expect(cookie).toMatch(/; Expires=(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d\d (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d\d:\d\d:\d\d GMT; /)
    expect(sessionSetCookie(null, NOW)).toBe(
      'ms_session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Secure; HttpOnly; Path=/; SameSite=Lax',
    )
  })

  it('originNetloc som urlparse(...).netloc', () => {
    expect(originNetloc('https://madshopper.dk')).toBe('madshopper.dk')
    expect(originNetloc('http://localhost:5001/x')).toBe('localhost:5001')
    expect(originNetloc('null')).toBe('')
    expect(originNetloc('//host')).toBe('host')
    expect(bearerJwt('Bearer kort')).toBeNull()
  })
})

describe('admin-tjek og 404', () => {
  const good = FIX.session[1].set_cookie[0].split(';')[0].split('=')[1]

  function stubSupabase(answer: unknown, status = 200) {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify(answer), { status })
    }))
    return calls
  }

  it('isAdminToken kalder rpc/is_admin med brugerens egen JWT og kræver true', async () => {
    const calls = stubSupabase(true)
    expect(await isAdminToken(good)).toBe(true)
    expect(calls[0].url).toBe('https://supabase.test/rest/v1/rpc/is_admin')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.body).toBe('{}')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${good}`)
    expect((calls[0].init.headers as Record<string, string>).apikey).toBe('anon-key')
    stubSupabase(false)
    expect(await isAdminToken(good)).toBe(false)
    stubSupabase('true')
    expect(await isAdminToken(good)).toBe(false)
    stubSupabase(true, 401)
    expect(await isAdminToken(good)).toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    expect(await isAdminToken(good)).toBe(false)
  })

  it('ugyldige tokens når aldrig Supabase', async () => {
    const calls = stubSupabase(true)
    for (const t of ['', 'a.b', 'x'.repeat(5000), 'a.b.c d', null, undefined]) expect(await isAdminToken(t)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('/api/admin/*: samme status og body som Flask for ikke-admins', async () => {
    for (const c of FIX.denied) {
      if (c.route === '/admin') {
        expect(c.status).toBe(404)
        continue
      }
      stubSupabase(c.auth ? false : true, 200)
      const headers: Record<string, string> = c.auth ? { Authorization: `Bearer ${good}` } : {}
      const request = new Request(`http://localhost${c.route}`, { method: c.method, headers })
      const res = await inRequest(request, () => adminGate(request, 'x'))
      expect(res).not.toBeNull()
      expect(res!.status).toBe(c.status)
      expect(await res!.text()).toBe(c.body)
    }
    // Og det er præcis Flasks svar på en sti der ikke findes.
    expect(werkzeugErrorBody(404)).toBe(FIX.not_found.body)
  })

  it('adminGate slipper kun en admin med POST igennem', async () => {
    stubSupabase(true)
    const post = new Request('http://localhost/api/admin/edge', { method: 'POST', headers: { Authorization: `Bearer ${good}` } })
    expect(await inRequest(post, () => adminGate(post, 'admin_edge'))).toBeNull()
    const get = new Request('http://localhost/api/admin/edge', { headers: { Authorization: `Bearer ${good}` } })
    expect((await inRequest(get, () => adminGate(get, 'admin_edge')))!.status).toBe(404)
  })

  it('/admin læser cookien ms_session', async () => {
    const calls = stubSupabase(true)
    const r = new Request('http://localhost/admin', { headers: { Cookie: `andet=1; ms_session=${good}` } })
    expect(await isAdminSession(r)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(await isAdminSession(new Request('http://localhost/admin'))).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('abort(400) = Werkzeugs Bad Request', async () => {
    const step = FIX.features.find((s: any) => s.status === 400)
    const r = new Request('http://localhost/')
    expect(await inRequest(r, () => abortResponse('x', 400)).text()).toBe(step.text)
  })
})

describe('analytics', () => {
  it('pyRound = Pythons round()', () => {
    expect(pyRound(12.25, 1)).toBe(12.2)
    expect(pyRound(12.35, 1)).toBe(12.3) // 12.35 ligger binært under
    expect(pyRound(1250.5)).toBe(1250)
    expect(pyRound(2.5)).toBe(2)
    expect(pyRound(3.5)).toBe(4)
    expect(pyRound(0.05)).toBe(0)
  })

  it('trafik: query, variabler og omsætning = _admin_traffic', () => {
    for (const c of FIX.traffic) {
      expect(TRAFFIC_QUERY).toBe(c.call.query)
      expect(trafficVariables(NOW_DATE)).toEqual(c.call.variables)
      expect(trafficFromAccount(c.acc, NOW_DATE)).toEqual(c.out)
    }
  })

  it('D1-budget = _admin_d1_budget', () => {
    const { groups, out, call } = FIX.d1_budget
    expect(d1BudgetFromGroups(groups, '2026-10-07')).toEqual(out)
    expect(call.body.variables).toEqual({ a: 'acct', d: '2026-10-07' })
  })
})

describe('feature-panelet', () => {
  function fakeKv(initial: Record<string, string>) {
    const data = { ...initial }
    const kv: FeaturesKv = {
      get: async (k) => data[k] ?? null,
      put: async (k, v) => { data[k] = v },
    }
    return { kv, data }
  }
  const forced = (name: string) => FIX.features_env[name] === '1'

  it('katalog = app._FEATURES/_PROJECTS', () => {
    const list = FIX.features_readonly[0].json
    expect(FEATURES.map((f) => f.key)).toEqual(list.features.map((f: any) => f.key))
    expect(PROJECTS.map((p) => ({ ...p }))).toEqual(list.projects)
  })

  it('skridt for skridt mod KV = admin_features', async () => {
    const { kv, data } = fakeKv(FIX.features_initial_kv)
    for (const step of FIX.features) {
      const res = await handleAdminFeatures(step.body, { kv, editable: true, forced, now: NOW_DATE })
      if (step.json === null) {
        expect(res).toEqual({ kind: 'abort', status: step.status })
      } else {
        expect(res.kind).toBe('json')
        expect(res).toEqual({ kind: 'json', status: step.status, body: step.json })
      }
      const parsed = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, JSON.parse(v)]))
      expect(parsed).toEqual(step.kv)
    }
  })

  it('ikke redigerbar: kun visning, ændringer giver 409', async () => {
    for (const step of FIX.features_readonly) {
      const res = await handleAdminFeatures(step.body, { kv: null, editable: false, forced, now: NOW_DATE })
      if (step.json === null) expect(res).toEqual({ kind: 'abort', status: step.status })
      else expect(res).toEqual({ kind: 'json', status: step.status, body: step.json })
    }
  })
})

describe('admin products', () => {
  it("id'er = admin_products' normalisering", () => {
    for (const c of FIX.product_ids) {
      expect(adminProductIds(c.body).filter((i) => i.trim())).toEqual(c.ids)
    }
  })
})

describe('admin-siden', () => {
  // ?v=-hashes afhænger af static/-filernes indhold på generingstidspunktet.
  const noV = (html: string) => html.replace(/\?v=[0-9a-f]+/g, '')

  it('AdminPage = templates/admin.html (med og uden stats), inkl. indlejret css/js', async () => {
    const { createElement } = await import('react')
    const { renderPage } = await import('~/components/render')
    const { AdminPage } = await import('~/components/pages/AdminPage')
    const { diff, tree } = await import('./html-diff')
    for (const p of FIX.admin_pages) {
      const ts = renderPage(createElement(AdminPage, { site: p.site_context }))
      expect(diff(tree(noV(p.html), true), tree(noV(ts), true), '')).toBeNull()
      expect(ts).toContain('<meta name="robots" content="noindex, nofollow"/>')
    }
  })
})
