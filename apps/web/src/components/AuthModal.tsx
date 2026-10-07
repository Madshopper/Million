// Port af templates/partials/auth_modal.html (login-/konto-modalen; styres af static/js/auth.js).
import { urlFor, type SiteContext } from './context'
import { on } from './jinja'

export function AuthModal({ site }: { site: SiteContext }) {
  return (
    <>
      <div id="auth-overlay" className="auth-overlay" {...on({ onclick: "closeAuthModal()" })}></div>
      <div id="auth-modal" className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" aria-hidden="true">
        <button className="auth-close" aria-label="Luk" {...on({ onclick: "closeAuthModal()" })}>✕</button>
        <div id="auth-view-login">
          <h2 id="auth-title">Log ind</h2>
          <p className="auth-sub">Gem din kurv og få den frem på alle dine enheder.</p>
          <div id="gsi-button" className="gsi-button"></div>
          <button type="button" className="auth-google-btn" id="auth-google-fallback" style={{ display: "none" }} {...on({ onclick: "authGoogle()" })}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="#4285F4" d="M23.06 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h6.19a5.3 5.3 0 0 1-2.29 3.48v2.89h3.7c2.17-2 3.46-4.94 3.46-8.38z" />
              <path fill="#34A853" d="M12 24c3.1 0 5.7-1.03 7.6-2.79l-3.7-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.54-2.03-6.45-4.75H1.72v2.98A11.99 11.99 0 0 0 12 24z" />
              <path fill="#FBBC05" d="M5.55 14.67a7.2 7.2 0 0 1 0-4.6V7.09H1.72a12 12 0 0 0 0 10.56l3.83-2.98z" />
              <path fill="#EA4335" d="M12 5.38c1.69 0 3.2.58 4.4 1.72l3.28-3.28C17.7 1.98 15.1.94 12 .94A11.99 11.99 0 0 0 1.72 7.09l3.83 2.98C6.46 7.41 9 5.38 12 5.38z" />
            </svg>
            {" Fortsæt med Google "}
          </button>
          <button type="button" className="auth-apple-btn" id="auth-apple-btn" style={{ display: "none" }} {...on({ onclick: "authApple()" })}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="#fff">
              <path d="M16.365 1.43c0 1.14-.462 2.109-1.386 2.906-.923.797-1.985 1.259-3.184 1.386-.077-1.117.365-2.147 1.326-3.09.98-.943 2.06-1.443 3.244-1.5v.298Zm3.522 16.44c-.462 1.02-1.02 1.983-1.673 2.891-.923 1.309-1.798 2.284-2.622 2.925-.827.634-1.673.972-2.538.972-.634 0-1.463-.187-2.487-.56-.923-.35-1.673-.523-2.25-.523-.577 0-1.365.173-2.362.523-1 .373-1.827.56-2.487.56-.827 0-1.653-.336-2.48-1.01-.827-.634-1.673-1.598-2.538-2.891-1.02-1.545-1.674-3.19-1.962-4.933-.28-1.77-.14-3.402.42-4.895.42-1.107 1.056-1.983 1.909-2.63.85-.65 1.797-.98 2.842-.99.634 0 1.44.196 2.42.588.976.392 1.6.588 1.868.588.28 0 .952-.226 2.017-.678 1.02-.42 1.884-.588 2.59-.502 1.928.15 3.373.867 4.336 2.148-1.723 1.033-2.577 2.476-2.557 4.334.017 1.446.539 2.65 1.567 3.61.463.44.986.783 1.567 1.028-.126.373-.257.727-.42 1.058Z" />
            </svg>
            {" Fortsæt med Apple "}
          </button>
          <div className="auth-divider">
            <span>eller</span>
          </div>
          <form id="auth-form" noValidate {...on({ onsubmit: "return authSubmit(event)" })}>
            <label className="auth-field">
              <span>Email</span>
              <input type="email" id="auth-email" autoComplete="email" required maxLength={254} placeholder="dig@eksempel.dk" />
            </label>
            <label className="auth-field">
              <span>Adgangskode</span>
              <input type="password" id="auth-password" autoComplete="current-password" required minLength={8} maxLength={72} placeholder="Mindst 8 tegn" />
            </label>
            <label className="auth-field" id="auth-name-row" style={{ display: "none" }}>
              <span>Dit navn</span>
              <input type="text" id="auth-name" autoComplete="nickname" maxLength={40} placeholder="fx Kasper" />
              <span className="auth-hint">Vises når I deler kurv, så andre kan se hvem der er med</span>
            </label>
            <div className="auth-field" id="auth-turnstile-row" style={{ display: "none" }}>
              <div id="auth-turnstile-widget" className="cf-turnstile" data-sitekey="0x4AAAAAAD_TUldIm22rh6Lz" data-action="turnstile-spin-v1"></div>
            </div>
            <p id="auth-error" className="auth-error" role="alert" style={{ display: "none" }}></p>
            <button type="submit" className="auth-submit" id="auth-submit-btn">Log ind</button>
          </form>
          <p className="auth-forgot" id="auth-forgot-row">
            <button type="button" className="auth-link" {...on({ onclick: "authShowReset()" })}>Glemt adgangskode?</button>
          </p>
          <p className="auth-switch">
            <span id="auth-switch-text">Ny bruger?</span>
            <button type="button" className="auth-link" id="auth-switch-btn" {...on({ onclick: "authToggleMode()" })}>Opret konto</button>
          </p>
          <p className="auth-legal">
            {" Ved at oprette en konto accepterer du vores "}
            <a href={urlFor('terms_of_service')}>vilkår</a>
            {" og "}
            <a href={urlFor('privacy_policy')}>privatlivspolitik</a>
            {". Vi gemmer kun din email, dit valgte navn og din kurv. "}
          </p>
        </div>
        <div id="auth-view-account" style={{ display: "none" }}>
          <h2 id="auth-account-title">Din konto</h2>
          <p className="auth-account-email" id="auth-account-email"></p>
          <p className="auth-sub">Din kurv gemmes automatisk, når du er logget ind.</p>
          <label className="auth-field">
            <span>Dit navn i delte kurve</span>
            <input type="text" id="auth-account-name" autoComplete="nickname" maxLength={40} placeholder="fx Kasper" />
          </label>
          <p id="auth-name-msg" className="auth-error" role="status" style={{ display: "none" }}></p>
          <button type="button" className="auth-submit" {...on({ onclick: "authSaveDisplayName()" })}>Gem navn</button>
          <section id="auth-alerts" className="auth-alerts">
            <h3 className="auth-alerts-title">Mine prisalarmer</h3>
            <p id="auth-alerts-empty" className="auth-sub" style={{ display: "none" }}>Du har ingen aktive prisalarmer. Åbn en vare og tryk “Overvåg pris”.</p>
            <ul id="auth-alerts-list" className="auth-alerts-list"></ul>
            <p id="auth-alerts-msg" className="auth-error" role="status" style={{ display: "none" }}></p>
            {site.push_enabled && (
            <div id="auth-push" className="auth-push" data-vapid={site.vapid_public_key} data-sw={urlFor('static', { filename: 'sw.js' })}>
              <p id="auth-push-status" className="auth-sub">Slå beskeder til for at få besked, når prisen falder.</p>
              <button type="button" id="auth-push-btn" className="auth-submit auth-submit-secondary" style={{ display: "none" }} {...on({ onclick: "authTogglePush()" })}>Få besked på telefonen</button>
              <p id="auth-push-msg" className="auth-error" role="status" style={{ display: "none" }}></p>
            </div>
            )}
          </section>
          <button type="button" className="auth-submit auth-submit-secondary" {...on({ onclick: "authLogout()" })}>Log ud</button>
          <button type="button" className="auth-danger" {...on({ onclick: "authDeleteAccount()" })}>Slet min konto</button>
        </div>
        <div id="auth-view-reset" style={{ display: "none" }}>
          <h2 id="auth-reset-title">Nulstil adgangskode</h2>
          <p className="auth-sub">Skriv din email, så sender vi et link til at vælge en ny adgangskode.</p>
          <form id="auth-reset-form" noValidate {...on({ onsubmit: "return authRequestReset(event)" })}>
            <label className="auth-field">
              <span>Email</span>
              <input type="email" id="auth-reset-email" autoComplete="email" required maxLength={254} placeholder="dig@eksempel.dk" />
            </label>
            <p id="auth-reset-msg" className="auth-error" role="alert" style={{ display: "none" }}></p>
            <button type="submit" className="auth-submit" id="auth-reset-btn">Send nulstillingslink</button>
          </form>
          <p className="auth-switch">
            <button type="button" className="auth-link" {...on({ onclick: "authShowLogin()" })}>Tilbage til log ind</button>
          </p>
        </div>
        <div id="auth-view-newpassword" style={{ display: "none" }}>
          <h2 id="auth-newpassword-title">Vælg ny adgangskode</h2>
          <p className="auth-sub">Indtast din nye adgangskode nedenfor.</p>
          <form id="auth-newpw-form" noValidate {...on({ onsubmit: "return authSubmitNewPassword(event)" })}>
            <label className="auth-field">
              <span>Ny adgangskode</span>
              <input type="password" id="auth-newpw" autoComplete="new-password" required minLength={8} maxLength={72} placeholder="Mindst 8 tegn" />
            </label>
            <p id="auth-newpw-msg" className="auth-error" role="alert" style={{ display: "none" }}></p>
            <button type="submit" className="auth-submit" id="auth-newpw-btn">Gem ny adgangskode</button>
          </form>
        </div>
      </div>
    </>
  )
}
