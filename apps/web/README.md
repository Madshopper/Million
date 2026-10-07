# MadShopper på TanStack Start (PoC)

Proof of concept: webserveren (`app.py`, `app_support.py`, `src/worker.py` og Jinja-skabelonerne) skrevet om til TypeScript/React på TanStack Start, kørende på Cloudflare Workers med samme D1 og KV som i dag. **Ikke deployet og ikke koblet på nogen workflow.**

## Kør lokalt

Kræver Node 22+ og `data/app_cache_local.json` (produkt-cachen fra Supabase `app_cache`) i repo-roden.

```bash
cd apps/web
npm install
python3 scripts/seed-local.py      # bygger D1-tabel + søgeindeks + d1_stats_v1 + home_data_v1 i .wrangler-state (kun lokalt)
npx vite build && npx vite preview --port 5002   # eller: npm run dev
```

`seed-local.py` genbruger `scripts/seed-d1.py`s byggefunktioner og skriver kun med `--local`. Kør aldrig wrangler med `--remote` herfra.

## Tests

```bash
npm run typecheck
npx vitest run                     # paritet mod Python: støttelogik + skabeloner (fixtures genereret af Python)
npx tsx test/parity/live-pages.ts  # hele sider: Python-worker på :5003 mod TanStack på :5002
```

Fixtures genereres med `python3 test/parity/gen_support_fixtures.py` og `gen_template_fixtures.py` fra repo-roden.

Opskrifterne har egne fixtures (`gen_recipe_fixtures.py` -> `recipes.test.tsx`, Supabase/D1 mocket) og en live-sammenligning af sider + JSON-API'er: `TANSTACK_PORT=5002 npx tsx test/parity/live-recipes.ts` (kun læsninger; `/api/recipe-click` får kun ugyldige payloads, så RPC'en aldrig kaldes).

## Måling

`node scripts/bench.mjs python=http://127.0.0.1:5003 tanstack=http://127.0.0.1:5002` måler p50/p95 og CPU pr. request (fra `/proc` for workerd-processerne). Python-workeren startes fra `dist/` efter `DEPLOY_ENV=staging bash scripts/build-pages.sh` med `wrangler dev --local --persist-to ../apps/web/.wrangler-state`, så begge læser samme lokale D1/KV. `vite preview` proxyer til en workerd på tilfældig port; angiv dens pid med `TANSTACK_PIDS=<pid>`. En `.dev.vars` (gitignoret) med `EDGE_CACHE=off` slår edge-cachen fra, så hver request renderes.

## Opbygning

- `src/server.tsx` - worker-entry: edge-cache (Cache API, nøgle = query + `cache_version` + UTC-dato + `BUILD_ID` + feature-hash, single-flight), sikkerhedsheaders/CSP, SSR uden hydrering (eksisterende `static/js/*.js` kører på markuppen som i dag).
- `src/routes/` - én fil pr. Flask-route (sider, `/api/*`, redirects, robots/sitemap).
- `src/lib/support/` - port af `app_support.py` (kategorier, søgning, filtre, display-dicts).
- `src/lib/` - D1/KV-adgang, søgeindekset (`search-index.ts`), listings, headers, request-state (Flasks `g`).
- `src/components/` - Jinja-skabelonerne som React-komponenter.
