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
    "desc": "Opskrifter med priser fra butikkerne. Mens den er under udvikling, vises opskrifterne kun som \"Kommer snart\" på forsiden.",
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
        "kind": "app",
        "name": "Opskrifter i appen",
        "desc": "Fanen og opskrifterne i iPhone- og Android-appen."
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
    "key": "subscription",
    "name": "Støt MadShopper (abonnement)",
    "env": "SUBSCRIPTION_ENABLED",
    "desc": "Frivilligt månedligt abonnement i appen, betalt via Apple. Alt i appen er stadig gratis; støtterne får et Støtter-mærke på deres profil. Udgiv først, når produktet er oprettet og godkendt i App Store Connect (docs/abonnement.md).",
    "app": "Kræver en ny app-version med abonnementet. Kun iPhone indtil videre. Hjemmesiden sælger det ikke.",
    "parts": [
      {
        "kind": "app",
        "name": "\"Støt MadShopper\" på Profil",
        "desc": "Skærm med pris, køb, gendan køb og links til vilkår. Vises kun når den er udgivet her."
      },
      {
        "kind": "app",
        "name": "Støtter-mærke",
        "desc": "Står under navnet på Profil, mens abonnementet er aktivt."
      }
    ]
  }
]

export const PROJECTS: readonly Project[] = [
  {
    "key": "app_store",
    "name": "Appen i App Store og Google Play",
    "status": "waiting",
    "desc": "Appen er bygget og testet i simulatoren. Den mangler de konti og trin, kun du kan klare, før den kan udgives.",
    "parts": [
      {
        "done": true,
        "name": "Appen bygget",
        "desc": "Alle skærme, login, kurv, lister og prisalarmer."
      },
      {
        "done": true,
        "name": "Klar til Apples godkendelse",
        "desc": "Slet konto i appen, skærmbilleder til iPhone og app-tekster."
      },
      {
        "done": false,
        "name": "Apple Developer-konto",
        "desc": "Koster ca. 99 USD om året. Giver også Apple-login på hjemmesiden."
      },
      {
        "done": false,
        "name": "Google Play-konto",
        "desc": "Koster ca. 25 USD én gang."
      },
      {
        "done": false,
        "name": "Første rigtige test på en telefon",
        "desc": "Google- og Apple-login er kun prøvet i simulatoren."
      },
      {
        "done": false,
        "name": "Skærmbilleder til Android",
        "desc": "Kræver en Android-telefon eller -simulator."
      },
      {
        "done": false,
        "name": "Send til godkendelse",
        "desc": "Udfyld oplysningerne i App Store Connect og Play Console og indsend."
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
        "desc": "Gjort 05-10-2026 med en Admin-nøgle. Den kan slettes nu (og ASC_ADMIN_* i GitHub)."
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
