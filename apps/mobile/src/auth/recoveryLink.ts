/**
 * Deep link til "glemt adgangskode".
 *
 * `resetPasswordForEmail` sender brugeren til Supabases /auth/v1/verify, som
 * redirecter videre til appens scheme (`madshopper://…`) med enten
 *   - implicit flow: `#access_token=…&refresh_token=…&type=recovery`
 *   - PKCE:          `?code=…&type=recovery`
 *   - eller en fejl: `#error=access_denied&error_description=…` (udløbet link)
 *
 * Klienten kører med `detectSessionInUrl: false` (der findes ingen browser-URL
 * i en native app), så URL'en skal veksles til en session i hånden. Parsingen
 * ligger i sin egen fil, dels fordi den er ren logik der kan testes uden
 * Expo-runtime, dels fordi den er sikkerhedsafgørende: kun URL'er der
 * utvetydigt er et recovery-link må åbne "vælg ny adgangskode".
 */

export type RecoveryLink =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string };

function paramsFrom(url: string): URLSearchParams {
  const merged = new URLSearchParams();
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  if (queryIndex >= 0) {
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
 * Bekræftelseslinket fra oprettelses-mailen (`type=signup`). Samme form som
 * recovery-linket, og samme regel: kun links der utvetydigt er mærket
 * `type=signup` giver et resultat. Uden den her sendte mailen brugeren ind
 * på hjemmesiden i stedet for appen.
 */
export function parseSignupLink(url: string): RecoveryLink | null {
  return parseTypedAuthLink(url, 'signup');
}

/**
 * Login-links må kun komme ind gennem appens egne schemes. Et https-link
 * (madshopper.dk åbner også appen via App Links) er aldrig et ægte
 * callback fra Supabase og kan bære en fremmeds tokens (sikkerhedstjek
 * runde 3). exp/exps er Expo Go under udvikling.
 */
const AUTH_LINK_SCHEMES = ['madshopper:', 'madshopper-test:', 'exp:', 'exps:'];

export function isAppSchemeUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return AUTH_LINK_SCHEMES.some((scheme) => lower.startsWith(scheme));
}

function parseTypedAuthLink(url: string, wanted: 'recovery' | 'signup'): RecoveryLink | null {
  if (!url || !isAppSchemeUrl(url)) return null;
  let params: URLSearchParams;
  try {
    params = paramsFrom(url);
  } catch {
    return null;
  }

  if (params.get('type') !== wanted) return null;

  const error = params.get('error_description') || params.get('error');
  if (error) return { kind: 'error', message: decodeURIComponent(error.replace(/\+/g, ' ')) };

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
