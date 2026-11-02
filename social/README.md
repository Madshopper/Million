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

## Nøglen META_PAGE_TOKEN

GitHub-secret med en **sidenøgle** for Facebook-siden MadShopper, der står til
"Expires: Never" og har tilladelserne `pages_show_list`,
`pages_read_engagement`, `pages_manage_posts`, `business_management`,
`instagram_basic` og `instagram_content_publish`. Den laves af en, der er
administrator på siden og har en Meta-udviklerkonto:

1. developers.facebook.com: opret appen "MadShopper Poster" (type Business),
   tilføj "Facebook Login for Business" og "Instagram". Appen bliver i
   udviklingstilstand.
2. Graph API Explorer: vælg appen, "Hent brugeradgangstoken" med de seks
   tilladelser, og godkend for siden og Instagram-kontoen.
3. Access Token Debugger: "Extend Access Token" og brug den lange nøgle.
4. Graph API Explorer med den lange nøgle: `GET me/accounts`, tag sidens
   `access_token`. Tjek i debuggeren at den står til "Expires: Never".
5. github.com/Madshopper/Million/settings/secrets/actions: ny secret
   `META_PAGE_TOKEN` med sidenøglen.

Uden nøglen stopper kørslen grønt uden at poste. Prøv bagefter en
prøvekørsel under Actions.
