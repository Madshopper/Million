#!/usr/bin/env node
// Lokal måling: samme URL-sæt mod to lokale workere (fx den gamle Python-
// worker på :5003 og TanStack-PoC'en på :5002), begge mod samme lokale
// D1/KV (.wrangler-state) og begge UDEN edge-cache, så hver request er en
// fuld render. Måler vægur pr. request og CPU-tid for workerd-processen
// (utime+stime fra /proc), som er det tætteste lokale bud på Cloudflares
// CPU-tid. Brug:  node scripts/bench.mjs <navn>=<url> [<navn>=<url> ...]
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const PATHS = [
  '/',
  '/Mejeri',
  '/Kolonial?page=3',
  '/Frugt_og_groent?sort=price-asc',
  '/Mejeri?stores=Netto,F%C3%B8tex',
  '/ugens_tilbud',
  '/search/results?q=m%C3%A6lk',
  '/search/results?q=hakket%20svinek%C3%B8d',
  '/search/results?q=minm%C3%A6lk',
  '/api/autocomplete?q=yog',
  '/api/category/Kolonial',
  '/api/search?q=ost',
  '/api/home',
  '/api/products',
]
const ROUNDS = Number(process.env.ROUNDS || 15)

const targets = process.argv.slice(2).map((a) => {
  const i = a.indexOf('=')
  return { name: a.slice(0, i), base: a.slice(i + 1) }
})

// workerd-processerne bag en lokal wrangler/vite på en given port: proxyen
// med --socket-addr=entry=127.0.0.1:<port> og dens søskende (selve workeren).
function pidsForPort(port) {
  const lines = execSync('pgrep -af workerd || true').toString().split('\n').filter(Boolean)
  const entry = lines.find((l) => l.includes(`entry=127.0.0.1:${port} `) || l.includes(`entry=localhost:${port} `))
  if (!entry) return []
  const ppid = readFileSync(`/proc/${entry.split(' ')[0]}/stat`, 'utf8').split(') ')[1].split(' ')[1]
  return execSync(`pgrep -P ${ppid} workerd || true`).toString().split(/\s+/).filter(Boolean).map(Number)
}

function cpuMs(pids) {
  let total = 0
  for (const p of pids) {
    try {
      const f = readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' ')
      total += (Number(f[11]) + Number(f[12])) * 10 // jiffies (100 Hz) -> ms
    } catch {}
  }
  return total
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

const results = {}
for (const t of targets) {
  // vite preview proxyer til en workerd på tilfældig port: angiv pid'en via fx TANSTACK_PIDS=1234
  const envPids = process.env[`${t.name.toUpperCase()}_PIDS`]
  const pid = envPids ? envPids.split(',').map(Number) : pidsForPort(new URL(t.base).port)
  if (!pid.length) console.error(`ingen workerd fundet for ${t.base} - CPU bliver 0`)
  results[t.name] = {}
  for (const path of PATHS) {
    // opvarmning (kold isolate / første import)
    await fetch(t.base + path).then((r) => r.arrayBuffer())
    const times = []
    let bytes = 0
    let status = 0
    const c0 = cpuMs(pid)
    for (let i = 0; i < ROUNDS; i++) {
      const t0 = performance.now()
      const r = await fetch(t.base + path)
      const body = await r.arrayBuffer()
      times.push(performance.now() - t0)
      bytes = body.byteLength
      status = r.status
    }
    const cpu = (cpuMs(pid) - c0) / ROUNDS
    results[t.name][path] = { status, bytes, p50: pct(times, 50), p95: pct(times, 95), cpu }
  }
}

const names = targets.map((t) => t.name)
console.log(`| Sti | ${names.map((n) => `${n} p50 ms | ${n} CPU ms/req`).join(' | ')} | bytes |`)
console.log(`|---|${names.map(() => '---:|---:').join('|')}|---|`)
for (const path of PATHS) {
  const cells = names.map((n) => {
    const r = results[n][path]
    return `${r.p50.toFixed(1)}${r.status !== 200 ? ` (${r.status})` : ''} | ${r.cpu.toFixed(1)}`
  })
  console.log(`| \`${path}\` | ${cells.join(' | ')} | ${names.map((n) => results[n][path].bytes).join(' / ')} |`)
}
console.log('\n' + JSON.stringify(results))
