# Prisovervågning

Status: **Live.** `RESEND_API_KEY` er sat som GitHub Actions-secret siden 31-07-2026 - denne fil påstod indtil 18-08-2026 fejlagtigt at nøglen stadig manglede, hvilket i to uger skjulte at funktionen reelt var i drift. Selve mail-leveringen (afsender-domæne, Resend-kvote mv.) er ikke logget bekræftet lykkedes - fejler et forsøg, ses det nu som en samlet advarsel i `updater.py`s natlige log (`check_price_alerts()`), ikke længere stille.

> **"Personlig besparelsesoversigt"** på forsiden (web `.savings-widget` + app) er **live**: kræver login, optæller (dyreste − billigste) ved prissammenligning, Top X % blandt brugere, og viser forrige måned de første 7 dage. SQL: `scripts/supabase-user-savings.sql`.

## Sådan virker det

1. I produkt-overlayet trykker en logget ind bruger "Overvåg pris" og sætter en målpris (`templates/base.html`, `.price-alert-box` / `#alert-form`).
2. `savePriceAlert()` i `static/js/script.js` kalder `create_price_alert`-RPC'en **direkte fra browseren** via `window.AuthBridge` (samme mønster som `carts` - ingen tur om `app.py`). Er brugeren ikke logget ind, åbner `AuthBridge.requireAuth()` login-modalen i stedet.
3. RPC'en (SECURITY DEFINER, `scripts/supabase-price-alerts-v2.sql`) kræver `auth.uid()` og henter email fra JWT'et - kan ikke forfalskes af klienten. Én alarm pr. bruger+produkt (nyt kald opdaterer target).
4. Hver nat, som del af `updater.py`s `run_updater()`, tjekker `check_price_alerts()` alle alarmer med `notified_at IS NULL` mod nattens friske priser (samme kilde som prishistorikken, `collect_store_prices()` - laveste pris på tværs af alle butikker).
5. Rammer prisen målprisen eller derunder, sendes en mail via **Resends HTTP API** (`_send_price_alert_email()`), og alarmen markeres `notified_at = now()` så den ikke sender igen. En ny alarm på samme vare nulstiller `notified_at` (RPC'en).

## Beskeder på telefonen (push) - bygget 04-10-2026

Skjult på madshopper.dk indtil den udgives i Feature-panelet (`app._FEATURES`, nøgle `push`); altid til på dev.madshopper.dk (`PUSH_ENABLED` i `build-pages.sh`) og i appens test-udgaver (`EXPO_PUBLIC_PUSH_ENABLED` i `eas.json`).

- **Tilmelding:** på hjemmesiden trykker brugeren "Få besked på telefonen" under "Mine prisalarmer". Appen har ingen knap (Kalle 04-10-2026): den spørger om lov ved første åbning, og derefter styres notifikationer kun i telefonens indstillinger; profilen viser bare de prisalarmer man har. Web (`static/js/auth.js::enablePush`, `static/sw.js`) bruger standard Web Push; appen (`apps/mobile/src/push/push.ts`) bruger Expos gratis push-tjeneste. Begge gemmer enheden via `register_push_device`-RPC'en i `push_devices` (`scripts/supabase-push.sql`, én række pr. enhed, højst 10 pr. bruger). Log ud afmelder enheden.
- **Afsendelse:** `check_price_alerts()` i `updater.py` spørger `scripts/feature_flags.py` om `push` er udgivet. Er den det, sendes prisalarmer **kun** som besked (`push_notify.py`), aldrig som mail (Kalle 04-10-2026). Har brugeren ingen tilmeldt enhed, eller kom beskeden ikke frem, bliver alarmen stående (`notified_at` forbliver tom) og prøves igen næste nat. Derfor spørger appen om lov til notifikationer første gang den åbnes, og tilmelder telefonen automatisk ved login, så længe lov er givet. Er notifikationer slået fra, viser "Overvåg pris" et overlay med "Slå notifikationer til" og "Åbn Indstillinger" i stedet for at sætte alarmen. Hjemmesiden gør det samme ved "Overvåg pris" (`script.js::showPushNotice`): uden notifikationer vises en boks med "Slå notifikationer til" (eller forklaring om blokeret browser / iPhone-hjemmeskærm) i stedet for formularen. Efter udgivelsen sender MadShopper altså ingen prisalarm-mails; de eneste mails er Supabase' egne login-mails (bekræft konto, nulstil adgangskode). Før udgivelsen sendes mail som hidtil. Enheder der er væk (404/410 / `DeviceNotRegistered`) slettes.
- **Nøgler:** Web Push signeres med VAPID. Den offentlige nøgle står i `app.py::_VAPID_PUBLIC_KEY` og `push_notify.py`; den hemmelige er GitHub-secret `VAPID_PRIVATE_KEY`. Kryptering og signatur tjekkes af `scripts/test-push-crypto.py` (inkl. RFC 8291's officielle testeksempel).
- **iPhone-appen** kræver at Apples push-nøgle ligger hos Expo (`eas credentials` → Push Notifications, eller sig ja når `eas build` spørger). **Android** kræver et gratis Firebase-projekt (`google-services.json` + FCM-nøgle i `eas credentials`), først relevant når appen kommer i Google Play.
- **iPhone-hjemmesiden:** Safari kan kun modtage beskeder, når siden er lagt på hjemmeskærmen (iOS 16.4+). Knappen forklarer det.
- **Test:** workflowet *Testbesked til telefonen (dev)* (`push-test.yml`) sender en testbesked til alle enheder tilmeldt på dev (`push_devices_dev`), aldrig til rigtige brugere.

## Forudsætninger (alle opfyldt pr. 18-08-2026)

1. **`RESEND_API_KEY`-secret** i GitHub Actions (bruges af `cache-updater.yml` → `updater.py`) - sat 31-07-2026. Samme nøgle ligger i lokal `.env` til test.
2. **`scripts/supabase-price-alerts-v2.sql`** kørt i Supabase SQL Editor.
3. **`scripts/supabase-price-alerts-throttle.sql`** kørt i Supabase SQL Editor - 1 kald/sekund-cooldown pr. bruger på `create_price_alert`, så RPC'en (som går uden om `app.py`s `@rate_limit`, jf. carts/delte lister/besparelser-mønsteret) ikke kan hamres.

## Bevidste afgrænsninger (v1)

- "Mine prisalarmer" findes nu paa BEGGE platformer og lister aktive alarmer med mulighed for at slette dem
  (web: `templates/base.html` `.auth-alerts` + `static/js/auth.js::loadPriceAlerts/deletePriceAlert`; app:
  `apps/mobile/src/components/PriceAlertsSection.tsx` under Indstillinger → Konto). Denne fil paastod frem til
  19-08-2026 at listen ikke fandtes - den blev bygget og fejlrettet i commit `d3cceff`/`2f89ed0`. En alarm er
  fortsat selv-oprensende (sender højst én mail, markeres derefter udløst).
- Web og native app er begge koblet på samme RPC (`apps/mobile/src/screens/ProductDetailScreen.tsx`, web-paritetsrevisionen 17-08-2026, commit `3c74ab9`) - denne fil hævdede indtil 18-08-2026 fejlagtigt at appen stadig viste en "under udvikling"-placeholder.
- `current_price` gemt på alarmen er kun til visning/logning; selve udløsningen genberegner altid den reelle laveste pris i `updater.py`.
