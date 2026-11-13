# Login-mails: bekræftelse og ny adgangskode

**Status 13-11-2026:** email+adgangskode, "glemt adgangskode" og
bekræftelse af nye konti er live. Bekræftelse er slået til (Supabase sendte
16 bekræftelsesmails de 60 dage før 13-11-2026, så `mailer_autoconfirm` er
ikke længere sat, som denne fil påstod indtil da). Mailene sendes via Resend
fra `MadShopper <noreply@madshopper.dk>` (SMTP i Supabase). DMARC for
madshopper.dk står på p=none siden 13-11-2026 (Cloudflare DMARC Management).

## Skabelonerne

Supabase bruger to skabeloner, som ligger i git:

| Supabase-skabelon | Fil | Emne |
|---|---|---|
| Confirm sign up | `supabase/templates/bekraeft-email.html` | `Bekræft din e-mail til MadShopper` |
| Reset password | `supabase/templates/nulstil-adgangskode.html` | `Nulstil din adgangskode til MadShopper` |

De sættes ind i hånden (der er ingen nøgle til Supabases Management-API i
projektet): [Authentication > Emails > Templates](https://supabase.com/dashboard/project/oxzxingkbsnqzpmjtktr/auth/templates),
vælg skabelonen, sæt emnet ind, sæt hele filens indhold ind i feltet til
selve mailen, og tryk Save. Ret filen i git i samme omgang, hvis teksten
ændres i Supabase. De øvrige skabeloner (Magic link, Change email, Invite,
Reauthentication) bruges ikke og er Supabases standard.

Indtil 13-11-2026 var begge Supabases engelske standard ("Confirm your email
address", "Reset your password").

## Hvor linket fører hen

Skabelonen vælger linket ud fra `redirectTo`, som den, der bad om mailen,
sendte med:

| Bestilt i | redirectTo | Link i mailen | Åbner |
|---|---|---|---|
| Appen | `https://madshopper.dk/app/konto` | `https://madshopper.dk/app/konto#token_hash=…&type=recovery` (eller `type=email`) | Appen direkte på iPhone (står i Apples link-fil, `app.py::apple_app_site_association`) |
| MadShopper Test | `https://madshopper.dk/app/konto?app=test` | Samme med `?app=test` | Siden `/app/konto`, som sender videre til testappen med en knap (udelukket i link-filen, så butiksappen ikke tager linket) |
| Hjemmesiden | `https://madshopper.dk` | Supabases eget link (`{{ .ConfirmationURL }}`, via supabase.co) | Hjemmesiden, som før |
| Ældre app-versioner | `madshopper://` | Supabases eget link | Safari, derefter appen, som før |

Nøglen (`token_hash`) står i fragmentet, så den aldrig når vores server, og
et mailprogram der "tjekker" links på forhånd, kan ikke bruge den op. Appen
veksler den med et rått `POST /auth/v1/verify` uden at logge ind, og sætter
kun sessionen, når kontoen er den, DENNE enhed selv bad om (kvitteringen i
`apps/mobile/src/auth/AuthContext.tsx`, sikkerhedstjek runde 3). En
bekræftelse veksles også uden kvittering (det er dét, der bekræfter
e-mailen); appen logger bare ikke ind.

Åbnes et app-link i en browser (en computer, et mailprogram med egen
browser, testappen), viser `/app/konto` (`templates/app_konto.html`) en knap
til appen. En bekræftelse kan også klares dér uden login. En ny adgangskode
kræver appen, fordi kun den kan se, at den selv bad om linket.

## Sådan testes det

1. Sæt begge skabeloner ind (se ovenfor).
2. Bed om en ny adgangskode i MadShopper Test. Linket i mailen skal starte
   med `https://madshopper.dk/app/konto?app=test#token_hash=`. Tryk på det:
   siden viser "Åbn MadShopper Test", og knappen åbner "Vælg ny adgangskode".
3. Bed om en ny adgangskode på hjemmesiden. Linket skal gå via supabase.co og
   ende på hjemmesiden som før.
4. Butiksappen: først med næste version i App Store. Linket skal starte med
   `https://madshopper.dk/app/konto#token_hash=` og åbne appen uden Safari.

## Sikkerhed (uændret)

RLS, `carts`, kurv-synk og `delete_own_account` er ens uanset login-metode.
Signup kræver Turnstile-tokenet i Supabases "before user created"-hook
(`scripts/supabase-signup-turnstile-hook.sql`).
