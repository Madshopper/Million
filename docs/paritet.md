# Web/app-paritet - matrix og status

Levende dokument. **Opdatér det i samme commit som du ændrer en feature** -
en matrix der lyver er værre end ingen matrix.

Senest revideret: **19-08-2026** (fuld gennemgang af `templates/`, `static/js/`,
`apps/mobile/src/`, `app.py`, `app_support.py`, `.github/workflows/`).

Grundprincippet: **ét produkt → én backend → én database → to præsentationslag.**
Web og app kalder de samme `/api/*`-endepunkter og de samme Supabase-RPC'er.
Al forretningslogik der kan ligge i backend, ligger i backend
(`app.py` / `app_support.py`), og begge platforme henter den derfra.

Symboler: ✅ implementeret · ⚠️ delvist · ❌ mangler · – ikke relevant

---

## 1. Feature-matrix

### Produkt og listevisning

| Feature | Web | App | Backend | Tests | Status |
|---|---|---|---|---|---|
| Forside med sektioner | ✅ | ✅ | ✅ `/api/home` | ✅ | Complete |
| Kategorisider (9 kategorier) | ✅ | ✅ | ✅ `/api/category/<slug>` | ✅ | Complete |
| Kategorier-knap med oversigt over alle (i stedet for vandret bjælke) | – | ✅ | – | ❌ | Complete *(03-10-2026; i appen en skuffe fra venstre. Web beholder den vandrette bjælke efter Kalles ønske)* |
| Ugens Tilbud | ✅ | ✅ | ✅ `/api/sale` | ✅ | Complete |
| Forsidens Ugens Tilbud: højst 2 varer pr. butik forrest | ✅ | ✅ | ✅ `_build_home_categories` | ❌ | Complete *(01-10-2026; gælder ikke Populære varer)* |
| Underkategori-chips | ✅ | ✅ | ✅ | ✅ | Complete |
| Paginering | ✅ | ✅ | ✅ | ✅ | Complete |
| Produktkort: mærke/navn/pris/tilbudsbadge | ✅ | ✅ | ✅ | ✅ | Complete |
| Produktkort: vægt, "X stk", **kg-pris** | ✅ | ✅ | ✅ | ✅ | Complete *(app fik dem 19-08-2026)* |
| "Kun hos <butik>"-badge | ✅ | ✅ | ✅ | ✅ | Complete |
| Farver: tre grønne (#059669 / #047857 / #D6F5E3) + gul til alt tilbud (én gul #DFA300: flade på SPAR-mærket, tekst på tilbudsprisen), intet rødt tilbud, grønt butiksmærke i kurven | ✅ | ✅ | – | ❌ | Complete *(03-10-2026; se `theme/colors.ts`)* |
| Tom-tilstand ("ingen varer matcher") | ✅ | ✅ | – | ✅ | Complete |
| Fejltilstand + "Prøv igen" | ✅ | ✅ | – | ⚠️ | Complete |

### Søgning og filtrering

| Feature | Web | App | Backend | Tests | Status |
|---|---|---|---|---|---|
| Fritekstsøgning | ✅ | ✅ | ✅ `/api/search` | ✅ | Complete |
| Autocomplete (debounced) | ✅ | ✅ | ✅ `/api/autocomplete` | ✅ | Complete |
| Stavekorrektion ("mlæk" → "mælk") | ✅ | ✅ | ✅ | ✅ | Complete |
| Varer vist før man skriver (app: "Populære varer" fra `/api/home`, edge-cachet) | ➖ | ✅ | ✅ `/api/home` | ➖ | App-only |
| Sortering (5 typer, inkl. kg-pris) | ✅ | ✅ | ✅ | ✅ | Complete |
| Prisinterval min/max | ✅ | ✅ | ✅ | ✅ | Complete |
| Filtre: tilbud / øko / laktosefri | ✅ | ✅ | ✅ | ✅ | Complete |
| Butiksvalg (14 butikker) | ✅ | ✅ | ✅ `/api/stores` | ⚠️ | Complete *(app: kun i Indstillinger; fjernet fra filter-arket 02-10-2026)* |
| Butiksvalg debounced 300 ms | ✅ | ✅ | – | ❌ | Complete *(app 19-08-2026)* |
| Butiksskift nulstiller til side 1 | ✅ | ✅ | – | ❌ | Complete *(app-kategori/tilbud 19-08-2026)* |

### Produktdetaljer

| Feature | Web | App | Backend | Tests | Status |
|---|---|---|---|---|---|
| Prissammenligning på tværs af butikker (maks. 5) | ✅ | ✅ | ✅ | ⚠️ | Complete |
| Kg-pris pr. butik | ✅ | ✅ | ✅ | ⚠️ | Complete |
| Multikøbs-tilbud | ✅ | ✅ | ✅ | ✅ | Complete |
| Prishistorik-graf (30 dage, pr. butik) | ✅ | ✅ | ✅ `/api/price-history` | ❌ | Complete |
| Prisindsigt ("billigere end normalt") | ✅ | ✅ | – | ❌ | Complete |
| Næringsindhold + ingredienser | ✅ | ✅ | ✅ `/api/nutrition` | ❌ | Complete |
| Prisalarm ("Overvåg pris") | ✅ | ✅ | ✅ RPC `create_price_alert` | ❌ | Complete |
| Billed-zoom | ✅ | ❌ | – | – | **Bevidst forskel** (se §3) |

### Kurv, lister og deling

| Feature | Web | App | Backend | Tests | Status |
|---|---|---|---|---|---|
| Kurv: tilføj/fjern/antal | ✅ | ✅ | – | ✅ | Complete |
| Kurv: swipe på en vare (venstre = fjern alle stk, højre = én mere), Feature `swipe` | ✅ kun touch | ✅ + skærmlæser-handlinger | ✅ `swipe_enabled` i sidekontekst og `/api/home` | ❌ | Skjult på madshopper.dk, til på dev; udgives automatisk af `feature-auto-publish.yml`, når app 1.0.4 er i App Store (`with_app` i `_FEATURES`), så web og app følges ad |
| Kurv gemt på server pr. bruger | ✅ | ✅ | ✅ `carts` + RLS | ❌ | Complete |
| Kurv-synk web ↔ app | ✅ | ✅ | ✅ | ❌ | Complete |
| Anonym kurv-statistik | ✅ | ✅ | ✅ RPC `record_cart_activity` | ❌ | Complete |
| Varestatistik: visninger og søgninger (Feature `stats`) | ✅ | ✅ | ✅ `/api/cart-event` → `record_cart_activity` (view) / `record_search_activity` | ❌ | Samles og sendes højst hvert 15. sekund; appen sender kun når `/api/home` siger `stats_enabled`, og først fra næste appversion |
| Gemte lister (maks. 10) | ✅ | ✅ | ✅ | ❌ | Complete |
| Delt kurv (live, maks. 6 medlemmer) | ✅ | ✅ | ✅ 5 RPC'er | ❌ | Complete |
| Invitationslink | ✅ | ✅ | ✅ | ❌ | Complete |
| Forlad gruppe | ✅ | ✅ | ✅ | ❌ | Complete |
| "Find billigste" (SCO) | ✅ | ✅ | ✅ `/api/products` | ✅ | Complete |
| Alternativer til manglende varer | ✅ | ✅ | ✅ `/api/alternatives` | ✅ | Complete |
| Butiksrute (flere butikker) | ✅ | ✅ | – | ❌ | Complete |
| Personlig besparelse (anbefalet butik mod dyreste på fælles varer, `compareSavingsRange`) | ✅ | ✅ | ✅ RPC `get_personal_savings` / `record_compare_savings` | ✅ `sco.test.ts` | Complete |

### Konto

| Feature | Web | App | Backend | Tests | Status |
|---|---|---|---|---|---|
| Opret konto (email) | ✅ | ✅ | ✅ Supabase Auth | ❌ | Complete |
| Log ind / log ud | ✅ | ✅ | ✅ | ❌ | Complete |
| Google-login | ✅ | ✅ | ✅ | ❌ | Complete |
| Apple-login | ⚠️ | ✅ | ✅ | ❌ | **Blokeret** (se §3) |
| Glemt adgangskode | ✅ | ✅ | ✅ | ❌ | Complete |
| Bot-tjek på signup (Turnstile) | ✅ | ✅ | ✅ Auth Hook | ❌ | Complete |
| Vist navn (delt kurv) | ✅ | ✅ | ✅ RPC `set_my_display_name` | ❌ | Complete |
| "Mine prisalarmer" (se/slet) | ✅ | ✅ | ✅ | ❌ | Complete |
| Prisalarm som besked på telefonen (push) | ✅ | ✅ | ✅ RPC `register_push_device`, `push_notify.py` | ⚠️ `test-push-crypto.py` | Skjult *(04-10-2026; Feature-panelet 'push', til på dev. Web: knap under Mine prisalarmer, på iPhone kun fra hjemmeskærmen. App: ingen knap, notifikationer styres kun i telefonens indstillinger (Kalle 04-10-2026); profilen viser kun prisalarmerne. Kræver ny app-version. Når udgivet sendes ingen mails; uden tilmeldt enhed venter alarmen. Begge platforme stopper "Overvåg pris" med en boks/overlay når notifikationer er slået fra; appen spørger ved første åbning)* |
| Slet konto | ✅ | ✅ | ✅ RPC `delete_own_account` | ❌ | Complete |
| Profil-fane med "Fælles kurv" | ➖ | ✅ | ✅ (samme delt-kurv-RPC'er) | ❌ | **Bevidst forskel**: appens nederste fane hedder "Profil" (før "Indstillinger", ændret 02-10-2026) og samler konto, navn, "Fælles kurv" (alle medlemmer, start/stop deling) og prisalarmer; indstillinger (med slet konto) og feedback er tydelige rækker derfra (03-10-2026). Web har ingen fanebjælke - kontoen ligger i konto-menuen og indstillingerne i tandhjulspanelet, og medlemmerne vises i kurven |

### Indstillinger og indhold

| Feature | Web | App | Backend | Tests | Status |
|---|---|---|---|---|---|
| Mørk tilstand | ✅ | ✅ | – | – | Complete |
| "Følg system"-tema | ✅ | ✅ | – | ✅ | Complete *(web fik det 19-08-2026)* |
| Standardbutikker | ✅ | ✅ | – | – | Complete |
| Feedback / meld fejl | ✅ | ✅ | ✅ `/api/feedback` | ❌ | Complete |
| Admin-panel (`/admin`) | ✅ | ➖ | ✅ `/api/admin/edge` + admin-RPC'er | ➖ | Web-only med vilje (kun ejeren). Usynlig for alle andre end admins (almindelig 404; adgang tjekkes på serveren via HttpOnly-cookien `ms_session` fra `/api/session`). Eget layout med sidemenu; CSS/JS ligger i `templates/admin/` og indlejres, så intet admin-indhold er en offentlig fil. Brugere-sektionen godkender/fjerner adgang til det private site via `admin_list_users`/`admin_set_approved` (falder tilbage til nyeste brugere, hvis RPC'erne mangler). Kørselshistorik fra GitHub Actions gemt i Supabase `job_runs` (`scripts/sync-job-runs.py` i security-monitor). Fanen Varer (Feature `stats`): dagstotaler i `stats_daily` via `admin_stats`; web og app tæller visninger og søgninger (appen via `apps/mobile/src/stats/stats.ts`, fra næste appversion) |
| Vilkår / privatliv / om os | ✅ | ✅ | – | – | Complete |
| Opskrifter (bag gate) | ✅ flag | ✅ flag | ✅ | ❌ | Gated - kun med `RECIPES_ENABLED=1` / `EXPO_PUBLIC_RECIPES_ENABLED=1` *(fra som standard; slået til på staging/dev.madshopper.dk via `build-pages.sh` 03-10-2026, aldrig i produktion)* |
| Forsidens opskrift-teaser | ✅ ikke-klikbar "Kommer snart" | ✅ ikke-klikbar "Kommer snart" | ✅ `recipes_clickable` | ❌ | Begge viser teaseren altid; kortene er kun klikbare med `RECIPES_ENABLED=1` (app: også `EXPO_PUBLIC_RECIPES_ENABLED=1`) *(tilbage på web og app 02-10-2026)* |
| Cookie-samtykke (Zaraz) | ✅ | – | – | – | **Bevidst forskel** (se §3) |
| Analytics (GA4 via Zaraz) | ✅ | – | – | – | **Bevidst forskel** (se §3) |
| Push-beskeder / nyhedsbrev | ❌ | ❌ | ❌ | – | **Findes ikke** (se §2) |

---

## 2. Åbne gaps

| # | Gap | Prioritet | Note |
|---|---|---|---|
| 1 | Ingen crash-/fejlrapportering i app'en | Høj | Ingen Sentry/Crashlytics. En fejl i produktion ses kun i App Store Connects crash-rapporter. En `ErrorBoundary` (19-08-2026) forhindrer nu hvid skærm, men rapporterer ikke videre. Kræver et leverandør- og privatlivsvalg. |
| 2 | Nyhedsbrev findes ikke | Lav | To døde kontakter blev fjernet fra web 19-08-2026 (de skrev til localStorage, som intet læste). Push-beskeder til prisalarmer er bygget på backend + web + app samtidigt (04-10-2026, se docs/prisovervaagning.md). |
| 3 | Tyndt testdække på konto, delt kurv og prisalarmer | Høj | Kun `multiDeal`/`sco` (app) + listing-API-kontrakt (Python) + Playwright-røgtest. Ingen automatiserede tests af login, delt kurv, gemte lister eller prisalarmer på nogen af platformene. |
| 4 | App'en er ikke prøvet med VoiceOver | Medium | Ikon-/symbol-knapper fik etiketter 19-08-2026. Alle skærme fik etiketter, roller og overskrifter 05-10-2026 (fælles udtale af priser i `src/a11y/speech.ts`; produktkortet har "Tilføj til kurv" som VoiceOver-handling). Mangler: en gennemgang på en rigtig iPhone med VoiceOver. |
| 5 | Ingen automatiseret web-a11y-kontrol | Medium | `scripts/audit-site.py` findes, men indgår ikke i deploy-workflowet. |
| 6 | Kurv-ikonet der fyldes op findes kun i app'en | Lav | App-headeren fik 01-10-2026 en vogn der fyldes med de første fire varer (`CartIcon.tsx`) + antal-badge i stedet for teksten "Kurv (n)". Web har stadig det almindelige ikon med badge. Samme tal, kun tegningen er forskellig. |

---

## 3. Bevidste, teknisk begrundede forskelle

Disse skal **ikke** rettes - de er dokumenteret her, så de ikke bliver "opdaget"
som gaps igen.

- **Cookie-banner og analytics kun på web.** App'en sætter ingen cookies og
  kalder aldrig ATT. `app.config.js` udelader bevidst
  `NSUserTrackingUsageDescription`, fordi App Privacy erklærer "no tracking".
  Kommer analytics på i app'en, skal begge dele ændres samtidigt.
- **Billed-zoom kun på web.** iOS/Android har systemets egen pinch-zoom-
  konvention; en modal kopi af webbens zoom ville modarbejde den.
- **Apple-login kun i app'en.** Koden ligger klar på web
  (`auth.js::ensureAppleSdk`); den mangler kun `window.__APPLE_CLIENT_ID` og
  Apple-provideren i Supabase. Begge kræver et Apple Developer-medlemskab,
  som ikke findes. Knappen er skjult indtil da - ingen død knap.
- **Butiksvalgets placering.** Kun i Indstillinger, på begge platforme.
  Filter-arket i app'en viste også butikkerne indtil 02-10-2026; de blev
  fjernet efter ønske (Kalle), så filteret kun handler om varerne.
- **Serverrendering vs. JSON.** Web renderer lister server-side (SEO, hurtig
  first paint), app'en henter de samme data som JSON fra `/api/*`. Samme
  `product_to_display_dict` → samme felter.

---

## 4. Status

**Feature-paritet**

- Web: 100 % af de fælles features
- App: 100 % af de fælles features
- Backend: 100 % - al delt logik ligger i `app.py`/`app_support.py` og RPC'erne
- Tests: ~35 % - kritiske købsflows er dækket, konto/deling/alarmer er ikke

**Åbne fund**

- Kritiske: 0
- Høje: 2 (crash-rapportering i app, testdække på konto/deling/alarmer)
- Medium: 2 (a11y i app, automatiseret web-a11y)
- Lave: 1 (push/nyhedsbrev findes ikke)

**Udgivelsesblokkere: 0.** Ingen af de åbne fund forhindrer udgivelse af den
nuværende funktionalitet; de er efterslæb, ikke defekter.

---

## 5. Rettet 19-08-2026

| Fund | Platform | Rettelse |
|---|---|---|
| "Push-beskeder"/"Nyhedsbreve" var døde kontakter | Web | Fjernet + gamle localStorage-nøgler ryddes |
| Produktkort manglede vægt, "X stk" og kg-pris | App | Tilføjet, samme rækkefølge/betingelser som webbens makro |
| Butiksvalg kun i Indstillinger | App | Butiks-chips i filter-arket (`FiltersBar`) |
| Ét listing-kald pr. butikstryk | App | `queryLabels` - 300 ms debounce som webbens `scheduleStoreContentRefresh()` |
| Butiksskift beholdt sidetallet → tom skærm | App | Nulstiller til side 1 i kategori/tilbud |
| Mærket "None" vist på ~4 % af varerne | **Begge** | `clean_display_text()` i visningslaget + `_clean_field` ved kilden i `updater.py` |
| "Tilføj til kurv" uden varenavn for skærmlæsere | **Begge** | Varenavnet med i `aria-label` / `accessibilityLabel` |
| Ikon-knapper uden etiket (✎, ···, −, +, Fjern) | App | `accessibilityRole` + `accessibilityLabel` |
| Uventet render-fejl gav hvid skærm | App | `ErrorBoundary` yderst i `App.tsx`, verificeret i simulator |
| Mobile-tests kørte kun på pull requests | CI | `push`-trigger på `main`/`dev` (repoet har haft 1 PR i alt) |
| Mobile-tests kunne aldrig bestå i CI: Node 20 kender ikke `--experimental-strip-types` (kom i 22.6) | CI | Node 22. Fejlen dukkede op i samme sekund push-triggeren blev slået til - den havde ligget skjult, fordi workflowet aldrig kørte |
| Playwright-installationen kunne aldrig komme sig efter en timeout - ramte 4 kørsler, heraf produktions-deployet | CI | `scripts/install-playwright-ci.sh`: rydder den efterladte `apt-get` op, venter på låsen, og dropper `--with-deps` på sidste forsøg |
| Død markup: `#overlay-pills` | Web | Fjernet (HTML + CSS) |
| `prisovervaagning.md` påstod at "Mine alarmer" manglede | Docs | Rettet - den findes på begge platforme |
| Web manglede app'ens "Følg system"-tema | Web | Tre valg med NØJAGTIG app'ens lagringskontrakt + `scripts/test-theme-parity.mjs` som gate (`parity-tests.yml`) |

---

## 6. Rettet 27-08-2026 (QA-gennemgang af web)

En fuld gennemklikning af webben (forside → søgning → filtre → overlay → kurv →
konto → mobil) gav 14 fund. Halvdelen holdt ikke ved eftersyn i koden - de
noteres her, fordi de ellers bliver "rettet" igen næste gang nogen tester.

| Fund | Platform | Rettelse |
|---|---|---|
| Kurv-banneret lovede 182,40 kr, sammenligningen viste 30,40 kr for samme kurv. Bannerets `dyreste − billigste` regnede hen over butikker med **forskellig dækning**, så en butik med 1 af 4 varer blev "billigst" | Web | Kun butikker der fører hele kurven tælles med (`storeCovered`), som `fullCoveragePriceRange()` allerede gjorde i selve sammenligningen |
| To varianter blev til to identiske kurvlinjer ("Coca cola"), fordi varianten ligger i `description`, ikke i `name` (`name="COCA COLA"` for både original og zero sugar) | **Begge** | `cartItemTitle()` viser beskrivelsen når den udvider navnet; `description` gemmes på kurv-varen og følger med i gemte lister og delt kurv (`d` i den kompakte form) |
| Fravalgt butik i Indstillinger dukkede op igen. Årsag: uden funktionelt samtykke kan `saveStoreFilters()` ikke gemme - men intet fortalte brugeren det | Web | Besked i Indstillinger med genvej til cookievalget |
| "Overvåg pris" så ud til at fryse siden | Web | Var en native `alert()` (blokerer siden, kan ikke styles). Erstattet af en besked i overlayet |
| "Alarm sat"-tilstanden hang ved på næste vare man åbnede | Web | `resetPriceAlertBox()` ved hver `openOverlay()` |
| Tom prishistorik tegnede Chart.js' standardakse (0-1 kr) under en vare til 3,52 kr | Web | Grafen skjules, og der står at vi endnu ikke har historik |
| Login sendte "abc" + 3-tegns kode til Supabase og fik et generisk svar retur | Web | Format og længde tjekkes i klienten (formen har `novalidate`) |
| `/om-os` gav 404 (kun `/om-os.html` og `/about` fandtes) | Web | `/om-os` tilføjet |

**Fund der ikke var fejl:** søgefeltet opdaterer ikke URL'en (det er et
overlay-panel, ikke en navigation - fuldsiden `/search/results?q=` findes og
virker), og produktoverlayet har ingen permalink af samme grund.

**Cookiemodalen - rettet samme dag, efter at DOM'en var målt.** Knapperne faldt
uden for skærmen ved lave vindueshøjder, så kun Escape lukkede modalen. Målt på
produktion: ved 560 px lå "Bekræft mine valg" på top 571, og ved **520 px lå
alle tre knapper** uden for viewporten - værre end rapporteret.

Mekanismen: modalen er Cloudflare Zaraz' egen og ligger i en **åben shadow
root** på `.cf_modal_container`. Dialogen får `max-height: 460px` mens indholdet
fylder ~570 px, og der er to indlejrede scroll-områder (dialogen *og*
formålslisten), så det var uklart hvad musehjulet ramte.

Det afgør også hvad der IKKE virker: en regel i `styles.css` mod
`.cf_modal_container > *` rammer ingenting, fordi der ikke findes light-DOM-børn
- alt indhold er i shadow rooten. Rettelsen er derfor `patchConsentModalLayout()`
i `script.js`, som injicerer en stil ind i shadow rooten og gør knapperækken
sticky i bunden af dialogen. Verificeret ved 520/560/900 px: ingen skjulte
knapper efter, ingen ændring over 760 px hvor media queryen er inaktiv.

Konsekvensen var ikke kosmetisk: afviser man samtykke, kan butiksvalg slet ikke
gemmes.

---

## 7. Rettet 15-09-2026 (kurv og prissammenligning)

Brugerrapport: "Billigste pris" virker første gang, men efter at have slettet
en vare sker der ingenting ved næste tryk. Reproduceret i Playwright mod både
localhost og **produktion** (runde 1 åbner, runde 2-4 åbner ikke), rettet, og
målt igen med en 19-scenariers kurv-suite på desktop og mobil.

| Fund | Platform | Rettelse |
|---|---|---|
| Sammenligningen åbnede kun første gang. Sletningen var ikke årsagen - **andet tryk overhovedet** var: med `/api/products` i cachen satte `showReference()` `display:flex` i microtask-køen *mens klikket stadig boblede*, og to globale "klik udenfor"-handlers så et åbent overlay + et klik uden for `.sco-modal` og lukkede det straks | Web | Handlerne fjernet; `.sco-backdrop` dækker hele overlayet og lukker det selv |
| Accepteret alternativ lukkede sammenligningen (knappen var fjernet fra DOM'en af gen-renderingen, så `contains()` var falsk), og klik inde i Billigste butikker lukkede sammenligningen nedenunder | Web | Samme rettelse |
| Esc lukkede både sammenligningen **og** kurven | Web | Den generelle Esc-handler viger, når et sammenlignings-overlay er åbent |
| Tab blev fanget i kurven *bag* sammenligningen - modalen var ikke til at nå med tastatur | Web | Overlayene er lag i fokus-fælden; fokus-stak giver fokus tilbage til "Billigste pris" ved luk |
| Fejlet `/api/products` (fx 429) blev cachet som `null` resten af sidevisningen; degraderet svar blev cachet som tomt kort | Web | Fejl ryddes, degraderede svar bruges men caches ikke |
| Ingen valgt butik fører varerne → overlayet viste *forrige* sammenlignings indhold | Web | Tom-tilstand med besked |
| Vare slettet mens første sammenligning indlæses (~2 s) kom med i resultatet | Web | Kurven læses efter ventetiden |
| Valgt butik uden for kataloget gav `undefined.push` | **Begge** | Kun katalog-butikker tælles (`sco.ts` + `script.js`) |
| Én `/api/cart-event` pr. **forskellig** vare - 10 varer = 10 kald, 429 fra 21. vare/min pr. IP | **Begge** | Køen samler alle varer i ét kald (maks. 50, maks. 3 s ventetid); web sender resten ved `pagehide` |
| Kurv-badget læste localStorage direkte og viste 0 ved blokeret/fuld lagring | Web | Læser kurven i hukommelsen, som listen og sammenligningen |
