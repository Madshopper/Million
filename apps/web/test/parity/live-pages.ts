// Sammenligner hele sider fra den kørende Python-worker (:5003) og
// TanStack-PoC'en (:5002) som HTML-træer. Kør: npx tsx test/parity/live-pages.ts
import { diff, tree } from './html-diff'

const PATHS = process.argv.slice(2).length ? process.argv.slice(2) : [
  '/', '/Mejeri', '/Kolonial?page=3', '/Mejeri?stores=Netto,F%C3%B8tex&sort=price-asc', '/ugens_tilbud',
  '/Slik?subcategory=Chokolade', '/search/results?q=m%C3%A6lk', '/search/results?q=xyzxyz',
  '/about', '/terms-of-service', '/privatliv', '/feedback', '/findes-ikke',
]
let bad = 0
for (const p of PATHS) {
  const [a, b] = await Promise.all([5003, 5002].map((port) => fetch(`http://127.0.0.1:${port}${p}`).then(async (r) => [r.status, await r.text()] as const)))
  const d = a[0] !== b[0] ? `status ${a[0]} != ${b[0]}` : diff(tree(a[1], true), tree(b[1], true), '')
  if (d) bad++
  console.log(d ? `DIFF ${p}\n  ${d}` : `SAME ${p}`)
}
process.exit(bad ? 1 : 0)
