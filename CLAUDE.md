# Million Project - Claude Instructions

## Sprog

Svar altid på dansk.

## Adfærd

- Læs ALTID relevante filer selv før du svarer - spørg aldrig brugeren om filindhold
- Brug tools proaktivt uden at bede om lov
- Du har fuld adgang til projektmappen - antag altid at filer eksisterer og læs dem
- Når du får en opgave, start med at liste og læse relevante filer selv

## Projekt

MadShopper ([madshopper.dk](https://madshopper.dk)) - dansk pris-sammenligning for dagligvarer på tværs af 14+ butikker (Rema 1000, Bilka, Netto, Føtex, Meny, Spar, SuperBrugsen, Brugsen, Kvickly, Min Købmand, 365 Discount, Lidl, Løvbjerg, ABC Lavpris).

**To lag:**
- **Backend/scraping**: Python 3 + Flask (`app.py`, `app_support.py`), Supabase som database, RapidFuzz til fuzzy-matching. Ingen AI/Ollama noget sted i projektet - produkt-klassifikation (`scraper/ai_classifier.py`) er ren keyword-baseret (allow-/blocklist i `scraper/keywords.py`).
- **Produktion/edge**: Cloudflare Workers + Pages ("EdgeKit"/Pyodide), D1 og KV (`src/worker.py`, `wrangler.toml`). Supabase-data seedes til D1 via `scripts/seed-d1.py`; deploy via `scripts/build-pages.sh` + `scripts/deploy-worker.sh` (purger også Cloudflare CDN-cache). Samme `app.py` kører både lokalt (Flask) og på edge.

**Mappestruktur:**
- `app.py` / `app_support.py` - Flask-routes, API, sikkerhedsheaders/CSP, logging, cache, søgeindeks
- `updater.py` - genopbygger produkt-cache + prishistorik (køres af GitHub Actions cache-updater)
- `src/worker.py` - Cloudflare Workers entry point: edge-cache (Cache API), rate limiting, sikkerhedslogning, staging-adgangsspærring
- `scraper/` - per-butik scrapers (Selenium/Requests), `dagrofa_scraper.py` (Meny/Spar/Min Købmand), `tjek_tilbud_scraper.py`, `*_katalog.py` (Bilka/Netto/Føtex/Lidl), `ai_classifier.py`, `keywords.py`, `supabase_utils.py`
- `scripts/` - deploy (`build-pages.sh`, `deploy-worker.sh`, `setup-domain.sh`, `setup-edge-secrets.sh`), `seed-d1.py`, `build-nutrition.py`, `build-icons.py` (favicon/app-ikoner, køres manuelt på macOS), `audit-site.py`, `verify-integrations.py`, `smoke-test.mjs` + `playwright-uptime-check.mjs` (Playwright), matchmotor-måling (`test-matching.py` = regressionstest af gates, `eval-matching.py` = segmenteret precision/recall mod EAN-verificeret guldsæt), samt `supabase-*.sql`
- `data/` - cachede butikspriser, AI-classifier cache/log, `nutrition_data.json`, Rema pHash-cache
- `templates/` (+ `macros/`, `partials/`) / `static/` - Jinja2 + CSS/JS (`script.js`, `auth.js`, `supabase.min.js`)
- `apps/mobile/` - native iOS/Android-app (Expo/React Native); se `docs/native-app.md` og `docs/env-setup.md`
- `docs/` - `Dev.md` (dev/staging-workflow), `Features.md` (roadmap), `paritet.md` (web/app-feature-matrix + aabne gaps - **opdatér i samme commit som du aendrer en feature**), `native-app.md`, `prisovervaagning.md`, `email-bekraeftelse.md`, `Github_fifs.md`
- `uptime-worker/` - selvstændig JS-worker (`madshopper-uptime`) med cron hvert 5. minut, der mailer ved nedbrud
- `.github/workflows/` - per-butik-scrapers, cache-updater, nutrition-build, edge-deploy (prod + staging, begge fra main), smoke/uptime-test, dependency-audit
- `wrangler.toml`, `pyproject.toml` - Cloudflare/EdgeKit-konfiguration (uv)

Fuld tech stack, butiksliste og mappetræ: `README.md` § Tech Stack / Supported Stores / Project Structure.

## Data & tabeller

**Supabase:** `app_cache` (produkt-cache i chunks), `produkter` (rå butiksdata), `price_history` (30 dage), `nutrition_data`, `cart_popularity` + `cart_events` (anonym kurv-aktivitet), `price_alerts`, `carts` (gemt kurv pr. bruger, RLS-låst), `user_monthly_savings` (personlig besparelse pr. måned, kun via RPC).
**Cloudflare D1:** read-only mirror af produkt-cachen (seedet nightly), `security_events`.
**Cloudflare KV:** `cache_version` (bumpes ved hvert seed → invaliderer al edge-cache), `home_data_v1` (forudberegnede forsidepuljer, sparer ~4 D1/Supabase-kald pr. render), `d1_stats_v1` (optællinger), `features_v1` (Feature-panelet i `/admin`: hvilke funktioner der er udgivet på madshopper.dk; læses sammen med `cache_version` i `src/worker.py` og indgår i cache-nøglen, så et skift slår igennem inden for 5 min uden bump), `sidx_ver` + `sidx:<version>:<p|s>:<tegn>` (søgeindekset, se § D1-læsebudget).

Skrive-tabellerne (`cart_popularity`, `cart_events`, `price_alerts`, `carts`, `user_monthly_savings`) vælges via `TABLE_SUFFIX`: tom i produktion, `_dev` lokalt og på staging - kør `scripts/supabase-dev-tables.sql` / `scripts/supabase-user-savings.sql` én gang.

**SQL-scripts (køres manuelt i Supabase SQL Editor):**
- `supabase-grants.sql` - service_role-rettigheder til prishistorik (ved permission-fejl)
- `supabase-price-history.sql` - unikke indeks/upsert (ved upsert-fejl)
- `supabase-produkter-index.sql` - indeks på `produkter.butik` (scrapernes/updaterens daglige butiks-filtrerede scans)
- `supabase-lowest-price.sql` - view til "30 dages laveste"-badget
- `supabase-normal-price.sql` - view til 30-dages typisk pris pr. produkt+butik, bruges som førpris-fallback når en scraper flager "tilbud" uden selv at levere en førpris (fx Bilkas multikøb)
- `supabase-app-cache-swap.sql` / `supabase-produkter-swap.sql` - atomisk swap, så en samtidig læser aldrig ser en halv/tom cache. Uden dem bruges automatisk den gamle to-kalds-metode
- `supabase-cart-increment.sql` - `record_cart_activity`-RPC (SECURITY DEFINER, eneste skrivevej til `cart_events`)
- `supabase-nutrition.sql`, `supabase-carts.sql`, `supabase-dev-tables.sql`
- `supabase-user-savings.sql` - personlig månedlig besparelse (`get_personal_savings` / `record_compare_savings`)
- `supabase-admin.sql` - admin-panelet `/admin`: `admin_users` + `is_admin()`, `admin_overview`, feedback-tabellen `feedback` + `submit_feedback`-RPC'en (eneste skrivevej for `/api/feedback`, med globalt loft) opskrift-moderering og kørselshistorikken `job_runs` + `admin_job_runs` (fyldes af `scripts/sync-job-runs.py` i `security-monitor.yml`). Skal køres FØR koden deployes, ellers giver feedback-formularen 503. Indsæt din konto i `admin_users` bagefter
- `supabase-rls-audit.sql` (ren læsning), `supabase-lockdown.sql`, `supabase-hardening.sql` - sikkerhed/RLS

## Miljøer & deploy

| Miljø | Branch | URL | Data |
|---|---|---|---|
| Produktion | `main` | madshopper.dk | prod-tabeller, egen KV + D1 |
| Staging | `main` (automatisk) + manuel deploy af vilkårlig branch | dev.madshopper.dk | læser prod-data, skriver til `*_dev`, egen KV + D1 |
| Lokal | - | localhost:5001 (`python app.py`) | læser prod-data, skriver til `*_dev` |

**Alt er slået til på staging.** En feature der er skjult bag et flag i produktion, skal være slået til på dev.madshopper.dk (sæt flaget i staging-grenen af `scripts/build-pages.sh`, fx `RECIPES_ENABLED`). I produktion udgives den fra fanen Feature i `/admin`: tilføj den til `app._FEATURES` og tjek den med `_feature_enabled('<key>')`. Staging er låst for alle andre end godkendte (`_staging_blocked()` i `src/worker.py`, 404 til alle andre), og det skal den blive ved med.

Der er ingen `dev`-branch (fjernet 02-10-2026). Arbejde laves på en feature-branch med PR direkte til `main`; merge til `main` → `deploy-edge.yml` (produktion) og `deploy-edge-dev.yml` (staging) samtidig. En PR-branch kan afprøves på staging før merge ved at køre `deploy-edge-dev.yml` manuelt på den; næste push til `main` skriver staging tilbage. Begge kører Playwright-røgtest bagefter. Fuld workflow: `docs/Dev.md`.

Produktion er ramt af et reelt nedbrud 2026-07-19 (1101/1102 CPU-fejl ved samtidige cold renders efter nightly reseed). Derfor: Workers-observability er **permanent slået fra** i `scripts/build-pages.sh` (dens introspektion var selve årsagen), edge-cachen er versioneret via `cache_version`, og sikkerhedslogningen i `src/worker.py` aggregeres i hukommelsen og skylles højst 1×/minut pr. isolate. Lav aldrig noget der logger pr. request.

Flaget sættes i den *ubetingede* del af heredoc'en (`build-pages.sh`), altså for **begge** miljøer - ikke i en ELSE-gren, som denne fil tidligere påstod. `scripts/test-security-logging.py` håndhæver det nu ved hvert produktions-deploy, både i `wrangler.toml` og i den genererede `dist/wrangler.toml`.

**Staging har den også slået fra.** Den var kortvarigt tændt 25-07-2026 for at finde en vedvarende fejl (30-50 af 60 requests under samtidig trafik). Aktiveringen fandt straks "Attempted to use PyProxy when Python GIL not held" under Pyodide-runtimens Python-instans-opstart - Cloudflares egen kode, ikke appens, og en fejlklasse der sker FØR Python-koden kører, så ingen mængde retries i `app.py` kunne rette den. Samme skrøbelige JS/Python-bro-race som 2026-07-19. Da svaret var fundet, blev den slået fra igen dagen efter (commit `b599d0c`).

Denne fil hævdede frem til 10-08-2026 at staging stadig havde den tændt. Det var forkert i to uger, og konsekvensen er værd at huske: leder du efter staging-logs under en fejl, findes de ikke - de skal tændes bevidst først.

**Edge-cache-TTL:** `_EDGE_CACHE_SECONDS` i `app.py` er 24 timer (via `CDN-Cache-Control`). Et cache-miss koster en fuld render - målt 1,07-1,42 s på en kategoriside mod 76 ms på et hit - og data skifter kun ved nattens seed, så en kort TTL var ren spildt CPU. Staleness bæres af cache-nøglen, ikke af TTL'en: nøglen er `cache_version` (KV, bumpes ved hvert seed og deploy) + dagens UTC-dato + `BUILD_ID` (sat pr. build i `build-pages.sh`), hvor dato-delen er nødbremsen, fordi `set_cache_version()` i `seed-d1.py` fejler blødt, og `BUILD_ID` forhindrer at gamle isolates under et deploy gemmer gammel HTML under den nye nøgle (sket 02-10-2026 med forsiden). Sænk ikke TTL'en for at "friske data op" - bump `cache_version` i stedet.

**Degraderede svar må aldrig i den delte cache:** D1-hjælperne og Supabase-kaldene kan ikke skelne "ingen rækker" fra "opslaget fejlede" - begge giver et tomt svar med status 200. Da statuskoden var eneste cache-kriterium, blev én forbigående bro- eller D1-kollision frosset fast som "der findes ingen varer" for ALLE besøgende på den URL i op til 24 timer. Fejlvejene kalder derfor `_mark_data_degraded()` i `app.py`, og header-laget nægter at sætte `CDN-Cache-Control` på et markeret svar. Statuskoderne er bevidst uændrede - 503 ville også løse caching-problemet, men koster en fuld render pr. besøgende i stedet for et cache-hit. Skelnen er bevaret: "vi har ingen næring på den vare" er stadig et gyldigt og cachebart svar; kun det fejlede opslag er det ikke. Samme regel gælder AJAX-fragmenter, der deler URL med den fulde side (zonen keyer på URL alene uden `Vary`). **Tilføjer du en ny sti der kan returnere tomt ved fejl, skal den kalde `_mark_data_degraded()`.** `scripts/test-degraded-cache.py` fejlinjicerer hver kendt fejlvej og kræver at CDN-headeren udebliver. Den kan ikke køre i CI - den kræver produktdata (`data/app_cache_local.json` eller Supabase-adgang) - så den er en lokal gate: kør den når du rører header-laget eller tilføjer fejlveje.

**Én render ad gangen pr. isolate:** edgekit kører hele Flask-renderingen synkront, og hvert D1/KV-kald suspenderer via `run_sync`. Når en anden request i samme isolate når ind i Flask imens, fejler dens D1-kald blødt (`_sync_bridge_busy`) og svaret bliver tomt + degraderet - målt 14-09-2026: 11 af 20 samtidige søgninger gav 0 varer. `_render_exclusive()` i `src/worker.py` lader derfor request nr. 2 vente asynkront (loft `_RENDER_WAIT_MAX_MS`, så en CPU-dræbt render ikke låser isolatet). **Kald aldrig `super().fetch()` uden om den** - `scripts/test-render-exclusive.py` håndhæver det ved hvert deploy. Afbryder en klient en request midt i et D1-kald, kører `finally` i `app.py::_sync_bridge_call` aldrig, og bro-flaget hænger; `_render_exclusive` nulstiller det derfor via `release_stale_sync_bridge()`, når ingen render er i gang (målt 02-10-2026: ellers degraderedes hele isolaten til den døde, tælles som `bridge_reset`).

**CPU er den egentlige grænse, ikke samtidighed:** målt 15-09-2026 med Cloudflare-analytics koster en render 250-1.100 ms CPU på edge (grænsen på gratis-planen er 10 ms; ~190 ms er en fast omkostning i kolde isolates). Isolaten dræbes (1102, efterfulgt af 1101-kaskade i 1-2 min for alle i den isolate) af *vedvarende* forbrug - også helt sekventielt: ~1 kold side/s døde efter 27-43 renders, 6/min gik fint. Derfor svarer workeren "travlt" (503 + `X-MadShopper-Busy` + Retry-After) i stedet for at rendere, når (1) et CPU-estimat pr. isolate er brugt op (`_CPU_BUDGET_*`, vægte pr. rutetype), (2) der allerede står `_RENDER_QUEUE_MAX` i kø, eller (3) ventetiden løber ud mens forgængeren stadig renderer - at gå ind i broen dér gav 1102 på fire requests samtidig. Web (`fetchWithDegradedRetry`) og appens API-klient prøver selv igen; sidevisninger genindlæser sig selv (højst 4 gange). **Nye `fetch` mod render-ruter i `script.js` skal gå gennem `fetchWithDegradedRetry`.** Kommer workeren på Workers Paid, slås budgettet fra med varen `RENDER_CPU_BUDGET = "off"`. Jinja-skabelonerne og routing-tabellen kompileres ved import (`_prewarm_for_snapshot`), så de ligger i Cloudflares snapshot i stedet for at blive betalt i hver ny isolate. Tunge svar bygges helst i D1 (fx `/api/products` via `_API_PRODUCTS_SQL`) - D1's CPU tæller ikke mod workerens.

**Browser-cache:** HTML sendes med `Cache-Control: no-store`, så browseren ikke gemmer gamle sider (og gamle `?v=`-links til CSS/JS). Uden det overskrev zonens *Browser Cache TTL* (4 timer) `max-age=0` til `max-age=14400`. `scripts/deploy-worker.sh` sætter også Browser Cache TTL til *Respect Existing Headers* via API ved hvert deploy.

**Statiske assets:** `/static/*` caches `immutable` i et år. `url_for('static', ...)` får automatisk `?v=<indholds-hash>` (`app.py::_static_cache_bust`; på edge fra `static_hashes.json`, som `scripts/build-pages.sh` bygger). Skriv **aldrig** `?v=` selv i en template - `scripts/test-cache-bust.py` fejler på det ved hvert deploy. Undtaget: `fonts/` (refereres fra `fonts.css` uden `?v=`; ny font = nyt filnavn) og `js/vendor/chart.umd.min.js`, der loades fra `script.js` med manuel `?v=`.

**D1-skrivebudget:** Gratis-planens 100k `rows_written` pr. UTC-døgn er konto-bredt - prod og staging tilsammen. En fuld reseed i `scripts/seed-d1.py` skriver tabelrække + PK-autoindeks + indeksindgange for hvert produkt: målt 5,0 rækker pr. produkt (97.163 for 19.429 produkter 11-09-2026), ~4,3 efter at `idx_products_sale` blev partielt. Nattens cache-updater (starter i praksis 00:30-01:00 UTC pga. GitHub-cron-forsinkelse) bruger altså det meste af døgnet alene. Et push til `main`, der rører `updater.py`/`app_support.py`/`scraper/**`, udløser en ekstra fuld reseed (`FORCE_RESEED=1`) og sprænger budgettet - sket 09-09-2026 (193k) og 11-09-2026 (194k skrevet). Derfor: merg matching-/scraper-ændringer til `main` med `[skip ci]` i merge-committen, så nattens kørsel henter koden med én reseed, og dispatch `deploy-edge.yml` manuelt hvis edge-koden også skal ud (`gh workflow run deploy-edge.yml --ref main` - den rører ikke D1). Test matching lokalt med `scripts/eval-matching.py`, og tving aldrig en ekstra reseed samme døgn. Er budgettet sprængt, fejler alle D1-skrivninger til 00:00 UTC; `/api/feedback` svarer derfor 503 frem for falsk succes.

**D1-læsebudget:** Gratis-planen har 5 mio. `rows_read` pr. UTC-døgn, også konto-bredt. Den blev sprængt 30-09-2026 (6,1 mio.), og målt pr. forespørgsel (GraphQL `d1QueriesAdaptiveGroups`, dimension `query`) var 76 % søgning: `search_text LIKE '%…%'` kan ikke bruge et indeks, så **hver frisk søgning scanner 12-20k rækker**, og autocomplete gør det samme pr. tastetryk. Toppene kom fra vores egne målinger (curl og test-scripts), ikke fra brugere, der ligger på ca. 1-1,5 mio. om dagen. Derfor: en test eller måling må højst sende nogle få friske søgninger, aldrig en serie på 100+ unikke søgeord samme døgn. Ukomplicerede optællinger (antal varer, pr. kategori, tilbud, underkategorier) læses fra KV-nøglen `d1_stats_v1`, som `scripts/seed-d1.py` skriver i samme kørsel som tabellen (`app.py::_d1_stats`). Tilføj ikke et nyt `COUNT(*)`/`DISTINCT` over hele kataloget pr. request; læg tallet i `d1_stats_v1` i stedet.

**Søgning går via et ordindeks i KV**, ikke LIKE: `scripts/seed-d1.py::build_search_shards` bygger foldet token -> rowid'er (~1,2 MB, ~86 nøgler opdelt efter første tegn og efter sidste tegn baglæns), og `app.py::_sidx_search` finder kandidaterne med `_token_matches_term`'s regler og henter kun dem via `rowid IN (...)`. Målt lokalt på 60 søgninger: 1,61 mio. læste rækker blev til 12.114, med samme eller flere rigtige træf. rowid er `version * 100000 + løbenummer`, så et indeks fra en anden seed end tabellen opdages (D1 returnerer færre rækker) og falder tilbage til LIKE. Al fejl i indekset falder tilbage til LIKE - virker søgning, men stiger `rows_read` igen, så tjek `sidx_ver` i KV og seed-loggen.

## Brugerkonti

Client-side via `supabase-js` (`static/js/auth.js`) - browseren bruger kun den offentlige publishable-nøgle. Google-login via Identity Services (ID-token-flow, så samtykkeskærmen viser madshopper.dk) + email/adgangskode med "glemt adgangskode". Kurven gemmes komprimeret i `carts` (RLS: `auth.uid() = user_id`); sammenligningspriser genhentes live fra `/api/products`, så der aldrig gemmes forældede priser. Opsætning der kræver manuelle trin (SMTP/branded mails): `docs/email-bekraeftelse.md`.

## Produktmatching (`updater.py`)

Tre **stages** efter EAN-status. Kun stage 3 initierer fuzzy matching; stage 1 og 2 er passive targets.

| Stage | Betingelse | Adfærd |
|---|---|---|
| **1 - EAN-match** | Samme EAN i ≥2 butikker | Grupperes via EAN (ingen fuzzy) |
| **2 - EAN, ingen match** | EAN findes kun i én butik | Solokort; passivt fuzzy-target |
| **3 - Ingen EAN** | Intet EAN | **Eneste stage der initierer fuzzy** |

Fuzzy vurderer: **navn**, **type**, **vægt** (enhed), **antal** (`stk`), **procenter** (fedt/alkohol/kakao), **kødtype**, **smag/form/variant**, **mærke-konflikt**, **pris-sanity**, **kg-pris**, **distinktivt ord (IDF)** og **billede (pHash)** - vægt og antal er separate attributter.

**Mål altid segmenteret.** `scripts/eval-matching.py` deler guldsættet i par
*inden for* samme datafeed (bilka/netto/føtex, meny/spar/mk, sb/kvickly/brugsen)
og par *på tværs*. Et samlet tal er meningsløst: 12.464 af 15.168 samme-feed-par
deler bogstavelig talt billed-URL, så de er trivielle og i forvejen grupperet af
stage 1 på EAN. Motoren står i dag 97,9 % / 98,8 % (recall/precision) inden for
feed og 17,6 % / 91,2 % på tværs. Det var 1,2 % / 56,2 % på tværs før revisionen
30-08-2026, hvor en usegmenteret baseline havde skjult problemet.

**Billed-signalet har tre roller og to grænser** (`_PHOTO_SAME_MAX_DIST` = 4
lemper hårde gates; `_PHOTO_REJECT_MAX_DIST` = 20 afviser, åbner blokeringen og
lemper type-gaten). Brug aldrig én grænse til alle tre igen: afvisning ved 4 var
kalibreret på par der deler billedfil, og lukkede 95,7 % af de korrekte
kryds-feed-par ude. Medianafstanden mellem to fotos af samme vare fra to
forskellige kilder er 22 af 64 bit.

Pipeline: Rema-annotering (inkl. EAN-retro-validering + cross-member-validering) → fase 1 (EAN-gruppering) → fase 2 (stage 3 fuzzy mod unmatched) → fase 2b (stage 3 fuzzy mod stage-1-grupper) → solokort → billed-dedup.

Fuld dokumentation med alle gates og tolerancer: `README.md` § Product matching.

## Sikkerhed

Den offentlige Supabase-nøgle ligger i `wrangler.toml`, i git og i hver sides HTML - den
er offentlig med vilje. Alt hviler derfor på, hvad den nøgle **må**: efter
`scripts/supabase-hardening.sql` har den ingen INSERT/UPDATE/DELETE på nogen tabel, og
al skrivning går gennem `SECURITY DEFINER`-RPC'er, der gentager appens validering i SQL.

Regler når du rører de her ting:
- Tilføj **aldrig** direkte tabelskrivning fra browseren eller fra `app.py` med anon-nøglen. Ny skrivning = ny RPC med validering i SQL.
- Ny butik med ny billed-CDN? Tilføj hosten i `_IMG_HOSTS` i `app.py`, ellers blokerer CSP'en billederne.
- Sikkerhedslogningen i `src/worker.py` skal blive ved med at være **aggregeret**. Logning der skalerer med trafikken var årsagen til nedbruddet 19-07-2026. `scripts/test-security-logging.py` håndhæver det og kører ved hvert produktions-deploy.
- `/admin` skal være usynlig for alle andre end admins: `admin_page()` svarer sitets almindelige 404 (`not_found.html`), medmindre HttpOnly-cookien `ms_session` (sat af auth.js via `/api/session`) tilhører en admin, og `/api/admin/*` svarer 404 til ikke-admins. Admin-CSS/JS ligger i `templates/admin/` og indlejres - læg dem aldrig i `static/`, og nævn ikke `/admin` i robots.txt, sitemap eller offentlige filer. Fanen Trafik (`/api/admin/traffic`) og D1-budgettet henter fra Cloudflares GraphQL-analytics og kræver GitHub-secret `CF_ANALYTICS_TOKEN` (kontotoken med *Account Analytics: Read*), som `build-pages.sh` lægger på workeren ved deploy. Besøgstallene kommer fra Cloudflare Web Analytics (cookiefri beacon, tilladt i CSP'en); headless-browsere tælles ikke. **En ny var som appen læser på edge skal både stå i `app._EDGE_ENV_VARS` og deklareres i `Env` i `src/worker.py`** - EdgeKit udleverer kun deklarerede navne, og en manglende linje giver ingen fejl, bare en usynlig værdi (sket 03-10-2026). `scripts/test-edge-env.py` håndhæver det ved hvert deploy.
- Workers-observability skal blive ved med at være slået fra - i **begge** miljøer (se § Miljøer & deploy). Angrebs-synligheden kommer fra D1 + `security-monitor.yml`, ikke fra platformens logs. `scripts/test-security-logging.py` håndhæver både dette og at ingen ny logningssti omgår aggregatoren.

Verifikation: `scripts/supabase-rls-audit.sql` (ren læsning) viser grants, RLS-status og policies.

## Verifikation - lært af søgefejlen (rettet 14-09-2026)

Samtidige søgninger gav 0 varer i over en måned. Tre "rettelser" (26-08 klient-retry, 27-08, 02-09 flere retries) behandlede symptomet og blev meldt løst uden at blive målt under samtidighed mod produktion - og ingen alarm gik, fordi hvert værn var blindt:

- **Grønt deploy ≠ virkende site.** Røgtesten og opvarmningen i deploy-workflows kører fra GitHub Actions og får 403 af Bot Fight Mode på *alle* requests; `continue-on-error` holdt dem grønne. Det der faktisk måler: funktionstjekket i `deploy-edge.yml` og `uptime-worker/` (forside + kategori, frisk render af en søgning), og `degraded`-alarmen fra `relay-security-events.py` på rigtig trafik (`search-check.yml` og `uptime-check.yml` er slettet). Siden 02-10-2026 kører relæet og job_runs-synken i `security-monitor.yml` hver 3. time, og uptime-tjekkene i `uptime-worker/`: Cloudflare cron hvert 5. minut, mail via Resend ved nede og OK igen, tilstand i KV-nøglen `uptime_state_v1`, deployes af `deploy-uptime-worker.yml`. En worker-fetch bliver ikke stoppet af Bot Fight Mode. Hvert 5. minut tjekkes kun edge-cachede sider plus staging-login; den friske søgning kører hver 2. time (~230k af 5M rows_read i døgnet; budgettet var 6,1M den 30-09-2026, så mål før frekvensen sættes op). Kør aldrig en ucachet søgning hvert 5. minut (288 D1-tabelscanninger i døgnet sprænger rows_read-budgettet).
- **En fejl i et brugervendt flow er først rettet, når den er målt før og efter mod produktion under de betingelser den opstår i** (her: samtidige, ucachede requests). Klient-retry er afhjælpning, ikke rettelse. Reproducér først, ret årsagen, mål igen.
- **Et tjek der ikke kan måle, skal fejle** - aldrig stå grønt. Tilføj ikke `continue-on-error` på et måletrin.
- **Cloudflares egne 1101/1102 når aldrig appens kode eller D1-loggen** - de ses kun i GraphQL-analytics. `security-monitor.yml` alarmerer på dem (`check_worker_invocations`), og en manuel kørsel med `cpu_detail_from`/`cpu_detail_to` giver CPU pr. minut og status: den eneste måde at måle CPU på edge. Mål en rutetype ved at sende en serie af den i ét minut og læse minuttet (analytics er et par minutter forsinket). Lokal CPython er 15-25× hurtigere end edge og kan kun bruges til at finde hotspots.
- **Cachede sider beviser intet om render-vejen.** Forsiden/kategorier ligger i edge-cachen; tjek søgning og andet dynamisk med en URL der renderes frisk.
- **GitHub-cron kører i praksis hver 2.-6. time**, uanset `*/5`. Alarmvinduer skal tåle det (`LOOKBACK_HOURS` i `relay-security-events.py`).

## Regler

- Rediger kode direkte uden at spørge om lov
- Vis altid ændringer du laver
- Hvis noget er ødelagt, fix det med det samme
- Optimer kode når du ser mulighed for det
