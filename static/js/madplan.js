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

  // Ikonerne er Ionicons-navne (static/js/ms-icons.js), samme som appen.
  // Ingen emoji i opskrift-delen (C2, 31-10-2026).
  var MOODS = [
    { key: 'hurtig', label: 'Hurtige retter', icon: 'timer-outline' },
    { key: 'let', label: 'Lav kalorie', icon: 'leaf-outline' },
    { key: 'familie', label: 'Familievenlig', icon: 'people-outline' },
    { key: 'sund', label: 'Sund og mættende', icon: 'heart-outline' },
    { key: 'takeaway', label: 'Hjemmelavet takeaway', icon: 'bag-handle-outline' },
    { key: 'protein', label: 'Proteinrig', icon: 'barbell-outline' }
  ];
  var DIETS = [
    { key: 'vegansk', label: 'Vegansk', icon: 'leaf-outline' },
    { key: 'vegetar', label: 'Vegetar', icon: 'nutrition-outline' },
    { key: 'pescetar', label: 'Pescetar', icon: 'fish-outline' },
    { key: 'glutenfri', label: 'Glutenfri', icon: 'ban-outline' },
    { key: 'maelkefri', label: 'Mælkefri', icon: 'water-outline' }
  ];
  // "Populære" ingredienser: kun tekst.
  var POPULAR = [
    'Hvidløg', 'Æg', 'Løg', 'Soja', 'Mælk', 'Citron', 'Ingefær', 'Gulerod',
    'Tomat', 'Svampe', 'Græsk yoghurt', 'Peanuts', 'Kylling', 'Kartoffel', 'Fløde', 'Agurk',
    'Koriander', 'Fisk', 'Chili', 'Ost'
  ];
  var KITCHEN = [
    { key: 'ovn', label: 'Ovn', icon: 'flame-outline' },
    { key: 'kogeplade', label: 'Kogeplade', icon: 'grid-outline' },
    { key: 'airfryer', label: 'Airfryer', icon: 'thermometer-outline' },
    { key: 'mikroovn', label: 'Mikroovn', icon: 'tv-outline' },
    { key: 'blender', label: 'Blender eller foodprocessor', short: 'Blender', icon: 'beaker-outline' },
    { key: 'stavblender', label: 'Stavblender', icon: 'color-wand-outline' },
    { key: 'roeremaskine', label: 'Røremaskine', icon: 'cog-outline' },
    { key: 'haandmixer', label: 'Håndmixer', icon: 'git-merge-outline' },
    { key: 'grill', label: 'Grill', icon: 'bonfire-outline' },
    { key: 'slowcooker', label: 'Slowcooker eller trykkoger', short: 'Slowcooker', icon: 'time-outline' },
    { key: 'elkedel', label: 'Elkedel', icon: 'cafe-outline' },
    { key: 'broedrister', label: 'Brødrister', icon: 'albums-outline' }
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

  // --- Visning (design C2, 31-10-2026: samme udseende som appens
  // MealPlanWizard/MealPlanView; stilen ligger under html.c2 i styles.css) --

  var state = { recipes: [], prefs: null, step: 0, root: null, hooks: {} };
  var OPTIONAL = ['diets', 'blocked'];
  var MAX_MOODS = 3;
  var QUICK_BUDGET = { uge: [300, 500, 750, 1000], maaned: [1500, 2000, 3000, 4000] };

  function ic(name, size, cls) { return window.MSIcon ? window.MSIcon(name, size, cls) : ''; }
  function kr(n) { return n.toFixed(2).replace('.', ',') + ' kr'; }
  function krRound(n) { return Math.round(n).toLocaleString('da-DK') + ' kr'; }

  function card(item, selected, group) {
    return '<button type="button" class="mp-card' + (selected ? ' is-selected' : '') +
      '" data-group="' + group + '" data-key="' + esc(item.key) + '" aria-pressed="' + selected + '">' +
      '<span class="mp-card-icon">' + ic(item.icon, 22) + '</span>' +
      '<span class="mp-card-label">' + esc(item.label) + '</span>' +
      (selected ? '<span class="mp-check">' + ic('checkmark', 14) + '</span>' : '') + '</button>';
  }

  function quick(label, selected, attrs) {
    return '<button type="button" class="mp-quick' + (selected ? ' is-selected' : '') + '" ' + attrs +
      ' aria-pressed="' + selected + '">' + esc(label) + '</button>';
  }

  function stepHtml(name, p) {
    if (name === 'people') {
      var unit = p.people === 1 ? 'person' : 'personer';
      return head('Hvem laver du mad til?', 'Så passer mængder og priser til jer.') +
        '<div class="mp-bigcard">' + '<span class="mp-bigcard-icon">' + ic('people-outline', 34) + '</span>' +
        '<div class="mp-counter-row">' +
        '<button type="button" class="mp-round" data-act="people-" aria-label="Færre personer"' + (p.people <= 1 ? ' disabled' : '') + '>' + ic('remove', 28) + '</button>' +
        '<div class="mp-counter-mid" aria-live="polite"><span class="mp-huge">' + p.people + '</span><span class="mp-muted">' + unit + '</span></div>' +
        '<button type="button" class="mp-round mp-round--dark" data-act="people+" aria-label="Flere personer"' + (p.people >= PEOPLE_MAX ? ' disabled' : '') + '>' + ic('add', 28) + '</button>' +
        '</div></div>' +
        '<div class="mp-smallhead">Hurtigt valg</div><div class="mp-quickrow">' +
        [1, 2, 3, 4, 5].map(function (n) {
          return quick(n === 5 ? '5+' : String(n), n === 5 ? p.people >= 5 : p.people === n, 'data-people="' + n + '"');
        }).join('') + '</div>' +
        '<p class="mp-note">Du kan altid ændre antallet i madplanen, fx når I får gæster.</p>';
    }
    if (name === 'budget') {
      var b = BUDGET[p.budgetPeriod];
      var seg = function (key, label) {
        var on = p.budgetPeriod === key;
        return '<button type="button" class="mp-seg-btn' + (on ? ' is-selected' : '') + '" data-period="' + key +
          '" aria-pressed="' + on + '">' + label + '</button>';
      };
      return head('Hvad er dit madbudget?', 'Træk til det beløb, du gerne vil bruge.') +
        '<div class="mp-seg" role="group" aria-label="Budget pr.">' + seg('uge', 'Om ugen') + seg('maaned', 'Om måneden') + '</div>' +
        '<div class="mp-budgetcard"><div class="mp-budget-amount"><span class="mp-huge" id="mpBudgetVal">' +
        Math.round(p.budget).toLocaleString('da-DK') + '</span><span class="mp-budget-kr">kr</span></div>' +
        '<div class="mp-budget-sub" id="mpBudgetSub">' + budgetSub(p) + '</div>' +
        '<input type="range" class="mp-range" id="mpBudget" min="' + b.min + '" max="' + b.max +
        '" step="' + b.step + '" value="' + p.budget + '" aria-label="Budget ' + b.label + '" style="--pct:' + budgetPct(p) + '%">' +
        '<div class="mp-range-labels"><span>' + krRound(b.min) + '</span><span>' + krRound(b.max) + '</span></div></div>' +
        '<div class="mp-quickrow mp-quickrow--budget">' +
        QUICK_BUDGET[p.budgetPeriod].map(function (v) {
          var val = clampBudget(v, p.budgetPeriod);
          return quick(krRound(val), p.budget === val, 'data-budget="' + val + '"');
        }).join('') + '</div>';
    }
    if (name === 'moods') {
      return head('Hvad har du lyst til?', 'Vælg op til 3. Vi blander retterne efter det.') + '<div class="mp-grid">' +
        MOODS.map(function (m) { return card(m, p.moods.indexOf(m.key) !== -1, 'moods'); }).join('') + '</div>' +
        '<p class="mp-note" aria-live="polite">' + p.moods.length + ' af ' + MAX_MOODS + ' valgt</p>';
    }
    if (name === 'diets') {
      return head('Har du særlige kostbehov?', 'Spring over, hvis du spiser alt.') + '<div class="mp-grid">' +
        DIETS.map(function (d) { return card(d, p.diets.indexOf(d.key) !== -1, 'diets'); }).join('') + '</div>';
    }
    if (name === 'blocked') {
      var isOn = function (n) { return p.blocked.some(function (b) { return fold(b) === fold(n); }); };
      var chosen = p.blocked.map(function (b) {
        return '<button type="button" class="mp-darkpill" data-unblock="' + esc(b) +
          '" aria-label="Fjern ' + esc(b) + '">' + esc(b) + '<span class="mp-darkpill-x">' + ic('close', 14) + '</span></button>';
      }).join('');
      return head('Er der noget, du vil undgå?', 'Vi bruger dem ikke i dine madplaner. Fjern en igen for at tillade den.') +
        '<div class="mp-search">' + ic('search', 20) +
        '<input type="text" id="mpBlockSearch" placeholder="Søg efter en ingrediens" autocomplete="off" aria-label="Søg efter en ingrediens"></div>' +
        '<div class="mp-chips mp-suggest" id="mpSuggest"></div>' +
        (chosen ? '<div class="mp-smallhead">Undgår du (' + p.blocked.length + ')</div><div class="mp-chips">' + chosen + '</div>' : '') +
        '<div class="mp-smallhead">Populære</div><div class="mp-chips">' +
        POPULAR.filter(function (n) { return !isOn(n); }).map(function (n) {
          return '<button type="button" class="mp-addpill" data-block="' + esc(n) + '" aria-label="Undgå ' + esc(n) + '">' +
            ic('add', 16) + esc(n) + '</button>';
        }).join('') + '</div>';
    }
    // kitchen
    return head('Hvad har du i køkkenet?', 'Vælg det udstyr, du har. Så foreslår vi kun retter, du kan lave.') + '<div class="mp-kitchen">' +
      KITCHEN.map(function (k) {
        var on = p.kitchen.indexOf(k.key) !== -1;
        return '<button type="button" class="mp-kcell' + (on ? ' is-selected' : '') + '" data-group="kitchen" data-key="' + k.key +
          '" aria-pressed="' + on + '" aria-label="' + esc(k.label) + '">' + ic(k.icon, 30) +
          '<span>' + esc(k.short || k.label) + '</span>' +
          (on ? '<span class="mp-check mp-check--small">' + ic('checkmark', 12) + '</span>' : '') + '</button>';
      }).join('') + '</div>';
  }

  function budgetPct(p) {
    var b = BUDGET[p.budgetPeriod];
    return Math.round(Math.min(1, Math.max(0, (p.budget - b.min) / (b.max - b.min))) * 100);
  }

  function budgetSub(p) {
    var perDay = Math.round(weeklyBudget(p) / Math.max(1, p.people) / 7);
    return BUDGET[p.budgetPeriod].label + ' · ca. ' + perDay + ' kr pr. person pr. dag';
  }

  function head(title, sub) {
    return '<div class="mp-steplabel">Trin ' + (state.step + 1) + ' af ' + STEPS.length + '</div>' +
      '<h2 class="mp-title">' + esc(title) + '</h2><p class="mp-subtitle">' + esc(sub) + '</p>';
  }

  // Nyt trin = start øverst i spørgsmålet, ikke midt på siden.
  function toTop() {
    var y = state.root.getBoundingClientRect().top + window.pageYOffset - 140;
    if (window.pageYOffset > y) window.scrollTo(0, Math.max(0, y));
  }

  function renderWizard() {
    var p = state.prefs, name = STEPS[state.step];
    var last = state.step === STEPS.length - 1;
    var canBack = state.step > 0 || p.done;
    var bars = STEPS.map(function (s, i) {
      return '<span class="' + (i <= state.step ? 'is-on' : '') + '"></span>';
    }).join('');
    state.root.innerHTML =
      '<div class="mp-wizard" role="region" aria-label="Spørgsmål til din madplan">' +
      '<div class="mp-top"><div class="mp-top-side">' +
      (canBack ? '<button type="button" class="mp-back" data-act="back" aria-label="Tilbage">' + ic('chevron-back', 22) + '</button>' : '') +
      '</div><div class="mp-progress" role="progressbar" aria-valuenow="' + (state.step + 1) + '" aria-valuemin="1" aria-valuemax="' +
      STEPS.length + '" aria-label="Trin ' + (state.step + 1) + ' af ' + STEPS.length + '">' + bars + '</div>' +
      '<div class="mp-top-side mp-top-side--right">' +
      (OPTIONAL.indexOf(name) !== -1 ? '<button type="button" class="mp-skip" data-act="skip">Spring over</button>' : '') +
      '</div></div>' +
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
    var sub = document.getElementById('mpBudgetSub');
    input.addEventListener('input', function () {
      state.prefs.budget = parseInt(input.value, 10) || BUDGET[state.prefs.budgetPeriod].min;
      val.textContent = Math.round(state.prefs.budget).toLocaleString('da-DK');
      sub.textContent = budgetSub(state.prefs);
      input.style.setProperty('--pct', budgetPct(state.prefs) + '%');
    });
    // Hurtigvalgene følger med, når man slipper skyderen.
    input.addEventListener('change', renderWizard);
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
        return '<button type="button" class="mp-addpill" data-block="' + esc(h) + '">' + ic('add', 16) + esc(h) + '</button>';
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

  function next() {
    var p = state.prefs;
    if (state.step < STEPS.length - 1) { state.step++; renderWizard(); return toTop(); }
    p.done = true;
    savePrefs(p);
    renderLoading();
    return toTop();
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
      return renderPlan();  // "Ret svar" fortrudt: tilbage til planen
    }
    if (act === 'next' || act === 'skip') return next();
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
    if (t.hasAttribute('data-people')) { p.people = parseInt(t.getAttribute('data-people'), 10); return renderWizard(); }
    if (t.hasAttribute('data-budget')) { p.budget = parseInt(t.getAttribute('data-budget'), 10); return renderWizard(); }
    var group = t.getAttribute('data-group');
    if (group) {
      var key = t.getAttribute('data-key');
      if (group === 'moods' && !toggleIn(p.moods, key, MAX_MOODS)) {
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

  // "Vi laver din madplan": en ring drejer, og tre linjer krydses af.
  function renderLoading() {
    var p = state.prefs;
    var steps = ['Finder retter, der passer til jer', 'Tjekker priserne i butikkerne', 'Holder planen inden for budgettet'];
    state.root.innerHTML = '<div class="mp-loading" role="status">' +
      '<div class="mp-loading-circle"><span class="mp-loading-ring"></span>' + ic('restaurant-outline', 52) + '</div>' +
      '<h2 class="mp-title">Vi laver din madplan</h2>' +
      '<p class="mp-loading-sub">' + p.people + (p.people === 1 ? ' person' : ' personer') + ' · ' +
      krRound(p.budget) + ' ' + BUDGET[p.budgetPeriod].label + '</p>' +
      '<ul class="mp-checklist">' +
      steps.map(function (t, i) {
        return '<li class="' + (i ? 'is-waiting' : 'is-current') + '"><span class="mp-cl-mark">' + ic('checkmark', 15) + '</span>' + esc(t) + '</li>';
      }).join('') + '</ul></div>';
    var items = state.root.querySelectorAll('.mp-checklist li');
    function mark(n) {
      Array.prototype.forEach.call(items, function (li, i) {
        li.className = i < n ? 'is-done' : i === n ? 'is-current' : 'is-waiting';
      });
    }
    setTimeout(function () { mark(1); }, 450);
    setTimeout(function () { mark(2); }, 900);
    setTimeout(renderPlan, 1400);
  }

  function mealRow(x, i, p) {
    var r = x.r, pinned = p.pinned.indexOf(r.id) !== -1;
    var img = r.image_url
      ? '<img src="' + esc(r.image_url) + '" alt="" loading="lazy">'
      : '<span class="mp-ph">' + ic('restaurant-outline', 30) + '</span>';
    var time = r.total_time_minutes ? ' · ' + r.total_time_minutes + ' min' : '';
    return '<div class="mp-row">' +
      '<a class="mp-row-link" href="/opskrift/' + r.id + '" aria-label="' + DAYS[i] + ': ' + esc(r.title) + ', ca. ' + kr(x.price) + '">' +
      '<span class="mp-row-img">' + img + '</span><span class="mp-row-text">' +
      '<span class="mp-row-day">' + DAYS[i] + '</span>' +
      '<span class="mp-row-title">' + esc(r.title) + '</span>' +
      '<span class="mp-row-meta">ca. ' + krRound(x.price) + time + '</span></span></a>' +
      '<button type="button" class="mp-pin' + (pinned ? ' is-selected' : '') + '" data-act="pin" data-id="' + r.id +
      '" aria-pressed="' + pinned + '" aria-label="' + (pinned ? 'Lås op: ' : 'Lås: ') + esc(r.title) + '">' +
      ic(pinned ? 'lock-closed' : 'lock-open-outline', 18) + '</button></div>';
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
        ', der passer til dine svar og dit budget. Der kommer flere opskrifter løbende.';
    }
    state.root.innerHTML =
      '<section class="mp-plan" aria-label="Din madplan">' +
      '<div class="mp-banner' + (over ? ' is-over' : '') + '">' +
      '<div class="mp-banner-top"><span class="mp-kicker">Ugens madplan · ' + n + (n === 1 ? ' ret' : ' retter') + '</span>' +
      '<button type="button" class="mp-edit" data-act="edit">' + ic('pencil', 13) + 'Ret svar</button></div>' +
      '<div class="mp-amount"><span class="mp-amount-big">' + krRound(plan.total) + '</span>' +
      '<span class="mp-amount-of">af ' + krRound(week) + ' om ugen</span></div>' +
      (p.budgetPeriod === 'maaned' ? '<div class="mp-amount-of">Ugens del af ' + krRound(p.budget) + ' om måneden</div>' : '') +
      '<div class="mp-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="' +
      pct + ' procent af budgettet brugt"><span style="width:' + pct + '%"></span></div>' +
      '<div class="mp-banner-foot">' +
      (n ? '<span class="mp-left">' + (over ? krRound(-left) + ' over budget' : krRound(left) + ' tilbage') + '</span>' : '<span></span>') +
      // Antal personer kan skrues direkte her (fx ved gæster) uden at svare på
      // alle spørgsmålene igen. Det nye antal bliver standarden.
      '<div class="mp-people"><button type="button" data-act="plan-people-" aria-label="Færre personer"' + (p.people <= 1 ? ' disabled' : '') + '>−</button>' +
      '<span aria-live="polite">' + p.people + ' ' + (p.people === 1 ? 'person' : 'personer') + '</span>' +
      '<button type="button" data-act="plan-people+" aria-label="Flere personer"' + (p.people >= PEOPLE_MAX ? ' disabled' : '') + '>+</button></div>' +
      '</div></div>' +
      '<div class="mp-sectionhead"><h2>Denne uge</h2>' + (n ? '<span>Lås dem, du vil beholde</span>' : '') + '</div>' +
      (note ? '<p class="mp-note mp-note--top">' + esc(note) + '</p>' : '') +
      (n ? '<div class="mp-list">' + plan.meals.map(function (x, i) { return mealRow(x, i, p); }).join('') + '</div>' : '') +
      '<button type="button" class="mp-shuffle" data-act="regen">' + ic('shuffle', 20) + 'Bland ugen</button>' +
      '<p class="mp-hint">Prisen er for hele pakker i den billigste butik. Har du noget i forvejen, bliver det billigere.</p>' +
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
