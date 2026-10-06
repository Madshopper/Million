# Støt MadShopper (abonnement i appen)

Frivilligt månedligt abonnement, købt i iPhone-appen via Apple. Alt i appen er
stadig gratis; støtterne får et "Støtter"-mærke under navnet på Profil.
Feature-panelet i `/admin`: `subscription`. Skjult på madshopper.dk, altid til
på dev.madshopper.dk.

## Sådan virker det

- Appen bruger `expo-iap` (gratis, StoreKit 2). Apple tjekker selv købet; vi
  gemmer intet om det på vores server, og der er ingen ekstra konto (fx
  RevenueCat) at oprette.
- Produkt-ID: `dk.madshopper.stoette.maaned` (`apps/mobile/src/subscription/subscription.ts`).
  Skal stå præcis sådan i App Store Connect.
- Skærmen `SupportScreen.tsx` åbnes fra Profil og viser pris, køb, "Gendan køb",
  "Administrér abonnement" og links til vilkår og privatliv (Apples krav).
- Kun iPhone. Android kræver Google Play-kontoen først.
- Hjemmesiden sælger det ikke (et Apple-abonnement kan kun købes i appen).

## Det Kalle selv skal gøre i App Store Connect

1. **Aftaler, skat og bank** (Business / Agreements, Tax, and Banking):
   accepter *Paid Apps Agreement*, tilføj bankkonto (IBAN) og udfyld
   skatteformularen *W-8BEN* som privatperson (så USA ikke trækker skat).
2. **EU-erhvervsstatus (DSA)**: sælger man noget, regner Apple en som
   erhvervsdrivende. Så viser App Store i EU en adresse, telefon og e-mail.
   Brug gerne en e-mail og et telefonnummer kun til appen.
3. **Small Business Program**: tilmeld dig på developer.apple.com. Så tager
   Apple 15 % i stedet for 30 %.
4. **Produktet** (appen > Monetization > Subscriptions):
   - Abonnementsgruppe: `MadShopper Støtte`
   - Abonnement: reference `Støtte månedlig`, produkt-ID `dk.madshopper.stoette.maaned`,
     varighed 1 måned, pris fx 19 kr.
   - Dansk navn `MadShopper Støtte` og en kort beskrivelse.
   - Et skærmbillede af skærmen "Støt MadShopper" til Apples gennemgang.
5. **Indsend** abonnementet sammen med den næste app-version (det første
   abonnement skal godkendes med en version).
6. **Udgiv** `subscription` i Feature-panelet, når Apple har godkendt.

## Skat i Danmark (kort)

Under 50.000 kr. om året kræver det hverken CVR eller momsregistrering. Apple
opkræver momsen hos køberne. Overskuddet skal opgives i årsopgørelsen som
B-indkomst. Spørg Skattestyrelsen, hvis du er i tvivl.

## Navn og bankoplysninger

Brugerne ser aldrig dine bankoplysninger. Sælgernavnet på App Store er navnet
på udviklerkontoen; er det en privat konto, står dit navn der allerede i dag,
uanset abonnement. Kun en virksomhedskonto (kræver CVR og D-U-N-S-nummer) kan
vise et firmanavn i stedet.

## Afprøvning

Køb i TestFlight og i Apples sandkasse er gratis. Test-appen
(`dk.madshopper.app.test`) har ikke sit eget produkt i App Store Connect, så
dér viser skærmen "Henter pris fra App Store…" for evigt; afprøv i stedet med
en sandkasse-konto (Users and Access > Sandbox) i en TestFlight-build, eller
med en StoreKit-konfigurationsfil i Xcode-simulatoren.

## Apples gennemgang

Apple kræver, at et abonnement giver noget løbende (retningslinje 3.1.2).
Støtter-mærket er det. Afviser Apple det som for lidt, er næste skridt at
give støtterne et lille ekstra (fx tidlig adgang til nye funktioner).
