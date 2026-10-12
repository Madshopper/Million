# Plan hvis data slipper ud

Et brud er, når personoplysninger kommer i forkerte hænder, bliver slettet ved
en fejl eller ikke kan nås. Fx: nogen får adgang til Supabase, en nøgle havner
offentligt, eller en fejl viser én brugers kurv for en anden.

Loven (GDPR artikel 33 og 34) siger: anmeld til Datatilsynet senest **72 timer**
efter, at du har opdaget det. Uret starter, når du ved det, ikke når det skete.

## 1. Stop det (med det samme)

- Luk hullet: slå funktionen fra i Feature-panelet i `/admin`, eller ret fejlen.
- Er en nøgle sluppet ud: lav en ny i Supabase, Cloudflare, Resend, Apple eller
  GitHub, og slet den gamle.
- Mistænker du et login: skift adgangskode og log alle ud i Supabase
  (Authentication).

## 2. Find ud af hvad der er sket (samme dag)

Skriv ned med dato og klokkeslæt:

- Hvornår skete det, og hvornår opdagede du det?
- Hvilke oplysninger: e-mail, navn, kurv, prisalarmer, feedback, abonnement?
- Hvor mange personer er ramt (cirka)?
- Hvad har du gjort for at stoppe det?

## 3. Anmeld til Datatilsynet (senest 72 timer)

- Anmeld på [datatilsynet.dk](https://www.datatilsynet.dk) under "Anmeld
  brud på persondatasikkerheden" (log ind med MitID).
- Ved du ikke alt endnu, så anmeld det du ved, og send resten bagefter.
- Kun hvis det er helt usandsynligt, at nogen tager skade (fx en fejl der
  rettes med det samme og kun viste anonyme tal), skal det ikke anmeldes. Skriv
  så alligevel ned, hvorfor du vurderede det sådan.

## 4. Giv brugerne besked (ved høj risiko)

Er der høj risiko for de ramte (fx adgangskoder eller e-mails er lækket), så
skriv til dem hurtigst muligt. Brug enkle ord:

- hvad der er sket,
- hvilke oplysninger det drejer sig om,
- hvad du har gjort,
- hvad de selv kan gøre (fx skifte adgangskode),
- hvor de kan spørge: kontakt@madshopper.dk.

## 5. Bagefter

- Gem dine noter (krav i loven: alle brud skal skrives ned, også dem der ikke
  anmeldes). Læg dem i denne mappe som `brud-ÅÅÅÅ-MM-DD.md`.
- Ret årsagen, så det ikke kan ske igen.

## Firmaerne bag

Sker bruddet hos et af firmaerne, skal de give dig besked. Følg så samme plan.

| Firma | Hvad de har |
|---|---|
| Supabase | konti, kurve, prisalarmer, abonnement, feedback |
| Cloudflare | hjemmesiden, varedata, sikkerhedslog |
| Resend | mails ved oprettelse og glemt adgangskode |
| Expo, Apple, Google | beskeder på telefonen |
| GitHub | koden og de automatiske jobs |
