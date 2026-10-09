# Abonnement på opskrifterne

Opskrifterne kræver betaling. Alle kan se listen over opskrifter (navn, billede
og pris), men selve opskriften (ingredienser, fremgangsmåde, "læg i kurv") og
madplanen kræver et månedligt abonnement. Det købes i iPhone-appen via Apple
og hører til kontoen, så det også låser op på madshopper.dk og på Android.
Admins har altid adgang.

Der findes ingen anden betaling eller frivillig støtte. "Støt MadShopper"
(PR #66) er fjernet 09-10-2026.

Det hele hænger på Feature `recipes` i `/admin`: mens opskrifterne er skjulte,
er betalingen det også. Udgiv først opskrifterne, når Apple har godkendt
abonnementet.

## Sådan virker det

1. Køb kræver login. Appen sender kontoens id med til Apple
   (`appAccountToken`).
2. Apple sender en underskrevet kvittering tilbage. Appen sender den til
   edge-funktionen `recipe-access` i Supabase
   (`supabase/functions/recipe-access/`), som tjekker Apples underskrift og
   skriver adgangen i tabellen `recipe_access`.
3. Apple giver også selv funktionen besked ved fornyelse, opsigelse og
   refusion (App Store Server Notifications), så hjemmesiden følger med, selvom
   appen ikke bliver åbnet.
4. Hjemmesiden og appen spørger serveren med `has_recipe_access()`.
   Ingredienser og fremgangsmåde forlader aldrig serveren uden adgang
   (`app.py::_recipe_access_ok`). Siderne bliver derfor ikke gemt i den delte
   edge-cache; kun listen `/api/recipes` gør.

Ét abonnement låser kun én konto op. Køber man på én konto og logger ind på en
anden, siger appen det.

- Produkt-ID: `dk.madshopper.opskrifter.maaned` (står i
  `apps/mobile/src/recipes/access.ts` og i edge-funktionen).
- Køb kun på iPhone. Android kræver Google Play-kontoen først; indtil da kan
  man låse op på Android med en konto, der har købt på iPhone.
- Hjemmesiden sælger det ikke (et Apple-abonnement kan kun købes i appen); den
  viser en boks med "Log ind" og "Hent appen".

## Det Kalle selv skal gøre

### Én gang i Supabase

1. Kør `scripts/supabase-recipe-access.sql` i SQL Editor.
2. Deploy edge-funktionen uden JWT-tjek (Apple sender ikke et login):
   `supabase functions deploy recipe-access --no-verify-jwt`
   (Claude kan også gøre det via Supabase-forbindelsen, når du siger til).

### I App Store Connect

1. **Aftaler, skat og bank** (Business / Agreements, Tax, and Banking):
   accepter *Paid Apps Agreement*, tilføj bankkonto (IBAN) og udfyld
   skatteformularen *W-8BEN* som privatperson.
2. **EU-erhvervsstatus (DSA)**: sælger man noget, regner Apple en som
   erhvervsdrivende, og App Store viser en adresse, telefon og e-mail i EU.
   Brug gerne en e-mail og et telefonnummer kun til appen.
3. **Small Business Program** på developer.apple.com: Apple tager 15 % i
   stedet for 30 %.
4. **Produktet** (appen > Monetization > Subscriptions):
   - Abonnementsgruppe: `MadShopper Opskrifter`
   - Abonnement: reference `Opskrifter månedlig`, produkt-ID
     `dk.madshopper.opskrifter.maaned`, varighed 1 måned.
   - Pris: dit valg, fx 19 kr. om måneden.
   - Dansk navn: `MadShopper Opskrifter`. Beskrivelse, fx: "Alle opskrifter
     med dagens priser, læg varerne i kurven med ét tryk, og få din egen
     madplan."
   - Et skærmbillede af skærmen "Opskrifter med priser" til Apples gennemgang.
5. **Besked fra Apple** (appen > App Information > App Store Server
   Notifications): version 2, både Production og Sandbox URL:
   `https://<projekt>.supabase.co/functions/v1/recipe-access`
6. **Login til Apples gennemgang**: under App Review Information skal der stå
   en testkonto (e-mail og adgangskode) til MadShopper, fordi køb kræver
   login.
7. **Indsend** abonnementet sammen med den næste app-version (det første
   abonnement skal godkendes med en version).
8. **Udgiv** `recipes` i Feature-panelet, når Apple har godkendt.

Har du allerede oprettet det gamle produkt `dk.madshopper.stoette.maaned`, så
slet det eller lad det ligge uden at indsende det; et produkt-ID kan ikke
omdøbes.

## Skat i Danmark (kort)

Under 50.000 kr. om året kræver det hverken CVR eller momsregistrering. Apple
opkræver momsen hos køberne. Overskuddet skal opgives i årsopgørelsen som
B-indkomst. Spørg Skattestyrelsen, hvis du er i tvivl.

## Navn og bankoplysninger

Brugerne ser aldrig dine bankoplysninger. Sælgernavnet på App Store er navnet
på udviklerkontoen; er det en privat konto, står dit navn der allerede i dag.
Kun en virksomhedskonto (kræver CVR og D-U-N-S-nummer) kan vise et firmanavn.

## Afprøvning

- Som admin har din egen konto altid adgang, både på dev.madshopper.dk og i
  appen. Log ud eller brug en anden konto for at se betalingsboksen.
- Køb i TestFlight og i Apples sandkasse er gratis og tæller som adgang
  (Apples gennemgang bruger også sandkassen).
- Test-appen (`dk.madshopper.app.test`) har ikke sit eget produkt i App Store
  Connect, så dér viser skærmen "Henter pris fra App Store…" for evigt; afprøv
  køb med en sandkasse-konto i en TestFlight-build.
- Edge-funktionens tjek af Apples underskrift er afprøvet lokalt med en
  selvlavet certifikatkæde; første rigtige sandkasse-køb er det endelige tjek.
