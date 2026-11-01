// Opskrifter: Python-workeren (:5003) mod TanStack (TANSTACK_PORT, standard
// :5002) - sider som HTML-træer, API'er som parset JSON.
// Kør: TANSTACK_PORT=5011 npx tsx test/parity/live-recipes.ts
// Kalder kun læse-ruter; /api/recipe-click får kun ugyldige payloads (400),
// så record_recipe_click-RPC'en aldrig rammes.
import { diff, tree } from './html-diff'
import { canonicalJson, canonicalizeRecipeJson } from './recipe-json'

const PY = 'http://127.0.0.1:5003'
const TS = `http://127.0.0.1:${process.env.TANSTACK_PORT || 5002}`

const list = await (await fetch(`${PY}/api/recipes`)).json() as { recipes: Array<{ id: number }> }
const ids = list.recipes.map((r) => r.id)
const pages = ['/opskrifter', ...ids.map((i) => `/opskrift/${i}`), '/opskrift/1', '/opskrift/abc', `/opskrift/0${ids[0]}`]
const apis = ['/api/recipes', ...ids.map((i) => `/api/recipes/${i}`), '/api/recipes/1', '/api/recipes/abc']

let bad = 0
const report = (p: string, d: string | null) => {
  if (d) bad++
  console.log(d ? `DIFF ${p}\n  ${d}` : `SAME ${p}`)
}

for (const p of pages) {
  const [a, b] = await Promise.all([PY, TS].map((h) => fetch(h + p).then(async (r) => [r.status, await r.text()] as const)))
  report(p, a[0] !== b[0] ? `status ${a[0]} != ${b[0]}` : diff(tree(canonicalizeRecipeJson(a[1]), true), tree(canonicalizeRecipeJson(b[1]), true), ''))
}

for (const p of apis) {
  const [a, b] = await Promise.all([PY, TS].map((h) => fetch(h + p).then(async (r) => [r.status, r.headers.get('content-type') || '', await r.text()] as const)))
  let d: string | null = a[0] !== b[0] ? `status ${a[0]} != ${b[0]}` : null
  if (!d && a[1].includes('json')) {
    const [x, y] = [canonicalJson(JSON.parse(a[2])), canonicalJson(JSON.parse(b[2]))]
    if (x !== y) {
      let i = 0
      while (x[i] === y[i]) i++
      d = `JSON afviger ved tegn ${i}\n  Python: ${x.slice(Math.max(0, i - 120), i + 120)}\n  TS:     ${y.slice(Math.max(0, i - 120), i + 120)}`
    }
  } else if (!d && a[2] !== b[2]) d = 'brødtekst afviger'
  report(p, d)
}

// Kun ugyldige klik - begge skal svare 400 uden at kalde RPC'en.
for (const [ct, body] of [['application/json', '[1]'], ['application/json', '{"recipe_id":"x"}'], ['application/json', '{"recipe_id":0}'],
  ['application/json', '{"recipe_id":10000000001}'], ['text/plain', '{"recipe_id":5}'], ['application/json', '{bad']]) {
  const [a, b] = await Promise.all([PY, TS].map((h) => fetch(h + '/api/recipe-click', { method: 'POST', headers: { 'Content-Type': ct }, body })
    .then(async (r) => [r.status, await r.text()] as const)))
  const same = a[0] === b[0] && canonicalJson(JSON.parse(a[1])) === canonicalJson(JSON.parse(b[1]))
  report(`POST /api/recipe-click ${ct} ${body}`, same ? null : `${a[0]} ${a[1]} != ${b[0]} ${b[1]}`)
}
process.exit(bad ? 1 : 0)
