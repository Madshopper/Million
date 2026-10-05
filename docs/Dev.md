Dev-miljø (test af nye features uden at røre produktion)

Live test-URL: https://dev.madshopper.dk (skjult ligesom /admin: alle uden adgang får 404, også på `/staging-login`, `/robots.txt` og `/static/`). Eneste vej ind for et menneske er knappen "Se dev-siden" i madshopper.dk/admin, som kun admins ser: den giver et engangslink (?t=, 2 min., signeret med samme secret, som produktionen har som STAGING_LINK_SECRET) og en cookie der holder 24t. CI bruger ?k=<STAGING_ACCESS_SECRET> til sin egen warmup/røgtest. Mail+adgangskode-login blev fjernet 05-10-2026.
Egen Worker (madshopper-dev), egen KV-namespace og egen D1-database - helt adskilt fra madshopper.dk. Bruger samme Supabase-projekt som produktion: produktdata og prishistorik LÆSES fra de delte tabeller (altid friske data), mens SKRIVNINGER (kurv-klik i cart_popularity, prisalarmer i price_alerts) går til separate *_dev-tabeller via TABLE_SUFFIX-env-varen - så test aldrig forurener produktionens statistik. Engangsopsætning: kør scripts/supabase-dev-tables.sql i Supabase SQL Editor. Lokal kørsel (python app.py) bruger også automatisk *_dev-tabellerne.


NÅR DU ÅBNER EN ANDEN COMPUTER (første gang)

1. Klon repoet, hvis det ikke allerede ligger der:
   git clone https://github.com/Madshopper/Million.git
   cd Million

2. Opret .env-filen. Den ligger IKKE i git (indeholder nøgler), så den følger ikke automatisk med til den nye computer:
   cp .env.example .env
   Åbn .env og indsæt Supabase-nøglerne (kopiér dem fra din anden computers .env, fx via password manager/AirDrop/Bitwarden - send dem ikke i almindelig chat/mail).

3. Installér afhængigheder:
   uv sync

Det er det - ingen Cloudflare-login nødvendigt her. Deploy sker via GitHub Actions, ikke fra din maskine.


HVER GANG DU SKAL ARBEJDE PÅ EN FEATURE (uanset computer)

Der er ingen dev-branch længere (fjernet 02-10-2026). Alt arbejde går via en feature-branch og en pull request direkte til main.

1. git checkout main
2. git pull                     (hent det seneste fra main)
3. git checkout -b min-feature  (ny branch til ændringen)
4. Lav dine ændringer
5. Test lokalt undervejs:
   python app.py
   -> http://localhost:5001
6. git add -A
   git commit -m "..."
   git push -u origin min-feature
7. Åbn en pull request mod main på GitHub. Tests (mobile-tests, parity-tests m.fl.) kører på PR'en.
8. Vil du se den på en rigtig edge-deployment før merge? Gå til Actions > "Deploy Edge Worker (staging)" > Run workflow, vælg din branch -> deployer til:
   https://dev.madshopper.dk
   Næste push til main skriver staging tilbage til main-koden.
9. Tilfreds? Merge PR'en ind i main -> deployer automatisk til både produktion (madshopper.dk) og staging (dev.madshopper.dk).
   Rører PR'en updater.py, app_support.py, scraper/** eller cache-updater.yml, så skriv [skip ci] i merge-committen (ellers en ekstra fuld D1-reseed, se CLAUDE.md § D1-skrivebudget). [skip ci] springer også deploy over, så kør derefter "Deploy Edge Worker" og "Deploy Edge Worker (staging)" manuelt på main hvis edge-koden også er ændret.


VALGFRIT - MANUELLE KOMMANDOER (kun hvis du vil springe GitHub Actions over)

Byg + deploy dev-workeren direkte fra din maskine (kræver wrangler-login):
DEPLOY_ENV=staging bash scripts/build-pages.sh
cd dist && npx wrangler deploy

Genseed dev-D1 med friske produktdata fra Supabase:
DEPLOY_ENV=staging python3 scripts/seed-d1.py


HUSK

- .env følger IKKE med git mellem computere - skal sættes op manuelt hver gang du starter på en ny (se trin 2 ovenfor).
- Dev-deployet genbruger CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID og CACHE_REFRESH_SECRET fra produktion. Ingen nye GitHub secrets nødvendige - røgtesten (se deploy-edge-dev.yml) kører via Playwright/headless browser og kræver ingen delt hemmelighed.
- Dev-workeren har custom domain dev.madshopper.dk og beholder også den gratis *.workers.dev-URL.
