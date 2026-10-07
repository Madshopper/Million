import { beforeEach, describe, expect, it } from 'vitest'
import { _secResetForTests, _secSnapshotForTests } from '~/lib/security-log'
import { STAGING_PROBE_PATH, cookieValue, pyQuotePlus, stagingBlocked } from '~/lib/staging-gate'
import { stagingLinkSig, stagingSessionToken } from '~/lib/staging'
import { WORKER_FUNCS, hasPython, py } from './pyexec'

const SECRET = 'f00dfacecafe0123456789abcdef0123456789abcdef'
const ctx = () => {
  const waits: Promise<unknown>[] = []
  return { waitUntil: (p: Promise<unknown>) => void waits.push(p), waits }
}
const env = { STAGING_ACCESS_SECRET: SECRET }
const req = (path: string, headers: Record<string, string> = {}) => new Request(`https://dev.madshopper.dk${path}`, { headers })

beforeEach(() => _secResetForTests())

describe.skipIf(!hasPython)('signaturer = Python (src/worker.py)', () => {
  const secrets = [SECRET, 'x', 'æøå-hemmelighed', 'a'.repeat(200)]
  const exps = [0, 1700000000, 1999999999]
  it('_staging_session_token og _staging_link_sig', async () => {
    const want = py<{ tok: string[]; sig: string[][] }>(
      WORKER_FUNCS + `
ns = load_worker_funcs('_staging_session_token', '_staging_link_sig')
d = json.load(sys.stdin)
print(json.dumps({'tok': [ns['_staging_session_token'](s) for s in d['s']],
                  'sig': [[ns['_staging_link_sig'](s, e) for e in d['e']] for s in d['s']]}))`,
      { s: secrets, e: exps },
    )
    expect(await Promise.all(secrets.map(stagingSessionToken))).toEqual(want.tok)
    expect(await Promise.all(secrets.map((s) => Promise.all(exps.map((e) => stagingLinkSig(s, e)))))).toEqual(want.sig)
  })

  it('_cookie_value og urlencode', () => {
    const cookies = ['ms_staging=abc', 'a=1; ms_staging=xyz; b=2', ' ms_staging=v=w ', 'ms_stagingx=1', '', 'foo=bar']
    const want = py<{ c: string[]; q: string }>(
      WORKER_FUNCS + `
from urllib.parse import urlencode
ns = load_worker_funcs('_cookie_value')
d = json.load(sys.stdin)
print(json.dumps({'c': [ns['_cookie_value'](c, 'ms_staging') for c in d['c']], 'q': urlencode([tuple(x) for x in d['q']])}))`,
      { c: cookies, q: [['q', 'mælk & brød'], ['x', "a~b*c!'()"], ['tom', '']] },
    )
    expect(cookies.map((c) => cookieValue(c, 'ms_staging'))).toEqual(want.c)
    expect([['q', 'mælk & brød'], ['x', "a~b*c!'()"], ['tom', '']].map(([k, v]) => `${pyQuotePlus(k)}=${pyQuotePlus(v)}`).join('&')).toBe(want.q)
  })
})

describe('stagingBlocked', () => {
  it('slået fra uden secret (produktion) - og logger intet', async () => {
    expect(await stagingBlocked(req('/'), {}, ctx())).toBeNull()
    expect(_secSnapshotForTests()).toEqual([])
  })

  it('afviser uden adgang med 404 og tæller staging_gate_denied aggregeret', async () => {
    const c = ctx()
    const r1 = await stagingBlocked(req('/Mejeri?x=1'), env, c)
    const r2 = await stagingBlocked(req('/Mejeri/sub'), env, c)
    expect(r1!.status).toBe(404)
    expect(await r1!.text()).toBe('Not found')
    expect(r1!.headers.get('Cache-Control')).toBe('no-store')
    expect(r2!.status).toBe(404)
    expect(_secSnapshotForTests()).toEqual([['staging_gate_denied', '/Mejeri', 1]])
  })

  it('probe-stien svarer 404 uden at logge', async () => {
    const r = await stagingBlocked(req(STAGING_PROBE_PATH), env, ctx())
    expect(r!.status).toBe(404)
    expect(_secSnapshotForTests()).toEqual([])
  })

  it('?k= sætter cookie med afledt token og bevarer resten af query', async () => {
    const r = await stagingBlocked(req(`/search/results?q=m%C3%A6lk+og&k=${SECRET}&t=1&page=2`), env, ctx())
    expect(r!.status).toBe(302)
    expect(r!.headers.get('Location')).toBe('/search/results?q=m%C3%A6lk+og&page=2')
    const cookie = r!.headers.get('Set-Cookie')!
    expect(cookie).toBe(`ms_staging=${await stagingSessionToken(SECRET)}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`)
    expect(cookie).not.toContain(SECRET)
  })

  it('forkert ?k= afvises; parse_qs springer tomme værdier over', async () => {
    expect((await stagingBlocked(req('/?k=forkert'), env, ctx()))!.status).toBe(404)
    expect((await stagingBlocked(req(`/?k=&k=${SECRET}`), env, ctx()))!.status).toBe(302)
  })

  it('gyldig cookie slipper igennem', async () => {
    const tok = await stagingSessionToken(SECRET)
    expect(await stagingBlocked(req('/', { Cookie: `a=1; ms_staging=${tok}` }), env, ctx())).toBeNull()
    expect((await stagingBlocked(req('/', { Cookie: `ms_staging=${tok}x` }), env, ctx()))!.status).toBe(404)
  })

  it('?t=-engangslink: gyldigt i [nu, nu+300]', async () => {
    const now = 1_800_000_000
    const link = async (exp: number) => `/admin?t=${exp}.${await stagingLinkSig(SECRET, exp)}`
    const ok = await stagingBlocked(req(await link(now + 120)), env, ctx(), now)
    expect(ok!.status).toBe(302)
    expect(ok!.headers.get('Location')).toBe('/admin')
    expect((await stagingBlocked(req(await link(now - 1)), env, ctx(), now))!.status).toBe(404)
    expect((await stagingBlocked(req(await link(now + 301)), env, ctx(), now))!.status).toBe(404)
    expect((await stagingBlocked(req(`/?t=${now + 10}.deadbeef`), env, ctx(), now))!.status).toBe(404)
  })
})
