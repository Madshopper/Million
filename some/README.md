# Videoer til Facebook og Instagram

Videoerne i `koe/` bliver postet af sig selv **mandag og torsdag kl. 19.30**
som Reel på Facebook-siden MadShopper og på Instagram (Kalle 31-10-2026).

## Sådan virker køen

Hver video er to filer med samme navn:

- `2026-11-02-velkommen.mp4`: videoen (lodret, 3 til 90 sekunder)
- `2026-11-02-velkommen.md`: teksterne, under `# Facebook` og `# Instagram`

Datoen i navnet er den første dag, videoen må komme ud. Hver mandag og torsdag
kl. 19.30 postes den ældste video, hvis dato er nået. Kun én pr. gang, så hvis
en aften falder ud, rykker resten en plads.

Når videoen er ude begge steder, flyttes teksten til `postet/` sammen med en
`.status.json`, der viser hvornår og opslagenes id hos Meta. Videoen slettes fra
repoet; den ligger stadig i projektmappen under `video/`.

- **Stop en video:** slet dens to filer i `koe/`.
- **Ret en tekst:** ret `.md`-filen før datoen.
- **Ny video:** læg de to filer i `koe/` med en dato. Testen i PR'en
  (`scripts/some-post.py --check`) fanger et forkert navn eller en manglende tekst.
- **Post nu:** start `SoMe-posting` under Actions i GitHub. Den poster den ældste
  video, hvis dato er nået.

Fejler Facebook eller Instagram, bliver jobbet rødt (GitHub sender en mail), og
næste kørsel prøver kun den platform, der manglede. Et opslag kommer aldrig ud
to gange.

## Det der kører

- `uptime-worker/worker.js::startSomePost`: starter jobbet mandag og torsdag
  kl. 19.30 dansk tid (GitHubs egen tidsplan kommer 1-4 timer for sent).
- `.github/workflows/some-post.yml`: poster og gemmer status i repoet.
- `scripts/some-post.py`: selve posteringen via Metas Graph API.

## Nøglen hos Meta (én gang)

Jobbet bruger GitHub-secret `META_PAGE_TOKEN`: en nøgle til Facebook-siden, der
aldrig udløber. Den laves med en gratis udvikler-app hos Meta, som kun Kalle har
adgang til (app'en behøver ikke Metas godkendelse, når den kun poster på egne
sider). Nøglen skal have tilladelserne `pages_show_list`,
`pages_read_engagement`, `pages_manage_posts`, `business_management`,
`instagram_basic` og `instagram_content_publish`, og Instagram-kontoen skal
være en professionel konto koblet til siden.

1. developers.facebook.com: opret en app (type Business), og tilføj
   Facebook Login for Business og Instagram (API med Facebook Login).
2. Graph API Explorer: vælg app'en, og lav en brugernøgle med tilladelserne
   ovenfor.
3. Access Token Debugger: "Extend Access Token" (gælder så 60 dage).
4. Graph API Explorer med den lange nøgle: `GET me/accounts`. Nøglen ud for
   siden MadShopper er sidenøglen. Tjek i Access Token Debugger at den står
   til "Expires: Never".
5. GitHub: Settings > Secrets and variables > Actions > New repository secret,
   navn `META_PAGE_TOKEN`.

Nøglen må aldrig stå i git, i en tråd eller i en log.

TikTok er ikke med endnu: TikTok skal godkende adgangen, før videoer kan
lægges op offentligt af et program.
