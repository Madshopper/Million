/*
 * Butikker nær mig (Feature-panelet 'lokation').
 *
 * - "Billigste butikker" viser rækkefølgen man bør køre i, og et link der
 *   åbner hele turen i Google Maps.
 * - "Vælg butikker nær mig" under Indstillinger, og én gang lige efter man
 *   har oprettet en profil: slår de kæder til, der ligger tæt på.
 *
 * Alt regnes ud her i browseren ud fra static/data/butikker.json
 * (scripts/build-store-locations.py, OpenStreetMap). Placeringen sendes aldrig
 * til madshopper.dk og gemmes ikke. Et postnummer, man selv skriver, gemmes
 * kun i browseren og kun med funktionelle cookies.
 *
 * Samme regler som appens apps/mobile/src/location/nearby.ts. Hold dem ens.
 */
(function () {
  'use strict';

  var DATA_URL = '/static/data/butikker.json';
  var PC_KEY = 'lokation_postnummer';
  var ASKED_KEY = 'lokation_spurgt';
  // Kæder med en butik inden for første radius er "i din by". Er der færre end
  // MIN_CHAINS, udvides radius, så man på landet stadig får et par butikker.
  var RADII_KM = [5, 10, 20];
  var MIN_CHAINS = 3;
  var NEW_ACCOUNT_MS = 15 * 60 * 1000;

  var dataPromise = null;
  var lastPos = null;          // kun i hukommelsen, aldrig gemt

  function loadData() {
    if (!dataPromise) {
      dataPromise = fetch(DATA_URL).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).catch(function (e) { dataPromise = null; throw e; });
    }
    return dataPromise;
  }

  // ── Afstande og rute (samme som nearby.ts) ─────────────────────────────
  function km(aLat, aLon, bLat, bLon) {
    var r = Math.PI / 180;
    var dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function toStore(row) {
    return { key: row[0], lat: row[1], lon: row[2], street: row[3], postcode: row[4], city: row[5] };
  }

  /** De n nærmeste butikker i kæden. */
  function nearestOfChain(data, pos, key, n) {
    var list = [];
    for (var i = 0; i < data.stores.length; i++) {
      var row = data.stores[i];
      if (row[0] !== key) continue;
      list.push({ s: row, d: km(pos.lat, pos.lon, row[1], row[2]) });
    }
    list.sort(function (a, b) { return a.d - b.d; });
    return list.slice(0, n).map(function (x) { var s = toStore(x.s); s.dist = x.d; return s; });
  }

  /** Nærmeste butik pr. kæde, og hvilke kæder der tæller som "nær". */
  function nearbyChains(data, pos, keys) {
    var rows = [];
    keys.forEach(function (key) {
      var s = nearestOfChain(data, pos, key, 1)[0];
      if (s) rows.push(s);
    });
    rows.sort(function (a, b) { return a.dist - b.dist; });
    var radius = RADII_KM[RADII_KM.length - 1];
    for (var i = 0; i < RADII_KM.length; i++) {
      var n = rows.filter(function (s) { return s.dist <= RADII_KM[i]; }).length;
      if (n >= MIN_CHAINS) { radius = RADII_KM[i]; break; }
    }
    rows.forEach(function (s) { s.near = s.dist <= radius; });
    return { stores: rows, radius: radius };
  }

  function permutations(arr) {
    if (arr.length <= 1) return [arr.slice()];
    var out = [];
    arr.forEach(function (x, i) {
      var rest = arr.slice(0, i).concat(arr.slice(i + 1));
      permutations(rest).forEach(function (p) { out.push([x].concat(p)); });
    });
    return out;
  }

  /**
   * Korteste tur i fugleflugt gennem én butik af hver kæde. roundTrip: hjem
   * igen bagefter (rigtig placering); ellers slutter turen i sidste butik
   * (postnummer, hvor vi ikke kender hjemmet).
   */
  function planRoute(data, pos, keys, roundTrip) {
    var perChain = keys.length <= 5 ? 3 : 2;
    var cands = keys.map(function (k) { return nearestOfChain(data, pos, k, perChain); })
      .filter(function (c) { return c.length; });
    if (!cands.length) return null;
    var best = null;
    function legKm(stops) {
      var t = 0, prev = pos;
      stops.forEach(function (s) { t += km(prev.lat, prev.lon, s.lat, s.lon); prev = s; });
      if (roundTrip) t += km(prev.lat, prev.lon, pos.lat, pos.lon);
      return t;
    }
    if (cands.length <= 6) {
      permutations(cands).forEach(function (order) {
        // Alle kombinationer af kandidat-butikker i den rækkefølge.
        (function walk(i, chosen) {
          if (i === order.length) {
            var t = legKm(chosen);
            if (!best || t < best.km) best = { km: t, stops: chosen.slice() };
            return;
          }
          order[i].forEach(function (s) { chosen.push(s); walk(i + 1, chosen); chosen.pop(); });
        })(0, []);
      });
    } else {
      // Mange butikker: tag altid den nærmeste næste.
      var left = cands.map(function (c) { return c[0]; }), stops = [], at = pos;
      while (left.length) {
        left.sort(function (a, b) { return km(at.lat, at.lon, a.lat, a.lon) - km(at.lat, at.lon, b.lat, b.lon); });
        at = left.shift(); stops.push(at);
      }
      best = { km: legKm(stops), stops: stops };
    }
    return best;
  }

  function mapsUrl(pos, stops, roundTrip) {
    var ll = function (p) { return p.lat + ',' + p.lon; };
    var q = ['api=1', 'travelmode=driving'];
    var way = stops.slice();
    if (roundTrip) {
      q.push('origin=' + ll(pos), 'destination=' + ll(pos));
    } else {
      // Uden origin bruger Google Maps telefonens egen placering.
      q.push('destination=' + ll(way.pop()));
    }
    if (way.length) q.push('waypoints=' + encodeURIComponent(way.map(ll).join('|')));
    return 'https://www.google.com/maps/dir/?' + q.join('&');
  }

  // ── Placering ──────────────────────────────────────────────────────────
  function lookupPostcode(data, pc) {
    pc = String(pc || '').trim();
    if (!/^\d{4}$/.test(pc)) return null;
    var hit = data.postcodes[pc];
    if (!hit) {
      // Postnumre uden egen butik: nærmeste postnummer med en butik. Tæt på i
      // tal er næsten altid tæt på i Danmark.
      var n = +pc, bestPc = null;
      Object.keys(data.postcodes).forEach(function (k) {
        if (Math.abs(+k - n) <= 20 && (bestPc === null || Math.abs(+k - n) < Math.abs(+bestPc - n))) bestPc = k;
      });
      if (!bestPc) return null;
      hit = data.postcodes[bestPc];
    }
    return { lat: hit[0], lon: hit[1], label: pc + (hit[2] ? ' ' + hit[2] : ''), precise: false };
  }

  function devicePosition() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) { reject(new Error('Din browser kan ikke finde din placering.')); return; }
      navigator.geolocation.getCurrentPosition(function (p) {
        resolve({ lat: p.coords.latitude, lon: p.coords.longitude, label: 'din placering', precise: true });
      }, function (err) {
        reject(new Error(err && err.code === 1
          ? 'Du har ikke givet lov til at bruge din placering. Skriv dit postnummer i stedet.'
          : 'Vi kunne ikke finde din placering. Skriv dit postnummer i stedet.'));
      }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
    });
  }

  function consent() {
    return typeof harFunktioneltSamtykke === 'function' && harFunktioneltSamtykke();
  }
  function savedPostcode() {
    try { return localStorage.getItem(PC_KEY) || ''; } catch (e) { return ''; }
  }
  function savePostcode(pc) {
    if (!consent()) return;
    try { localStorage.setItem(PC_KEY, pc); } catch (e) { /* ingen lagring */ }
  }

  // ── Hjælpere til visning ───────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtKm(d) {
    return d < 1 ? Math.round(d * 1000 / 50) * 50 + ' m' : d.toFixed(1).replace('.', ',') + ' km';
  }
  function storesList() { return (typeof ALL_STORES !== 'undefined' && ALL_STORES) || []; }
  function labelOf(key) {
    var s = storesList().find(function (x) { return x.key === key; });
    return s ? s.label : key;
  }
  function keyOf(label) {
    var s = storesList().find(function (x) { return x.label === label; });
    return s ? s.key : null;
  }
  function address(s) {
    return [s.street, [s.postcode, s.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  }
  var ATTRIB = '<p class="lok-attrib">Butikkernes adresser: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-bidragydere</p>';

  /** Felterne "Brug min placering" eller postnummer. onPos(pos) kaldes med svaret. */
  function positionPicker(container, onPos) {
    var pc = savedPostcode();
    container.innerHTML =
      '<div class="lok-picker">' +
        '<button type="button" class="lok-btn lok-btn-primary" data-lok="gps">Brug min placering</button>' +
        '<span class="lok-or">eller</span>' +
        '<form class="lok-pc" data-lok="pcform">' +
          '<input type="text" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="Postnummer" aria-label="Postnummer" value="' + esc(pc) + '">' +
          '<button type="submit" class="lok-btn">Find</button>' +
        '</form>' +
      '</div>' +
      '<p class="lok-msg" role="status" aria-live="polite"></p>';
    var msg = container.querySelector('.lok-msg');
    function fail(e) { msg.textContent = e.message || 'Noget gik galt. Prøv igen.'; }
    container.querySelector('[data-lok="gps"]').addEventListener('click', function () {
      msg.textContent = 'Finder din placering…';
      devicePosition().then(function (pos) { msg.textContent = ''; lastPos = pos; onPos(pos); }).catch(fail);
    });
    container.querySelector('[data-lok="pcform"]').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var v = this.querySelector('input').value.trim();
      loadData().then(function (data) {
        var pos = lookupPostcode(data, v);
        if (!pos) { fail(new Error('Vi kender ikke postnummeret ' + v + '. Tjek at det har 4 cifre.')); return; }
        msg.textContent = '';
        savePostcode(v);
        lastPos = pos;
        onPos(pos);
      }).catch(function () { fail(new Error('Butikslisten kunne ikke hentes. Prøv igen.')); });
    });
    return { auto: pc };
  }

  // ── Rækkefølge i "Billigste butikker" ──────────────────────────────────
  function renderRoute(container, labels, groupsEl) {
    var keys = labels.map(keyOf).filter(Boolean);
    if (!keys.length) return;
    container.innerHTML =
      '<div class="lok-route">' +
        '<div class="lok-route-title">Hvilken rækkefølge?</div>' +
        '<p class="lok-desc">Find de nærmeste butikker og den korteste tur. Din placering bliver kun brugt her og bliver ikke gemt.</p>' +
        '<div class="lok-route-picker"></div>' +
        '<div class="lok-route-result"></div>' +
      '</div>';
    var result = container.querySelector('.lok-route-result');
    function show(pos) {
      result.innerHTML = '<p class="lok-msg">Beregner turen…</p>';
      loadData().then(function (data) {
        var plan = planRoute(data, pos, keys, pos.precise);
        if (!plan) { result.innerHTML = '<p class="lok-msg">Vi fandt ingen af butikkerne i nærheden.</p>'; return; }
        var html = '<ol class="lok-stops">' + plan.stops.map(function (s) {
          return '<li><strong>' + esc(labelOf(s.key)) + '</strong>' +
            '<span class="lok-addr">' + esc(address(s)) + '</span>' +
            '<span class="lok-dist">' + fmtKm(s.dist) + ' fra ' + esc(pos.label) + '</span></li>';
        }).join('') + '</ol>' +
          '<p class="lok-total">Turen er ca. ' + fmtKm(plan.km) + ' i fugleflugt' + (pos.precise ? ', hjem igen' : '') + '.</p>' +
          '<a class="lok-btn lok-btn-primary lok-maps" target="_blank" rel="noopener" href="' + esc(mapsUrl(pos, plan.stops, pos.precise)) + '">Åbn turen i Google Maps</a>' +
          ATTRIB;
        result.innerHTML = html;
        // Butikkernes varer i samme rækkefølge som turen, med nummer på.
        if (groupsEl) {
          plan.stops.slice().reverse().forEach(function (s, i) {
            var g = groupsEl.querySelector('.br-store-group[data-store="' + CSS.escape(labelOf(s.key)) + '"]');
            if (!g) return;
            groupsEl.insertBefore(g, groupsEl.firstChild);
            var head = g.querySelector('.br-store-name');
            var nr = plan.stops.length - i;
            var badge = g.querySelector('.lok-nr') || document.createElement('span');
            badge.className = 'lok-nr';
            badge.textContent = nr;
            badge.setAttribute('aria-label', 'Nummer ' + nr + ' på turen');
            if (head && !badge.parentNode) head.parentNode.insertBefore(badge, head);
          });
          groupsEl.insertBefore(container, groupsEl.firstChild);
        }
      }).catch(function () { result.innerHTML = '<p class="lok-msg">Butikslisten kunne ikke hentes. Prøv igen.</p>'; });
    }
    var picker = positionPicker(container.querySelector('.lok-route-picker'), show);
    if (lastPos) show(lastPos);
    else if (picker.auto) container.querySelector('[data-lok="pcform"]').requestSubmit();
  }

  // ── "Vælg butikker nær mig" ────────────────────────────────────────────
  function closeDialog() {
    var d = document.getElementById('lok-dialog');
    if (d) d.remove();
    document.body.style.overflow = '';
  }

  function openNearby(opts) {
    opts = opts || {};
    closeDialog();
    var wrap = document.createElement('div');
    wrap.id = 'lok-dialog';
    wrap.className = 'lok-overlay';
    wrap.innerHTML =
      '<div class="lok-backdrop" data-lok="close"></div>' +
      '<div class="lok-modal" role="dialog" aria-modal="true" aria-labelledby="lok-title">' +
        '<button type="button" class="lok-close" data-lok="close" aria-label="Luk">&times;</button>' +
        '<h3 id="lok-title">' + (opts.welcome ? 'Hvor handler du?' : 'Butikker nær dig') + '</h3>' +
        '<p class="lok-desc">' + (opts.welcome
          ? 'Så viser vi kun priser fra de butikker, der ligger tæt på dig. Du kan altid ændre det under Indstillinger.'
          : 'Vi slår de butikker til, der ligger tæt på dig, og resten fra. Du kan stadig ændre det bagefter.') +
          ' Din placering bliver kun brugt her og bliver ikke gemt.</p>' +
        '<div class="lok-dialog-picker"></div>' +
        '<div class="lok-dialog-result"></div>' +
        '<div class="lok-actions">' +
          '<button type="button" class="lok-btn" data-lok="close">' + (opts.welcome ? 'Spring over' : 'Annullér') + '</button>' +
          '<button type="button" class="lok-btn lok-btn-primary" data-lok="save" disabled>Brug de valgte butikker</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    wrap.querySelectorAll('[data-lok="close"]').forEach(function (b) { b.addEventListener('click', closeDialog); });
    var result = wrap.querySelector('.lok-dialog-result');
    var save = wrap.querySelector('[data-lok="save"]');

    function show(pos) {
      result.innerHTML = '<p class="lok-msg">Finder butikker…</p>';
      loadData().then(function (data) {
        var keys = storesList().map(function (s) { return s.key; });
        var near = nearbyChains(data, pos, keys);
        result.innerHTML = '<p class="lok-near-head">Tæt på ' + esc(pos.label) + ' (inden for ' + near.radius + ' km):</p>' +
          '<div class="lok-chains">' + near.stores.map(function (s) {
            return '<label class="lok-chain"><input type="checkbox" value="' + esc(labelOf(s.key)) + '"' + (s.near ? ' checked' : '') + '>' +
              '<span>' + esc(labelOf(s.key)) + '</span><span class="lok-dist">' + fmtKm(s.dist) + '</span></label>';
          }).join('') + '</div>' + ATTRIB;
        save.disabled = false;
        var first = result.querySelector('input');
        if (first) first.focus();
      }).catch(function () { result.innerHTML = '<p class="lok-msg">Butikslisten kunne ikke hentes. Prøv igen.</p>'; });
    }
    var picker = positionPicker(wrap.querySelector('.lok-dialog-picker'), show);
    if (lastPos) show(lastPos);
    else if (picker.auto) wrap.querySelector('[data-lok="pcform"]').requestSubmit();

    save.addEventListener('click', function () {
      var chosen = Array.prototype.map.call(result.querySelectorAll('input:checked'), function (i) { return i.value; });
      if (!chosen.length) { wrap.querySelector('.lok-msg').textContent = 'Vælg mindst én butik.'; return; }
      // Samme vej som kontakterne under Indstillinger (script.js::saveStoreDefaults).
      document.querySelectorAll('.store-checkbox input[type="checkbox"]').forEach(function (cb) {
        cb.checked = chosen.indexOf(cb.value) !== -1;
      });
      if (typeof saveStoreDefaults === 'function') saveStoreDefaults();
      closeDialog();
    });
  }

  /** Kaldes af auth.js ved login: spørg én gang, når kontoen lige er oprettet. */
  function afterSignIn(user) {
    if (!user || !user.created_at) return;
    if (Date.now() - new Date(user.created_at).getTime() > NEW_ACCOUNT_MS) return;
    var flag = ASKED_KEY + ':' + user.id;
    try {
      if (localStorage.getItem(flag) || sessionStorage.getItem(flag)) return;
      (consent() ? localStorage : sessionStorage).setItem(flag, '1');
    } catch (e) { /* uden lagring spørger vi bare */ }
    setTimeout(function () { openNearby({ welcome: true }); }, 400);
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && document.getElementById('lok-dialog')) closeDialog();
  });

  window.Lokation = {
    renderRoute: renderRoute,
    openNearby: openNearby,
    afterSignIn: afterSignIn,
    // Til test (scripts/test-lokation.mjs).
    _planRoute: planRoute, _nearbyChains: nearbyChains, _lookupPostcode: lookupPostcode, _mapsUrl: mapsUrl,
  };
})();
