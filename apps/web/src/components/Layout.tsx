// Port af templates/base.html: hele dokumentet (<html>/<head>/<body>).
// script.js/auth.js kører oven på markup'en, så id'er, klasser og inline-
// handlere skal være som i Jinja-versionen.
import { createContext, useContext, type ReactNode } from 'react'
import { staticUrl } from '~/lib/static'
import { AuthModal } from './AuthModal'
import { urlFor, type RequestInfo, type SiteContext } from './context'
import { Filters, FiltersToggleBtn } from './Filters'
import { on, raw, tojson } from './jinja'

export interface LayoutProps {
  site: SiteContext
  req: RequestInfo
  /** {% block title %} */
  title?: string
  /** {% block og_title %} */
  ogTitle?: string
  /** {% block structured_data %} - ekstra JSON-LD i <head> */
  structuredData?: ReactNode
  /** {% block content %} */
  children?: ReactNode
}

// React 19 dropper ikke-hoistbare <head>-børn (script/style), når dokumentet
// renderes inde i en Suspense-grænse - og TanStack Router lægger altid sine
// ruter i én. I appen renderer root-ruten derfor <html>/<head> (LayoutHead)
// uden for grænsen, og Layout leverer kun <body>-indholdet (ShellContext).
export const ShellContext = createContext(false)

export interface LayoutHeadProps {
  site: SiteContext
  req: RequestInfo
  title?: string
  ogTitle?: string
  structuredData?: ReactNode
}

export function LayoutHead({
  site,
  req,
  title = 'MadShopper',
  ogTitle = 'MadShopper - Sammenlign dagligvarepriser',
  structuredData,
}: LayoutHeadProps) {
  void req
  return (
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <title>{title}</title>
        <meta name="description" content="MadShopper - sammenlign dagligvarepriser fra Rema 1000, Bilka, Meny, Spar og flere danske kæder. Billigste bud, før du går ud." />
        <link rel="canonical" href={site.canonical_url} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="MadShopper" />
        <meta property="og:title" content={ogTitle} />
        <meta property="og:description" content="Sammenlign dagligvarepriser på tværs af danske kæder - billigste bud, før du går ud. Dækningen varierer fra butik til butik." />
        <meta property="og:url" content={site.canonical_url} />
        <meta property="og:locale" content="da_DK" />
        <meta property="og:image" content={`${site.site_url}/static/icon-512.png`} />
        <meta property="og:image:width" content="512" />
        <meta property="og:image:height" content="512" />
        <meta property="og:image:alt" content="MadShopper" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="MadShopper - Sammenlign dagligvarepriser" />
        <meta name="twitter:description" content="Sammenlign dagligvarepriser på tværs af danske kæder - billigste bud, før du går ud." />
        <meta name="twitter:image" content={`${site.site_url}/static/icon-512.png`} />
        <link rel="icon" href={staticUrl('favicon.svg')} type="image/svg+xml" />
        <link rel="icon" href={staticUrl('favicon.ico')} sizes="16x16 32x32 48x48" />
        <link rel="apple-touch-icon" href={staticUrl('apple-touch-icon.png')} />
        <link rel="manifest" href={staticUrl('site.webmanifest')} />
        <meta name="theme-color" content="#059669" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: tojson(site.structured_data) }} />
        {structuredData}
        <link {...raw({ rel: "preload" })} href={staticUrl('fonts/inter-latin-variable.woff2')} as="font" type="font/woff2" crossOrigin="" />
        <link {...raw({ rel: "preload" })} href={staticUrl('fonts/plus-jakarta-sans-latin-variable.woff2')} as="font" type="font/woff2" crossOrigin="" />
        <link rel="stylesheet" href={staticUrl('css/fonts.css')} />
        <link {...raw({ rel: "preload" })} href={staticUrl('css/styles.css')} as="style" />
        <link rel="stylesheet" href={staticUrl('css/styles.css')} />
        <style dangerouslySetInnerHTML={{ __html: "\n    /* Fallback hvis styles.css fejler at loade (netværk/CDN) */\n    body { font-family: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif; margin: 0; background: #F9FAFB; color: #111827; }\n    /* Skip-linket skal være skjult indtil tastaturfokus, også før/uden\n       styles.css (sket 02-10-2026 med en gammel styles.css i browser-cachen). */\n    .skip-link { position: absolute; top: -100px; left: 12px; }\n    .skip-link:focus { top: 12px; }\n  " }} />
        <script dangerouslySetInnerHTML={{ __html: "\n    window.__SB_URL = " + tojson(site.supabase_url) + ";\n    window.__SB_KEY = " + tojson(site.supabase_anon_key) + ";\n    window.__SB_CARTS = " + tojson(site.carts_table) + ";\n    window.__SB_PRICE_ALERTS = " + tojson(site.price_alerts_table) + ";\n    window.__SB_RPC_SUFFIX = " + tojson(site.rpc_suffix) + ";\n    // Varestatistik (Feature-panelet 'stats'): tæl visninger og søgninger.\n    window.__STATS_ON = " + (site.stats_enabled ? 'true' : 'false') + ";\n    // Swipe i kurven (Feature-panelet 'swipe').\n    window.__SWIPE_ON = " + (site.swipe_enabled ? 'true' : 'false') + ";\n    // Offentligt Google OAuth client-id (samme som i Supabase). Bruges af\n    // Google Identity Services (ID-token-flow), så samtykkeskærmen viser\n    // madshopper.dk i stedet for supabase.co-callback'en.\n    window.__GOOGLE_CLIENT_ID = \"683267660851-4jvo3nauv24s4g8sk5qhk1dlvuc4tjgr.apps.googleusercontent.com\";\n    // App-paritet (AuthContext.tsx signInApple) - webben mangler kun denne\n    // værdi og Apple-provideren i Supabase for at have samme login-mulighed\n    // som app'en. Sæt til Apple Developer-portalens Services ID (fx\n    // \"dk.madshopper.web\") for at aktivere - se auth.js::ensureAppleSdk,\n    // som holder knappen skjult indtil da. Intet Apple Developer-medlemskab\n    // findes pr. 2026-08-17.\n    window.__APPLE_CLIENT_ID = \"\";\n  " }} />
        <script src={staticUrl('js/supabase.min.js')} defer></script>
        <script src={staticUrl('js/script.js')} defer></script>
        <script src={staticUrl('js/auth.js')} defer></script>
      </head>
  )
}

export function Layout(props: LayoutProps) {
  const inShell = useContext(ShellContext)
  const body = <LayoutBody site={props.site} req={props.req}>{props.children}</LayoutBody>
  if (inShell) return body
  return (
    <html lang="da">
      <LayoutHead {...props} />
      <body>{body}</body>
    </html>
  )
}

function LayoutBody({ site, req, children }: { site: SiteContext; req: RequestInfo; children?: ReactNode }) {
  const mejeriLabel = site.mejeri_navn_enabled ? 'Køl & Mejeri' : 'Køl'
  const nav: Array<[string, string]> = [
    ['/ugens_tilbud', 'Ugens Tilbud'], ['/Kolonial', 'Kolonial'],
    ['/Mejeri', mejeriLabel], ['/Koed_og_fisk', 'Kød & Fisk'],
    ['/Frugt_og_groent', 'Frugt & grønt'], ['/Drikkevarer', 'Drikkevarer'],
    ['/Frost', 'Frost'], ['/Broed_og_kager', 'Brød & Kager'],
    ['/Slik', 'Slik'],
  ]
  return (
    <>
        <a href="#main-content" className="skip-link">Spring til indhold</a>
        <script dangerouslySetInnerHTML={{ __html: "\n    try {\n      // Samme lagringskontrakt som app'ens ThemeContext (AsyncStorage,\n      // NØJAGTIG samme nøgle og værdier): 'true' = mørk, 'false' = lys,\n      // NØGLEN HELT FRAVÆRENDE = følg systemet. Web behandlede tidligere\n      // \"fraværende\" som lys og havde derfor ikke app'ens tredje valg.\n      var _t = localStorage.getItem('madshopper_darkmode');\n      var _dark = _t === 'true'\n        || (_t === null && window.matchMedia\n            && window.matchMedia('(prefers-color-scheme: dark)').matches);\n      if (_dark) document.body.setAttribute('data-theme', 'dark');\n    } catch (e) { /* localStorage kan være spærret (privat browsing) */ }\n  " }} />
        <header>
          <div className="header-top">
            <a href={urlFor('home')} className="logo-link">
              <div className="logo-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="21" r="1" />
                  <circle cx="20" cy="21" r="1" />
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                </svg>
              </div>
              <span className="logo-text">MadShopper</span>
            </a>
            <div className="header-search">
              <span className="header-search-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <input type="text" id="searchInput" placeholder="Søg efter produkter..." autoComplete="off" aria-label="Søg efter produkter" role="combobox" aria-expanded="false" aria-controls="autocomplete-dropdown" aria-autocomplete="list" />
              <div id="autocomplete-dropdown" className="autocomplete-dropdown" role="listbox" aria-label="Søgeforslag"></div>
            </div>
            <div className="header-actions">
              <button className="auth-btn" id="auth-toggle-btn" aria-label="Log ind" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--gray-700)", padding: "8px" }} {...on({ onclick: "openAuthModal()" })}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </button>
              {site.recipes_enabled && (
              <a className="recipes-btn" href="/opskrifter" aria-label="Opskrifter" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--gray-700)", padding: "8px", display: "inline-flex", textDecoration: "none" }}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 7v14" />
                  <path d="M3 5a2 2 0 0 1 2-2h4a4 4 0 0 1 4 4 4 4 0 0 1 4-4h4a2 2 0 0 1 2 2v13a1 1 0 0 1-1 1h-5a3 3 0 0 0-3 3 3 3 0 0 0-3-3H4a1 1 0 0 1-1-1Z" />
                </svg>
              </a>
              )}
              <button className="settings-btn" id="settings-toggle-btn" aria-label="Åbn indstillinger" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--gray-700)", padding: "8px" }} {...on({ onclick: "toggleSettings()" })}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
              <button className="cart-btn" id="cart-toggle-btn" aria-label="Åbn indkøbskurv" {...on({ onclick: "toggleCart()" })}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="21" r="1" />
                  <circle cx="20" cy="21" r="1" />
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                </svg>
                <span id="cart-badge" data-testid="cart-badge">0</span>
              </button>
              <button className="hamburger-btn" aria-label="Menu" {...on({ onclick: "toggleMenu()" })}>
                <span></span>
                <span></span>
                <span></span>
              </button>
            </div>
          </div>
          <nav className="category-nav">
            <ul>
              <li>
                <a href={urlFor('home')} className={req.endpoint === 'home' ? 'active' : ''} {...(req.endpoint === 'home' ? { 'aria-current': 'page' as const } : {})}>Forside</a>
              </li>
              {nav.map(([path, label]) => {
                // Aktiv kategori markeres (også aria-current til skærmlæsere)
                const isActive = req.path === path
                return (
                  <li key={path}>
                    <a href={path} className={isActive ? 'active' : ''} {...(isActive ? { 'aria-current': 'page' as const } : {})}>{label}</a>
                  </li>
                )
              })}
            </ul>
          </nav>
        </header>
        <div id="mobile-filters-backdrop" className="mobile-filters-backdrop" aria-hidden="true"></div>
        <div id="menu-overlay" className="menu-overlay" {...on({ onclick: "toggleMenu()" })}></div>
        <nav id="nav-menu" className="nav-menu">
          <div className="nav-header">
            <a href={urlFor('home')} className="logo-link">
              <div className="logo-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="21" r="1" />
                  <circle cx="20" cy="21" r="1" />
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                </svg>
              </div>
              <span className="logo-text">MadShopper</span>
            </a>
            <button className="close-button" aria-label="Luk menu" {...on({ onclick: "toggleMenu()" })}>✕</button>
          </div>
          <div className="nav-search-wrap">
            <div style={{ position: "relative" }}>
              <span className="header-search-icon" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <input type="text" id="searchInputMobile" placeholder="Søg..." autoComplete="off" aria-label="Søg efter produkter" style={{ width: "100%", padding: "10px 16px 10px 40px", background: "var(--gray-100)", border: "2px solid transparent", borderRadius: "999px", fontFamily: "'Plus Jakarta Sans','Inter',sans-serif", fontSize: "0.9rem", outline: "none" }} {...on({ oninput: "document.getElementById('searchInput').value=this.value;", onkeydown: "if(event.key==='Enter'){document.getElementById('searchInput').value=this.value;closeAutocomplete();if(document.getElementById('nav-menu').classList.contains('active')){toggleMenu();}performSearch();this.blur();}" })} />
            </div>
          </div>
          <div className="nav-category-label">Kategorier</div>
          <div className="nav-category-grid">
            <a href={urlFor('home')} className="nav-category-btn">Forside</a>
            <a href="/ugens_tilbud" className="nav-category-btn">Ugens Tilbud</a>
            <a href="/Kolonial" className="nav-category-btn">Kolonial</a>
            <a href="/Mejeri" className="nav-category-btn">{mejeriLabel}</a>
            <a href="/Koed_og_fisk" className="nav-category-btn">{"Kød & Fisk"}</a>
            <a href="/Frugt_og_groent" className="nav-category-btn">{"Frugt & grønt"}</a>
            <a href="/Drikkevarer" className="nav-category-btn">Drikkevarer</a>
            <a href="/Frost" className="nav-category-btn">Frost</a>
            <a href="/Broed_og_kager" className="nav-category-btn">{"Brød & Kager"}</a>
            <a href="/Slik" className="nav-category-btn">Slik</a>
          </div>
        </nav>
        <div id="cart-overlay" {...on({ onclick: "toggleCart()" })}></div>
        <div id="cart-panel">
          <div className="cart-header">
            <div className="cart-header-left">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 01-8 0" />
              </svg>
              <h2 id="cart-panel-title">Din kurv</h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <button id="clear-cart-btn" className="clear-cart-btn" style={{ display: "none" }} aria-label="Tøm kurv" {...on({ onclick: "clearCart()" })}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                <span style={{ fontSize: "0.75rem", fontWeight: "600" }}>Tøm</span>
              </button>
              <button className="close-button" aria-label="Luk kurv" {...on({ onclick: "toggleCart()" })}>✕</button>
            </div>
          </div>
          <div className="cart-tabs">
            <button className="cart-tab active" id="tab-cart" {...on({ onclick: "switchCartTab('cart')" })}>Din kurv</button>
            <button className="cart-tab" id="tab-lists" {...on({ onclick: "switchCartTab('lists')" })}>
              <span id="tab-lists-label">Mine lister</span>
              <span className="cart-tab-badge" id="lists-count-badge" style={{ display: "none" }}></span>
            </button>
          </div>
          <div id="cart-tab-cart">
            <div id="shared-cart-banner" className="shared-cart-banner" style={{ display: "none" }}>
              <div className="shared-cart-banner-info">
                <strong id="shared-cart-banner-name">Delt kurv</strong>
                <span id="shared-cart-banner-meta">Live · 1 / 6</span>
                <span id="shared-cart-banner-members" className="shared-cart-banner-members"></span>
              </div>
              <div className="shared-cart-banner-actions">
                <button type="button" className="shared-cart-invite-btn" {...on({ onclick: "shareCurrentCart()" })}>Inviter</button>
                <button type="button" className="shared-cart-leave-btn" id="shared-cart-leave-btn" {...on({ onclick: "leaveSharedCart()" })}>Meld dig ud</button>
              </div>
            </div>
            <div className="cart-items"></div>
            <div className="cart-footer" id="cart-footer-section" style={{ display: "none" }}>
              <button className="cart-best-deal" id="cart-best-deal-btn" {...on({ onclick: "showReference()" })}>
                <div className="cart-best-deal-left">
                  <span className="cart-best-label">Billigste pris</span>
                  <span className="cart-best-savings" id="cart-best-savings-text">Beregner...</span>
                </div>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
              <button className="save-list-btn" id="save-list-btn" {...on({ onclick: "saveCurrentCartAsList()" })}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                {" Gem som liste "}
              </button>
              <button className="share-list-btn" id="share-list-btn" {...on({ onclick: "shareCurrentCart()" })}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                <span id="share-list-btn-label">Del kurv</span>
              </button>
            </div>
          </div>
          <div id="cart-tab-lists" style={{ display: "none" }}>
            <div id="saved-lists-container" className="saved-lists-container"></div>
          </div>
          <button className="clear-cart-btn" {...on({ onclick: "clearCart()" })}></button>
          <div className="cart-total">
            <p></p>
            <p id="cart-total-price">0 kr</p>
          </div>
          <button className="show-reference-btn" {...on({ onclick: "showReference()" })}>
            <span className="button-text">Vis henvisning</span>
            <div className="loading-spinner"></div>
          </button>
        </div>
        <div id="settings-overlay" {...on({ onclick: "toggleSettings()" })}></div>
        <div id="settings-panel">
          <div className="cart-header">
            <div className="cart-header-left">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <h2>Indstillinger</h2>
            </div>
            <button className="close-button" aria-label="Luk indstillinger" {...on({ onclick: "toggleSettings()" })}>✕</button>
          </div>
          <div className="settings-content">
            <div className="settings-section">
              <h3>Tema og Udseende</h3>
              <p className="settings-desc">Vælg hvordan MadShopper skal se ud.</p>
              <div className="theme-choice" role="radiogroup" aria-label="Tema">
                <button type="button" className="theme-option" data-theme-mode="system" role="radio" aria-checked="false" {...on({ onclick: "setThemeMode('system')" })}>Følg system</button>
                <button type="button" className="theme-option" data-theme-mode="light" role="radio" aria-checked="false" {...on({ onclick: "setThemeMode('light')" })}>Lys</button>
                <button type="button" className="theme-option" data-theme-mode="dark" role="radio" aria-checked="false" {...on({ onclick: "setThemeMode('dark')" })}>Mørk</button>
              </div>
            </div>
            <div className="settings-section">
              <h3>Standardbutikker</h3>
              <p className="settings-desc">Vælg hvilke butikker der automatisk vises, når du åbner appen.</p>
              <p className="settings-consent-warning" id="store-consent-warning" style={{ display: "none" }}>
                {" Dit valg gælder kun denne side, indtil du tillader funktionelle cookies. "}
                <button type="button" className="settings-consent-link" {...on({ onclick: "openCookiePreferences()" })}>Skift cookieindstillinger</button>
              </p>
              <div className="store-toggles">
                <label className="store-checkbox">
                  <input type="checkbox" defaultValue="Rema 1000" defaultChecked {...on({ onchange: "saveStoreDefaults()" })} />
                  <span>Rema 1000</span>
                </label>
                <label className="store-checkbox">
                  <input type="checkbox" defaultValue="Bilka" defaultChecked {...on({ onchange: "saveStoreDefaults()" })} />
                  <span>Bilka</span>
                </label>
                <label className="store-checkbox">
                  <input type="checkbox" defaultValue="Netto" defaultChecked {...on({ onchange: "saveStoreDefaults()" })} />
                  <span>Netto</span>
                </label>
                <label className="store-checkbox">
                  <input type="checkbox" defaultValue="Føtex" defaultChecked {...on({ onchange: "saveStoreDefaults()" })} />
                  <span>Føtex</span>
                </label>
                <label className="store-checkbox">
                  <input type="checkbox" defaultValue="Meny" defaultChecked {...on({ onchange: "saveStoreDefaults()" })} />
                  <span>Meny</span>
                </label>
                <label className="store-checkbox">
                  <input type="checkbox" defaultValue="Spar" defaultChecked {...on({ onchange: "saveStoreDefaults()" })} />
                  <span>Spar</span>
                </label>
                <label className="store-checkbox">
                  <input type="checkbox" defaultValue="Min Købmand" defaultChecked {...on({ onchange: "saveStoreDefaults()" })} />
                  <span>Min Købmand</span>
                </label>
                <label className="store-checkbox">
                  <input type="checkbox" defaultValue="SuperBrugsen" defaultChecked {...on({ onchange: "saveStoreDefaults()" })} />
                  <span>SuperBrugsen</span>
                </label>
                <label className="store-checkbox">
                  <input type="checkbox" defaultValue="Brugsen" defaultChecked {...on({ onchange: "saveStoreDefaults()" })} />
                  <span>Brugsen</span>
                </label>
                <label className="store-checkbox">
                  <input type="checkbox" defaultValue="Kvickly" defaultChecked {...on({ onchange: "saveStoreDefaults()" })} />
                  <span>Kvickly</span>
                </label>
                <label className="store-checkbox">
                  <input type="checkbox" defaultValue="365 Discount" defaultChecked {...on({ onchange: "saveStoreDefaults()" })} />
                  <span>365 Discount</span>
                </label>
                <label className="store-checkbox">
                  <input type="checkbox" defaultValue="Lidl" defaultChecked {...on({ onchange: "saveStoreDefaults()" })} />
                  <span>Lidl</span>
                </label>
                <label className="store-checkbox">
                  <input type="checkbox" defaultValue="Løvbjerg" defaultChecked {...on({ onchange: "saveStoreDefaults()" })} />
                  <span>Løvbjerg</span>
                </label>
                <label className="store-checkbox">
                  <input type="checkbox" defaultValue="ABC Lavpris" defaultChecked {...on({ onchange: "saveStoreDefaults()" })} />
                  <span>ABC Lavpris</span>
                </label>
              </div>
            </div>
          </div>
        </div>
        <div id="overlay" {...on({ onclick: "handleOverlayClick(event)" })}>
          <div className="overlay-content" {...on({ onclick: "event.stopPropagation()" })}>
            <button className="overlay-close-btn" {...on({ onclick: "closeOverlay()" })}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <div className="overlay-body">
              <div className="overlay-left">
                <img id="overlay-image" {...raw({ src: '' })} alt="" className="overlay-img" {...on({ onclick: "openImageZoom(this.src)" })} />
                <div id="overlay-brand-name" className="overlay-brand"></div>
                <div id="overlay-title" className="overlay-title"></div>
                <div id="overlay-description" className="overlay-description"></div>
                <p className="sale-end-date" id="overlay-sale-end-date" style={{ display: "none", marginTop: "8px" }}></p>
                <div id="overlay-price-value" style={{ marginTop: "8px" }}></div>
                <div className="price-alert-box">
                  <button type="button" className="alert-toggle-btn" id="price-alert-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                    {" Overvåg pris "}
                  </button>
                  <p id="price-alert-msg" className="price-alert-msg" role="status" aria-live="polite" style={{ display: "none" }}></p>
                  {site.push_enabled && (
                  <div id="price-alert-push" className="price-alert-push" role="dialog" aria-labelledby="price-alert-push-title" style={{ display: "none" }}>
                    <p id="price-alert-push-title" className="price-alert-push-title">Notifikationer er slået fra</p>
                    <p id="price-alert-push-text"></p>
                    <div className="price-alert-push-actions">
                      <button type="button" id="price-alert-push-btn" className="price-alert-push-btn">Slå notifikationer til</button>
                      <button type="button" className="price-alert-push-close" {...on({ onclick: "hidePushNotice()" })}>Ikke nu</button>
                    </div>
                  </div>
                  )}
                  <div id="alert-form" className="alert-form" style={{ display: "none" }}>
                    <p>
                      {`Giv mig besked ${site.push_enabled ? '' : 'på mail '}når prisen falder til:`}
                    </p>
                    <div className="alert-input-group">
                      <input type="number" id="target-price-input" placeholder="Eks. 40" step="0.5" />
                      <button type="button" id="price-alert-submit-btn" {...on({ onclick: "savePriceAlert()" })}>Sæt alarm</button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="overlay-right" id="overlay-right-panel">
                <div className="comp-label">Prissammenligning</div>
                <div id="overlay-store-only-msg"></div>
                <div id="overlay-comparison" style={{ display: "none" }}>
                  <div id="comp-cards-container">
                    <div id="comp-card-rema" className="comp-card">
                      <div className="comp-header">
                        <span className="comp-store">Rema 1000</span>
                        <span id="comp-badge-rema" className="comp-badge">Billigst</span>
                      </div>
                      <div id="comp-rema-price" className="comp-price">0.00 kr</div>
                      <div id="comp-rema-kg-price" className="comp-kg-price"></div>
                      <div id="comp-rema-multideal" className="comp-multideal"></div>
                    </div>
                    <div id="comp-card-bilka" className="comp-card">
                      <div className="comp-header">
                        <span className="comp-store">Bilka</span>
                        <span id="comp-badge-bilka" className="comp-badge"></span>
                      </div>
                      <div id="comp-bilka-price" className="comp-price">0.00 kr</div>
                      <div id="comp-bilka-kg-price" className="comp-kg-price"></div>
                      <div id="comp-bilka-multideal" className="comp-multideal"></div>
                    </div>
                    <div id="comp-card-foetex" className="comp-card">
                      <div className="comp-header">
                        <span className="comp-store">Føtex</span>
                        <span id="comp-badge-foetex" className="comp-badge"></span>
                      </div>
                      <div id="comp-foetex-price" className="comp-price">0.00 kr</div>
                      <div id="comp-foetex-kg-price" className="comp-kg-price"></div>
                      <div id="comp-foetex-multideal" className="comp-multideal"></div>
                    </div>
                    <div id="comp-card-netto" className="comp-card">
                      <div className="comp-header">
                        <span className="comp-store">Netto</span>
                        <span id="comp-badge-netto" className="comp-badge"></span>
                      </div>
                      <div id="comp-netto-price" className="comp-price">0.00 kr</div>
                      <div id="comp-netto-kg-price" className="comp-kg-price"></div>
                      <div id="comp-netto-multideal" className="comp-multideal"></div>
                    </div>
                    <div id="comp-card-minkobmand" className="comp-card">
                      <div className="comp-header">
                        <span className="comp-store">Min Købmand</span>
                        <span id="comp-badge-minkobmand" className="comp-badge"></span>
                      </div>
                      <div id="comp-mk-price" className="comp-price">0.00 kr</div>
                      <div id="comp-mk-kg-price" className="comp-kg-price"></div>
                      <div id="comp-mk-multideal" className="comp-multideal"></div>
                    </div>
                    <div id="comp-card-meny" className="comp-card">
                      <div className="comp-header">
                        <span className="comp-store">Meny</span>
                        <span id="comp-badge-meny" className="comp-badge"></span>
                      </div>
                      <div id="comp-meny-price" className="comp-price">0.00 kr</div>
                      <div id="comp-meny-kg-price" className="comp-kg-price"></div>
                      <div id="comp-meny-multideal" className="comp-multideal"></div>
                    </div>
                    <div id="comp-card-spar" className="comp-card">
                      <div className="comp-header">
                        <span className="comp-store">Spar</span>
                        <span id="comp-badge-spar" className="comp-badge"></span>
                      </div>
                      <div id="comp-spar-price" className="comp-price">0.00 kr</div>
                      <div id="comp-spar-kg-price" className="comp-kg-price"></div>
                      <div id="comp-spar-multideal" className="comp-multideal"></div>
                    </div>
                    <div id="comp-card-sb" className="comp-card">
                      <div className="comp-header">
                        <span className="comp-store">SuperBrugsen</span>
                        <span id="comp-badge-sb" className="comp-badge"></span>
                      </div>
                      <div id="comp-sb-price" className="comp-price">0.00 kr</div>
                      <div id="comp-sb-kg-price" className="comp-kg-price"></div>
                      <div id="comp-sb-multideal" className="comp-multideal"></div>
                    </div>
                    <div id="comp-card-brugsen" className="comp-card">
                      <div className="comp-header">
                        <span className="comp-store">Brugsen</span>
                        <span id="comp-badge-brugsen" className="comp-badge"></span>
                      </div>
                      <div id="comp-brugsen-price" className="comp-price">0.00 kr</div>
                      <div id="comp-brugsen-kg-price" className="comp-kg-price"></div>
                      <div id="comp-brugsen-multideal" className="comp-multideal"></div>
                    </div>
                    <div id="comp-card-kvickly" className="comp-card">
                      <div className="comp-header">
                        <span className="comp-store">Kvickly</span>
                        <span id="comp-badge-kvickly" className="comp-badge"></span>
                      </div>
                      <div id="comp-kvickly-price" className="comp-price">0.00 kr</div>
                      <div id="comp-kvickly-kg-price" className="comp-kg-price"></div>
                      <div id="comp-kvickly-multideal" className="comp-multideal"></div>
                    </div>
                    <div id="comp-card-discount365" className="comp-card">
                      <div className="comp-header">
                        <span className="comp-store">365 Discount</span>
                        <span id="comp-badge-discount365" className="comp-badge"></span>
                      </div>
                      <div id="comp-discount365-price" className="comp-price">0.00 kr</div>
                      <div id="comp-discount365-kg-price" className="comp-kg-price"></div>
                      <div id="comp-discount365-multideal" className="comp-multideal"></div>
                    </div>
                    <div id="comp-card-lidl" className="comp-card">
                      <div className="comp-header">
                        <span className="comp-store">Lidl</span>
                        <span id="comp-badge-lidl" className="comp-badge"></span>
                      </div>
                      <div id="comp-lidl-price" className="comp-price">0.00 kr</div>
                      <div id="comp-lidl-kg-price" className="comp-kg-price"></div>
                      <div id="comp-lidl-multideal" className="comp-multideal"></div>
                    </div>
                    <div id="comp-card-loevbjerg" className="comp-card">
                      <div className="comp-header">
                        <span className="comp-store">Løvbjerg</span>
                        <span id="comp-badge-loevbjerg" className="comp-badge"></span>
                      </div>
                      <div id="comp-loevbjerg-price" className="comp-price">0.00 kr</div>
                      <div id="comp-loevbjerg-kg-price" className="comp-kg-price"></div>
                      <div id="comp-loevbjerg-multideal" className="comp-multideal"></div>
                    </div>
                    <div id="comp-card-abclavpris" className="comp-card">
                      <div className="comp-header">
                        <span className="comp-store">ABC Lavpris</span>
                        <span id="comp-badge-abclavpris" className="comp-badge"></span>
                      </div>
                      <div id="comp-abclavpris-price" className="comp-price">0.00 kr</div>
                      <div id="comp-abclavpris-kg-price" className="comp-kg-price"></div>
                      <div id="comp-abclavpris-multideal" className="comp-multideal"></div>
                    </div>
                  </div>
                </div>
                <div className="overlay-actions">
                  <div className="quantity-controls">
                    <button className="quantity-btn" aria-label="Færre" {...on({ onclick: "updateOverlayQuantity(-1)" })}>-</button>
                    <span className="quantity">1</span>
                    <button className="quantity-btn" aria-label="Flere" {...on({ onclick: "updateOverlayQuantity(1)" })}>+</button>
                  </div>
                  <button className="overlay-add-btn" id="generic-add-to-cart-btn" {...on({ onclick: "addToCartFromOverlay(event)" })}>Tilføj til kurv</button>
                </div>
              </div>
            </div>
            <div className="overlay-history-section">
              <div className="history-header">
                <div className="history-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                    <polyline points="17 6 23 6 23 12" />
                  </svg>
                  {" Prishistorik (30 dage) "}
                </div>
                <div id="price-insight-badge" className="price-insight-badge">Prishistorik</div>
              </div>
              <div className="chart-container">
                <canvas id="priceHistoryChart"></canvas>
              </div>
              <div className="history-footer">
                <span id="history-summary">Henter prishistorik…</span>
              </div>
            </div>
            <div className="overlay-nutrition-section" id="overlay-nutrition-section" style={{ display: "none" }}>
              <div className="history-header">
                <div className="history-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
                    <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
                    <line x1="6" y1="1" x2="6" y2="4" />
                    <line x1="10" y1="1" x2="10" y2="4" />
                    <line x1="14" y1="1" x2="14" y2="4" />
                  </svg>
                  {" Næringsindhold "}
                </div>
                <div id="nutrition-per-badge" className="price-insight-badge">pr. 100 g</div>
              </div>
              <table className="nutrition-table" id="nutrition-table"></table>
              <div className="nutrition-ingredients" id="nutrition-ingredients" style={{ display: "none" }}></div>
              <div className="nutrition-empty" id="nutrition-empty" style={{ display: "none" }}>Vi har endnu ikke næringsindhold på denne vare.</div>
              <div className="nutrition-source" id="nutrition-source"></div>
            </div>
            <div className="product-info" style={{ display: "none" }} data-product-id=""></div>
          </div>
        </div>
        <div id="store-comparison-overlay" style={{ display: "none" }}>
          <div className="sco-backdrop" {...on({ onclick: "closeStoreComparison()" })}></div>
          <div className="sco-modal" role="dialog" aria-modal="true" aria-labelledby="sco-title">
            <div className="sco-head">
              <span className="sco-title" id="sco-title">Sammenlign priser</span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button className="sco-group-store-btn sco-butiksrute-head-btn" aria-label="Billigste butikker" {...on({ onclick: "showButiksrute()" })}>
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="5" cy="12" r="1.5" />
                    <circle cx="19" cy="6" r="1.5" />
                    <circle cx="19" cy="18" r="1.5" />
                    <line x1="6.5" y1="11.3" x2="17.5" y2="6.7" />
                    <line x1="6.5" y1="12.7" x2="17.5" y2="17.3" />
                  </svg>
                  <span>Billigste butikker</span>
                </button>
                <button className="sco-close" aria-label="Luk" {...on({ onclick: "closeStoreComparison()" })}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="sco-store-row" id="sco-store-row"></div>
            <div className="sco-item-list" id="sco-item-list"></div>
            <div id="comparison-summary" style={{ display: "none" }}></div>
          </div>
        </div>
        <div id="butiksrute-overlay" style={{ display: "none", position: "fixed", inset: "0", zIndex: "1100", alignItems: "flex-end", justifyContent: "center" }}>
          <div className="sco-backdrop" {...on({ onclick: "closeButiksrute()" })}></div>
          <div className="sco-modal" role="dialog" aria-modal="true" aria-labelledby="br-title" style={{ display: "flex", flexDirection: "column" }}>
            <div className="sco-head">
              <span className="sco-title" id="br-title">Billigste butikker</span>
              <button className="sco-close" aria-label="Luk" {...on({ onclick: "closeButiksrute()" })}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div id="br-summary" className="br-summary"></div>
            <div id="br-stores" className="br-stores"></div>
          </div>
        </div>
        <div id="share-list-modal" className="share-list-overlay" style={{ display: "none" }} {...on({ onclick: "closeShareListModal(event)" })}>
          <div className="share-list-content" role="dialog" aria-modal="true" aria-labelledby="share-list-title" {...on({ onclick: "event.stopPropagation()" })}>
            <button className="share-list-close" aria-label="Luk" {...on({ onclick: "closeShareListModal()" })}>×</button>
            <h3 id="share-list-title">Inviter til gruppen</h3>
            <p id="share-list-subtitle">Send linket. Alle i gruppen er lige — I deler én live kurv (max 6).</p>
            <div className="share-list-url-row">
              <input type="text" id="share-list-url" readOnly />
              <button type="button" className="share-list-copy-btn" {...on({ onclick: "copyShareListUrl()" })}>Kopiér</button>
            </div>
            <p className="share-list-meta" id="share-list-meta"></p>
            <button type="button" className="share-list-ok" {...on({ onclick: "closeShareListModal()" })}>Færdig</button>
          </div>
        </div>
        <div id="claim-list-modal" className="share-list-overlay" style={{ display: "none" }} {...on({ onclick: "closeClaimListModal(event)" })}>
          <div className="share-list-content" role="dialog" aria-modal="true" aria-labelledby="claim-list-title" {...on({ onclick: "event.stopPropagation()" })}>
            <button className="share-list-close" aria-label="Luk" {...on({ onclick: "closeClaimListModal()" })}>×</button>
            <h3 id="claim-list-title">Tilslut gruppe</h3>
            <p id="claim-list-subtitle">Du bliver en del af den delte live-kurv, indtil du melder dig ud.</p>
            <p className="share-list-meta" id="claim-list-meta"></p>
            <div className="share-list-actions" id="claim-list-actions">
              <button type="button" className="share-list-ok" id="claim-list-confirm-btn" {...on({ onclick: "confirmJoinSharedCart()" })}>Tilslut gruppen</button>
              <button type="button" className="share-list-secondary" {...on({ onclick: "closeClaimListModal()" })}>Annuller</button>
            </div>
            <p className="share-list-error" id="claim-list-error" style={{ display: "none" }}></p>
          </div>
        </div>
        <main id="main-content">
          <div id="searchResults">
            <div className="container-search">
              <div className="search-results-header">
                <h2 className="search-title">Søgeresultater</h2>
                <a href={urlFor('home')} className="reset-filters-btn">✕ Nulstil</a>
              </div>
              <div className="filters-wrapper">
                <div className="advanced-filters-container">
                  <FiltersToggleBtn />
                  <Filters scope="search" />
                </div>
              </div>
              <div id="searchProductsWrapper"></div>
            </div>
          </div>
          {children}
        </main>
        <footer>
          <div className="footer-inner">
            <div className="footer-brand">
              <div className="logo-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="21" r="1" />
                  <circle cx="20" cy="21" r="1" />
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                </svg>
              </div>
              <span className="footer-brand-name">MadShopper</span>
            </div>
            <nav className="footer-links" aria-label="Footer navigation">
              <a href={urlFor('terms_of_service')}>Vilkår og betingelser</a>
              <a href={urlFor('privacy_policy')}>Privatlivspolitik</a>
              <a href={urlFor('about')}>Om os</a>
              <a href={urlFor('feedback_page')}>Feedback</a>
              <button type="button" className="footer-link-btn" {...on({ onclick: "openCookiePreferences()" })}>Cookie-indstillinger</button>
            </nav>
            <a className="footer-appstore" href="https://apps.apple.com/app/id6812713857" target="_blank" rel="noopener" aria-label="Hent MadShopper i App Store">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
              </svg>
              <span className="footer-appstore-text">
                <span className="footer-appstore-small">Hent i</span>
                <span className="footer-appstore-big">App Store</span>
              </span>
            </a>
            <div className="footer-bottom">
              <p>© 2026 MadShopper - Dansk prissammenligning for dagligvarer.</p>
            </div>
          </div>
        </footer>
        <div id="image-zoom-overlay" {...on({ onclick: "closeImageZoom()" })}>
          <div className="zoom-content" {...on({ onclick: "event.stopPropagation()" })}>
            <button className="zoom-close-btn" {...on({ onclick: "closeImageZoom()" })}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <img id="zoomed-image" {...raw({ src: '' })} alt="Forstørret billede" />
          </div>
        </div>
        <AuthModal site={site} />
    </>
  )
}
