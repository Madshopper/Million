/* Login-siden for det private site (templates/login.html).
 *
 * Workeren (src/worker.py::_site_gate) sender alle uden et godkendt login
 * hertil og lægger den side, de ville hen til, i fragmentet (#next=/sti).
 * Godkendelsen står i tokenets app_metadata.approved, som kun kan sættes af
 * admin (scripts/supabase-site-approval.sql). Er man godkendt, lægges tokenet
 * i session-cookien via /api/session, og man sendes videre. Ellers vises
 * "afventer godkendelse" med "Tjek igen", der henter et nyt token.
 */
(function () {
  'use strict';

  var NEXT_KEY = 'madshopper_gate_next';

  function el(id) { return document.getElementById(id); }

  // Kun stier på eget domæne - aldrig //andet.dk eller https://...
  function safePath(p) {
    return (typeof p === 'string' && /^\/(?!\/)/.test(p)) ? p : null;
  }

  // Fragmentet forsvinder under Google-redirect og email-bekræftelse, så
  // målet huskes i sessionStorage, indtil det er brugt.
  function readNext() {
    var m = /(?:^#|&)next=([^&]*)/.exec(location.hash || '');
    var fromHash = null;
    if (m) { try { fromHash = safePath(decodeURIComponent(m[1])); } catch (e) { /* ugyldig */ } }
    if (fromHash) {
      try { sessionStorage.setItem(NEXT_KEY, fromHash); } catch (e) { /* spærret */ }
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignorér */ }
      return fromHash;
    }
    try { return safePath(sessionStorage.getItem(NEXT_KEY)) || '/'; } catch (e) { return '/'; }
  }
  var nextPath = readNext();

  function claims(token) {
    try {
      var b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(b64))));
    } catch (e) { return null; }
  }

  function show(view) {
    ['gate-loading', 'gate-login', 'gate-pending'].forEach(function (id) {
      var node = el(id);
      if (node) node.hidden = (id !== view);
    });
  }

  function setSessionCookie(token) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch('/api/session', {
      method: 'POST', headers: headers, body: '{}', credentials: 'same-origin'
    }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }

  var leaving = false;
  function decide(session) {
    if (leaving) return;
    var token = session && session.access_token;
    var c = token ? claims(token) : null;
    if (!c) {
      // Ingen session: ryd en evt. gammel cookie, så "log ud" også lukker siden.
      setSessionCookie(null);
      show('gate-login');
      return;
    }
    if (c.app_metadata && c.app_metadata.approved === true) {
      leaving = true;
      show('gate-loading');
      setSessionCookie(token).then(function (ok) {
        if (!ok) { leaving = false; show('gate-pending'); msg('Kunne ikke logge ind lige nu. Prøv igen.'); return; }
        try { sessionStorage.removeItem(NEXT_KEY); } catch (e) { /* spærret */ }
        location.replace(nextPath);
      });
      return;
    }
    var email = el('gate-email');
    if (email) email.textContent = c.email || '';
    show('gate-pending');
  }

  function msg(text) {
    var node = el('gate-msg');
    if (node) node.textContent = text || '';
  }

  function boot() {
    var bridge = window.AuthBridge;
    var sb = bridge && bridge.getClient();
    if (!sb) { show('gate-login'); return; }

    // Auth-modalen lukker sig selv efter login; resten styres herfra.
    sb.auth.onAuthStateChange(function (_event, session) { decide(session); });
    sb.auth.getSession().then(function (r) { decide(r && r.data && r.data.session); });

    el('gate-login-btn').addEventListener('click', function () {
      window.openAuthModal('login');
    });
    el('gate-signup-btn').addEventListener('click', function () {
      window.openAuthModal('login');
      if (!/opret/i.test((el('auth-title') || {}).textContent || '')) window.authToggleMode();
    });
    el('gate-logout').addEventListener('click', function () {
      sb.auth.signOut().then(function () { decide(null); });
    });
    el('gate-recheck').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      msg('Tjekker …');
      // Godkendelsen kommer først med i et nyt token.
      sb.auth.refreshSession().then(function (r) {
        btn.disabled = false;
        var s = r && r.data && r.data.session;
        var c = s ? claims(s.access_token) : null;
        if (c && c.app_metadata && c.app_metadata.approved === true) { msg(''); decide(s); }
        else msg('Ikke godkendt endnu.');
      });
    });
  }

  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
