/*
 * Madplan på /opskrifter (Feature 'recipes', del "Madplan").
 *
 * Første gang man åbner Opskrifter, stilles seks spørgsmål (antal, budget,
 * lyst, kostbehov, ingredienser der skal undgås, køkken), og ud fra svarene
 * laves en madplan med en ret pr. dag og pris pr. ret mod budgettet.
 * Svarene gemmes kun i browseren (localStorage), aldrig på serveren.
 *
 * Mærkerne pr. opskrift (kost, lyst, køkken, aftensmad) regnes af serveren
 * (app.py::_recipe_plan_profile) og kommer med /api/recipes i feltet `plan`.
 * Selve planen laves her. Appen gør præcis det samme i
 * apps/mobile/src/recipes/mealPlan.ts - ret begge steder.
 *
 * Kaldes af templates/opskrifter.html: MadPlan.init(recipes, hooks).
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'ms_recipe_prefs_v1';
  var DAYS = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
  var PEOPLE_MAX = 8;
  // Budget kan angives om ugen eller om måneden (knap på budget-spørgsmålet).
  // Planen er for én uge, så et månedsbudget regnes om til ugens andel.
  var BUDGET = {
    uge: { min: 200, max: 1500, step: 50, label: 'om ugen' },
    maaned: { min: 800, max: 6500, step: 100, label: 'om måneden' }
  };
  var WEEKS_PER_MONTH = 52 / 12;

  function weeklyBudget(p) {
    return p.budgetPeriod === 'maaned' ? Math.round(p.budget / WEEKS_PER_MONTH) : p.budget;
  }

  function clampBudget(v, period) {
    var b = BUDGET[period];
    return Math.min(b.max, Math.max(b.min, Math.round(v / b.step) * b.step));
  }

  var MOODS = [
    { key: 'hurtig', label: 'Hurtige retter', icon: '⏱️' },
    { key: 'let', label: 'Lav kalorie', icon: '🥗' },
    { key: 'familie', label: 'Familievenlig', icon: '👨‍👩‍👧' },
    { key: 'sund', label: 'Sund og mættende', icon: '🥦' },
    { key: 'takeaway', label: 'Hjemmelavet takeaway', icon: '🍕' },
    { key: 'protein', label: 'Proteinrig', icon: '💪' }
  ];
  var DIETS = [
    { key: 'vegansk', label: 'Vegansk', icon: '🥑' },
    { key: 'vegetar', label: 'Vegetar', icon: '🥕' },
    { key: 'pescetar', label: 'Pescetar', icon: '🐟' },
    { key: 'glutenfri', label: 'Glutenfri', icon: '🌾' },
    { key: 'maelkefri', label: 'Mælkefri', icon: '🥛' }
  ];
  var POPULAR = [
    ['Hvidløg', '🧄'], ['Æg', '🥚'], ['Løg', '🧅'], ['Soja', '🍶'],
    ['Mælk', '🥛'], ['Citron', '🍋'], ['Ingefær', '🫚'], ['Gulerod', '🥕'],
    ['Tomat', '🍅'], ['Svampe', '🍄'], ['Græsk yoghurt', '🥣'], ['Peanuts', '🥜'],
    ['Kylling', '🍗'], ['Kartoffel', '🥔'], ['Fløde', '🧈'], ['Agurk', '🥒'],
    ['Koriander', '🌿'], ['Fisk', '🐟'], ['Chili', '🌶️'], ['Ost', '🧀']
  ];
  var KITCHEN = [
    { key: 'ovn', label: 'Ovn', icon: '♨️' },
    { key: 'kogeplade', label: 'Kogeplade', icon: '🍳' },
    { key: 'airfryer', label: 'Airfryer', icon: '🍟' },
    { key: 'mikroovn', label: 'Mikroovn', icon: '📟' },
    { key: 'blender', label: 'Blender eller foodprocessor', icon: '🥤' },
    { key: 'stavblender', label: 'Stavblender', icon: '🪄' },
    { key: 'roeremaskine', label: 'Røremaskine', icon: '🎂' },
    { key: 'haandmixer', label: 'Håndmixer', icon: '🥣' },
    { key: 'grill', label: 'Grill', icon: '🔥' },
    { key: 'slowcooker', label: 'Slowcooker eller trykkoger', icon: '🍲' },
    { key: 'elkedel', label: 'Elkedel', icon: '🫖' },
    { key: 'broedrister', label: 'Brødrister', icon: '🍞' }
  ];
  // Udstyr der kan klare det samme: en stavblender kan purere, og en
  // håndmixer kan det meste af en røremaskines arbejde.
  var KITCHEN_OK = {
    blender: ['blender', 'stavblender'],
    roeremaskine: ['roeremaskine', 'haandmixer']
  };
  var STEPS = ['people', 'budget', 'moods', 'diets', 'blocked', 'kitchen'];

  function defaults() {
    return { v: 1, done: false, people: 2, budget: 500, budgetPeriod: 'uge', moods: [], diets: [],
             blocked: [], kitchen: ['ovn', 'kogeplade'], pinned: [], seed: 1 };
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || p.v !== 1) return null;
      p = Object.assign(defaults(), p);
      if (!BUDGET[p.budgetPeriod]) p.budgetPeriod = 'uge';
      return p;
    } catch (e) { return null; }
  }

  function savePrefs(p) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch (e) { /* privat vindue */ }
  }

  function fold(s) { return String(s || '').toLowerCase().trim(); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // --- Selve planen (samme regler som mealPlan.ts) -------------------------

  // Prisen i /api/recipes er for hele pakker til hele opskriften. Antal
  // portioner er upålideligt i de importerede opskrifter (1 eller 20), så
  // 2-8 tages for gode varer, og alt andet regnes som 4. Færre personer end
  // opskriften er til gør det ikke billigere (man køber stadig hele pakker),
  // flere personer skalerer prisen op i forhold til antallet.
  function priceFor(r, people) {
    if (r.cheapest_total_price == null) return null;
    var s = r.servings;
    var eff = s && s >= 2 && s <= 8 ? s : 4;
    return Math.round(r.cheapest_total_price * Math.max(1, people / eff) * 100) / 100;
  }

  // Lille deterministisk tilfældighed, så "Lav ny plan" giver en ny plan,
  // men samme svar + samme seed altid giver den samme.
  function jitter(seed, id) {
    var x = Math.sin(seed * 9301 + id * 49297) * 233280;
    return x - Math.floor(x);
  }

  function isBlocked(r, blocked) {
    if (!blocked.length) return false;
    var names = ((r.plan && r.plan.ingredient_names) || []).map(fold);
    var title = fold(r.title);
    return blocked.some(function (b) {
      var t = fold(b);
      return t && (title.indexOf(t) !== -1 ||
                   names.some(function (n) { return n.indexOf(t) !== -1; }));
    });
  }

  function fits(r, p) {
    var plan = r.plan;
    if (!plan || !plan.meal || r.cheapest_total_price == null) return false;
    if (!p.diets.every(function (d) { return plan.diet.indexOf(d) !== -1; })) return false;
    if (!plan.needs.every(function (n) {
      return (KITCHEN_OK[n] || [n]).some(function (k) { return p.kitchen.indexOf(k) !== -1; });
    })) return false;
    return !isBlocked(r, p.blocked);
  }

  function makePlan(recipes, p) {
    var eligible = recipes.filter(function (r) { return fits(r, p); });
    var scored = eligible.map(function (r) {
      var hits = r.plan.moods.filter(function (m) { return p.moods.indexOf(m) !== -1; }).length;
      return { r: r, price: priceFor(r, p.people),
               score: hits * 10 + (r.sale_ratio || 0) * 5 + jitter(p.seed, r.id) * 6 };
    });
    var pinned = scored.filter(function (x) { return p.pinned.indexOf(x.r.id) !== -1; });
    var rest = scored.filter(function (x) { return p.pinned.indexOf(x.r.id) === -1; })
      .sort(function (a, b) { return b.score - a.score; });
    var meals = [], total = 0, overBudget = 0;
    pinned.concat(rest).forEach(function (x) {
      if (meals.length >= DAYS.length) return;
      var isPinned = p.pinned.indexOf(x.r.id) !== -1;
      if (!isPinned && total + x.price > weeklyBudget(p)) { overBudget++; return; }
      meals.push(x);
      total += x.price;
    });
    return { meals: meals, total: Math.round(total * 100) / 100,
             eligible: eligible.length, overBudget: overBudget };
  }

  // --- Visning ---------------------------------------------------------------

  var state = { recipes: [], prefs: null, step: 0, root: null, hooks: {} };

  function kr(n) { return n.toFixed(2).replace('.', ',') + ' kr'; }
  function krRound(n) { return Math.round(n).toLocaleString('da-DK') + ' kr'; }

  function card(item, selected, group) {
    return '<button type="button" class="mp-card' + (selected ? ' is-selected' : '') +
      '" data-group="' + group + '" data-key="' + esc(item.key) + '" aria-pressed="' + selected + '">' +
      '<span class="mp-card-icon" aria-hidden="true">' + item.icon + '</span>' +
      '<span class="mp-card-label">' + esc(item.label) + '</span>' +
      '<span class="mp-check" aria-hidden="true">✓</span></button>';
  }

  function stepHtml(name, p) {
    if (name === 'people') {
      return head('Hvem laver du mad til?', 'Så passer mængder og priser til jer.') +
        counter('👥', 'Personer', p.people === 1 ? 'person' : 'personer', p.people, 'people', 1, PEOPLE_MAX);
    }
    if (name === 'budget') {
      var b = BUDGET[p.budgetPeriod];
      var seg = function (key, label) {
        var on = p.budgetPeriod === key;
        return '<button type="button" class="mp-seg-btn' + (on ? ' is-selected' : '') + '" data-period="' + key +
          '" aria-pressed="' + on + '">' + label + '</button>';
      };
      return head('Hvad er dit madbudget?', 'Træk til det beløb du gerne vil bruge.') +
        '<div class="mp-seg" role="group" aria-label="Budget pr.">' + seg('uge', 'Om ugen') + seg('maaned', 'Om måneden') + '</div>' +
        '<div class="mp-budget"><span class="mp-big" id="mpBudgetVal">' + krRound(p.budget) + '</span>' +
        '<span class="mp-muted">' + b.label + '</span></div>' +
        '<input type="range" class="mp-range" id="mpBudget" min="' + b.min + '" max="' + b.max +
        '" step="' + b.step + '" value="' + p.budget + '" aria-label="Budget ' + b.label + '">' +
        '<div class="mp-range-labels"><span>' + krRound(b.min) + '</span><span>' + krRound(b.max) + '</span></div>';
    }
    if (name === 'moods') {
      return head('Hvad har du lyst til?', 'Vælg op til 3.') + '<div class="mp-grid">' +
        MOODS.map(function (m) { return card(m, p.moods.indexOf(m.key) !== -1, 'moods'); }).join('') + '</div>';
    }
    if (name === 'diets') {
      return head('Har du særlige kostbehov?', 'Spring over, hvis du spiser alt.') + '<div class="mp-grid">' +
        DIETS.map(function (d) { return card(d, p.diets.indexOf(d.key) !== -1, 'diets'); }).join('') + '</div>';
    }
    if (name === 'blocked') {
      var chosen = p.blocked.map(function (b) {
        return '<button type="button" class="mp-chip is-selected" data-unblock="' + esc(b) +
          '" aria-label="Fjern ' + esc(b) + '">' + esc(b) + ' <span aria-hidden="true">×</span></button>';
      }).join('');
      return head('Er der noget du vil undgå?', 'Søg efter ingredienser, der ikke skal med i dine madplaner. Fjern en igen for at tillade den.') +
        '<div class="mp-search"><input type="text" id="mpBlockSearch" placeholder="Søg ingredienser..." autocomplete="off" aria-label="Søg ingredienser">' +
        '<div class="mp-suggest" id="mpSuggest"></div></div>' +
        (chosen ? '<div class="mp-chips">' + chosen + '</div>' : '') +
        '<h3 class="mp-sub">Populære</h3><div class="mp-pop">' +
        POPULAR.map(function (x) {
          var on = p.blocked.some(function (b) { return fold(b) === fold(x[0]); });
          return '<button type="button" class="mp-pop-item' + (on ? ' is-selected' : '') + '" data-block="' + esc(x[0]) +
            '" aria-pressed="' + on + '"><span class="mp-pop-icon" aria-hidden="true">' + x[1] + '</span>' + esc(x[0]) + '</button>';
        }).join('') + '</div>';
    }
    // kitchen
    return head('Hvad har du i køkkenet?', 'Vælg det udstyr du har.') + '<div class="mp-kitchen">' +
      KITCHEN.map(function (k) {
        var on = p.kitchen.indexOf(k.key) !== -1;
        return '<button type="button" class="mp-chip' + (on ? ' is-selected' : '') + '" data-group="kitchen" data-key="' + k.key +
          '" aria-pressed="' + on + '"><span aria-hidden="true">' + k.icon + '</span> ' + esc(k.label) + '</button>';
      }).join('') + '</div>';
  }

  // Én række med ikon, tekst og plus/minus (antal personer, aftener).
  function counter(icon, label, unit, value, key, min, max) {
    return '<div class="mp-counter"><span class="mp-counter-icon" aria-hidden="true">' + icon + '</span>' +
      '<div class="mp-counter-text"><strong>' + esc(label) + '</strong><span class="mp-muted">' + value + ' ' + esc(unit) + '</span></div>' +
      '<button type="button" class="mp-round" data-act="' + key + '-" aria-label="Færre ' + esc(label.toLowerCase()) + '"' + (value <= min ? ' disabled' : '') + '>−</button>' +
      '<span class="mp-counter-val" aria-live="polite">' + value + '</span>' +
      '<button type="button" class="mp-round mp-round--dark" data-act="' + key + '+" aria-label="Flere ' + esc(label.toLowerCase()) + '"' + (value >= max ? ' disabled' : '') + '>+</button></div>';
  }

  function head(title, sub) {
    return '<h2 class="mp-title">' + esc(title) + '</h2><p class="mp-muted mp-subtitle">' + esc(sub) + '</p>';
  }

  // Nyt trin = start øverst i spørgsmålet, ikke midt på siden.
  function toTop() {
    var y = state.root.getBoundingClientRect().top + window.pageYOffset - 140;
    if (window.pageYOffset > y) window.scrollTo(0, Math.max(0, y));
  }

  function renderWizard() {
    var p = state.prefs, name = STEPS[state.step];
    var last = state.step === STEPS.length - 1;
    var pct = Math.round(((state.step + 1) / STEPS.length) * 100);
    state.root.innerHTML =
      '<div class="mp-wizard" role="region" aria-label="Spørgsmål til din madplan">' +
      '<div class="mp-top"><button type="button" class="mp-back" data-act="back" aria-label="Tilbage"' +
      (state.step === 0 && !p.done ? ' style="visibility:hidden"' : '') + '>‹</button>' +
      '<div class="mp-progress" role="progressbar" aria-valuenow="' + (state.step + 1) + '" aria-valuemin="1" aria-valuemax="' + STEPS.length +
      '"><span style="width:' + pct + '%"></span></div>' +
      '<span class="mp-muted mp-count">' + (state.step + 1) + '/' + STEPS.length + '</span></div>' +
      '<div class="mp-body">' + stepHtml(name, p) + '</div>' +
      '<button type="button" class="mp-next" data-act="next"' +
      (name === 'kitchen' && !p.kitchen.length ? ' disabled' : '') + '>' +
      (last ? 'Lav min madplan' : 'Næste') + '</button></div>';
    if (name === 'budget') bindBudget();
    if (name === 'blocked') bindBlockSearch();
  }

  function bindBudget() {
    var input = document.getElementById('mpBudget');
    var val = document.getElementById('mpBudgetVal');
    input.addEventListener('input', function () {
      state.prefs.budget = parseInt(input.value, 10) || BUDGET[state.prefs.budgetPeriod].min;
      val.textContent = krRound(state.prefs.budget);
    });
  }

  function allIngredientNames() {
    var seen = {}, out = [];
    state.recipes.forEach(function (r) {
      ((r.plan && r.plan.ingredient_names) || []).forEach(function (n) {
        // "finthakket rødløg (ca. 150 g)" -> "finthakket rødløg"
        var short = String(n).split(/[(,]/)[0].replace(/[½¼¾\d]+/g, '').trim();
        var k = fold(short);
        if (k.length > 1 && !seen[k]) { seen[k] = 1; out.push(short); }
      });
    });
    return out;
  }

  function bindBlockSearch() {
    var input = document.getElementById('mpBlockSearch');
    var box = document.getElementById('mpSuggest');
    var names = allIngredientNames();
    input.addEventListener('input', function () {
      var q = fold(input.value);
      if (!q) { box.innerHTML = ''; return; }
      var hits = names.filter(function (n) { return fold(n).indexOf(q) !== -1; }).slice(0, 6);
      // Det man selv skriver kan altid vælges, også uden træf i opskrifterne.
      if (!hits.some(function (h) { return fold(h) === q; })) hits.unshift(input.value.trim());
      box.innerHTML = hits.map(function (h) {
        return '<button type="button" class="mp-suggest-item" data-block="' + esc(h) + '">' + esc(h) + '</button>';
      }).join('');
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); toggleBlock(input.value.trim(), true); }
    });
  }

  function toggleBlock(name, forceOn) {
    var p = state.prefs, k = fold(name);
    var idx = -1;
    p.blocked.forEach(function (b, i) { if (fold(b) === k) idx = i; });
    if (idx === -1) p.blocked.push(name);
    else if (!forceOn) p.blocked.splice(idx, 1);
    renderWizard();
  }

  function toggleIn(list, key, max) {
    var i = list.indexOf(key);
    if (i !== -1) { list.splice(i, 1); return true; }
    if (max && list.length >= max) return false;
    list.push(key);
    return true;
  }

  function onClick(e) {
    var t = e.target.closest('button');
    if (!t || !state.root.contains(t)) return;
    var p = state.prefs;
    var act = t.getAttribute('data-act');
    if (act === 'people-') { p.people = Math.max(1, p.people - 1); return renderWizard(); }
    if (act === 'people+') { p.people = Math.min(PEOPLE_MAX, p.people + 1); return renderWizard(); }
    if (act === 'back') {
      if (state.step > 0) { state.step--; renderWizard(); return toTop(); }
      return renderPlan();  // "Ret mine svar" fortrudt: tilbage til planen
    }
    if (act === 'next') {
      if (state.step < STEPS.length - 1) { state.step++; renderWizard(); return toTop(); }
      p.done = true;
      savePrefs(p);
      renderLoading();
      return toTop();
    }
    if (act === 'plan-people-' || act === 'plan-people+') {
      p.people = Math.min(PEOPLE_MAX, Math.max(1, p.people + (act === 'plan-people+' ? 1 : -1)));
      savePrefs(p);
      return renderPlan();
    }
    if (act === 'regen') {
      p.seed = (p.seed || 1) + 1;
      savePrefs(p);
      return renderPlan();
    }
    if (act === 'edit') { state.step = 0; renderWizard(); return toTop(); }
    if (act === 'pin') {
      toggleIn(p.pinned, parseInt(t.getAttribute('data-id'), 10));
      savePrefs(p);
      return renderPlan();
    }
    var group = t.getAttribute('data-group');
    if (group) {
      var key = t.getAttribute('data-key');
      if (group === 'moods' && !toggleIn(p.moods, key, 3)) {
        flash(t);
        return;
      }
      if (group === 'diets') toggleIn(p.diets, key);
      if (group === 'kitchen') toggleIn(p.kitchen, key);
      return renderWizard();
    }
    if (t.hasAttribute('data-period')) {
      var period = t.getAttribute('data-period');
      if (period !== p.budgetPeriod) {
        // Behold samme beløb omregnet, så skiftet ikke nulstiller budgettet.
        var weekly = weeklyBudget(p);
        p.budgetPeriod = period;
        p.budget = clampBudget(period === 'maaned' ? weekly * WEEKS_PER_MONTH : weekly, period);
      }
      return renderWizard();
    }
    if (t.hasAttribute('data-block')) return toggleBlock(t.getAttribute('data-block'));
    if (t.hasAttribute('data-unblock')) return toggleBlock(t.getAttribute('data-unblock'));
  }

  function flash(el) {
    el.classList.remove('mp-shake');
    void el.offsetWidth;
    el.classList.add('mp-shake');
  }

  // MadShoppers egen "tænker"-skærm: tre trin der krydses af, så man kan se
  // hvad der sker (opskrifter, priser, budget).
  function renderLoading() {
    var steps = ['Finder opskrifter der passer til jer', 'Tjekker priserne i butikkerne', 'Holder planen inden for budgettet'];
    state.root.innerHTML = '<div class="mp-loading" role="status">' +
      '<div class="mp-loading-icon" aria-hidden="true">🛒</div>' +
      '<h2 class="mp-title">Vi laver din madplan</h2><ul class="mp-checklist">' +
      steps.map(function (t, i) { return '<li style="animation-delay:' + (i * 0.35) + 's">' + esc(t) + '</li>'; }).join('') +
      '</ul></div>';
    setTimeout(renderPlan, 1400);
  }

  var MOOD_LABEL = {};
  MOODS.forEach(function (m) { MOOD_LABEL[m.key] = m; });

  // Opskrifter uden billede får en farvet flade med en ret-emoji, så kortene
  // ikke står grå. Farve og emoji følger id'et, så de ikke skifter.
  var PLACEHOLDER = ['🍲', '🥘', '🍝', '🥗', '🌮', '🍛'];

  function mealCard(x, i, p) {
    var r = x.r, pinned = p.pinned.indexOf(r.id) !== -1;
    var tags = r.plan.moods.filter(function (m) { return p.moods.indexOf(m) !== -1; }).slice(0, 2)
      .map(function (m) { return '<span class="mp-tag">' + MOOD_LABEL[m].icon + ' ' + esc(MOOD_LABEL[m].label) + '</span>'; }).join('');
    var img = r.image_url
      ? '<img src="' + esc(r.image_url) + '" alt="" loading="lazy">'
      : '<span class="mp-ph mp-ph-' + (r.id % 4) + '" aria-hidden="true">' + PLACEHOLDER[r.id % PLACEHOLDER.length] + '</span>';
    return '<article class="mp-mcard' + (pinned ? ' is-pinned' : '') + '" style="animation-delay:' + (i * 0.06) + 's">' +
      '<a class="mp-mcard-link" href="/opskrift/' + r.id + '" aria-label="' + DAYS[i] + ': ' + esc(r.title) + ', ca. ' + kr(x.price) + '">' +
      '<div class="mp-mcard-img' + (r.image_url ? ' has-img' : '') + '">' + img +
      '<span class="mp-mcard-day">' + DAYS[i] + '</span>' +
      '<span class="mp-mcard-price">ca. ' + krRound(x.price) + '</span></div>' +
      '<div class="mp-mcard-body"><h3>' + esc(r.title) + '</h3>' +
      (tags ? '<div class="mp-tags">' + tags + '</div>' : '') + '</div></a>' +
      '<button type="button" class="mp-mcard-pin' + (pinned ? ' is-selected' : '') + '" data-act="pin" data-id="' + r.id +
      '" aria-pressed="' + pinned + '" aria-label="' + (pinned ? 'Lås op: ' : 'Lås: ') + esc(r.title) + '">' +
      (pinned ? '🔒' : '🔓') + '</button></article>';
  }

  function renderPlan() {
    var p = state.prefs;
    var plan = makePlan(state.recipes, p);
    var week = weeklyBudget(p);
    var pct = Math.min(100, Math.round((plan.total / week) * 100));
    var over = plan.total > week;
    var left = week - plan.total;
    var n = plan.meals.length;
    var note = '';
    if (!n) {
      note = plan.eligible
        ? 'Ingen retter passer inden for budgettet. Prøv at sætte budgettet op.'
        : 'Ingen af vores opskrifter passer til dine svar endnu. Der kommer flere opskrifter løbende.';
    } else if (n < DAYS.length) {
      note = 'Vi fandt ' + n + (n === 1 ? ' ret' : ' retter') +
        ' der passer til dine svar og dit budget. Der kommer flere opskrifter løbende.';
    }
    // Ugens 7 dage som prikker: fyldt = der er en ret den dag.
    var dots = DAYS.map(function (d, i) {
      return '<span class="mp-dot' + (i < n ? ' is-on' : '') + '" title="' + d + '">' + d.charAt(0) + '</span>';
    }).join('');
    state.root.innerHTML =
      '<section class="mp-plan" aria-label="Din madplan">' +
      '<div class="mp-hero' + (over ? ' is-over' : '') + '">' +
      '<div class="mp-hero-top"><span class="mp-hero-kicker">Ugens madplan</span>' +
      '<button type="button" class="mp-hero-edit" data-act="edit">✏️ Ret svar</button></div>' +
      '<div class="mp-hero-main">' +
      '<div class="mp-ring" style="--pct:' + pct + '" role="img" aria-label="' + pct + ' procent af budgettet brugt">' +
      '<div class="mp-ring-in"><strong>' + pct + '%</strong><span>af budget</span></div></div>' +
      '<div class="mp-hero-text"><div class="mp-hero-price">' + krRound(plan.total) + '</div>' +
      '<div class="mp-hero-sub">for ' + n + (n === 1 ? ' ret' : ' retter') + ' · budget ' + krRound(week) + '</div>' +
      (p.budgetPeriod === 'maaned' ? '<div class="mp-hero-sub">Ugens del af ' + krRound(p.budget) + ' om måneden</div>' : '') +
      (n ? '<div class="mp-hero-left">' + (over ? '⚠️ ' + krRound(-left) + ' over budget' : '🎉 ' + krRound(left) + ' tilbage') + '</div>' : '') +
      '</div></div>' +
      '<div class="mp-hero-foot">' +
      // Antal personer kan skrues direkte her (fx ved gæster) uden at svare på
      // alle spørgsmålene igen. Det nye antal bliver standarden.
      '<div class="mp-guests"><button type="button" class="mp-mini" data-act="plan-people-" aria-label="Færre personer"' + (p.people <= 1 ? ' disabled' : '') + '>−</button>' +
      '<span aria-live="polite">👥 <strong>' + p.people + '</strong> ' + (p.people === 1 ? 'person' : 'personer') + '</span>' +
      '<button type="button" class="mp-mini" data-act="plan-people+" aria-label="Flere personer"' + (p.people >= PEOPLE_MAX ? ' disabled' : '') + '>+</button></div>' +
      '<div class="mp-dots" aria-hidden="true">' + dots + '</div></div></div>' +
      (note ? '<p class="mp-note">' + esc(note) + '</p>' : '') +
      (n ? '<p class="mp-muted mp-hint">Tryk 🔓 på de retter du vil beholde, og bland resten.</p>' : '') +
      '<div class="mp-meals">' + plan.meals.map(function (x, i) { return mealCard(x, i, p); }).join('') + '</div>' +
      '<button type="button" class="mp-shuffle" data-act="regen">🎲 Bland ugen</button>' +
      '<p class="mp-muted mp-hint">Prisen er for hele pakker i den billigste butik. Har du noget i forvejen, bliver det billigere.</p>' +
      '</section>';
    if (state.hooks.onPlan) state.hooks.onPlan();
  }

  window.MadPlan = {
    init: function (root, recipes, hooks) {
      state.root = root;
      state.recipes = recipes || [];
      state.hooks = hooks || {};
      state.prefs = loadPrefs();
      if (!state.root.dataset.bound) {
        state.root.addEventListener('click', onClick);
        state.root.dataset.bound = '1';
      }
      if (state.prefs && state.prefs.done) renderPlan();
      else { state.prefs = state.prefs || defaults(); state.step = 0; renderWizard(); }
      return !!(state.prefs && state.prefs.done);
    },
    // Til tests: samme regler som appen.
    _makePlan: makePlan,
    _priceFor: priceFor
  };
})();
