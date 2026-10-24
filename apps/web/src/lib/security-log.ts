// Aggregeret sikkerhedslogning til D1 `security_events` - port af
// src/worker.py::_sec_path/_sec_note/_sec_flush.
//
// Workers-observability er permanent slået fra (dens introspektion var selv
// årsagen til nedbruddet 2026-07-19), så der findes ingen request- eller
// fejllog. Derfor tælles KUN de interessante hændelser (429, 5xx, degraderede
// svar, afviste staging-forsøg) i hukommelsen pr. isolate og skylles højst ÉN
// gang i minuttet. Det skal blive ved med at være aggregeret: en log-linje
// pr. blokeret request ville gøre logningen til angrebets egen forstærker.
// Ved et angreb koster det her 1 D1-batch i minuttet pr. isolate, uanset
// hvor mange requests der kommer. Logning må aldrig kunne vælte en request -
// alt er pakket ind i try/catch, og skrivningen sker i ctx.waitUntil.

export const SEC_FLUSH_INTERVAL_MS = 60_000
/** Loft på distinkte (type, sti)-nøgler; derover samles alt i "(overflow)". */
export const SEC_MAX_KEYS = 200

export const SEC_CREATE_SQL =
  'CREATE TABLE IF NOT EXISTS security_events (' +
  'bucket TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL, ' +
  'events INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (bucket, kind, path))'
export const SEC_INSERT_SQL =
  'INSERT INTO security_events (bucket, kind, path, events) VALUES (?, ?, ?, ?) ' +
  'ON CONFLICT(bucket, kind, path) DO UPDATE SET events = events + excluded.events'

// Nøglen er "kind\0path" - \0 kan ikke forekomme i en URL-sti.
const counts = new Map<string, number>()
let flushAt = 0
let tableReady = false

interface WaitCtx {
  waitUntil(p: Promise<unknown>): void
}

/** Kun første sti-segment (og /api/<navn>), højst 32 tegn pr. led - en
 * angriber kan ellers generere uendeligt mange unikke stier og dermed
 * uendeligt mange log-rækker. */
export function secPath(request: Request): string {
  try {
    const parts = new URL(request.url).pathname.split('/').filter((p) => p)
    if (!parts.length) return '/'
    const head = cpHead(parts[0])
    if (head === 'api' && parts.length > 1) return `/api/${cpHead(parts[1])}`
    return `/${head}`
  } catch {
    return '?'
  }
}

/** s[:32] i kodepunkter (som Python). */
function cpHead(s: string): string {
  return Array.from(s).slice(0, 32).join('')
}

/** Tæl én hændelse. Ingen I/O. */
export function secNote(kind: string, request: Request): void {
  try {
    let key = `${kind}\0${secPath(request)}`
    if (!counts.has(key) && counts.size >= SEC_MAX_KEYS) key = `${kind}\0(overflow)`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  } catch {
    // logning må aldrig vælte en request
  }
}

/** Skyl aggregatet til D1 - højst én gang pr. SEC_FLUSH_INTERVAL_MS pr.
 * isolate, aldrig blokerende. `now` kan overstyres i tests. */
export function secFlush(env: { DB?: D1Database }, ctx: WaitCtx, now = Date.now()): void {
  try {
    if (!counts.size) return
    if (flushAt && now - flushAt < SEC_FLUSH_INTERVAL_MS) return
    flushAt = now

    const db = env.DB
    if (!db) {
      counts.clear()
      return
    }
    const snapshot = [...counts.entries()]
    counts.clear()

    // Minut-spand (YYYY-MM-DDTHH:MM): rækkerne er idempotente på tværs af
    // isolates, og tabellen forbliver lille uanset trafikmængde.
    let bucket: string
    try {
      bucket = new Date(now).toISOString().slice(0, 16)
    } catch {
      bucket = '?'
    }
    const stmts = snapshot.map(([key, n]) => {
      const i = key.indexOf('\0')
      return db.prepare(SEC_INSERT_SQL).bind(bucket, key.slice(0, i), key.slice(i + 1), n)
    })

    // DDL holdes UDE af batch'en: D1's batch er én alt-eller-intet-
    // transaktion, og et afvist CREATE deri ville gøre hver efterfølgende
    // skylning tavst død. Én gang pr. isolate (scripts/relay-security-events.py
    // opretter desuden tabellen løbende). Modsat Python køres CREATE og batch
    // her i rækkefølge i samme waitUntil, så første skylning ikke kan nå
    // tabellen før den findes.
    const create = !tableReady
    tableReady = true
    ctx.waitUntil(
      (async () => {
        if (create) {
          try {
            await db.prepare(SEC_CREATE_SQL).run()
          } catch {
            // tabellen findes typisk allerede
          }
        }
        if (stmts.length) await db.batch(stmts)
      })().catch(() => undefined),
    )
  } catch {
    try {
      counts.clear()
    } catch {
      // ignoreret
    }
  }
}

/** Kun til tests: aktuelt aggregat og nulstilling af isolate-tilstanden. */
export function _secSnapshotForTests(): Array<[string, string, number]> {
  return [...counts.entries()].map(([k, n]) => {
    const i = k.indexOf('\0')
    return [k.slice(0, i), k.slice(i + 1), n]
  })
}

export function _secResetForTests(): void {
  counts.clear()
  flushAt = 0
  tableReady = false
}
