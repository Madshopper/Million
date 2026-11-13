import {
  APP_AUTH_LINK,
  appAuthRedirect,
  isAppAuthPageUrl,
  isRecoveryUrl,
  parseRecoveryLink,
  parseSignupLink,
} from './recoveryLink.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const HASH = 'a3f1c9e0b2d4a3f1c9e0b2d4a3f1c9e0b2d4a3f1c9e0b2d4a3f1c9e0';

// redirectTo: præcis de to værdier Supabase-skabelonerne kender.
assert(appAuthRedirect(false) === 'https://madshopper.dk/app/konto', 'butiksappen');
assert(appAuthRedirect(true) === 'https://madshopper.dk/app/konto?app=test', 'testappen');
assert(APP_AUTH_LINK === appAuthRedirect(false), 'samme sti som Apples link-fil');

// Nye mails: token_hash i fragmentet, via Universal Link (https) eller siden (scheme).
const nyHttps = parseRecoveryLink(`https://madshopper.dk/app/konto#token_hash=${HASH}&type=recovery`);
assert(nyHttps?.kind === 'token_hash' && nyHttps.tokenHash === HASH && nyHttps.otpType === 'recovery', 'https-link med token_hash');
const nyTest = parseRecoveryLink(`https://madshopper.dk/app/konto?app=test#token_hash=${HASH}&type=recovery`);
assert(nyTest?.kind === 'token_hash', 'testappens link (?app=test)');
const nyScheme = parseRecoveryLink(`madshopper://app/konto#token_hash=${HASH}&type=recovery`);
assert(nyScheme?.kind === 'token_hash', 'videresendt fra siden til appens scheme');
assert(parseRecoveryLink(`madshopper-test://app/konto#token_hash=${HASH}&type=recovery`)?.kind === 'token_hash', 'testappens scheme');
assert(parseRecoveryLink(`https://madshopper.dk/app/konto/#token_hash=${HASH}&type=recovery`)?.kind === 'token_hash', 'skråstreg til sidst');
assert(parseRecoveryLink(`HTTPS://MADSHOPPER.DK/app/konto#token_hash=${HASH}&type=recovery`)?.kind === 'token_hash', 'versaler i domænet');

const bekraeft = parseSignupLink(`https://madshopper.dk/app/konto#token_hash=${HASH}&type=email`);
assert(bekraeft?.kind === 'token_hash' && bekraeft.otpType === 'email', 'bekræftelse med type=email');
assert(parseSignupLink(`https://madshopper.dk/app/konto#token_hash=${HASH}&type=signup`)?.kind === 'token_hash', 'type=signup');
assert(parseRecoveryLink(`https://madshopper.dk/app/konto#token_hash=${HASH}&type=email`) === null, 'bekræftelse er ikke nulstilling');
assert(parseSignupLink(`https://madshopper.dk/app/konto#token_hash=${HASH}&type=recovery`) === null, 'nulstilling er ikke bekræftelse');

// Andre https-links må aldrig blive til login: kun præcis /app/konto på madshopper.dk.
assert(parseRecoveryLink(`https://madshopper.dk/#token_hash=${HASH}&type=recovery`) === null, 'forsiden');
assert(parseRecoveryLink(`https://madshopper.dk/?liste=abc#access_token=a&refresh_token=b&type=recovery`) === null, 'delt liste');
assert(parseRecoveryLink(`https://madshopper.dk/app/kontoX#token_hash=${HASH}&type=recovery`) === null, 'længere sti');
assert(parseRecoveryLink(`https://madshopper.dk/app/konto/andet#token_hash=${HASH}&type=recovery`) === null, 'understi');
assert(parseRecoveryLink(`https://evil.example/app/konto#token_hash=${HASH}&type=recovery`) === null, 'fremmed domæne');
assert(parseRecoveryLink(`https://madshopper.dk.evil.example/app/konto#token_hash=${HASH}&type=recovery`) === null, 'lignende domæne');
assert(parseRecoveryLink(`http://madshopper.dk/app/konto#token_hash=${HASH}&type=recovery`) === null, 'http uden s');
assert(!isAppAuthPageUrl('https://madshopper.dk/app'), '/app alene');
assert(isAppAuthPageUrl('https://madshopper.dk/app/konto'), '/app/konto');

// Nøglen skal ligne Supabases (ingen mellemrum, ingen tegn der kan bryde JSON).
assert(parseRecoveryLink('https://madshopper.dk/app/konto#token_hash=kort&type=recovery') === null, 'for kort');
assert(parseRecoveryLink('https://madshopper.dk/app/konto#token_hash=a%22b%22c%22d%22e%22f%22g%22h&type=recovery') === null, 'mærkelige tegn');
assert(parseRecoveryLink(`https://madshopper.dk/app/konto#token_hash=pkce_${HASH}&type=recovery`)?.kind === 'token_hash', 'pkce_-nøgle');

// Udløbet link fra Supabase.
const fejl = parseRecoveryLink('https://madshopper.dk/app/konto#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&type=recovery');
assert(fejl?.kind === 'error' && fejl.message === 'Email link is invalid or has expired', 'fejl fra Supabase');

// Gamle mails (Supabases standard-skabelon) virker stadig via appens scheme.
const gammel = parseRecoveryLink('madshopper://#access_token=a.b.c&refresh_token=r1&type=recovery&expires_in=3600');
assert(gammel?.kind === 'tokens' && gammel.accessToken === 'a.b.c' && gammel.refreshToken === 'r1', 'gammelt recovery-link');
assert(parseRecoveryLink('madshopper://?code=abc123&type=recovery')?.kind === 'code', 'PKCE-kode');
assert(parseSignupLink('madshopper://#access_token=a.b.c&refresh_token=r1&type=signup')?.kind === 'tokens', 'gammelt bekræftelseslink');
// …også når Supabase redirecter til /app/konto (ny app, gammel skabelon).
assert(parseRecoveryLink('https://madshopper.dk/app/konto#access_token=a.b.c&refresh_token=r1&type=recovery')?.kind === 'tokens', 'ny app, gammel skabelon');

// Uden type eller med forkert type: intet.
assert(parseRecoveryLink(`madshopper://#token_hash=${HASH}`) === null, 'mangler type');
assert(parseRecoveryLink('madshopper://#access_token=a&refresh_token=b&type=magiclink') === null, 'magiclink');
assert(parseRecoveryLink('madshopper://') === null, 'tomt link');
assert(parseRecoveryLink('') === null, 'tom streng');
assert(isRecoveryUrl(`https://madshopper.dk/app/konto#token_hash=${HASH}&type=recovery`), 'isRecoveryUrl');
assert(!isRecoveryUrl('https://madshopper.dk/?liste=abc'), 'delt liste er ikke recovery');

console.log('recoveryLink ok');
