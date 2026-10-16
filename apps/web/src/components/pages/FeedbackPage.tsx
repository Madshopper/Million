// Port af templates/feedback.html.
import type { RequestInfo, SiteContext } from '../context'
import { urlFor } from '../context'
import { Layout } from '../Layout'

export interface FeedbackPageProps {
  site: SiteContext
  req: RequestInfo
}

export function FeedbackPage({ site, req }: FeedbackPageProps) {
  return (
    <Layout site={site} req={req} title={'Feedback - MadShopper'}>
      <div className="page-wrap">
        <article className="static-page">
          <h1>Feedback</h1>
          <p className="static-page-lead">Fortæl os hvad du synes, rapporter en fejl, eller kom med forslag til forbedringer.</p>
          <form id="feedback-form" className="feedback-form" noValidate>
            <div className="feedback-field">
              <label htmlFor="feedback-type">Type</label>
              <select id="feedback-type" name="type" required>
                <option value="feedback">Generel feedback</option>
                <option value="bug">Rapportér fejl</option>
                <option value="feature">Forslag til funktion</option>
                <option value="other">Andet</option>
              </select>
            </div>
            <div className="feedback-row">
              <div className="feedback-field">
                <label htmlFor="feedback-name">
                  {"Navn "}
                  <span className="optional">(valgfrit)</span>
                </label>
                <input type="text" id="feedback-name" name="name" maxLength={120} autoComplete="name" placeholder="Dit navn" />
              </div>
              <div className="feedback-field">
                <label htmlFor="feedback-email">
                  {"E-mail "}
                  <span className="optional">(valgfrit)</span>
                </label>
                <input type="email" id="feedback-email" name="email" maxLength={254} autoComplete="email" placeholder="din@email.dk" />
              </div>
            </div>
            <div className="feedback-field">
              <label htmlFor="feedback-subject">
                {"Emne "}
                <span className="optional">(valgfrit)</span>
              </label>
              <input type="text" id="feedback-subject" name="subject" maxLength={200} placeholder="Kort beskrivelse" />
            </div>
            <div className="feedback-field">
              <label htmlFor="feedback-message">
                {"Besked "}
                <span className="required">*</span>
              </label>
              <textarea id="feedback-message" name="message" rows={6} required minLength={10} maxLength={500} placeholder="Beskriv din feedback, fejlen du oplevede, eller hvad vi kan gøre bedre…"></textarea>
            </div>
            <div id="feedback-turnstile-widget" className="cf-turnstile" data-sitekey="0x4AAAAAAD_TUldIm22rh6Lz" data-action="turnstile-spin-v1"></div>
            <p className="feedback-consent">
              {" Ved at sende beskeden accepterer du, at vi behandler det du skriver (og evt. navn/e-mail) for at kunne svare dig, som beskrevet i "}
              <a href={urlFor('privacy_policy')}>privatlivspolitikken</a>
              {". "}
            </p>
            <p id="feedback-status" className="feedback-status" role="status" aria-live="polite"></p>
            <button type="submit" className="feedback-submit" id="feedback-submit-btn">Send besked</button>
          </form>
        </article>
      </div>
      <script dangerouslySetInnerHTML={{ __html: "\n(function () {\n  const form = document.getElementById('feedback-form');\n  const statusEl = document.getElementById('feedback-status');\n  const submitBtn = document.getElementById('feedback-submit-btn');\n\n  /** Fjerner query-streng og fragment fra en URL - se page_url nedenfor. */\n  function stripQueryAndFragment(url) {\n    try {\n      const u = new URL(url, window.location.origin);\n      return u.origin + u.pathname;\n    } catch (e) {\n      return '';\n    }\n  }\n\n  // Turnstile-scriptet er ikke længere et ubetinget <script> i base.html\n  // (compliance-audit 19-08-2026, GDPR-002) - denne side bruger widget'en fra\n  // første visning, så den loades her med det samme. Samme hjælper som\n  // auth.js's login/signup-modal bruger (idempotent, se static/js/auth.js).\n  // auth.js er 'defer' og har derfor IKKE nødvendigvis kørt endnu, når dette\n  // inline-script rammes af parseren - vent til DOMContentLoaded, som altid\n  // fyrer efter alle defer-scripts er kørt.\n  document.addEventListener('DOMContentLoaded', function () {\n    if (typeof window.__ensureTurnstileScript === 'function') {\n      window.__ensureTurnstileScript();\n    }\n  });\n\n  // Se auth.js: et bart element-id faar turnstile.getResponse()/reset() til at\n  // kaste, fordi strengen laeses som tag-selector. Widget'en rendres implicit\n  // via klassen cf-turnstile, saa vi laeser det skjulte input og bruger\n  // getResponse med rigtig selector som reserve - begge indpakket, saa et kast\n  // i finally ikke efterlader knappen laast paa \"Sender…\".\n  function turnstileToken(containerId) {\n    const input = document.querySelector('#' + containerId + ' [name=\"cf-turnstile-response\"]');\n    if (input && input.value) return input.value;\n    try {\n      if (typeof turnstile !== 'undefined' && turnstile.getResponse) {\n        return turnstile.getResponse('#' + containerId) || '';\n      }\n    } catch (err) {\n      console.warn('[feedback] Turnstile getResponse fejlede:', err);\n    }\n    return '';\n  }\n\n  function turnstileReset(containerId) {\n    try {\n      if (typeof turnstile !== 'undefined' && turnstile.reset) {\n        turnstile.reset('#' + containerId);\n      }\n    } catch (err) {\n      console.warn('[feedback] Turnstile reset fejlede:', err);\n    }\n  }\n\n  form.addEventListener('submit', async function (e) {\n    e.preventDefault();\n    statusEl.textContent = '';\n    statusEl.className = 'feedback-status';\n\n    const message = document.getElementById('feedback-message').value.trim();\n    if (message.length < 10) {\n      statusEl.textContent = 'Beskeden skal være mindst 10 tegn.';\n      statusEl.classList.add('error');\n      return;\n    }\n\n    submitBtn.disabled = true;\n    submitBtn.textContent = 'Sender…';\n\n    try {\n      // Turnstile: bot-tjek før beskeden overhovedet sendes til /api/feedback.\n      const tsToken = turnstileToken('feedback-turnstile-widget');\n      if (!tsToken) {\n        statusEl.textContent = 'Bekræft venligst at du ikke er en robot.';\n        statusEl.classList.add('error');\n        return;\n      }\n      // verify.madshopper.dk: custom domain sat op 24-08-2026, erstatter\n      // turnstile-siteverify-madshopper.kasp478g.workers.dev (eksponerede\n      // et privat kontoalias, compliance-audit GDPR-028).\n      const verifyRes = await fetch('https://verify.madshopper.dk', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ token: tsToken }),\n      });\n      const verifyData = await verifyRes.json().catch(function () { return null; });\n      if (!verifyData || !verifyData.success) {\n        statusEl.textContent = 'Bot-tjek fejlede. Prøv igen.';\n        statusEl.classList.add('error');\n        return;\n      }\n\n      const res = await fetch('" + urlFor('submit_feedback') + "', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({\n          type: document.getElementById('feedback-type').value,\n          name: document.getElementById('feedback-name').value.trim(),\n          email: document.getElementById('feedback-email').value.trim(),\n          subject: document.getElementById('feedback-subject').value.trim(),\n          message: message,\n          // Kun sti - ingen query-streng eller fragment. Compliance-audit\n          // 19-08-2026 (GDPR-018): en henviser-URL kan bære et delt-kurv-\n          // invitationstoken (?liste=) eller søgeord, og siden document.\n          // referrer/location.href gemmes i feedback-databasen (læses i\n          // /admin), skal de aldrig følge med.\n          page_url: stripQueryAndFragment(document.referrer || window.location.href),\n          turnstile_token: tsToken,\n        }),\n      });\n      const contentType = res.headers.get('content-type') || '';\n      let data = null;\n      if (contentType.includes('application/json')) {\n        data = await res.json();\n      } else {\n        const text = (await res.text()).trim();\n        throw new Error(text || ('HTTP ' + res.status));\n      }\n      if (res.ok && data && data.success) {\n        statusEl.textContent = 'Tak for din besked! Vi har modtaget den.';\n        statusEl.classList.add('success');\n        form.reset();\n      } else {\n        statusEl.textContent = (data && data.error) || 'Noget gik galt. Prøv igen.';\n        statusEl.classList.add('error');\n      }\n    } catch (err) {\n      const msg = err && err.message ? String(err.message) : '';\n      if (msg.includes('For mange forespørgsler')) {\n        statusEl.textContent = msg;\n      } else {\n        statusEl.textContent = 'Kunne ikke sende beskeden. Tjek din forbindelse og prøv igen.';\n      }\n      statusEl.classList.add('error');\n    } finally {\n      turnstileReset('feedback-turnstile-widget');\n      submitBtn.disabled = false;\n      submitBtn.textContent = 'Send besked';\n    }\n  });\n})();\n" }} />
    </Layout>
  )
}
