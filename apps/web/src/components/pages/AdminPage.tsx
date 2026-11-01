// Port af templates/admin.html. Admin har sit eget layout - ikke base.html:
// ingen offentlig header/footer, søgning, kurv eller script.js; kun login
// (auth.js + auth-modalen). Renderes KUN for en verificeret admin
// (routes/admin.tsx) - alle andre får sitets almindelige 404. Derfor ligger
// admin.css/admin.js under templates/ og indlejres her som tekst i stedet for
// at være offentlige filer i static/. Læg dem aldrig i static/.
import adminCss from '../../../../../templates/admin/admin.css?raw'
import adminJs from '../../../../../templates/admin/admin.js?raw'
import { staticUrl } from '~/lib/static'
import { AuthModal } from '../AuthModal'
import type { SiteContext } from '../context'
import { raw, tojson } from '../jinja'

const THEME_SCRIPT = `
    // Samme tema-nøgle som resten af sitet (se base.html), sat før første maling.
    try {
      var _t = localStorage.getItem('madshopper_darkmode');
      if (_t === 'true' || (_t === null && window.matchMedia
          && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.body.setAttribute('data-theme', 'dark');
      }
    } catch (e) { /* localStorage kan være spærret */ }
  `

function siteScript(site: SiteContext): string {
  return (
    '\n    window.__SB_URL = ' + tojson(site.supabase_url) + ';' +
    '\n    window.__SB_KEY = ' + tojson(site.supabase_anon_key) + ';' +
    '\n    window.__SB_CARTS = ' + tojson(site.carts_table) + ';' +
    '\n    window.__SB_PRICE_ALERTS = ' + tojson(site.price_alerts_table) + ';' +
    '\n    window.__SB_RPC_SUFFIX = ' + tojson(site.rpc_suffix) + ';' +
    '\n    window.__GOOGLE_CLIENT_ID = "683267660851-4jvo3nauv24s4g8sk5qhk1dlvuc4tjgr.apps.googleusercontent.com";' +
    '\n    window.__APPLE_CLIENT_ID = "";\n  '
  )
}

export function AdminPage({ site }: { site: SiteContext }) {
  const stats = site.stats_enabled
  return (
    <html lang="da">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <meta name="robots" content="noindex, nofollow" />
        <title>Admin - MadShopper</title>
        <link rel="icon" href={staticUrl('favicon.svg')} type="image/svg+xml" />
        <link rel="icon" href={staticUrl('favicon.ico')} sizes="16x16 32x32 48x48" />
        <meta name="theme-color" content="#059669" />
        <link rel="stylesheet" href={staticUrl('css/fonts.css')} />
        <link rel="stylesheet" href={staticUrl('css/styles.css')} />
        <style dangerouslySetInnerHTML={{ __html: '\n' + adminCss + '\n  ' }} />
        <script dangerouslySetInnerHTML={{ __html: siteScript(site) }} />
        <script src={staticUrl('js/supabase.min.js')} defer></script>
        <script src={staticUrl('js/auth.js')} defer></script>
      </head>

      <body className="adm-body">
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />

        <div className="adm-shell">
          <aside className="adm-side" aria-label="Admin-menu">
            <div className="adm-brand">
              {/* src via raw(): ellers lægger React et <link rel=preload> ind i <head>. */}
              <img {...raw({ src: staticUrl('favicon.svg') })} alt="" width="28" height="28" />
              <span><span className="adm-brand-name">MadShopper </span><b>Admin</b></span>
            </div>
            <nav className="adm-nav" id="admin-nav">
              <a href="#oversigt" data-section="oversigt">Overblik</a>
              <a href="#trafik" data-section="trafik">Trafik</a>
              <a href="#app" data-section="app">App</a>
              {stats ? <a href="#varer" data-section="varer">Varer</a> : null}
              <a href="#feedback" data-section="feedback">Feedback <span className="adm-badge" id="badge-feedback" hidden></span></a>
              <a href="#scraping" data-section="scraping">Scraping <span className="adm-badge" id="badge-scraping" hidden></span></a>
              <a href="#korsler" data-section="korsler">Kørsler <span className="adm-badge" id="badge-korsler" hidden></span></a>
              <a href="#opskrifter" data-section="opskrifter">Opskrifter <span className="adm-badge" id="badge-opskrifter" hidden></span></a>
              <a href="#feature" data-section="feature">Feature</a>
              <a href="#brugere" data-section="brugere">Brugere <span className="adm-badge" id="badge-brugere" hidden></span></a>
              <a href="#drift" data-section="drift">Drift</a>
            </nav>
            <div className="adm-side-foot">
              <span id="admin-who" className="adm-who"></span>
              <button type="button" className="adm-btn" id="admin-refresh">Opdater</button>
              <button type="button" className="adm-btn" id="admin-logout" hidden>Log ud</button>
              <button type="button" className="adm-btn" id="admin-dev" data-dev-path="/">Se dev-siden</button>
              <a href="/" className="adm-backlink">Til madshopper.dk</a>
            </div>
          </aside>

          <div className="adm" id="admin-root" role="main">
            <div className="adm-gate" id="admin-gate">
              <h1>Admin</h1>
              <p id="admin-gate-text">Henter …</p>
              <button type="button" className="adm-btn primary" id="admin-login" hidden>Log ind</button>
            </div>

            <div id="admin-main" hidden>
              <div id="admin-errors"></div>

              <section data-section="oversigt" hidden>
                <div className="adm-head"><h1>Overblik</h1><span className="adm-sub" id="admin-stamp"></span></div>
                <div className="adm-tiles" id="admin-tiles"></div>
                <div className="adm-card">
                  <h2>Kræver opmærksomhed</h2>
                  <div id="admin-attention"></div>
                </div>
              </section>

              <section data-section="trafik" hidden>
                <div className="adm-head"><h1>Trafik</h1><span className="adm-sub">Cloudflare Web Analytics, seneste 7 dage (UTC)</span></div>
                <div className="adm-tiles" id="admin-traffic-tiles"></div>
                <div className="adm-card"><h2>Besøg pr. dag</h2><div id="admin-traffic-days"></div></div>
                <div className="adm-grid">
                  <div className="adm-card"><h2>Mest besøgte sider</h2><div id="admin-traffic-pages"></div></div>
                  <div className="adm-card"><h2>Kommer fra</h2><div id="admin-traffic-referers"></div></div>
                  <div className="adm-card"><h2>Enheder</h2><div id="admin-traffic-devices"></div></div>
                  <div className="adm-card"><h2>Lande</h2><div id="admin-traffic-countries"></div></div>
                  <div className="adm-card"><h2>Browsere</h2><div id="admin-traffic-browsers"></div></div>
                  <div className="adm-card"><h2>Serveren i dag</h2><div id="admin-traffic-worker"></div></div>
                </div>
              </section>

              {stats ? (
                <section data-section="varer" hidden>
                  <div className="adm-head">
                    <h1>Varer</h1>
                    <span className="adm-seg" id="stats-period">
                      <button type="button" className="adm-btn" data-days="7" aria-pressed="false">7 dage</button>
                      <button type="button" className="adm-btn" data-days="30" aria-pressed="true">30 dage</button>
                      <button type="button" className="adm-btn" data-days="90" aria-pressed="false">90 dage</button>
                      <button type="button" className="adm-btn" data-days="365" aria-pressed="false">1 år</button>
                      <button type="button" className="adm-btn" data-days="3650" aria-pressed="false">Alt</button>
                    </span>
                  </div>
                  <p className="adm-sub adm-intro" id="stats-sub">Hvad folk kigger på, lægger i kurven og søger efter. Der gemmes kun tal pr. dag, intet om den enkelte bruger.</p>
                  <div className="adm-tiles" id="stats-tiles"></div>
                  <div className="adm-card"><h2>Over tid</h2><div id="stats-days"></div></div>
                  <div className="adm-grid">
                    <div className="adm-card"><h2>Lagt i kurven</h2><div id="stats-top-add"></div></div>
                    <div className="adm-card"><h2>Kigget på</h2><div id="stats-top-view"></div></div>
                    <div className="adm-card"><h2>Prissammenlignet</h2><div id="stats-top-compare"></div></div>
                    <div className="adm-card"><h2>Søgt efter</h2><div id="stats-top-search"></div></div>
                  </div>
                </section>
              ) : null}

              <section data-section="app" hidden>
                <div className="adm-head"><h1>App</h1><span className="adm-sub" id="app-sub"></span></div>
                <div className="adm-tiles" id="admin-app-tiles"></div>
                <div className="adm-card"><h2>Downloads pr. dag, seneste 14 dage</h2><div id="admin-app-days"></div></div>
                <div className="adm-grid">
                  <div className="adm-card"><h2>App Store-siden, 30 dage</h2><div id="admin-app-store"></div></div>
                  <div className="adm-card"><h2>Brugere</h2><div id="admin-app-users"></div></div>
                  <div className="adm-card"><h2>Nye brugere pr. uge</h2><div id="admin-app-weeks"></div></div>
                  <div className="adm-card"><h2>Nedbrud, 30 dage</h2><div id="admin-app-crashes"></div></div>
                </div>
                <div className="adm-card"><h2>Anmeldelser</h2><div id="admin-app-reviews"></div></div>
              </section>

              <section data-section="feedback" hidden>
                <div className="adm-head">
                  <h1>Feedback</h1>
                  <span className="adm-seg">
                    <button type="button" className="adm-btn" id="fb-open" aria-pressed="true">Ubehandlet</button>
                    <button type="button" className="adm-btn" id="fb-all" aria-pressed="false">Alle</button>
                  </span>
                </div>
                <div className="adm-card" id="admin-feedback"></div>
              </section>

              <section data-section="scraping" hidden>
                <div className="adm-head"><h1>Scraping pr. butik</h1></div>
                <div className="adm-card" id="admin-stores"></div>
              </section>

              <section data-section="korsler" hidden>
                <div className="adm-head"><h1>Kørsler</h1><span className="adm-sub" id="runs-sub"></span></div>
                <div className="adm-card" id="admin-runs"></div>
              </section>

              <section data-section="opskrifter" hidden>
                <div className="adm-head"><h1>Opskrifter</h1></div>
                <div className="adm-card" id="admin-recipes"></div>
              </section>

              <section data-section="feature" hidden>
                <div className="adm-head"><h1>Feature</h1></div>
                <p className="adm-sub adm-intro">Overblik over alt der ikke er færdigt endnu. Funktioner med knap er skjult på madshopper.dk, indtil du udgiver dem. På dev-siden er alt altid slået til.</p>
                <div id="admin-features"></div>
              </section>

              <section data-section="brugere" hidden>
                <div className="adm-head"><h1>Brugere</h1></div>
                <div className="adm-tiles" id="admin-user-tiles"></div>
                <div className="adm-card">
                  <div className="adm-head" style={{ marginBottom: '8px' }}>
                    <h2 style={{ margin: '0' }} id="admin-users-title">Nyeste brugere</h2>
                    <span className="adm-seg" id="users-filter" hidden>
                      <button type="button" className="adm-btn" id="users-pending" aria-pressed="true">Venter</button>
                      <button type="button" className="adm-btn" id="users-all" aria-pressed="false">Alle</button>
                    </span>
                  </div>
                  <div id="admin-users"></div>
                </div>
              </section>

              <section data-section="drift" hidden>
                <div className="adm-head"><h1>Drift</h1></div>
                <div className="adm-grid">
                  <div className="adm-card"><h2>Edge (Cloudflare)</h2><div id="admin-edge"></div></div>
                  <div className="adm-card"><h2>Sikkerhed seneste 24 timer</h2><div id="admin-security"></div></div>
                </div>
                <div className="adm-card" id="admin-dev-card"><h2>Dev-siden (dev.madshopper.dk)</h2>
                  <p className="adm-sub">Testudgaven af sitet. Her lander nye ændringer, og den bruger sine egne testtabeller, så du kan klikke rundt uden at røre de rigtige data. Knapperne logger dig direkte ind på dev.</p>
                  <div className="adm-dev-btns">
                    <button type="button" className="adm-btn" data-dev-path="/">Åbn forsiden på dev</button>
                    <button type="button" className="adm-btn" data-dev-path="/admin">Åbn admin på dev</button>
                  </div>
                  <p className="adm-sub" id="admin-dev-note" hidden></p>
                </div>
                <div className="adm-card"><h2>Største tabeller (Supabase)</h2><div id="admin-tables"></div></div>
              </section>
            </div>
          </div>
        </div>

        <div className="adm-modal" id="feature-modal" hidden>
          <div className="adm-modal-box" role="dialog" aria-modal="true" aria-labelledby="feature-modal-title">
            <h2 id="feature-modal-title"></h2>
            <p id="feature-modal-text"></p>
            <div className="adm-modal-remind" id="feature-modal-remind" hidden>
              <b>Husk at opdatere appen</b>
              <p id="feature-modal-app"></p>
            </div>
            <p className="adm-sub" id="feature-modal-note" hidden></p>
            <div className="adm-modal-btns">
              <button type="button" className="adm-btn" id="feature-modal-cancel">Annuller</button>
              <button type="button" className="adm-btn primary" id="feature-modal-ok"></button>
            </div>
          </div>
        </div>

        <AuthModal site={site} />
        <script dangerouslySetInnerHTML={{ __html: '\n' + adminJs + '\n  ' }} />
      </body>
    </html>
  )
}
