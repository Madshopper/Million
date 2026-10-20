// Feature-panelet i /admin: port af app.py::_FEATURES og _PROJECTS (samme
// tekster, nøgler og rækkefølge). Paritetstesten (test/parity/admin.test.ts)
// sammenligner med Python, så ret begge steder i samme commit.
//
// kind: 'web' (følger knappen med det samme), 'job' (natlige kørsler, der selv
// tjekker valget via scripts/feature_flags.py), 'app' (kræver ny app-version),
// 'idea' (ikke startet). Projekt-status: 'waiting' | 'doing' | 'idea'.

export interface FeaturePart { kind: string; name: string; desc: string }

export interface Feature {
  key: string
  name: string
  env: keyof Cloudflare.Env
  desc: string
  app?: string
  /** Udgives automatisk, når denne appversion er i App Store. */
  with_app?: string
  parts: FeaturePart[]
}

export interface ProjectPart { done: boolean; name: string; desc: string }

export interface Project { key: string; name: string; status: string; desc: string; parts: ProjectPart[] }

export const FEATURES: readonly Feature[] = [
  {
    "key": "recipes",
    "name": "Opskrifter",
    "env": "RECIPES_ENABLED",
    "desc": "Opskrifter med priser fra butikkerne. Kræver betaling: alle kan se listen, men selve opskriften og madplanen kræver et månedligt abonnement, købt i appen. Mens den er under udvikling, vises opskrifterne kun som \"Kommer snart\" på forsiden. Udgiv først, når Apple har godkendt abonnementet (docs/abonnement.md).",
    "app": "Appen viser først opskrifterne, når der er lavet en ny version af den med opskrifter slået til.",
    "parts": [
      {
        "kind": "web",
        "name": "Opskriftsiden",
        "desc": "Siden /opskrifter og hver opskrifts egen side."
      },
      {
        "kind": "web",
        "name": "Opskrift-ikonet i toppen",
        "desc": "Genvejen til opskrifterne i sidens menu."
      },
      {
        "kind": "web",
        "name": "Opskrifter på forsiden",
        "desc": "\"Lækre opskrifter\" kan trykkes på i stedet for \"Kommer snart\"."
      },
      {
        "kind": "web",
        "name": "Faste 10 opskrifter indtil udgivelse",
        "desc": "Så længe opskrifter er skjult, viser forsiden på web og i appen kun de 10 første opskrifter som \"Kommer snart\" (18-10-2026). Når den udgives, vises de nyeste igen."
      },
      {
        "kind": "web",
        "name": "Madplan: spørgsmål første gang",
        "desc": "Første gang man åbner /opskrifter: hvor mange, budget om ugen, lyst, kostbehov, ting man vil undgå og køkken. Svarene gemmes kun i browseren."
      },
      {
        "kind": "web",
        "name": "Madplan: din madplan",
        "desc": "En ret pr. hverdag med pris for jeres antal mod budgettet. Lås retter og lav resten om."
      },
      {
        "kind": "job",
        "name": "Opskrifternes priser",
        "desc": "Regnes ud hver nat efter butikkernes nye priser."
      },
      {
        "kind": "job",
        "name": "Import af opskrifter",
        "desc": "Kører hver morgen og tjekker nye opskrifter fra brugerne."
      },
      {
        "kind": "job",
        "name": "Egne opskrifter",
        "desc": "30 opskrifter på kendte retter, skrevet af os selv, så vi må vise hele fremgangsmåden. Lægges ind af importen."
      },
      {
        "kind": "app",
        "name": "Opskrifter i appen",
        "desc": "Fanen og opskrifterne i iPhone- og Android-appen."
      },
      {
        "kind": "app",
        "name": "Madplan i appen",
        "desc": "De samme spørgsmål og den samme madplan i Opskrift-fanen. Svarene gemmes kun på telefonen."
      },
      {
        "kind": "web",
        "name": "Betaling for opskrifter",
        "desc": "Listen kan ses af alle. Opskriften selv og madplanen kræver et abonnement på kontoen; ellers vises en boks om at købe det i appen. Admins har altid adgang."
      },
      {
        "kind": "app",
        "name": "Køb af opskrifter i appen",
        "desc": "Månedligt abonnement via Apple, kun på iPhone. Kræver login, så samme konto også låser op på hjemmesiden og Android. Med \"Gendan køb\"."
      },
      {
        "kind": "job",
        "name": "Fornyelse og opsigelse",
        "desc": "Apple giver selv besked, når abonnementet fornyes, stoppes eller refunderes (edge-funktionen recipe-access)."
      },
      {
        "kind": "idea",
        "name": "Madplan: gem svar på kontoen",
        "desc": "Så svarene følger med mellem telefon og computer."
      },
      {
        "kind": "idea",
        "name": "Madplan: læg hele ugen i kurven",
        "desc": "Alle varer til ugens retter i kurven med ét tryk."
      },
      {
        "kind": "idea",
        "name": "Gem opskrifter",
        "desc": "Gemte opskrifter under \"Mine opskrifter\" / \"Favorit opskrifter\"."
      },
      {
        "kind": "idea",
        "name": "Mit køleskab",
        "desc": "Forslag til opskrifter ud fra det man har i køleskabet."
      },
      {
        "kind": "idea",
        "name": "Aftensmad fra tilbud",
        "desc": "Forslag til aftensmad ud fra ugens tilbudsvarer."
      }
    ]
  },
  {
    "key": "push",
    "name": "Beskeder på telefonen",
    "env": "PUSH_ENABLED",
    "desc": "Prisalarmer som besked på telefonen i stedet for mail. Når den er udgivet, sendes der ingen mails. Har man ikke slået beskeder til, venter alarmen, til man gør det.",
    "app": "Appen spørger om lov til beskeder, så snart den er udgivet her, men kun i en ny app-version, der har beskeder med.",
    "parts": [
      {
        "kind": "web",
        "name": "Knappen \"Få besked på telefonen\"",
        "desc": "Under Mine prisalarmer på hjemmesiden. På iPhone kun når siden er lagt på hjemmeskærmen."
      },
      {
        "kind": "job",
        "name": "Beskeder om natten",
        "desc": "Nattens tjek af prisalarmer sender en besked i stedet for en mail."
      },
      {
        "kind": "app",
        "name": "Beskeder i appen",
        "desc": "Spørger om lov ved første åbning; derefter styres det i telefonens indstillinger. Android kræver en gratis Firebase-opsætning."
      }
    ]
  },
  {
    "key": "stats",
    "name": "Varestatistik",
    "env": "STATS_ENABLED",
    "desc": "Hvilke varer folk kigger på, lægger i kurven og søger efter, dag for dag. Kurv og prissammenligning tælles allerede; visninger og søgninger tælles først, når den er udgivet. Der gemmes kun tal pr. dag, intet om den enkelte bruger.",
    "app": "Appen tæller fra version 1.0.4. Udgives automatisk her, når 1.0.4 er i App Store (feature-auto-publish.yml), så web og app tæller fra samme dag (Kalle 15-10-2026).",
    "with_app": "1.0.4",
    "parts": [
      {
        "kind": "web",
        "name": "Fanen Varer i admin",
        "desc": "Mest populære varer, udvikling over tid og de mest søgte ord."
      },
      {
        "kind": "web",
        "name": "Tæller visninger og søgninger",
        "desc": "Hjemmesiden sender et samlet tal, når en vare åbnes, og når der søges. Ingen cookies."
      },
      {
        "kind": "app",
        "name": "Visninger og søgninger fra appen",
        "desc": "Appen sender de samme tal som hjemmesiden, når en vare åbnes, og når der søges. Virker fra næste appversion."
      }
    ]
  },
  {
    "key": "swipe",
    "name": "Swipe i kurven",
    "env": "SWIPE_ENABLED",
    "desc": "Swipe på en vare i kurven: mod venstre fjerner varen helt (alle stk), mod højre lægger én mere i. Knapperne virker som før. Udgives samtidig på hjemmesiden og i appen.",
    "app": "Appen kan først swipe fra version 1.0.4. Udgives automatisk her, når 1.0.4 er i App Store (feature-auto-publish.yml), så web og app følges ad.",
    "with_app": "1.0.4",
    "parts": [
      {
        "kind": "web",
        "name": "Swipe i kurven på hjemmesiden",
        "desc": "Kun på telefon og tablet. Med mus bruges knapperne."
      },
      {
        "kind": "app",
        "name": "Swipe i kurven i appen",
        "desc": "Med de samme to handlinger til skærmlæseren (VoiceOver/TalkBack)."
      }
    ]
  },
  {
    "key": "tilbud_gul",
    "name": "Gul pris ved tilbud uden førpris",
    "env": "TILBUD_GUL_ENABLED",
    "desc": "Når butikken på varekortet har tilbud, men ikke oplyser normalprisen (fx multikøb), står prisen nu i gul ligesom Tilbud-mærket. Før stod den hvid.",
    "app": "Appen får det fra version 1.0.4. Udgives automatisk her, når 1.0.4 er i App Store (feature-auto-publish.yml), så web og app følges ad (Kalle 07-10-2026).",
    "with_app": "1.0.4",
    "parts": [
      {
        "kind": "web",
        "name": "Gul pris på hjemmesidens varekort",
        "desc": "templates/macros/product_card.html"
      },
      {
        "kind": "app",
        "name": "Gul pris på appens varekort",
        "desc": "ProductCard.tsx, med i næste appversion."
      }
    ]
  },
  {
    "key": "mejeri_navn",
    "name": "Køl hedder Køl & Mejeri",
    "env": "MEJERI_NAVN_ENABLED",
    "desc": "Kategorien \"Køl\" hedder \"Køl & Mejeri\" i menuen og som overskrift, så mejerivarerne er nemmere at finde. Adressen /Mejeri er den samme.",
    "app": "Appen kan først vise det nye navn fra version 1.0.4. Udgives automatisk her, når 1.0.4 er i App Store (feature-auto-publish.yml), så web og app skifter samtidig.",
    "with_app": "1.0.4",
    "parts": [
      {
        "kind": "web",
        "name": "Nyt navn på hjemmesiden",
        "desc": "Menuen, mobilmenuen og overskriften på /Mejeri."
      },
      {
        "kind": "app",
        "name": "Nyt navn i appens kategoriknap",
        "desc": "Appen skifter navn, når den er udgivet her."
      }
    ]
  },
  {
    "key": "butiksaviser",
    "name": "Tilbudsavis pr. butik",
    "env": "BUTIKSAVISER_ENABLED",
    "desc": "Kalles ønske (10-10-2026), efter at Tjek sagde nej til aviserne: butikkernes logoer på forsiden, og et tryk viser butikkens tilbud denne uge, bygget af de priser vi selv henter direkte fra butikkerne. Samme avis-skabelon for alle butikker med butikkens logo svagt i baggrunden. Kun ugens avis tæller, og et tilbud med mange varer tæller som ét (18-10-2026). Ingen avisbilleder, kun et link til butikkens egen avis. Coop-butikkerne og 365 Discount er ikke med, før Coop har svaret (de kommer stadig fra Tjek).",
    "app": "App 1.0.4 i App Store har dem med, men skjult. De vises i appen, så snart den udgives her. MadShopper Test har dem allerede.",
    "parts": [
      {
        "kind": "web",
        "name": "Butikslogoer på forsiden",
        "desc": "Kun de butikker man har valgt, med antal tilbud. Tryk åbner /tilbud/<butik>."
      },
      {
        "kind": "web",
        "name": "Avisen pr. butik",
        "desc": "Bånd i butikkens farver med uge og antal tilbud, \"Ugens bedste tilbud\" og et afsnit pr. kategori med de største besparelser først. \"Se alle\" giver hele listen med filtre, og et link fører til butikkens egen avis."
      },
      {
        "kind": "app",
        "name": "Tilbudsavis i appen",
        "desc": "Samme logoer og samme avis i appen (/api/store-avis/<butik>, /api/store-offers/<butik>)."
      },
      {
        "kind": "idea",
        "name": "Coop-butikkerne og 365 Discount",
        "desc": "Tilføjes, når Coop har svaret og tilbuddene ikke længere kommer fra Tjek."
      }
    ]
  },
  {
    "key": "lokation",
    "name": "Butikker nær mig",
    "env": "LOKATION_ENABLED",
    "desc": "Kalles ønske (12-10-2026): find de butikker der ligger tæt på, slå dem til som standard, og vis rækkefølgen man skal handle i, når kurven er delt på flere butikker. Adresserne kommer fra OpenStreetMap (gratis). Placeringen bruges kun på telefonen eller i browseren og bliver aldrig sendt til os. Et postnummer, man selv skriver, gemmes på kontoen (Kalle 13-10-2026), så det følger med til en ny telefon. Privatlivspolitikken får sit eget afsnit om det, når den udgives.",
    "app": "Appen viser den fra version 1.0.4. Udgives automatisk her, når 1.0.4 er i App Store (feature-auto-publish.yml), så web og app følges ad (Kalle 15-10-2026). Telefonens placering kræver et nyt build af MadShopper Test på Mac'en (runtimeVersion test-2); indtil da har testappen kun postnummer.",
    "with_app": "1.0.4",
    "parts": [
      {
        "kind": "web",
        "name": "Rækkefølge i \"Billigste butikker\"",
        "desc": "Nærmeste butik af hver kæde, den korteste tur og en knap der åbner turen i Google Maps."
      },
      {
        "kind": "web",
        "name": "\"Vælg butikker nær mig\"",
        "desc": "Under Indstillinger og under profilen: slår kæderne tæt på til og resten fra, ud fra placering eller postnummer."
      },
      {
        "kind": "web",
        "name": "\"Hvor bor du?\" når man opretter sig",
        "desc": "Formularen spørger om postnummer eller placering ved siden af navnet og slår butikkerne tæt på til af sig selv. Springer man feltet over (eller bruger Google/Apple), spørger vi én gang lige efter: \"Hvor handler du?\""
      },
      {
        "kind": "job",
        "name": "Butikkernes adresser",
        "desc": "Hentes fra OpenStreetMap én gang om måneden (store-locations.yml)."
      },
      {
        "kind": "app",
        "name": "Rækkefølge og butikker nær mig i appen",
        "desc": "Samme rute og samme valg i appen."
      },
      {
        "kind": "app",
        "name": "Telefonens placering i appen",
        "desc": "Telefonen spørger om lov, når man trykker \"Brug min placering\" (også når man opretter sig). Har man sagt ja, bruger appen der hvor man er lige nu, også i en anden by. Kun mens appen er åben."
      }
    ]
  },
  {
    "key": "design_c2",
    "name": "Nyt udseende på hjemmesiden (C2)",
    "env": "DESIGN_C2_ENABLED",
    "desc": "Hjemmesiden får samme udseende som appen (design C2): appens skrift, lille gul \"Spar\"-pille og butikslogo i varebilledet, aviser som runde logoer, seneste søgninger og \"Køb igen\" under søgefeltet, vinderkort, \"Handl i 2 butikker\" og \"Glemt noget?\" i kurven og en bundmenu på telefonen. Altid slået til på dev.madshopper.dk, så MadShopper Test og dev-siden ligner hinanden (Kalle 19-10-2026).",
    "app": "Appen har det på MadShopper Test. Butiksappen får det først med en ny App Store-version.",
    "parts": [
      {
        "kind": "web",
        "name": "Skrift og farver",
        "desc": "Schibsted Grotesk som i appen, lys grå baggrund og runde kort."
      },
      {
        "kind": "web",
        "name": "Varekort",
        "desc": "Lille gul \"Spar 49%\"-pille og butikslogo i billedet, kun kg-pris under navnet, pris med små øre og grøn \"+\"."
      },
      {
        "kind": "web",
        "name": "Forside",
        "desc": "Kompakt besparelse, \"Aviser denne uge\" som runde logoer med startdag eller \"Ny i dag\" og \"Ugens største fald\" med antal tilbud."
      },
      {
        "kind": "web",
        "name": "Søgning",
        "desc": "Seneste søgninger og \"Køb igen\" (de 5 varer man oftest lægger i kurven), kun gemt i browseren."
      },
      {
        "kind": "web",
        "name": "Kurv",
        "desc": "Vinderkort med de to næste butikker, \"Handl i 2 butikker\" og \"Glemt noget? Du plejer at købe\"."
      },
      {
        "kind": "web",
        "name": "Bundmenu på telefonen",
        "desc": "Hjem, Søg, Kurv og Profil i bunden af skærmen."
      },
      {
        "kind": "app",
        "name": "Design C2 i appen",
        "desc": "Findes allerede på MadShopper Test (PR #123)."
      }
    ]
  }
]

export const PROJECTS: readonly Project[] = [
  {
    "key": "app_store",
    "name": "Appen i Google Play",
    "status": "waiting",
    "desc": "iPhone-appen er i App Store (version 1.0.4 siden 18-10-2026). Android-appen mangler de konti og trin, kun du kan klare, før den kan udgives.",
    "parts": [
      {
        "done": true,
        "name": "Appen bygget",
        "desc": "Alle skærme, login, kurv, lister og prisalarmer."
      },
      {
        "done": true,
        "name": "iPhone-appen i App Store",
        "desc": "Apple Developer-konto, test på din iPhone og Apples godkendelse er klaret."
      },
      {
        "done": false,
        "name": "Google Play-konto",
        "desc": "Koster ca. 25 USD én gang."
      },
      {
        "done": false,
        "name": "Android klar til Google Play",
        "desc": "Ligger klar i PR #50. Beskeder kræver også en gratis Firebase-opsætning."
      },
      {
        "done": false,
        "name": "Skærmbilleder til Android",
        "desc": "Kræver en Android-telefon eller -simulator."
      },
      {
        "done": false,
        "name": "Send til godkendelse i Google Play",
        "desc": "Udfyld oplysningerne i Play Console og indsend."
      }
    ]
  },
  {
    "key": "admin_app_stats",
    "name": "Appens tal i admin",
    "status": "doing",
    "desc": "Fanen App i admin: downloads, visninger i App Store, nedbrud, stjerner og anmeldelser fra Apple, og hvor mange der bruger appen. Hentes hver dag ved 19-tiden.",
    "parts": [
      {
        "done": true,
        "name": "Nøgle til Apple",
        "desc": "App Store Connect-nøglen ligger i GitHub og virker."
      },
      {
        "done": true,
        "name": "Leverandørnummer",
        "desc": "ASC_VENDOR_NUMBER i GitHub, så downloads kan hentes."
      },
      {
        "done": true,
        "name": "Tabeller i databasen",
        "desc": "scripts/supabase-app-stats.sql køres én gang i Supabase."
      },
      {
        "done": true,
        "name": "Bed Apple om rapporter",
        "desc": "Gjort 05-10-2026 med en Admin-nøgle. Nøglen og ASC_ADMIN_* i GitHub er slettet igen."
      },
      {
        "done": false,
        "name": "Første tal fra Apple",
        "desc": "Downloads og stjerner kommer dagen efter. Visninger, sletninger og nedbrud ca. to døgn senere."
      }
    ]
  },
  {
    "key": "app_a11y",
    "name": "Appen for svagtseende",
    "status": "doing",
    "desc": "Appen skal kunne bruges med VoiceOver og skærmlæser.",
    "parts": [
      {
        "done": true,
        "name": "Knapper med ikoner har navne",
        "desc": "Skærmlæseren kan læse ikon-knapperne op."
      },
      {
        "done": true,
        "name": "Resten af skærmene",
        "desc": "Alle skærme har nu beskrivelser til skærmlæseren (05-10-2026). Kommer med i næste app-version."
      },
      {
        "done": false,
        "name": "Gennemgang med VoiceOver",
        "desc": "Hele appen prøvet af med skærmlæser på en iPhone."
      }
    ]
  },
  {
    "key": "app_crash_reports",
    "name": "Fejlrapporter fra appen",
    "status": "idea",
    "desc": "Når appen går ned hos en bruger, ser vi det i dag kun i Apples egne rapporter. Kræver valg af en gratis tjeneste.",
    "parts": []
  },
  {
    "key": "matching",
    "name": "Bedre sammenligning af varer",
    "status": "doing",
    "desc": "Varer med samme stregkode sammenlignes sikkert. Resten gættes ud fra navn, vægt, pris og billede, og her er ca. 15 % forkerte, mens mange varer slet ikke bliver sammenlignet (målt 07-10-2026).",
    "parts": [
      {
        "done": true,
        "name": "Strammere regler for gæt",
        "desc": "Kædernes egne mærker, pris uden vægt, mærke i navnet og multipak holdes adskilt (07-10-2026)."
      },
      {
        "done": true,
        "name": "Is og chokolade holdes adskilt",
        "desc": "Fx Skildpadde-chokolade mod Skildpadde-is (10-10-2026)."
      },
      {
        "done": true,
        "name": "Remas egne varer kun mod egne mærker",
        "desc": "Remas egne varer sammenlignes kun med andre kæders egne mærker, aldrig med fx Arla (10-10-2026)."
      },
      {
        "done": true,
        "name": "Flere Rema-varer sammenlignes",
        "desc": "Kædernes egne mærker (Salling, First Price, Gestus, ØGO) bliver nu stående side om side på Rema-kortet i stedet for at blive smidt væk (10-10-2026)."
      },
      {
        "done": true,
        "name": "Samme mærke og vægt vejer tungere end billedet",
        "desc": "To fotos af samme vare fra to kilder ligner ofte ikke hinanden. Har varerne samme mærke og vægt, afviser billedet dem ikke længere (19-10-2026). Målt: 20 % til 30 % fundet."
      },
      {
        "done": false,
        "name": "Find flere ens varer uden stregkode",
        "desc": "Kun ca. hver femte vare, der findes i flere kæder uden fælles stregkode, bliver i dag sammenlignet (målt 07-10-2026). Næste skridt er at give motoren bedre oplysninger, ikke løsere regler."
      }
    ]
  },
  {
    "key": "dagrofa_backup",
    "name": "Reservevej for Spar, Meny og Min Købmand",
    "status": "waiting",
    "desc": "Priserne hentes fra butikkernes egen vareliste. Svigter den, går en reservevej direkte til hver kategoris adresse på butikkens hjemmeside. Færdig og merget 10-10-2026 (PR #92), så den kan markeres som færdig.",
    "parts": [
      {
        "done": true,
        "name": "Varelisten henter alle varer igen",
        "desc": "Rettet 07-10-2026: før manglede ca. 400 varer hos Spar og Min Købmand, og natten fejlede."
      },
      {
        "done": true,
        "name": "Reservevejen virker igen",
        "desc": "Rettet 10-10-2026 og prøvet på alle tre butikker: samme antal varer pr. kategori som varelisten."
      }
    ]
  },
  {
    "key": "tilbud_direkte",
    "name": "Ugens tilbud direkte fra butikkerne",
    "status": "waiting",
    "desc": "Ugens tilbud hentes fra butikkernes egne sider i stedet for fra Tjek. Coops fire butikker venter på svar fra Coop.",
    "parts": [
      {
        "done": true,
        "name": "Netto, Føtex, Lidl og Løvbjerg",
        "desc": "Fra butikkernes egne sider (PR #83)."
      },
      {
        "done": true,
        "name": "ABC Lavpris",
        "desc": "Læst ud af avisen på abc-lavpris.dk (PR #86)."
      },
      {
        "done": true,
        "name": "Lidl: frugt og grønt og ugeavisen",
        "desc": "Hentes søndag og torsdag, når Lidls priser skifter (PR #89)."
      },
      {
        "done": true,
        "name": "Tilbudsaviserne fjernet",
        "desc": "Aviserne på forsiden kom fra Tjek og er taget af web og app (PR #87)."
      },
      {
        "done": false,
        "name": "365discount, Brugsen, Kvickly og SuperBrugsen",
        "desc": "Hentes stadig via Tjek. Mail sendt til Coop 10-10-2026; venter på svar."
      }
    ]
  },
  {
    "key": "nat_hurtigere",
    "name": "Hurtigere opdatering om natten",
    "status": "waiting",
    "desc": "Cloudflare starter hentningen af butikkerne kl. 00:01, og siden opdateres lige efter, i stedet for at vente på GitHubs ur, der kom 1-4 timer for sent.",
    "parts": [
      {
        "done": true,
        "name": "Siden opdateres lige efter butikkerne",
        "desc": "Cache-opdateringen starter, når nattens hentning er færdig."
      },
      {
        "done": true,
        "name": "Start kl. 00:01 fra Cloudflare",
        "desc": "Merget 10-10-2026 (PR #88), nøglen er sat."
      },
      {
        "done": true,
        "name": "Første nætter tjekket",
        "desc": "Butikkerne hentes kl. 00:01 dansk tid og siden opdateres kl. 00:01 UTC (tjekket 19-10-2026). Kan markeres som færdig."
      }
    ]
  },
  {
    "key": "app_design_c",
    "name": "Nyt udseende i appen (version C)",
    "status": "doing",
    "desc": "Ny skrift, runde kort med butikslogo og rundt gult tilbudsmærke, \"Køb igen\" på forsiden og kurven med den billigste butik øverst. Kun appen; hjemmesiden får det ikke nu (18-10-2026).",
    "parts": [
      {
        "done": true,
        "name": "Bygget",
        "desc": "Forside, produktkort, kurv og bundmenu, lys og mørk."
      },
      {
        "done": true,
        "name": "På MadShopper Test",
        "desc": "Merget og sendt til testappen 18-10-2026 (PR #119)."
      },
      {
        "done": false,
        "name": "Med i næste App Store-version",
        "desc": "App 1.0.4 i App Store har det ikke. Butiksappen får det først med et nyt build (1.0.5)."
      }
    ]
  },
  {
    "key": "app_design_c2",
    "name": "Nyt app-design (C2)",
    "status": "doing",
    "desc": "Videre fra version C, så appen ser mindre generisk ud: lille gul \"Spar\"-pille, aviser som runde logoer, \"Køb igen\" og seneste søgninger i Søg, \"Handl i 2 butikker\" og \"Glemt noget?\" i kurven. Kun appen (19-10-2026).",
    "parts": [
      {
        "done": true,
        "name": "Forside",
        "desc": "Søgefelt, kompakt besparelse, aviser denne uge og \"Ugens største fald\"."
      },
      {
        "done": true,
        "name": "Søgning",
        "desc": "Seneste søgninger og \"Køb igen\", kun gemt på telefonen."
      },
      {
        "done": true,
        "name": "Produktkort",
        "desc": "Lille gul \"Spar\"-pille, butikslogo og kun kg-pris."
      },
      {
        "done": true,
        "name": "Kurv",
        "desc": "Vinderkort, \"Handl i 2 butikker\" og \"Glemt noget?\"."
      },
      {
        "done": true,
        "name": "Bundmenu",
        "desc": "Lysegrøn pille bag den aktive fane, grønt tal på kurven."
      },
      {
        "done": true,
        "name": "Mørk tilstand",
        "desc": "Kun farver fra appens tema, ingen faste farver."
      },
      {
        "done": true,
        "name": "Web",
        "desc": "Bygget på hjemmesiden bag funktionen \"Nyt udseende på hjemmesiden (C2)\". Slået til på dev-siden, udgives herfra."
      }
    ]
  },
  {
    "key": "tests",
    "name": "Flere automatiske tests",
    "status": "idea",
    "desc": "Login, delt kurv, gemte lister og prisalarmer testes ikke automatisk i dag, hverken på hjemmesiden eller i appen.",
    "parts": []
  }
]

export const FEATURE_KEYS = new Map(FEATURES.map((f) => [f.key, f]))
export const PROJECT_KEYS = new Map(PROJECTS.map((p) => [p.key, p]))
export const FEATURES_KV_KEY = 'features_v1'
export const PROJECTS_KV_KEY = 'projects_v1'
