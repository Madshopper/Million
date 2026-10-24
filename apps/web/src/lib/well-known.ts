// Små tekst-/JSON-svar fra app.py: security.txt (RFC 9116), Universal Links
// (apple-app-site-association), Android App Links (assetlinks.json) og
// Turnstile-udfordringen til den native app. Rene funktioner.
import { tojson } from '~/components/jinja'
import { pyStrip } from './support/py'

/** security.txt. Expires er påkrævet og rulles et år frem, så filen aldrig
 * står som udløbet. */
export function securityTxt(siteUrl: string, now = new Date()): string {
  const expires = new Date(now.getTime() + 365 * 86400_000).toISOString().slice(0, 19) + 'Z'
  return (
    'Contact: mailto:kontakt@madshopper.dk\n' +
    `Expires: ${expires}\n` +
    'Preferred-Languages: da, en\n' +
    `Canonical: ${siteUrl}/.well-known/security.txt\n`
  )
}

/** apple-app-site-association. Uden APPLE_TEAM_ID tomme details, så Apple
 * ikke cacher et forkert appID. */
export function appleAppSiteAssociation(teamId: string | undefined): unknown {
  const team = (teamId || '').trim()
  if (!team) return { applinks: { apps: [], details: [] } }
  const appId = `${team}.dk.madshopper.app`
  return {
    applinks: { apps: [], details: [{ appID: appId, paths: ['*', '/'] }] },
    webcredentials: { apps: [appId] },
  }
}

/** assetlinks.json. ANDROID_CERT_SHA256 kan være kommasepareret. */
export function androidAssetLinks(raw: string | undefined): unknown {
  const fps = (raw || '').trim().split(',').map((f) => f.trim().toUpperCase()).filter((f) => f)
  if (!fps.length) return []
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: 'dk.madshopper.app', sha256_cert_fingerprints: fps },
  }]
}

/** JSON-svar med 1 times cache, som Python (ikke via edge-cachen). */
export function wellKnownJson(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  })
}

// Kun madshopper://-linket appen selv registrerer må modtage tokenet -
// ellers blev ?returnUrl= en åben omdirigering til en fremmed side.
export const TURNSTILE_APP_SCHEME = 'madshopper://'

export function turnstileReturnUrl(raw: string | null): string {
  const r = pyStrip(raw || '')
  return r.startsWith(TURNSTILE_APP_SCHEME) ? r : TURNSTILE_APP_SCHEME + 'turnstile-callback'
}

/** templates/turnstile_challenge.html. Selvstændig side (udvider ikke
 * base.html): den åbnes i systemets browser fra appen. */
export function turnstileChallengeHtml(returnUrl: string): string {
  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bekræft at du ikke er en robot – MadShopper</title>
<!-- Selvstændig side (udvider ikke base.html): den åbnes i systemets browser
     fra den native app (se apps/mobile/src/auth/turnstile.ts), ikke som en
     almindelig sidevisning, og skal ikke bære sitets fulde header/nav med. -->
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0d1f16;
    color: #eef2ee;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    margin: 0;
    padding: 24px;
    text-align: center;
  }
  .card { max-width: 340px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { color: #9fb0a6; font-size: 14px; line-height: 1.5; margin: 0 0 20px; }
  .cf-turnstile { display: flex; justify-content: center; }
  .status { margin-top: 16px; font-size: 13px; color: #9fb0a6; min-height: 18px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Bekræft at du ikke er en robot</h1>
    <p>Kort sikkerhedstjek, før du fortsætter i MadShopper-appen.</p>
    <div class="cf-turnstile"
         data-sitekey="0x4AAAAAAD_TUldIm22rh6Lz"
         data-action="turnstile-spin-v1"
         data-callback="onTurnstileToken"
         data-error-callback="onTurnstileError"></div>
    <p class="status" id="ts-status"></p>
  </div>
  <script>
    var RETURN_URL = ${tojson(returnUrl)};
    function onTurnstileToken(token) {
      document.getElementById('ts-status').textContent = 'Bekræftet - vender tilbage til appen…';
      var sep = RETURN_URL.indexOf('?') >= 0 ? '&' : '?';
      window.location.href = RETURN_URL + sep + 'token=' + encodeURIComponent(token);
    }
    function onTurnstileError() {
      document.getElementById('ts-status').textContent =
        'Bot-tjekket kunne ikke indlæses. Prøv at lukke og åbne siden igen.';
    }
  </script>
</body>
</html>`
}
