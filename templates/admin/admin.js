/* Admin-panel (/admin).
 *
 * Alt indhold hentes her efter login - selve siden er en tom skal. To kilder:
 *  - Supabase-RPC'erne i scripts/supabase-admin.sql (admin_overview,
 *    admin_feedback, ...); feedback-formularen skriver direkte i public.feedback, kaldt med brugerens egen session. De tjekker selv
 *    is_admin() i SQL, så en ikke-admin får 403 uanset hvad denne fil gør.
 *  - POST /api/admin/edge (app.py) til D1, KV og D1-budgettet, med samme
 *    access-token som Bearer.
 * Kørselshistorikken (admin_job_runs) er GitHub Actions-kørsler, som
 * et planlagt workflow gemmer i Supabase via scripts/sync-job-runs.py.
 *
 * Feedback og opskrifter er brugerinput: alt skrives med textContent, aldrig
 * innerHTML.
 */
(function () {
  'use strict';

  var STALE_HOURS = 30;          // butik uden nye data i over 30 t = rød
  var state = { feedback: [], pending: [], showAll: false, runs: null, access: null, accessAll: false, ov: null };

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

  function post(path, token, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      credentials: 'same-origin'
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  function edge(token) { return post('/api/admin/edge', token); }
  function traffic(token) { return post('/api/admin/traffic', token); }

  /* ---------------------------------------------------------------- render */
  function renderTiles(ov, ed) {
    var box = $('admin-tiles');
    box.textContent = '';
    var u = ov.users || {};
    box.appendChild(tile('Brugere', nf(u.total), nf(u.new_7d) + ' nye seneste 7 dage'));

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
    box.appendChild(tile('Ubehandlet feedback', nf(open), state.pending.length ? nf(state.pending.length) + ' i gammel D1-kø' : 'fra feedback-formularen'));

    var ub = $('admin-user-tiles');
    ub.textContent = '';
    var e = ov.engagement || {};
    ub.appendChild(tile('Brugere', nf(u.total), nf(u.confirmed) + ' bekræftede'));
    ub.appendChild(tile('Nye brugere', nf(u.new_7d), 'seneste 7 dage, ' + nf(u.new_30d) + ' på 30'));
    ub.appendChild(tile('Aktive brugere', nf(u.active_7d), 'logget ind seneste 7 dage'));
    ub.appendChild(tile('Prisalarmer', nf(e.price_alerts_active), 'aktive'));
    ub.appendChild(tile('Kurve', nf(e.carts), nf(e.shared_carts) + ' delte, ' + nf(e.cart_events_7d) + ' kurv-hændelser/7 d'));
  }

  function openFeedbackCount() {
    return state.feedback.filter(function (f) { return !f.handled_at; }).length + state.pending.length;
  }

  function staleStores(ov) {
    return (ov.stores || []).filter(function (s) {
      var h = ago(s.last_scraped);
      return h == null || h > STALE_HOURS;
    });
  }

  function badge(id, n) {
    var b = $(id);
    b.hidden = !n;
    b.textContent = n ? String(n) : '';
  }

  function renderBadges(ov) {
    badge('badge-feedback', openFeedbackCount());
    badge('badge-scraping', staleStores(ov).length);
    badge('badge-opskrifter', (ov.pending_recipes || []).length);
    badge('badge-korsler', failingWorkflows().length);
    badge('badge-brugere', waitingUsers().length);
  }

  // Overblikkets "kræver opmærksomhed": hvert punkt linker til sin sektion.
  function renderAttention(ov, ed) {
    var items = [];
    var open = openFeedbackCount();
    if (open) items.push(['warn', open + ' ubehandlet feedback', '#feedback']);
    staleStores(ov).forEach(function (s) {
      items.push(['bad', s.butik + ': ingen nye data i ' + agoText(ago(s.last_scraped)).replace(' siden', ''), '#scraping']);
    });
    failingWorkflows().forEach(function (g) {
      items.push(['bad', g.name + ': seneste kørsel fejlede', '#korsler']);
    });
    var synced = state.runs && state.runs.synced_at ? ago(state.runs.synced_at) : null;
    if (synced != null && synced > SYNC_STALE_HOURS) {
      items.push(['warn', 'Kørselshistorikken er ikke synket i ' + agoText(synced).replace(' siden', ''), '#korsler']);
    }
    var wu = waitingUsers().length;
    if (wu) items.push(['warn', wu + ' bruger' + (wu === 1 ? '' : 'e') + ' venter på godkendelse', '#brugere']);
    var pr = (ov.pending_recipes || []).length;
    if (pr) items.push(['info', pr + ' opskrift' + (pr === 1 ? '' : 'er') + ' venter på godkendelse', '#opskrifter']);
    var db = ov.database || {};
    if (db.limit_bytes && db.size_bytes / db.limit_bytes >= 0.8) {
      items.push(['bad', 'Supabase-databasen er ' + Math.round(db.size_bytes / db.limit_bytes * 100) + ' % fuld', '#drift']);
    }
    var b = (ed && ed.d1_budget) || {};
    if (b.configured && !b.error && b.rows_written / b.limit_written >= 0.9) {
      items.push(['warn', 'D1 rows_written er ' + Math.round(b.rows_written / b.limit_written * 100) + ' % af dagens budget', '#drift']);
    }
    if (!items.length) { fill('admin-attention', empty('Intet kræver opmærksomhed lige nu.')); return; }
    fill('admin-attention', el('ul', { class: 'adm-attn' }, items.map(function (it) {
      return el('li', {}, [pill(it[0], it[0] === 'bad' ? 'Problem' : it[0] === 'warn' ? 'Tjek' : 'Info'),
                           el('a', { href: it[2], text: it[1] })]);
    })));
  }

  /* ----------------------------------------------------------- navigation */
  var SECTIONS = ['oversigt', 'trafik', 'feedback', 'scraping', 'korsler', 'opskrifter', 'feature', 'brugere', 'drift'];

  function showSection() {
    var name = (location.hash || '').replace('#', '');
    if (SECTIONS.indexOf(name) < 0) name = 'oversigt';
    document.querySelectorAll('#admin-main section[data-section]').forEach(function (sec) {
      sec.hidden = sec.getAttribute('data-section') !== name;
    });
    document.querySelectorAll('#admin-nav a').forEach(function (a) {
      if (a.getAttribute('data-section') === name) {
        a.setAttribute('aria-current', 'page');
        // På mobil er menuen en vandret bjælke - hold det valgte punkt synligt.
        if (a.scrollIntoView) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      else a.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
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
      if (f.env === 'dev') head.push(pill('warn', 'Staging/lokal'));
      if (f.queued) {
        head.push(pill('warn', 'Gammel D1-kø'));
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
      badge('badge-feedback', openFeedbackCount());
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

  /* ------------------------------------------------- GitHub Actions-kørsler */
  var EVENTS = { schedule: 'Planlagt', workflow_dispatch: 'Manuel', push: 'Push',
                 workflow_run: 'Efter andet job', repository_dispatch: 'Dispatch' };
  var FAILED = ['failure', 'timed_out', 'startup_failure'];
  var SYNC_STALE_HOURS = 8;      // synken kører hver ~3. time (GitHub-cron: 2-6 t)

  function runOutcome(r) {
    if (r.status !== 'completed') return ['info', r.status === 'in_progress' ? 'Kører' : 'I kø'];
    if (r.conclusion === 'success') return ['ok', 'OK'];
    if (FAILED.indexOf(r.conclusion) >= 0) return ['bad', 'Fejlede'];
    if (r.conclusion === 'cancelled') return ['warn', 'Annulleret'];
    if (r.conclusion === 'skipped') return ['', 'Sprunget over'];
    return ['warn', String(r.conclusion || r.status)];
  }

  // Kørslerne kommer nyeste først; grupperes pr. workflow-fil i den rækkefølge.
  function runGroups() {
    var runs = (state.runs && state.runs.runs) || [];
    var byKey = {}, groups = [];
    runs.forEach(function (r) {
      var key = r.path || r.workflow;
      if (!byKey[key]) { byKey[key] = { name: r.workflow || key, path: r.path || '', runs: [] }; groups.push(byKey[key]); }
      byKey[key].runs.push(r);
    });
    return groups;
  }

  // Et workflow "fejler", når dets seneste afgjorte kørsel (lykkedes/fejlede)
  // fejlede. Annullerede og overspringede kørsler tæller ikke som svar.
  function lastVerdict(g) {
    for (var i = 0; i < g.runs.length; i++) {
      var r = g.runs[i];
      if (r.status === 'completed' && (r.conclusion === 'success' || FAILED.indexOf(r.conclusion) >= 0)) return r;
    }
    return null;
  }

  function failingWorkflows() {
    return runGroups().filter(function (g) {
      var v = lastVerdict(g);
      return v && v.conclusion !== 'success';
    });
  }

  function ghUrl(u) { return /^https:\/\/github\.com\//.test(u || '') ? u : null; }

  function duration(r) {
    if (r.status !== 'completed' || !r.started_at || !r.updated_at) return '-';
    var s = Math.max(0, Math.round((Date.parse(r.updated_at) - Date.parse(r.started_at)) / 1000));
    return s < 60 ? s + ' s' : s < 3600 ? Math.round(s / 60) + ' min' : (s / 3600).toFixed(1).replace('.', ',') + ' t';
  }

  function runStrip(runs) {
    // Ældste til venstre, nyeste til højre - som en tidslinje.
    return el('span', { class: 'adm-runs' }, runs.slice(0, 12).reverse().map(function (r) {
      var o = runOutcome(r);
      return el(ghUrl(r.url) ? 'a' : 'span', { class: o[0], href: ghUrl(r.url) || '', target: '_blank', rel: 'noopener',
        title: when(r.created_at) + ' · ' + o[1] + (r.branch && r.branch !== 'main' ? ' · ' + r.branch : ''),
        'aria-label': when(r.created_at) + ': ' + o[1] });
    }));
  }

  function renderRuns() {
    var info = state.runs;
    var sub = $('runs-sub');
    sub.textContent = '';
    if (!info) { fill('admin-runs', empty('Kørslerne kunne ikke hentes.')); return; }
    if (!info.synced_at) {
      fill('admin-runs', empty('Ingen kørsler gemt endnu. De hentes af scripts/sync-job-runs.py hver ~3. time.'));
      return;
    }
    var failing = failingWorkflows();
    var groups = runGroups().sort(function (a, b) {
      var fa = failing.indexOf(a) >= 0, fb = failing.indexOf(b) >= 0;
      if (fa !== fb) return fa ? -1 : 1;
      return String(b.runs[0].created_at).localeCompare(String(a.runs[0].created_at));
    });
    sub.textContent = 'Seneste 14 dage, uden PR-tjek · synket ' + agoText(ago(info.synced_at));
    if (!groups.length) { fill('admin-runs', empty('Ingen kørsler fundet.')); return; }
    var rows = groups.map(function (g) {
      var r = g.runs[0];
      var o = runOutcome(r);
      var v = lastVerdict(g);
      var name = el('span', {}, [ghUrl(r.url)
          ? el('a', { href: r.url, target: '_blank', rel: 'noopener', text: g.name })
          : el('span', { text: g.name }),
        el('br'), el('span', { class: 'adm-wf-file', text: g.path.replace('.github/workflows/', '') })]);
      var status = el('span', {}, [pill(o[0] || 'info', o[1]),
        v && v !== r && v.conclusion !== 'success' ? el('span', { class: 'adm-wf-file', text: ' sidst afgjort: fejlede' }) : null]);
      var started = el('span', { title: when(r.created_at), style: 'white-space:nowrap', text: agoText(ago(r.created_at)) });
      return [name, status, started,
              EVENTS[r.event] || r.event, duration(r), runStrip(g.runs)];
    });
    fill('admin-runs', table(['Workflow', 'Seneste', 'Startet', 'Udløst af', 'Varighed', 'Historik'], rows, [4]));
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
      ['Feedback i gammel D1-kø', nf((ed.pending_feedback || []).length)]
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

  /* ---------------------------------------------------------------- trafik */
  var DEVICE_NAMES = { desktop: 'Computer', mobile: 'Mobil', tablet: 'Tablet' };
  var PAGE_NAMES = {
    '/': 'Forside', '/index.html': 'Forside', '/search': 'Søgning', '/search/results': 'Søgeresultater',
    '/ugens_tilbud': 'Ugens tilbud', '/sale.html': 'Ugens tilbud', '/om-os': 'Om os', '/about': 'Om os',
    '/privatliv': 'Privatliv', '/privacy': 'Privatliv', '/terms-of-service': 'Vilkår',
    '/feedback': 'Feedback', '/opskrifter': 'Opskrifter', '/admin': 'Admin'
  };

  // Stien som en læsbar side: "/" -> "Forside", "/Mejeri" -> "Kategori: Mejeri".
  function pageName(path) {
    if (!path) return '-';
    var p = path.length > 1 ? path.replace(/\/+$/, '') : path;
    if (PAGE_NAMES[p]) return PAGE_NAMES[p];
    if (/^\/product\//.test(p)) return 'Vare';
    if (/^\/opskrift\//.test(p)) return 'Opskrift';
    var m = /^\/([^\/.]+)(\.html)?$/.exec(p);
    if (m) {
      var name = m[1];
      try { name = decodeURIComponent(name); } catch (_) {}
      return 'Kategori: ' + name.replace(/[-_]+/g, ' ');
    }
    return p;
  }

  function shareRows(list, nameFn) {
    var total = list.reduce(function (a, x) { return a + x.count; }, 0) || 1;
    return list.map(function (x) {
      return [nameFn ? nameFn(x.name) : (x.name || '-'), nf(x.count), Math.round(x.count * 100 / total) + ' %'];
    });
  }

  function vitalRating(ms, good, poor) {
    if (ms == null) return null;
    return ms <= good ? 'god' : ms <= poor ? 'kan forbedres' : 'langsom';
  }

  function renderTraffic(tr) {
    var tiles = $('admin-traffic-tiles');
    tiles.textContent = '';
    if (!tr || !tr.configured || tr.error) {
      var msg = !tr ? 'Trafikdata kunne ikke hentes.'
        : tr.error ? 'Cloudflare-analytics svarede ikke. Prøv at opdatere.'
        : 'Serveren kan ikke se ' + ((tr.missing && tr.missing.length) ? tr.missing.join(' og ') : 'Cloudflare-nøglen') + '.';
      fill('admin-traffic-days', empty(msg));
      ['pages', 'referers', 'devices', 'countries', 'browsers', 'worker'].forEach(function (k) {
        fill('admin-traffic-' + k, empty('-'));
      });
      return;
    }
    var days = tr.days || [];
    var today = days.filter(function (d) { return d.date === tr.today; })[0] || { visits: 0, pageviews: 0 };
    var visits7 = days.reduce(function (a, d) { return a + d.visits; }, 0);
    var views7 = days.reduce(function (a, d) { return a + d.pageviews; }, 0);
    tiles.appendChild(tile('Besøg i dag', nf(today.visits), nf(today.pageviews) + ' sidevisninger'));
    tiles.appendChild(tile('Besøg 7 dage', nf(visits7), nf(views7) + ' sidevisninger'));
    tiles.appendChild(tile('Sider pr. besøg', visits7 ? (views7 / visits7).toFixed(1).replace('.', ',') : '-', 'gennemsnit, 7 dage'));
    var v = tr.vitals || {};
    var lcpRating = vitalRating(v.lcp_ms, 2500, 4000);
    tiles.appendChild(tile('Indlæsningstid', v.lcp_ms != null ? (v.lcp_ms / 1000).toFixed(1).replace('.', ',') + ' s' : '-',
      lcpRating ? lcpRating + ' (3 af 4 besøg er hurtigere)' : 'ingen målinger endnu'));

    var max = days.reduce(function (a, d) { return Math.max(a, d.visits); }, 0) || 1;
    fill('admin-traffic-days', days.length ? el('div', { class: 'adm-bars' }, days.map(function (d) {
      return el('div', { class: 'adm-bar-row' }, [
        el('span', { class: 'adm-bar-label', text: new Date(d.date + 'T12:00:00Z').toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' }) }),
        el('span', { class: 'adm-bar' }, [el('span', { style: 'width:' + Math.max(1, d.visits * 100 / max).toFixed(1) + '%' })]),
        el('span', { class: 'adm-bar-value', text: nf(d.visits) })
      ]);
    })) : empty('Ingen besøg målt endnu.'));

    function list(id, rows, head, nameFn) {
      fill(id, rows && rows.length ? table(head, shareRows(rows, nameFn), [1, 2]) : empty('Ingen data endnu.'));
    }
    list('admin-traffic-pages', tr.pages, ['Side', 'Visninger', 'Andel'], pageName);
    list('admin-traffic-referers', tr.referers, ['Kilde', 'Visninger', 'Andel'], function (n) { return n || 'Direkte / ukendt'; });
    list('admin-traffic-devices', tr.devices, ['Enhed', 'Visninger', 'Andel'], function (n) { return DEVICE_NAMES[n] || n || '-'; });
    var regionNames = null;
    try { regionNames = new Intl.DisplayNames(['da'], { type: 'region' }); } catch (_) {}
    list('admin-traffic-countries', tr.countries, ['Land', 'Visninger', 'Andel'], function (n) {
      try { return (regionNames && n && regionNames.of(n)) || n || '-'; } catch (_) { return n || '-'; }
    });
    list('admin-traffic-browsers', tr.browsers, ['Browser', 'Visninger', 'Andel']);

    var w = tr.worker || {};
    var bs = w.by_status || {};
    var failed = Object.keys(bs).filter(function (k) { return k !== 'success' && k !== 'clientDisconnected'; })
      .reduce(function (a, k) { return a + bs[k]; }, 0);
    var rows = [
      ['Forespørgsler i dag', nf(w.requests)],
      ['Fejlede (fx CPU-grænse)', failed ? pill('bad', nf(failed)) : nf(0)],
      ['Afbrudt af besøgende', nf(bs.clientDisconnected || 0)],
      ['CPU pr. forespørgsel (typisk)', w.cpu_p50_ms != null ? String(w.cpu_p50_ms).replace('.', ',') + ' ms' : '-'],
      ['CPU pr. forespørgsel (tungeste 1 %)', w.cpu_p99_ms != null ? String(w.cpu_p99_ms).replace('.', ',') + ' ms' : '-']
    ];
    Object.keys(bs).forEach(function (k) {
      if (k !== 'success' && k !== 'clientDisconnected') rows.push(['  status ' + k, nf(bs[k])]);
    });
    fill('admin-traffic-worker', table(['', ''], rows, [1]));
  }

  // Overblikkets flise - tilføjes efter renderTiles, som tømmer boksen.
  function renderTrafficTile(tr) {
    if (!tr || !tr.configured || tr.error) return;
    var today = (tr.days || []).filter(function (d) { return d.date === tr.today; })[0] || { visits: 0, pageviews: 0 };
    $('admin-tiles').insertBefore(tile('Besøg i dag', nf(today.visits), nf(today.pageviews) + ' sidevisninger'),
      $('admin-tiles').firstChild);
  }

  function renderTables(ov) {
    var t = ov.tables || [];
    fill('admin-tables', t.length
      ? table(['Tabel', 'Rækker (ca.)', 'Størrelse'], t.map(function (x) {
          return [x.name, nf(x.rows_estimate), bytes(x.bytes)];
        }), [1, 2])
      : empty('Ingen tabeller.'));
  }

  /* ------------------------------------------- adgang (privat site) */
  // admin_list_users/admin_set_approved fra scripts/supabase-site-approval.sql.
  // Findes de ikke endnu (SQL'en ikke kørt), vises den gamle liste over nyeste
  // brugere i stedet. Godkendelsen slår først igennem hos brugeren, når
  // brugerens token fornyes (login-siden har "Tjek igen").
  function waitingUsers() {
    return (state.access || []).filter(function (x) { return !x.approved && !x.is_admin; });
  }

  function renderAccess() {
    var list = state.access || [];
    var shown = state.accessAll ? list : waitingUsers();
    $('users-filter').hidden = false;
    $('admin-users-title').textContent = 'Adgang til sitet';
    if (!shown.length) {
      fill('admin-users', empty(state.accessAll ? 'Ingen brugere.' : 'Ingen venter på godkendelse.'));
      return;
    }
    fill('admin-users', table(['E-mail', 'Via', 'Oprettet', 'Sidst logget ind', 'Adgang', ''], shown.map(function (x) {
      var status = x.is_admin ? pill('info', 'Admin') : x.approved ? pill('ok', 'Godkendt') : pill('warn', 'Venter');
      var btn = x.is_admin ? null : el('button', {
        type: 'button', class: 'adm-btn' + (x.approved ? ' danger' : ' primary'),
        text: x.approved ? 'Fjern adgang' : 'Godkend',
        onclick: function () { setApproved(x, !x.approved, this); }
      });
      return [x.email || '-', x.provider || 'email', when(x.created_at), when(x.last_sign_in_at), status, btn];
    })));
  }

  function setApproved(x, approved, btn) {
    if (!approved && !window.confirm('Fjern adgangen for ' + (x.email || 'brugeren') + '?')) return;
    btn.disabled = true;
    rpc('admin_set_approved', { p_user_id: x.user_id, p_approved: approved }).then(function () {
      x.approved = approved;
      renderAccess();
      if (state.ov) { renderBadges(state.ov); renderAttention(state.ov, state.ed); }
    }).catch(function (e) {
      btn.disabled = false;
      showError('Kunne ikke ændre adgang: ' + (e.message || e));
    });
  }

  function setAccessFilter(all) {
    state.accessAll = all;
    $('users-all').setAttribute('aria-pressed', String(all));
    $('users-pending').setAttribute('aria-pressed', String(!all));
    renderAccess();
  }

  function renderUsers(ov) {
    if (state.access) { renderAccess(); return; }
    var u = ov.recent_users || [];
    fill('admin-users', u.length
      ? table(['E-mail', 'Oprettet', 'Sidst logget ind', 'Via'], u.map(function (x) {
          return [x.email || '-', when(x.created_at), when(x.last_sign_in_at),
                  x.confirmed ? (x.provider || 'email') : pill('warn', 'ikke bekræftet')];
        }))
      : empty('Ingen brugere.'));
  }

  /* --------------------------------------------------------------- feature
   * Hvad der vises på madshopper.dk. Valget gemmes i produktionens KV via
   * /api/admin/features og slår igennem inden for ca. 5 minutter (workerens
   * cache-nøgle skifter med valget, se src/worker.py::_cache_version). */
  function token() {
    return client().auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      if (!session) throw new Error('Du er ikke logget ind.');
      return session.access_token;
    });
  }

  function loadFeatures(tok) {
    return post('/api/admin/features', tok).then(renderFeatures).catch(function (e) {
      fill('admin-features', empty('Kunne ikke hente funktionerne: ' + ((e && e.message) || e)));
    });
  }

  var PART_KIND = {
    web: ['Hjemmesiden', 'Følger knappen med det samme'],
    job: ['Kørsel', 'Starter og stopper med knappen'],
    app: ['Appen', 'Kræver en ny app-version'],
    idea: ['Idé', 'Ikke bygget endnu']
  };
  var PROJECT_STATUS = {
    waiting: ['warn', 'Venter på dig'],
    doing: ['info', 'I gang'],
    idea: ['info', 'Ikke startet']
  };
  var featOpen = {};

  function partRow(f, p) {
    var kind = PART_KIND[p.kind] || PART_KIND.web;
    var st;
    if (p.kind === 'app' || p.kind === 'idea') st = pill('info', kind[1]);
    else if (f.forced_here) st = pill('ok', 'Slået til her');
    else st = f.live ? pill('ok', p.kind === 'job' ? 'Kører' : 'Vises') : pill('warn', p.kind === 'job' ? 'Sat på pause' : 'Skjult');
    return el('li', {}, [
      el('div', {}, [
        el('b', { text: p.name }), ' ',
        el('span', { class: 'adm-feat-kind', text: kind[0] }),
        el('div', { class: 'adm-sub', text: p.desc })
      ]),
      st
    ]);
  }

  function projectCard(j, pr) {
    var open = !!featOpen['p:' + pr.key];
    var parts = pr.parts || [];
    var doneN = parts.filter(function (x) { return x.done; }).length;
    var st = PROJECT_STATUS[pr.status] || PROJECT_STATUS.doing;
    var head = el('button', {
      type: 'button', class: 'adm-feat-head', 'aria-expanded': String(open),
      onclick: function () { featOpen['p:' + pr.key] = !open; renderFeatures(j); }
    }, [
      el('span', { class: 'adm-feat-arrow', 'aria-hidden': 'true', text: parts.length ? (open ? '▾' : '▸') : '' }),
      el('h2', { text: pr.name }), pill(st[0], st[1]),
      parts.length ? el('span', { class: 'adm-sub', text: doneN + ' af ' + parts.length + ' trin færdige' }) : null
    ]);
    return el('div', { class: 'adm-card adm-feat' }, [
      head,
      el('p', { class: 'adm-feat-desc', text: pr.desc }),
      open && parts.length ? el('ul', { class: 'adm-feat-parts' }, parts.map(function (x) {
        return el('li', {}, [
          el('div', {}, [el('b', { text: x.name }), el('div', { class: 'adm-sub', text: x.desc })]),
          x.done ? pill('ok', 'Færdig') : pill('warn', 'Mangler')
        ]);
      })) : null,
      j.editable ? el('div', { class: 'adm-feat-btns' }, [el('button', {
        type: 'button', class: 'adm-btn', text: 'Marker som færdig',
        onclick: function () { askFeature(pr, 'done'); }
      })]) : null
    ]);
  }

  function renderFeatures(j) {
    var list = (j && j.features) || [];
    var projects = (j && j.projects) || [];
    var out = el('div', {}, [
      el('h2', { class: 'adm-feat-group', text: 'Funktioner med knap' }),
      el('p', { class: 'adm-sub adm-intro', text: 'Skjult på madshopper.dk, indtil du udgiver dem.' }),
      list.length ? featureCards(j, list) : empty('Ingen funktioner under udvikling. Alt er udgivet og gjort permanent.'),
      el('h2', { class: 'adm-feat-group', text: 'Projekter i gang' }),
      el('p', { class: 'adm-sub adm-intro', text: 'Ting der ikke er færdige endnu. De forsvinder herfra, når du markerer dem som færdige.' }),
      projects.length ? el('div', {}, projects.map(function (pr) { return projectCard(j, pr); }))
        : empty('Ingen projekter i gang.')
    ]);
    if (!j.editable) {
      out.insertBefore(el('p', { class: 'adm-sub', text: /^dev\./.test(location.hostname)
        ? 'Du er på dev-siden, hvor alt altid er slået til. Udgiv fra madshopper.dk/admin.'
        : 'Kan kun ændres på madshopper.dk/admin.' }), out.firstChild);
    }
    fill('admin-features', out);
  }

  function featureCards(j, list) {
    var wrap = el('div', {}, list.map(function (f) {
      var status;
      if (!j.editable) status = pill('info', f.forced_here ? 'Altid slået til her' : 'Styres fra madshopper.dk');
      else status = f.live ? pill('ok', 'Vises på madshopper.dk') : pill('warn', 'Under udvikling');
      var open = !!featOpen[f.key];
      var parts = f.parts || [];
      var btns = [];
      if (j.editable) {
        btns.push(el('button', {
          type: 'button',
          class: 'adm-btn' + (f.live ? ' danger' : ' primary'),
          text: f.live ? 'Skjul igen' : 'Udgiv på madshopper.dk',
          onclick: function () { askFeature(f, f.live ? 'hide' : 'publish'); }
        }));
        // Først når den er udgivet: fjern fra panelet = permanent.
        if (f.live) {
          btns.push(el('button', {
            type: 'button', class: 'adm-btn',
            text: 'Fjern fra panelet',
            onclick: function () { askFeature(f, 'permanent'); }
          }));
        }
      }
      var head = el('button', {
        type: 'button', class: 'adm-feat-head', 'aria-expanded': String(open),
        onclick: function () { featOpen[f.key] = !open; renderFeatures(j); }
      }, [
        el('span', { class: 'adm-feat-arrow', 'aria-hidden': 'true', text: open ? '▾' : '▸' }),
        el('h2', { text: f.name }), status,
        el('span', { class: 'adm-sub', text: parts.length + ' dele' })
      ]);
      return el('div', { class: 'adm-card adm-feat' }, [
        head,
        el('p', { class: 'adm-feat-desc', text: f.desc }),
        open && parts.length ? el('ul', { class: 'adm-feat-parts' }, parts.map(function (p) { return partRow(f, p); })) : null,
        f.changed_at ? el('p', { class: 'adm-sub', text: (f.live ? 'Udgivet ' : 'Skjult ') + when(f.changed_at) }) : null,
        btns.length ? el('div', { class: 'adm-feat-btns' }, btns) : null
      ]);
    }));
    return wrap;
  }

  var modalOk = null;
  var modalReturn = null;
  function closeModal() {
    $('feature-modal').hidden = true;
    modalOk = null;
    if (modalReturn) { try { modalReturn.focus(); } catch (e) { /* væk */ } }
  }

  // action: 'publish' | 'hide' | 'permanent'
  function askFeature(f, action) {
    modalReturn = document.activeElement;
    var jobs = (f.parts || []).filter(function (p) { return p.kind === 'job'; })
      .map(function (p) { return p.name.toLowerCase(); });
    var text = {
      publish: f.name + ' bliver synlig for alle besøgende på madshopper.dk.'
        + (jobs.length ? ' Kørslerne (' + jobs.join(' og ') + ') starter igen af sig selv.' : ''),
      hide: f.name + ' bliver skjult for alle på madshopper.dk igen, og kørslerne sættes på pause. Den virker stadig på dev-siden.',
      permanent: f.name + ' forbliver udgivet for altid og forsvinder fra panelet. Den kan ikke skjules igen bagefter.',
      done: f.name + ' bliver markeret som færdig og forsvinder fra panelet.'
    }[action];
    $('feature-modal-title').textContent = action === 'hide' ? 'Skjul ' + f.name + '?' : 'Er du helt sikker?';
    $('feature-modal-text').textContent = text;
    $('feature-modal-remind').hidden = action !== 'publish';
    $('feature-modal-app').textContent = f.app
      || 'Tjek om appen også skal have en ny version, så den viser det samme som hjemmesiden.';
    $('feature-modal-note').hidden = true;
    var ok = $('feature-modal-ok');
    ok.textContent = { publish: 'Ja, udgiv på madshopper.dk', hide: 'Ja, skjul den',
                       permanent: 'Ja, gør den permanent', done: 'Ja, den er færdig' }[action];
    ok.disabled = false;
    modalOk = function () {
      ok.disabled = true;
      var body = action === 'permanent' ? { key: f.key, permanent: true }
        : action === 'done' ? { key: f.key, done: true }
        : { key: f.key, on: action === 'publish' };
      token().then(function (tok) {
        return post('/api/admin/features', tok, body);
      }).then(function (j) {
        closeModal();
        renderFeatures(j);
        var box = $('admin-features');
        box.insertBefore(el('p', { class: 'adm-ok', text: {
          publish: 'Gemt. ' + f.name + ' vises på madshopper.dk inden for ca. 5 minutter.',
          hide: 'Gemt. ' + f.name + ' er skjult på madshopper.dk inden for ca. 5 minutter.',
          permanent: f.name + ' er nu permanent og er fjernet fra panelet.',
          done: f.name + ' er markeret som færdig og er fjernet fra panelet.'
        }[action] }), box.firstChild);
      }).catch(function (e) {
        closeModal();
        showError('Kunne ikke ændre ' + f.name + ': ' + ((e && e.message) || e));
      });
    };
    $('feature-modal').hidden = false;
    $('feature-modal-cancel').focus();
  }

  /* ------------------------------------------------------------------ flow */
  function gate(text, showLogin) {
    $('admin-main').hidden = true;
    $('admin-gate').hidden = false;
    $('admin-gate-text').textContent = text;
    $('admin-login').hidden = !showLogin;
  }

  var loading = false;
  function load() {
    var sb = client();
    if (!sb) { gate('Login er ikke tilgængeligt lige nu.', false); return Promise.resolve(); }
    if (loading) return Promise.resolve();
    loading = true;
    return sb.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      $('admin-who').textContent = session ? (session.user.email || '') : '';
      $('admin-logout').hidden = !session;
      if (!session) { gate('Log ind med din admin-konto for at se panelet.', true); return; }

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
          }),
          rpc('admin_list_users').catch(function (e) {
            // PGRST202: funktionen findes ikke - privat-site-SQL'en er ikke kørt.
            if (!(e && (e.code === 'PGRST202' || /admin_list_users/.test(e.message || '')))) {
              showError('Brugerlisten kunne ikke hentes: ' + (e.message || e));
            }
            return null;
          }),
          rpc('admin_job_runs', { p_days: 14 }).catch(function (e) {
            showError('Kørselshistorikken kunne ikke hentes: ' + (e.message || e)); return null;
          }),
          traffic(session.access_token).then(function (j) { return j.traffic; }).catch(function () { return null; }),
          loadFeatures(session.access_token)
        ]).then(function (r) {
          var ov = r[0] || {};
          var ed = r[2];
          state.access = Array.isArray(r[3]) ? r[3] : null;
          state.runs = r[4];
          state.ov = ov;
          state.ed = ed;
          state.feedback = r[1] || [];
          state.pending = (ed && ed.pending_feedback) || [];
          renderTiles(ov, ed);
          renderBadges(ov);
          renderAttention(ov, ed);
          renderFeedback();
          renderStores(ov);
          renderRuns();
          renderRecipes(ov);
          renderSecurity(ov);
          renderEdge(ed);
          renderTables(ov);
          renderUsers(ov);
          state.traffic = r[5];
          renderTraffic(r[5]);
          renderTrafficTile(r[5]);
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

  /* Dev-siden: produktionen udsteder et engangslink (2 min.). Det er den
   * eneste vej ind for et menneske; dev svarer 404 til alle andre. Fanen åbnes før kaldet, ellers blokerer
   * browseren den som pop-up. */
  function openDev(path) {
    var win = window.open('about:blank', '_blank');
    var note = $('admin-dev-note');
    client().auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      if (!session) throw new Error('Du er ikke logget ind.');
      return fetch('/api/admin/staging-link', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path }),
        credentials: 'same-origin'
      });
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j.direct && note) {
        note.textContent = 'Direkte adgang er ikke sat op her (STAGING_LINK_SECRET mangler), så dev-siden svarer 404.';
        note.hidden = false;
      }
      if (win) { win.opener = null; win.location.href = j.url; }
      else location.href = j.url;
    }).catch(function (e) {
      if (win) win.close();
      showError('Kunne ikke åbne dev-siden: ' + ((e && e.message) || e));
    });
  }

  function setFilter(all) {
    state.showAll = all;
    $('fb-all').setAttribute('aria-pressed', String(all));
    $('fb-open').setAttribute('aria-pressed', String(!all));
    renderFeedback();
  }

  function boot() {
    $('admin-refresh').addEventListener('click', load);
    Array.prototype.forEach.call(document.querySelectorAll('[data-dev-path]'), function (b) {
      b.addEventListener('click', function () { openDev(b.getAttribute('data-dev-path')); });
    });
    // På dev-siden selv giver knapperne ingen mening.
    if (/^dev\./.test(location.hostname)) {
      $('admin-dev').hidden = true;
      $('admin-dev-card').hidden = true;
    }
    $('admin-logout').addEventListener('click', function () {
      // Efter log ud er /admin en 404 - send til forsiden i stedet.
      Promise.resolve(window.authLogout && window.authLogout()).then(function () {
        location.href = '/';
      });
    });
    window.addEventListener('hashchange', showSection);
    showSection();
    $('admin-login').addEventListener('click', function () {
      if (window.openAuthModal) window.openAuthModal('login');
    });
    $('fb-open').addEventListener('click', function () { setFilter(false); });
    $('fb-all').addEventListener('click', function () { setFilter(true); });
    $('users-pending').addEventListener('click', function () { setAccessFilter(false); });
    $('users-all').addEventListener('click', function () { setAccessFilter(true); });
    $('feature-modal-cancel').addEventListener('click', closeModal);
    $('feature-modal-ok').addEventListener('click', function () { if (modalOk) modalOk(); });
    $('feature-modal').addEventListener('click', function (e) {
      if (e.target === this && !$('feature-modal-ok').disabled) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('feature-modal').hidden && !$('feature-modal-ok').disabled) closeModal();
    });

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
