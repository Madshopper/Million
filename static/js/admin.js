/* Admin-panel (/admin).
 *
 * Alt indhold hentes her efter login - selve siden er en tom skal. To kilder:
 *  - Supabase-RPC'erne i scripts/supabase-admin.sql (admin_overview,
 *    admin_feedback, ...), kaldt med brugerens egen session. De tjekker selv
 *    is_admin() i SQL, så en ikke-admin får 403 uanset hvad denne fil gør.
 *  - POST /api/admin/edge (app.py) til D1, KV og D1-budgettet, med samme
 *    access-token som Bearer.
 *
 * Feedback og opskrifter er brugerinput: alt skrives med textContent, aldrig
 * innerHTML.
 */
(function () {
  'use strict';

  var STALE_HOURS = 30;          // butik uden nye data i over 30 t = rød
  var state = { feedback: [], pending: [], showAll: false };

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else if (k === 'onclick') node.addEventListener('click', attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function fill(id, node) {
    var box = $(id);
    box.textContent = '';
    box.appendChild(node);
  }

  function nf(n) {
    return (n == null || isNaN(n)) ? '-' : Number(n).toLocaleString('da-DK');
  }

  function bytes(n) {
    if (n == null) return '-';
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    return Math.round(n / 1024) + ' kB';
  }

  function when(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function ago(iso) {
    if (!iso) return null;
    var h = (Date.now() - new Date(iso).getTime()) / 3600000;
    return isNaN(h) ? null : h;
  }

  function agoText(h) {
    if (h == null) return 'aldrig';
    if (h < 1) return 'under 1 t siden';
    if (h < 48) return Math.round(h) + ' t siden';
    return Math.round(h / 24) + ' dage siden';
  }

  function pill(kind, text) { return el('span', { class: 'adm-pill ' + kind, text: text }); }

  function table(head, rows, numCols) {
    numCols = numCols || [];
    var thead = el('tr', {}, head.map(function (h, i) {
      return el('th', { text: h, style: numCols.indexOf(i) >= 0 ? 'text-align:right' : '' });
    }));
    var body = rows.map(function (r) {
      return el('tr', {}, r.map(function (c, i) {
        var td = el('td', numCols.indexOf(i) >= 0 ? { class: 'num' } : {});
        if (c && c.nodeType) td.appendChild(c); else td.textContent = c == null ? '-' : String(c);
        return td;
      }));
    });
    return el('table', {}, [el('thead', {}, [thead]), el('tbody', {}, body)]);
  }

  function empty(text) { return el('p', { class: 'adm-empty', text: text }); }

  function tile(label, value, sub, ratio) {
    var kids = [el('div', { class: 'k', text: label }), el('div', { class: 'v', text: value })];
    if (sub) kids.push(el('div', { class: 's', text: sub }));
    if (ratio != null && !isNaN(ratio)) {
      var cls = ratio >= 0.9 ? 'bad' : ratio >= 0.7 ? 'warn' : '';
      var bar = el('span', { style: 'width:' + Math.min(100, Math.max(1, ratio * 100)).toFixed(1) + '%' });
      kids.push(el('div', { class: 'adm-meter ' + cls }, [bar]));
    }
    return el('div', { class: 'adm-tile' }, kids);
  }

  function showError(text) {
    $('admin-errors').appendChild(el('div', { class: 'adm-err', text: text }));
  }

  /* ------------------------------------------------------------ dataadgang */
  function client() {
    return window.AuthBridge && window.AuthBridge.getClient();
  }

  function rpc(name, args) {
    return client().rpc(name, args || {}).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  function edge(token) {
    return fetch('/api/admin/edge', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'same-origin'
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  /* ---------------------------------------------------------------- render */
  function renderTiles(ov, ed) {
    var box = $('admin-tiles');
    box.textContent = '';
    var u = ov.users || {};
    box.appendChild(tile('Brugere', nf(u.total), nf(u.confirmed) + ' bekræftede'));
    box.appendChild(tile('Nye brugere', nf(u.new_7d), 'seneste 7 dage, ' + nf(u.new_30d) + ' på 30'));
    box.appendChild(tile('Aktive brugere', nf(u.active_7d), 'logget ind seneste 7 dage'));

    var db = ov.database || {};
    var dbRatio = db.limit_bytes ? db.size_bytes / db.limit_bytes : null;
    box.appendChild(tile('Supabase database', bytes(db.size_bytes), 'af ' + bytes(db.limit_bytes), dbRatio));

    var b = (ed && ed.d1_budget) || {};
    if (b.configured && !b.error) {
      box.appendChild(tile('D1 rows_written i dag', nf(b.rows_written),
        'af ' + nf(b.limit_written) + ' (UTC-døgn, prod + staging)', b.rows_written / b.limit_written));
    } else {
      box.appendChild(tile('D1 rows_written i dag', '-',
        b.error ? 'Cloudflare-analytics svarede ikke' : 'kræver CF_ANALYTICS_TOKEN'));
    }

    var open = state.feedback.filter(function (f) { return !f.handled_at; }).length + state.pending.length;
    box.appendChild(tile('Ubehandlet feedback', nf(open), nf(state.pending.length) + ' i kø i D1'));

    var e = ov.engagement || {};
    box.appendChild(tile('Prisalarmer', nf(e.price_alerts_active), 'aktive'));
    box.appendChild(tile('Kurve', nf(e.carts), nf(e.shared_carts) + ' delte, ' + nf(e.cart_events_7d) + ' kurv-hændelser/7 d'));
  }

  function renderFeedback() {
    var items = state.pending.map(function (p) {
      return {
        queued: true, feedback_type: p.feedback_type, name: p.name, email: p.email,
        subject: p.subject, message: p.message, page_url: p.page_url,
        created_at: p.created_at ? p.created_at + 'Z' : null
      };
    }).concat(state.feedback);
    if (!state.showAll) items = items.filter(function (f) { return !f.handled_at; });
    items.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });

    if (!items.length) {
      fill('admin-feedback', empty(state.showAll ? 'Ingen feedback endnu.' : 'Ingen ubehandlet feedback.'));
      return;
    }
    var typeNames = { feedback: 'Feedback', bug: 'Fejl', feature: 'Idé', other: 'Andet' };
    var list = el('div', {}, items.map(function (f) {
      var head = [
        pill(f.feedback_type === 'bug' ? 'bad' : 'info', typeNames[f.feedback_type] || f.feedback_type || 'Feedback'),
        el('span', { text: when(f.created_at) })
      ];
      if (f.queued) {
        head.push(pill('warn', 'I kø'));
      } else {
        var done = !!f.handled_at;
        head.push(el('button', {
          type: 'button', class: 'adm-btn', text: done ? 'Marker ubehandlet' : 'Marker håndteret',
          onclick: function () { setFeedbackHandled(f, !done, this); }
        }));
      }
      var meta = [];
      var who = [f.name, f.email].filter(Boolean).join(' · ');
      if (who) meta.push(document.createTextNode(who));
      if (f.page_url && /^https?:\/\//i.test(f.page_url)) {
        if (meta.length) meta.push(document.createTextNode(' · '));
        meta.push(el('a', { href: f.page_url, target: '_blank', rel: 'noopener noreferrer', text: f.page_url }));
      }
      return el('div', { class: 'adm-fb' + (f.handled_at ? ' done' : '') }, [
        el('div', { class: 'adm-fb-head' }, head),
        f.subject ? el('div', { class: 'adm-fb-subj', text: f.subject }) : null,
        el('div', { class: 'adm-fb-msg', text: f.message || '' }),
        meta.length ? el('div', { class: 'adm-fb-meta' }, meta) : null
      ]);
    }));
    fill('admin-feedback', list);
  }

  function setFeedbackHandled(f, handled, btn) {
    btn.disabled = true;
    rpc('admin_set_feedback_handled', { p_id: f.id, p_handled: handled }).then(function () {
      f.handled_at = handled ? new Date().toISOString() : null;
      renderFeedback();
    }).catch(function (e) {
      btn.disabled = false;
      showError('Kunne ikke opdatere feedback: ' + (e.message || e));
    });
  }

  function renderStores(ov) {
    var stores = ov.stores || [];
    if (!stores.length) { fill('admin-stores', empty('Ingen butiksdata.')); return; }
    var rows = stores.map(function (s) {
      var h = ago(s.last_scraped);
      var status = h == null ? pill('bad', 'Ingen data')
        : h > STALE_HOURS ? pill('bad', 'Forældet') : pill('ok', 'OK');
      return [s.butik, nf(s.products), when(s.last_scraped) + ' (' + agoText(h) + ')', status];
    });
    var box = el('div', {}, [table(['Butik', 'Varer', 'Senest scrapet', 'Status'], rows, [1])]);
    box.appendChild(el('p', { class: 'adm-sub', style: 'margin:10px 0 0',
      text: 'Priser senest tjekket: ' + (ov.prices_last_checked || '-') +
            ' · næringsdata opdateret: ' + when(ov.nutrition_updated) }));
    fill('admin-stores', box);
  }

  function renderRecipes(ov) {
    var r = ov.recipes || {};
    var pending = ov.pending_recipes || [];
    var box = el('div', {}, [el('p', { class: 'adm-sub', style: 'margin:0 0 8px',
      text: nf(r.approved) + ' godkendte · ' + nf(r.pending) + ' venter · ' + nf(r.rejected) + ' afviste' })]);
    if (!pending.length) {
      box.appendChild(empty('Ingen opskrifter venter.'));
    } else {
      box.appendChild(table(['Titel', 'Kilde', 'Indsendt', ''], pending.map(function (p) {
        var src = p.source_url && /^https?:\/\//i.test(p.source_url)
          ? el('a', { href: p.source_url, target: '_blank', rel: 'noopener noreferrer', text: p.source_name || 'link' })
          : (p.source_name || '-');
        var actions = el('span', { style: 'display:flex;gap:6px;justify-content:flex-end' }, [
          el('button', { type: 'button', class: 'adm-btn', text: 'Godkend',
            onclick: function () { setRecipe(p, 'approved', this); } }),
          el('button', { type: 'button', class: 'adm-btn danger', text: 'Afvis',
            onclick: function () { setRecipe(p, 'rejected', this); } })
        ]);
        return [el('a', { href: '/opskrift/' + encodeURIComponent(p.id), target: '_blank', text: p.title }),
                src, when(p.created_at), actions];
      })));
    }
    fill('admin-recipes', box);
  }

  function setRecipe(p, status, btn) {
    if (status === 'rejected' && !window.confirm('Afvis "' + p.title + '"?')) return;
    btn.disabled = true;
    rpc('admin_set_recipe_status', { p_recipe_id: p.id, p_status: status })
      .then(load)
      .catch(function (e) {
        btn.disabled = false;
        showError('Kunne ikke opdatere opskriften: ' + (e.message || e));
      });
  }

  function renderSecurity(ov) {
    var ev = ov.security_24h || [];
    fill('admin-security', ev.length
      ? table(['Type', 'Hændelser'], ev.map(function (e) { return [e.kind, nf(e.events)]; }), [1])
      : empty('Ingen arkiverede hændelser det seneste døgn.'));
  }

  function renderEdge(ed) {
    if (!ed) { fill('admin-edge', empty('Edge-data kunne ikke hentes.')); return; }
    if (!ed.edge) { fill('admin-edge', empty('Kører lokalt: D1 og KV findes kun på edge.')); return; }
    var v = ed.cache_version ? new Date(Number(ed.cache_version) * 1000) : null;
    var rows = [
      ['Varer i D1', nf(ed.d1_products)],
      ['Sidste seed/deploy (cache_version)', v && !isNaN(v) ? when(v.toISOString()) : (ed.cache_version || '-')],
      ['Feedback i kø i D1', nf((ed.pending_feedback || []).length)]
    ];
    var b = ed.d1_budget || {};
    if (b.configured && !b.error) {
      rows.push(['D1 rows_read i dag', nf(b.rows_read) + ' af ' + nf(b.limit_read)]);
      (b.databases || []).forEach(function (d) {
        rows.push(['  database ' + String(d.id).slice(0, 8), nf(d.rows_written) + ' skrevet']);
      });
    }
    fill('admin-edge', table(['', ''], rows, [1]));
  }

  function renderTables(ov) {
    var t = ov.tables || [];
    fill('admin-tables', t.length
      ? table(['Tabel', 'Rækker (ca.)', 'Størrelse'], t.map(function (x) {
          return [x.name, nf(x.rows_estimate), bytes(x.bytes)];
        }), [1, 2])
      : empty('Ingen tabeller.'));
  }

  function renderUsers(ov) {
    var u = ov.recent_users || [];
    fill('admin-users', u.length
      ? table(['E-mail', 'Oprettet', 'Sidst logget ind', 'Via'], u.map(function (x) {
          return [x.email || '-', when(x.created_at), when(x.last_sign_in_at),
                  x.confirmed ? (x.provider || 'email') : pill('warn', 'ikke bekræftet')];
        }))
      : empty('Ingen brugere.'));
  }

  /* ------------------------------------------------------------------ flow */
  function gate(text, showLogin) {
    $('admin-main').hidden = true;
    $('admin-gate').hidden = false;
    $('admin-gate-text').textContent = text;
    $('admin-login').hidden = !showLogin;
    $('admin-sub').textContent = '';
  }

  var loading = false;
  function load() {
    var sb = client();
    if (!sb) { gate('Login er ikke tilgængeligt lige nu.', false); return Promise.resolve(); }
    if (loading) return Promise.resolve();
    loading = true;
    return sb.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      if (!session) { gate('Log ind med din admin-konto for at se panelet.', true); return; }
      $('admin-sub').textContent = 'Logget ind som ' + (session.user.email || '');

      return rpc('is_admin').then(function (ok) {
        if (!ok) { gate('Din konto har ikke admin-adgang.', false); return; }
        $('admin-gate').hidden = true;
        $('admin-main').hidden = false;
        $('admin-errors').textContent = '';
        $('admin-stamp').textContent = 'Henter …';

        return Promise.all([
          rpc('admin_overview'),
          rpc('admin_feedback', { p_limit: 200 }).catch(function (e) {
            showError('Feedback-arkivet kunne ikke hentes: ' + (e.message || e)); return [];
          }),
          edge(session.access_token).catch(function (e) {
            showError('Edge-data kunne ikke hentes: ' + (e.message || e)); return null;
          })
        ]).then(function (r) {
          var ov = r[0] || {};
          var ed = r[2];
          state.feedback = r[1] || [];
          state.pending = (ed && ed.pending_feedback) || [];
          renderTiles(ov, ed);
          renderFeedback();
          renderStores(ov);
          renderRecipes(ov);
          renderSecurity(ov);
          renderEdge(ed);
          renderTables(ov);
          renderUsers(ov);
          $('admin-stamp').textContent = 'Opdateret ' + when(ov.generated_at || new Date().toISOString());
        });
      }, function (e) {
        // PGRST202: funktionen findes ikke - SQL'en er ikke kørt endnu.
        if (e && (e.code === 'PGRST202' || /is_admin/.test(e.message || ''))) {
          gate('Admin-funktionerne findes ikke i databasen endnu. Kør scripts/supabase-admin.sql.', false);
        } else {
          gate('Kunne ikke tjekke adgang: ' + ((e && e.message) || e), false);
        }
      });
    }).catch(function (e) {
      showError('Fejl: ' + ((e && e.message) || e));
    }).then(function () { loading = false; });
  }

  function setFilter(all) {
    state.showAll = all;
    $('fb-all').setAttribute('aria-pressed', String(all));
    $('fb-open').setAttribute('aria-pressed', String(!all));
    renderFeedback();
  }

  function boot() {
    $('admin-refresh').addEventListener('click', load);
    $('admin-login').addEventListener('click', function () {
      if (window.openAuthModal) window.openAuthModal('login');
    });
    $('fb-open').addEventListener('click', function () { setFilter(false); });
    $('fb-all').addEventListener('click', function () { setFilter(true); });

    var sb = client();
    if (sb) {
      sb.auth.onAuthStateChange(function (event) {
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') load();
      });
    }
    load();
  }

  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
