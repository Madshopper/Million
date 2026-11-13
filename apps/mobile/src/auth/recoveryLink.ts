/**
 * Links fra login-mails: "glemt adgangskode" og bekræftelse af ny konto.
 *
 * Mails bestilt i appen peger på `https://madshopper.dk/app/konto` (se
 * `appAuthRedirect`), og Supabase-skabelonerne (supabase/templates/) lægger
 * linkets engangsnøgle i fragmentet:
 *   - `…/app/konto#token_hash=…&type=recovery` (ny adgangskode)
 *   - `…/app/konto#token_hash=…&type=email`    (bekræft e-mail)
 * Stien står i Apples link-fil (app.py::apple_app_site_association), så
 * iPhone åbner appen direkte uden om Safari. Åbnes linket alligevel i en
 * browser, sender siden /app/konto det videre til appens scheme med samme
 * fragment (`madshopper://app/konto#…`).
 *
 * Ældre mails (og Supabases standard-skabelon) går via Supabases
 * /auth/v1/verify, som redirecter med enten
 *   - implicit flow: `#access_token=…&refresh_token=…&type=recovery`
 *   - PKCE:          `?code=…&type=recovery`
 *   - eller en fejl: `#error=access_denied&error_description=…` (udløbet link)
 *
 * Klienten kører med `detectSessionInUrl: false` (der findes ingen browser-URL
 * i en native app), så URL'en skal veksles til en session i hånden. Parsingen
 * ligger i sin egen fil, dels fordi den er ren logik der kan testes uden
 * Expo-runtime (recoveryLink.test.ts), dels fordi den er sikkerhedsafgørende:
 * kun URL'er der utvetydigt er et login-link må åbne "vælg ny adgangskode".
 * Selve spærren mod en fremmeds link er kvitteringen i AuthContext: linket
 * bruges kun, hvis DENNE enhed selv har bedt om det for netop den e-mail.
 */

export type RecoveryLink =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | { kind: 'token_hash'; tokenHash: string; otpType: 'recovery' | 'signup' | 'email' }
  | { kind: 'error'; message: string };

/** Siden login-mails bestilt i appen peger på (og som Apples link-fil gør krav på). */
export const APP_AUTH_LINK = 'https://madshopper.dk/app/konto';

/**
 * redirectTo for mails bestilt i appen. Testappen får `?app=test`: Apples
 * link-fil udelukker den, så linket ikke åbner den rigtige MadShopper-app på
 * en telefon med begge, og siden sender det videre til testappens scheme.
 * Supabase-skabelonerne kender præcis de to værdier.
 */
export function appAuthRedirect(isTestApp: boolean): string {
  return isTestApp ? `${APP_AUTH_LINK}?app=test` : APP_AUTH_LINK;
}

function paramsFrom(url: string): URLSearchParams {
  const merged = new URLSearchParams();
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  if (queryIndex >= 0 && (hashIndex < 0 || queryIndex < hashIndex)) {
    const end = hashIndex > queryIndex ? hashIndex : url.length;
    for (const [k, v] of new URLSearchParams(url.slice(queryIndex + 1, end))) {
      merged.set(k, v);
    }
  }
  if (hashIndex >= 0) {
    for (const [k, v] of new URLSearchParams(url.slice(hashIndex + 1))) merged.set(k, v);
  }
  return merged;
}

/**
 * Returnerer et resultat KUN for links der er markeret som recovery. Alt
 * andet (invitations-links, tilfældige dybe links, OAuth-callbacks) giver
 * null, så de hverken kan skabe en session eller åbne en skærm.
 */
export function parseRecoveryLink(url: string): RecoveryLink | null {
  return parseTypedAuthLink(url, 'recovery');
}

/**
 * Bekræftelseslinket fra oprettelses-mailen (`type=signup`, eller `type=email`
 * fra vores egen skabelon). Samme regel som recovery: kun links der
 * utvetydigt er mærket sådan, giver et resultat.
 */
export function parseSignupLink(url: string): RecoveryLink | null {
  return parseTypedAuthLink(url, 'signup');
}

/**
 * Login-links må kun komme ind gennem appens egne schemes eller præcis
 * `https://madshopper.dk/app/konto` (siden login-mails bestilt i appen peger
 * på). Alle andre https-links afvises: madshopper.dk/?liste= åbner også appen,
 * og et link dér er aldrig et login-link (sikkerhedstjek runde 3).
 * exp/exps er Expo Go under udvikling.
 */
const AUTH_LINK_SCHEMES = ['madshopper:', 'madshopper-test:', 'exp:', 'exps:'];

export function isAppSchemeUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return AUTH_LINK_SCHEMES.some((scheme) => lower.startsWith(scheme));
}

/** Sandt kun for `https://madshopper.dk/app/konto` (evt. med / til sidst), med eller uden ?/#. */
export function isAppAuthPageUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  if (!lower.startsWith(APP_AUTH_LINK)) return false;
  let rest = lower.slice(APP_AUTH_LINK.length);
  if (rest.startsWith('/')) rest = rest.slice(1);
  return rest === '' || rest.startsWith('?') || rest.startsWith('#');
}

// Supabases token_hash er hex (eller "pkce_" + hex). Alt andet er ikke et
// ægte link og sendes aldrig videre til Supabase.
const TOKEN_HASH_RE = /^[A-Za-z0-9_-]{16,256}$/;

function parseTypedAuthLink(url: string, wanted: 'recovery' | 'signup'): RecoveryLink | null {
  if (!url || !(isAppSchemeUrl(url) || isAppAuthPageUrl(url))) return null;
  let params: URLSearchParams;
  try {
    params = paramsFrom(url);
  } catch {
    return null;
  }

  const type = params.get('type');
  if (wanted === 'recovery' ? type !== 'recovery' : type !== 'signup' && type !== 'email') {
    return null;
  }

  const error = params.get('error_description') || params.get('error');
  if (error) return { kind: 'error', message: decodeURIComponent(error.replace(/\+/g, ' ')) };

  const tokenHash = params.get('token_hash');
  if (tokenHash) {
    if (!TOKEN_HASH_RE.test(tokenHash)) return null;
    return { kind: 'token_hash', tokenHash, otpType: type as 'recovery' | 'signup' | 'email' };
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) return { kind: 'tokens', accessToken, refreshToken };

  const code = params.get('code');
  if (code) return { kind: 'code', code };

  return null;
}

/** Sandt kun for URL'er `parseRecoveryLink` faktisk kan bruge til noget. */
export function isRecoveryUrl(url: string): boolean {
  return parseRecoveryLink(url) !== null;
}
