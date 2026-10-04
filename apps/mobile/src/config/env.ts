/**
 * MadShopper native — miljø / flavors.
 *
 * Produktion: EXPO_PUBLIC_FLAVOR=production, RPC-suffix ""
 * Staging:    EXPO_PUBLIC_FLAVOR=staging,    RPC-suffix "_dev"
 *             (samme Auth-projekt; skriver til *_dev — se docs/native-app.md §10.3)
 */
import Constants from 'expo-constants';

type Extra = {
  apiBaseUrl?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  rpcSuffix?: string;
  googleClientId?: string;
  googleIosClientId?: string;
  googleAndroidClientId?: string;
  flavor?: string;
  nonProdReleaseAllowed?: boolean;
  recipesEnabled?: boolean;
  pushEnabled?: boolean;
};

const extra = (Constants.expoConfig?.extra || {}) as Extra;

export const env = {
  flavor: (extra.flavor || 'production') as 'production' | 'staging' | 'local',
  /** Vises nederst på Profil, så en fejlmelding kan knyttes til en konkret udgave. */
  appVersion: Constants.expoConfig?.version || '',
  apiBaseUrl: (extra.apiBaseUrl || 'https://madshopper.dk').replace(/\/$/, ''),
  supabaseUrl: extra.supabaseUrl || '',
  supabaseAnonKey: extra.supabaseAnonKey || '',
  /** '' i prod, '_dev' på staging/lokal — spejler __SB_RPC_SUFFIX. */
  rpcSuffix: extra.rpcSuffix ?? '',
  /** Web Client ID — audience Supabase bruger til at verificere ID-tokens. */
  googleClientId: extra.googleClientId || '',
  googleIosClientId: extra.googleIosClientId || '',
  googleAndroidClientId: extra.googleAndroidClientId || '',
};

/**
 * Sikkerhedsnet (24-09-2026): et release-bundle (ikke __DEV__) med staging-
 * flavor er kun gyldigt, når miljøet er valgt eksplicit - en EAS-profil eller
 * MADSHOPPER_ALLOW_NONPROD_RELEASE=1 (se app.config.js). Ellers er det en
 * lokal release-build med en efterladt staging-.env, og den må ikke skrive i
 * *_dev-tabellerne eller ramme localhost i stilhed. Gradle giver ingen
 * build-tids-variabel at tjekke på, så dette er Androids eneste værn - og
 * iOS' andet. Fejler højlydt ved opstart frem for at skifte miljø.
 */
if (!__DEV__ && env.flavor !== 'production' && !extra.nonProdReleaseAllowed) {
  throw new Error(
    `Release-build med flavor=${env.flavor} uden eksplicit tilladelse. ` +
      'Byg med produktions-env, via en EAS-profil, eller sæt MADSHOPPER_ALLOW_NONPROD_RELEASE=1.',
  );
}

/**
 * Opskrift-featuren er slået FRA, medmindre buildet har
 * EXPO_PUBLIC_RECIPES_ENABLED=1 (se app.config.js). Samme eksplicitte flag
 * som webbens _recipes_enabled() i app.py (RECIPES_ENABLED=1) - ikke længere
 * afledt af miljøet, da staging fjernes og opskrifter ikke må udgives.
 *
 * Flaget bor her og ikke i RootNavigator, så både navigationen, forsiden og
 * alt andet kan gate på præcis den samme værdi uden at importere hinanden på
 * kryds (cirkulær import).
 */
export const recipesEnabled = extra.recipesEnabled === true;

/**
 * Beskeder på telefonen: altid synlig i builds med EXPO_PUBLIC_PUSH_ENABLED=1
 * (test-udgaverne i eas.json). Ellers styres den af Feature-panelet via
 * /api/home's push_enabled - se src/push/push.ts.
 */
export const pushEnabledBuild = extra.pushEnabled === true;

export function rpcName(base: string): string {
  // delete_own_account har ingen _dev-variant (docs/native-app.md §10.3)
  if (base === 'delete_own_account') return base;
  return `${base}${env.rpcSuffix}`;
}
