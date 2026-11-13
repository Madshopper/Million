# Videoer på Facebook og Instagram

Mandag og torsdag kl. 19.30 poster MadShopper selv næste video fra
`social/koe/` som reel på Facebook-siden MadShopper og Instagram @madshopper.dk.
Altid begge steder eller intet (`scripts/social-post.py`).

## Læg en video i køen

1. Læg videoen i `social/koe/`, fx `003-tilbud-uge-46.mp4`.
2. Læg teksten til opslaget ved siden af med samme navn: `003-tilbud-uge-46.txt`.
3. Videoerne postes i navnets rækkefølge, så start navnet med et tal.

Krav til videoen: `.mp4` eller `.mov`, 3 til 90 sekunder, helst stående 9:16
(fx 1080x1920). Teksten højst 2.200 tegn. Upload via github.com kan højst tage
25 MB pr. fil; større filer skal pushes med git.

Efter udgivelse flyttes videoen og teksten til `social/udgivet/`, og
`social/udgivet/historik.csv` får en linje med tidspunkt og id'er.

## Sådan startes den

`uptime-worker/` (Cloudflare, hvert 5. minut) starter
`.github/workflows/social-post.yml` mandag og torsdag mellem 19.30 og 19.59
dansk tid. GitHubs egen cron bruges ikke, fordi den kommer 1 til 4 timer for
sent. Workflowet kan også startes i hånden under Actions, med "Prøvekørsel"
der tjekker video, tekst og nøgle uden at poste.

## Postering via Make.com

Selve posteringen sker i Make.com, fordi Metas egen vej kræver en
udviklerkonto, og Meta kan ikke sende sms-koden til Kalles nummer. Make har
sin egen godkendte Meta-app. `scripts/social-post.py` sender kun et link til
videoen (raw.githubusercontent.com, derfor skal repoet være offentligt) og
teksten til Make. Meta henter selv videoen fra linket, så den aldrig går
gennem Make (gratisplanen har kun 100 MB dataoverførsel om måneden).

Scenariet hedder "MadShopper video" (Make, gratisplan, EU-region, Kalles
konto) og kører "Immediately as data arrives":

1. **Webhooks > Custom webhook** "MadShopper video" modtager
   `{"video_url", "caption", "file"}`.
2. **Facebook-reel** på siden MadShopper med videoen fra `video_url` og
   `caption` som beskrivelse. Fejler den, svarer en error handler
   `{"status": "fb_failed", "error": ...}` og stopper: intet er udgivet.
3. **Instagram for Business > Create a Reel Post** på @madshopper.dk, kun
   EFTER Facebook. Fejler den, svarer en error handler
   `{"status": "ig_failed", "facebook_id": ..., "error": ...}`.
4. **Webhooks > Webhook response** 200 med
   `{"status": "ok", "facebook_id": ..., "instagram_id": ...}`.

Facebook- og Instagram-forbindelserne i Make er lavet med Kalles eget
Facebook-login og har kun adgang til siden MadShopper og @madshopper.dk.
Kun Kalle styrer siden.

## Hemmeligheden MAKE_WEBHOOK_URL

Webhookens adresse i Make ligger som GitHub-secret `MAKE_WEBHOOK_URL` på
github.com/Madshopper/Million/settings/secrets/actions. Den er hemmelig:
alle med adressen kan poste på siden. Den må kun stå i secret'en, aldrig i
kode, commits, chat eller noter. Får du brug for en ny, så lav en ny webhook i
scenariet og erstat secret'en.

Uden secret'en stopper kørslen grønt uden at poste. En prøvekørsel under
Actions tjekker video, tekst og videolink uden at kalde Make.
