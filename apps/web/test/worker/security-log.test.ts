import { beforeEach, describe, expect, it } from 'vitest'
import {
  SEC_CREATE_SQL, SEC_INSERT_SQL, SEC_MAX_KEYS, _secResetForTests, _secSnapshotForTests, secFlush, secNote, secPath,
} from '~/lib/security-log'
import { WORKER_FUNCS, hasPython, py } from './pyexec'

/** Falsk D1: registrerer prepare/bind/run/batch. */
function fakeDb() {
  const calls: Array<{ op: string; sql?: string; args?: unknown[]; n?: number }> = []
  const db = {
    prepare(sql: string) {
      const stmt = {
        sql,
        args: [] as unknown[],
        bind(...args: unknown[]) {
          stmt.args = args
          return stmt
        },
        async run() {
          calls.push({ op: 'run', sql })
        },
      }
      return stmt
    },
    async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
      calls.push({ op: 'batch', n: stmts.length })
      for (const s of stmts) calls.push({ op: 'stmt', sql: s.sql, args: s.args })
    },
  }
  return { db: db as unknown as D1Database, calls }
}
function ctx() {
  const waits: Promise<unknown>[] = []
  return { waitUntil: (p: Promise<unknown>) => void waits.push(p), waits }
}
const r = (path: string) => new Request(`https://madshopper.dk${path}`, { method: 'POST' })

beforeEach(() => _secResetForTests())

describe.skipIf(!hasPython)('secPath = worker.py::_sec_path', () => {
  it('samme sti-nøgler', () => {
    const paths = ['/', '/api/cart-event', '/api/', '/Mejeri/Ost?x=1', '//a//b', `/${'x'.repeat(50)}/y`, `/api/${'æ'.repeat(40)}`, '/api', '/%C3%A6bler']
    const want = py<string[]>(
      WORKER_FUNCS + `
ns = load_worker_funcs('_sec_path')
class R:
    def __init__(self, u): self.url = u
print(json.dumps([ns['_sec_path'](R(u)) for u in json.load(sys.stdin)]))`,
      // Python på edge får str(request.url) fra JS-Request'en - altså den
      // normaliserede, procent-kodede URL.
      paths.map((p) => r(p).url),
    )
    expect(paths.map((p) => secPath(r(p)))).toEqual(want)
  })
})

describe('aggregeret sikkerhedslogning', () => {
  it('tæller i hukommelsen og skyller højst én gang i minuttet', async () => {
    const { db, calls } = fakeDb()
    const c = ctx()
    const t0 = Date.UTC(2026, 9, 7, 12, 34, 56)
    for (let i = 0; i < 1000; i++) secNote('rate_limit', r('/api/cart-event'))
    secNote('server_error', r('/api/alternatives'))
    secFlush({ DB: db }, c, t0)
    await Promise.all(c.waits)
    // Ét CREATE (første gang i isolaten) + én batch med to rækker - uanset 1001 hændelser.
    expect(calls.filter((x) => x.op === 'run')).toEqual([{ op: 'run', sql: SEC_CREATE_SQL }])
    expect(calls.filter((x) => x.op === 'batch')).toEqual([{ op: 'batch', n: 2 }])
    expect(calls.filter((x) => x.op === 'stmt')).toEqual([
      { op: 'stmt', sql: SEC_INSERT_SQL, args: ['2026-10-07T12:34', 'rate_limit', '/api/cart-event', 1000] },
      { op: 'stmt', sql: SEC_INSERT_SQL, args: ['2026-10-07T12:34', 'server_error', '/api/alternatives', 1] },
    ])
    expect(_secSnapshotForTests()).toEqual([])

    // Inden for minuttet: ingen skrivning, tælleren bevares.
    secNote('rate_limit', r('/api/cart-event'))
    secFlush({ DB: db }, c, t0 + 59_000)
    expect(c.waits.length).toBe(1)
    expect(_secSnapshotForTests()).toEqual([['rate_limit', '/api/cart-event', 1]])

    // Efter minuttet: ny batch, intet nyt CREATE.
    secFlush({ DB: db }, c, t0 + 61_000)
    await Promise.all(c.waits)
    expect(calls.filter((x) => x.op === 'run').length).toBe(1)
    expect(calls.filter((x) => x.op === 'batch').length).toBe(2)
  })

  it('intet at skylle = ingen I/O', () => {
    const { db, calls } = fakeDb()
    const c = ctx()
    secFlush({ DB: db }, c, Date.now())
    expect(c.waits).toEqual([])
    expect(calls).toEqual([])
  })

  it('loft på distinkte stier: resten samles i (overflow)', () => {
    for (let i = 0; i < SEC_MAX_KEYS + 50; i++) secNote('rate_limit', r(`/sti${i}`))
    const snap = _secSnapshotForTests()
    expect(snap.length).toBe(SEC_MAX_KEYS + 1)
    expect(snap.find(([, p]) => p === '(overflow)')).toEqual(['rate_limit', '(overflow)', 50])
  })

  it('uden DB-binding ryddes aggregatet uden fejl', () => {
    secNote('degraded', r('/x'))
    const c = ctx()
    secFlush({}, c, Date.now())
    expect(_secSnapshotForTests()).toEqual([])
    expect(c.waits).toEqual([])
  })

  it('en D1-fejl kan aldrig vælte requesten', async () => {
    const db = { prepare: () => ({ bind: () => ({}), run: async () => { throw new Error('x') } }), batch: async () => { throw new Error('D1 nede') } }
    const c = ctx()
    secNote('server_error', r('/'))
    expect(() => secFlush({ DB: db as unknown as D1Database }, c, Date.now())).not.toThrow()
    await expect(Promise.all(c.waits)).resolves.toBeDefined()
  })
})
