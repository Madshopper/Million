/* MadShopper admin-panel (/admin).
 *
 * Siden er en tom skal i den delte edge-cache - alt data hentes her med
 * brugerens eget login via admin_*-RPC'erne (scripts/supabase-admin.sql).
 * Sikkerheden ligger i SQL'en: hver RPC afviser kaldere uden en række i
 * admin_users. Denne fil skjuler blot UI'et for ikke-admins.
 *
 * Alt brugerstyret indhold (titler, emails, ingredienser) sættes via
 * textContent - aldrig innerHTML - så en ondsindet opskrift-titel ikke kan
 * køre script i en admins session.
 */
(function () {
  'use strict';

  var SB = null;
  var usersOffset = 0;
  var USERS_PAGE = 50;
  var recipeStatus = 'pending';

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = String(text);
    return n;
  }

  function fmtDate(s) {
    if (!s) return '-';
    try {
      return new Date(s).toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' });
    } catch (e) { return String(s); }
  }

  function setState(msg) {
    var s = $('adminState');
    s.textContent = msg || '';
    s.hidden = !msg;
  }

  function rpc(name, args) {
    return SB.rpc(name, args || {}).then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }

  function showError(target, err) {
    target.textContent = '';
    target.appendChild(el('p', { 'class': 'admin-state' },
      'Kunne ikke hente data: ' + ((err && err.message) || err)));
  }

  /* ------------------------------------------------------------ overblik */
  var STAT_LABELS = [
    ['users_total', 'Brugere i alt'],
    ['users_new_7d', 'Nye brugere (7 d)'],
    ['users_active_7d', 'Aktive logins (7 d)'],
    ['carts_nonempty', 'Gemte kurve'],
    ['shared_carts_total', 'Delte lister'],
    ['price_alerts_total', 'Prisalarmer'],
    ['recipes_pending', 'Opskrifter afventer'],
    ['recipes_approved', 'Opskrifter godkendt'],
    ['cart_adds_7d', 'Lagt i kurv (7 d)'],
    ['cart_compares_7d', 'Sammenligninger (7 d)'],
    ['admins_total', 'Admins']
  ];

  function loadOverview() {
    var stats = $('adminStats');
    var top = $('adminTop');
    stats.textContent = 'Henter …';
    rpc('admin_overview').then(function (d) {
      stats.textContent = '';
      STAT_LABELS.forEach(function (pair) {
        if (d[pair[0]] == null) return;
        var box = el('div', { 'class': 'admin-stat' });
        box.appendChild(el('b', null, Number(d[pair[0]]).toLocaleString('da-DK')));
        box.appendChild(el('span', null, pair[1]));
        stats.appendChild(box);
      });
    }).catch(function (e) { showError(stats, e); });

    top.textContent = '';
    rpc('admin_top_products', { p_days: 7 }).then(function (rows) {
      var head = el('tr');
      ['Produkt', 'Lagt i kurv', 'Sammenlignet'].forEach(function (h) { head.appendChild(el('th', null, h)); });
      top.appendChild(head);
      if (!rows || !rows.length) {
        var tr = el('tr'); var td = el('td', { colspan: '3' }, 'Ingen aktivitet endnu.');
        tr.appendChild(td); top.appendChild(tr);
        return;
      }
      rows.forEach(function (r) {
        var tr = el('tr');
        var td = el('td');
        td.appendChild(el('a', { href: '/product/' + encodeURIComponent(r.product_id) }, r.product_id));
        tr.appendChild(td);
        tr.appendChild(el('td', null, r.adds));
        tr.appendChild(el('td', null, r.compares));
        top.appendChild(tr);
      });
    }).catch(function (e) { showError(top, e); });
  }

  /* ---------------------------------------------------------- opskrifter */
  function loadRecipes() {
    var box = $('adminRecipes');
    box.textContent = 'Henter …';
    document.querySelectorAll('[data-rstatus]').forEach(function (b) {
      b.classList.toggle('ok', b.getAttribute('data-rstatus') === recipeStatus);
    });
    rpc('admin_list_recipes', { p_status: recipeStatus, p_limit: 50 }).then(function (rows) {
      box.textContent = '';
      if (!rows || !rows.length) {
        box.appendChild(el('p', { 'class': 'admin-state' }, 'Ingen opskrifter her.'));
        return;
      }
      rows.forEach(function (r) { box.appendChild(recipeCard(r)); });
    }).catch(function (e) { showError(box, e); });
  }

  function recipeCard(r) {
    var card = el('div', { 'class': 'admin-recipe' });
    card.appendChild(el('h3', null, r.title));
    var meta = [
      '#' + r.id,
      r.imported_via === 'user_manual' ? 'Indsendt af ' + (r.submitted_by_email || 'slettet bruger') : 'Import: ' + (r.source_name || '-'),
      fmtDate(r.created_at),
      r.matched_count + '/' + r.ingredient_count + ' ingredienser matchet'
    ].join(' · ');
    card.appendChild(el('div', { 'class': 'admin-meta' }, meta));
    if (r.source_url && /^https?:\/\//i.test(r.source_url)) {
      var a = el('a', { href: r.source_url, target: '_blank', rel: 'noopener noreferrer nofollow' }, r.source_url);
      var p = el('div', { 'class': 'admin-meta' }); p.appendChild(a); card.appendChild(p);
    }
    var ul = el('ul');
    (r.ingredients || []).forEach(function (t) { ul.appendChild(el('li', null, t)); });
    card.appendChild(ul);

    var actions = el('div', { 'class': 'admin-row' });
    if (r.status !== 'approved') actions.appendChild(actionBtn('Godkend', 'ok', r.id, 'approved'));
    if (r.status !== 'rejected') actions.appendChild(actionBtn('Afvis', 'no', r.id, 'rejected'));
    if (r.status !== 'pending') actions.appendChild(actionBtn('Tilbage til kø', '', r.id, 'pending'));
    if (r.status === 'approved') {
      actions.appendChild(el('a', { href: '/opskrift/' + r.id, target: '_blank', rel: 'noopener' }, 'Se opskrift'));
    }
    card.appendChild(actions);
    return card;
  }

  function actionBtn(label, cls, id, status) {
    var b = el('button', { type: 'button', 'class': 'admin-btn ' + cls }, label);
    b.addEventListener('click', function () {
      b.disabled = true;
      rpc('admin_set_recipe_status', { p_id: id, p_status: status })
        .then(function () { loadRecipes(); })
        .catch(function (e) { b.disabled = false; alert('Fejl: ' + ((e && e.message) || e)); });
    });
    return b;
  }

  /* ------------------------------------------------------------- brugere */
  function loadUsers(append) {
    var table = $('adminUsers');
    var more = $('adminUsersMore');
    if (!append) { usersOffset = 0; table.textContent = ''; }
    rpc('admin_list_users', {
      p_search: $('adminUserQ').value || '',
      p_limit: USERS_PAGE,
      p_offset: usersOffset
    }).then(function (rows) {
      rows = rows || [];
      if (!append) {
        var head = el('tr');
        ['Email', 'Login', 'Oprettet', 'Sidst logget ind', 'Bekræftet', 'Admin'].forEach(function (h) {
          head.appendChild(el('th', null, h));
        });
        table.appendChild(head);
      }
      rows.forEach(function (u) {
        var tr = el('tr');
        tr.appendChild(el('td', null, u.email || '-'));
        tr.appendChild(el('td', null, u.provider || '-'));
        tr.appendChild(el('td', null, fmtDate(u.created_at)));
        tr.appendChild(el('td', null, fmtDate(u.last_sign_in_at)));
        tr.appendChild(el('td', null, u.confirmed ? 'Ja' : 'Nej'));
        tr.appendChild(el('td', null, u.is_admin ? 'Ja' : ''));
        table.appendChild(tr);
      });
      usersOffset += rows.length;
      more.hidden = rows.length < USERS_PAGE;
    }).catch(function (e) { showError(table, e); });
  }

  /* -------------------------------------------------------------- faner */
  var loaded = {};
  function showTab(name) {
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.setAttribute('aria-selected', b.getAttribute('data-tab') === name ? 'true' : 'false');
    });
    document.querySelectorAll('[data-panel]').forEach(function (p) {
      p.hidden = p.getAttribute('data-panel') !== name;
    });
    if (loaded[name]) return;
    loaded[name] = true;
    if (name === 'overview') loadOverview();
    else if (name === 'recipes') loadRecipes();
    else if (name === 'users') loadUsers(false);
  }

  function bindUi() {
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
    });
    document.querySelectorAll('[data-rstatus]').forEach(function (b) {
      b.addEventListener('click', function () {
        recipeStatus = b.getAttribute('data-rstatus');
        loadRecipes();
      });
    });
    $('adminUserSearch').addEventListener('submit', function (ev) {
      ev.preventDefault();
      loadUsers(false);
    });
    $('adminUsersMore').addEventListener('click', function () { loadUsers(true); });
  }

  /* --------------------------------------------------------------- adgang */
  var started = false;
  function checkAccess(session) {
    if (!session || !session.user) {
      $('adminPanel').hidden = true;
      setState('Log ind med en admin-konto for at fortsætte.');
      var btn = el('button', { type: 'button', 'class': 'admin-btn ok' }, 'Log ind');
      btn.addEventListener('click', function () { if (window.openAuthModal) window.openAuthModal('login'); });
      $('adminState').appendChild(document.createTextNode(' '));
      $('adminState').appendChild(btn);
      return;
    }
    setState('Tjekker adgang …');
    rpc('is_admin').then(function (ok) {
      if (!ok) {
        $('adminPanel').hidden = true;
        setState('Din konto har ikke admin-adgang.');
        return;
      }
      setState('');
      $('adminPanel').hidden = false;
      if (!started) { started = true; bindUi(); showTab('overview'); }
    }).catch(function (e) {
      setState('Kunne ikke tjekke adgang: ' + ((e && e.message) || e));
    });
  }

  function boot() {
    SB = window.AuthBridge && window.AuthBridge.getClient();
    if (!SB) { setState('Login er ikke tilgængeligt lige nu.'); return; }
    SB.auth.getSession().then(function (r) { checkAccess(r.data && r.data.session); });
    SB.auth.onAuthStateChange(function (event, session) {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') checkAccess(session);
    });
  }

  // auth.js er også defer og indlæses før denne fil (base.html <head>), så
  // AuthBridge findes ved DOMContentLoaded.
  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
