import fs from 'fs';
import path from 'path';

// Compliance-audit 19-08-2026 (GDPR-029): NSAllowsLocalNetworking er kun
// nødvendig for at ramme en lokal Flask-server (http://localhost:5001 eller
// http://<mac-lan-ip>:5001) under udvikling - se docs/env-setup.md. Et
// produktions-build peger altid på https://madshopper.dk og har ingen brug
// for undtagelsen, som ellers unødigt svækker App Transport Security i den
// udgave, der reelt havner i App Store.
const FLAVOR = process.env.EXPO_PUBLIC_FLAVOR || 'production';
const IS_PRODUCTION_FLAVOR = FLAVOR === 'production';

// APP_VARIANT=test bygger "MadShopper Test": en separat iOS-app med egen
// identitet, så den kan ligge ved siden af App Store-udgaven på Kalles egen
// telefon. Den installeres kun direkte fra Mac'en (udviklingsprofil, kun
// registrerede enheder) og sendes aldrig til TestFlight/App Store. Google-/
// Apple-login, push og links ind i appen er bundet til den rigtige identitet
// og virker derfor ikke i testappen, før de tilmeldes særskilt.
const IS_TEST_APP = process.env.APP_VARIANT === 'test';

// Offentlige værdier (samme som eas.json -> build.production.env). Supabase-
// projektet og Google-klienterne er de samme på tværs af flavors, så de er
// fallback for alle builds - også et Xcode-arkiv fra en ren checkout uden
// .env, der ellers fik tomme værdier og et dødt login.
const PUBLIC_DEFAULTS = {
  supabaseUrl: 'https://oxzxingkbsnqzpmjtktr.supabase.co',
  supabaseAnonKey: 'sb_publishable_Jt8N0XezmzfZJSzzSwBBKQ_uGbNoq8f',
  googleClientId: '683267660851-4jvo3nauv24s4g8sk5qhk1dlvuc4tjgr.apps.googleusercontent.com',
  googleIosClientId: '683267660851-6ah9du0ig9fs3a0rcrbp72hu6t7j0hr4.apps.googleusercontent.com',
  googleAndroidClientId: '683267660851-qo7pqojmbl75t9im36k7t22l6naqe8m0.apps.googleusercontent.com',
};

// Sikkerhedsnet mod staging i et store-build (revideret 24-09-2026).
//
// Et ikke-produktions-build er kun "tilladt" når miljøet er valgt eksplicit:
// en EAS-profil (EAS_BUILD=true, env kommer fra eas.json - preview/development
// ER staging med vilje) eller MADSHOPPER_ALLOW_NONPROD_RELEASE=1 ved en
// bevidst lokal release-build mod staging. En efterladt .env gælder ikke som
// eksplicit valg.
//
// Tidligere tvang CONFIGURATION === 'Release' stille flavor/API/RPC-suffix
// over på produktion. Det ramte også EAS' iOS-builds (de arkiverer med
// -configuration Release), så preview-builds skrev testdata i prod-tabellerne
// uden at nogen kunne se det. Nu skiftes der aldrig miljø i stilhed: en
// uautoriseret non-prod release fejler i stedet.
const NONPROD_RELEASE_ALLOWED =
  process.env.EAS_BUILD === 'true' || process.env.MADSHOPPER_ALLOW_NONPROD_RELEASE === '1';

// $CONFIGURATION sættes af Xcode, når expo-constants' build-fase evaluerer
// denne fil under xcodebuild. Alt der ikke er en Debug-konfiguration tælles
// som release (fanger også egne navne som "Release-Prod" eller "AppStore").
// Gradle sætter ingen tilsvarende variabel - Android (og iOS) dækkes derfor
// også af runtime-tjekket i src/config/env.ts.
const XCODE_CONFIGURATION = process.env.CONFIGURATION || '';
const IS_LOCAL_XCODE_RELEASE =
  XCODE_CONFIGURATION !== '' && !/debug/i.test(XCODE_CONFIGURATION) && !NONPROD_RELEASE_ALLOWED;

if (IS_LOCAL_XCODE_RELEASE) {
  if (!IS_PRODUCTION_FLAVOR) {
    throw new Error(
      `Xcode-konfiguration "${XCODE_CONFIGURATION}" med EXPO_PUBLIC_FLAVOR=${FLAVOR}: ` +
        'et release-build må ikke pege på staging. Ret apps/mobile/.env (eller shell-' +
        'variablerne) til produktion, eller sæt MADSHOPPER_ALLOW_NONPROD_RELEASE=1 ' +
        'hvis det er bevidst.',
    );
  }
  // Info.plist bages ved `expo prebuild`, ikke her. Var prebuild kørt med en
  // staging-.env, ligger ATS-undtagelsen stadig i ios/ og ville følge med i
  // arkivet (GDPR-029), selvom flavoren nu er produktion.
  const root = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const iosDir = path.join(root, 'ios');
  const plists = fs.existsSync(iosDir)
    ? fs
        .readdirSync(iosDir)
        .map((d) => path.join(iosDir, d, 'Info.plist'))
        .filter((f) => fs.existsSync(f))
    : [];
  const leaky = plists.filter((f) => fs.readFileSync(f, 'utf8').includes('NSAllowsLocalNetworking'));
  if (leaky.length) {
    throw new Error(
      `${leaky.join(', ')} indeholder NSAllowsLocalNetworking (prebuild kørt med staging-env). ` +
        'Kør `npx expo prebuild --clean` med produktions-env før et release-arkiv.',
    );
  }
}

/** @type {import('expo/config').ExpoConfig} */
const config = {
  name: 'MadShopper',
  slug: 'madshopper',
  // 1.0.0 blev udgivet i App Store 25-09-2026 - hver ny butiksudgave skal
  // have et højere nummer, ellers afviser Apple den.
  version: '1.0.2',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  scheme: IS_TEST_APP ? 'madshopper-test' : 'madshopper',
  // Brandgrøn = samme #059669 som favicon/app-ikonet (scripts/build-icons.py).
  // Appens egne UI-grønne toner ligger i src/theme/colors.ts.
  primaryColor: '#059669',
  ios: {
    // Portrait-first iPhone-app. `true` ville kræve iPad-screenshots i App Store
    // Connect og gøre iPad til en review-flade vi ikke tester på.
    supportsTablet: false,
    bundleIdentifier: IS_TEST_APP ? 'dk.madshopper.app.test' : 'dk.madshopper.app',
    associatedDomains: IS_TEST_APP ? [] : ['applinks:madshopper.dk'],
    infoPlist: {
      ...(IS_TEST_APP ? { CFBundleDisplayName: 'MadShopper Test' } : {}),
      CFBundleAllowMixedLocalizations: true,
      // Appen er på dansk. Uden disse to viste App Store sproget som
      // "EN English" (Expo sætter udviklingsregionen til engelsk som standard).
      CFBundleDevelopmentRegion: 'da',
      CFBundleLocalizations: ['da'],
      // Appen bruger ingen egen kryptering ud over standard HTTPS/TLS -
      // undtaget fra USA's eksportregler, sa vi undgar det interaktive
      // spørgsmål ved hver build.
      ITSAppUsesNonExemptEncryption: false,
      // Bevidst INGEN NSUserTrackingUsageDescription: appen kalder aldrig ATT
      // og svarer "no tracking" i App Privacy. En tilladelsestekst vi ikke
      // bruger, ville modsige den erklæring over for review. Tilføj den igen
      // samtidig med at ATT faktisk kaldes, hvis analytics kommer på.
      NSAppTransportSecurity: {
        // Tillader KUN usikker http:// mod loopback/private IP'er/.local -
        // ikke mod internettet generelt (det ville kræve
        // NSAllowsArbitraryLoads, en meget bredere svækkelse). Nødvendig for
        // EXPO_PUBLIC_API_BASE_URL=http://localhost:5001 (simulator) eller
        // http://<mac-lan-ip>:5001 (telefon), se apps/mobile/.env.example -
        // uden denne fejler alle API-kald mod lokal Flask stille (fetch
        // afvises af ATS før den overhovedet rammer netværket).
        //
        // KUN i ikke-produktionsbuilds (compliance-audit 19-08-2026,
        // GDPR-029): et rigtigt produktions-build peger altid på
        // https://madshopper.dk og har ingen brug for undtagelsen - den
        // fulgte tidligere ubetinget med i App Store-buildet.
        ...(IS_PRODUCTION_FLAVOR ? {} : { NSAllowsLocalNetworking: true }),
      },
    },
    // NSPrivacyAccessedAPITypes skal spejle ALLE kategorier, som det
    // GENERTEDE ios/MadShopper/PrivacyInfo.xcprivacy faktisk erklærer -
    // ikke kun én af dem (compliance-audit 19-08-2026, GDPR-029). /ios er
    // gitignoreret, så mappen (og manifestet) regenereres ved næste
    // `expo prebuild` fra PRÆCIS denne liste - stod kun UserDefaults her,
    // ville et fremtidigt build ende med et fattigere manifest end det,
    // React Native/Expo/Google-pods'ene reelt kræver.
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1', 'C56D.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
          NSPrivacyAccessedAPITypeReasons: ['C617.1', '0A2A.1', '3B52.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
          NSPrivacyAccessedAPITypeReasons: ['E174.1', '85F4.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
          NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
        },
      ],
    },
  },
  android: {
    package: 'dk.madshopper.app',
    adaptiveIcon: {
      backgroundColor: '#059669',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'madshopper.dk', pathPrefix: '/' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    // iOS 27 kræver scene-opstart (ellers lukker appen ved start).
    './plugins/withSceneLifecycle',
    // faceIDPermission: false fjerner NSFaceIDUsageDescription helt fra
    // Info.plist (compliance-audit 19-08-2026, GDPR-029). Ingen SecureStore-
    // kald i src/ bruger requireAuthentication, og der er ingen
    // LocalAuthentication-import noget sted - appen bruger aldrig Face ID,
    // og en erklæret-men-ubrugt tilladelse (tidligere Expos engelske
    // standardtekst, i en ellers dansk app) modsagde både LegalScreen.tsx's
    // opremsning af tilladelser og store/review-notes.md.
    ['expo-secure-store', { faceIDPermission: false }],
    // Splash: logo med FAST bredde, låst til skærmens midte (vandret + lodret)
    // via constraints - står derfor centralt på iPhone, iPad og alle størrelser.
    // Den gamle top-level `splash` var et fuldskærmsbillede (aspect-fit), hvis
    // kurve skalerede med skærmbredden og afhang af billedets indhold.
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 220,
        resizeMode: 'contain',
        backgroundColor: '#059669',
      },
    ],
    'expo-web-browser',
    // Beskeder på telefonen (prisalarmer). Tilføjer iOS' push-tilladelse
    // (aps-environment) - Apple-nøglen til push ligger hos Expo (eas credentials).
    ['expo-notifications', { color: '#059669' }],
    'expo-asset',
    'expo-apple-authentication',
    [
      '@react-native-google-signin/google-signin',
      {
        // Hardkodet i stedet for udledt af EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID:
        // eas-cli's lokale "anvend config-plugins"-tjek (kører før upload til
        // cloud-build) mister build-profilens env-variabler i det trin, selvom
        // de er korrekt indlæst til selve `expo config` et øjeblik forinden.
        // Værdien er projektets faste Google iOS OAuth-klient-ID (offentligt,
        // ikke en hemmelighed) og er identisk på tværs af flavors - se .env.
        iosUrlScheme: 'com.googleusercontent.apps.683267660851-6ah9du0ig9fs3a0rcrbp72hu6t7j0hr4',
      },
    ],
    // Google Sign-In's Swift pods (AppCheckCore/GoogleUtilities/RecaptchaInterop)
    // require modular headers, which only happens automatically with use_frameworks!.
    ['expo-build-properties', { ios: { useFrameworks: 'static' } }],
  ],
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'https://madshopper.dk',
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || PUBLIC_DEFAULTS.supabaseUrl,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || PUBLIC_DEFAULTS.supabaseAnonKey,
    rpcSuffix: process.env.EXPO_PUBLIC_RPC_SUFFIX || '',
    recipesEnabled: process.env.EXPO_PUBLIC_RECIPES_ENABLED === '1',
    // Beskeder på telefonen (src/push/push.ts) - altid til i test-udgaverne.
    pushEnabled: process.env.EXPO_PUBLIC_PUSH_ENABLED === '1',
    googleClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || PUBLIC_DEFAULTS.googleClientId,
    googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || PUBLIC_DEFAULTS.googleIosClientId,
    googleAndroidClientId:
      process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || PUBLIC_DEFAULTS.googleAndroidClientId,
    flavor: FLAVOR,
    // Læses af runtime-tjekket i src/config/env.ts (dækker også Android).
    nonProdReleaseAllowed: NONPROD_RELEASE_ALLOWED,
    eas: {
      // Fra `eas init` (Cartspotter-organisationen), 2026-07-27
      projectId: '61fb2d3e-805e-4d2f-9c78-5e9705d28fd8',
    },
  },
};

export default config;
