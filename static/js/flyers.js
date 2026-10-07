/**
 * Butikkernes tilbudsaviser (Feature-panelet 'flyers').
 *
 * Forsiden viser logoerne for de valgte butikker; et tryk åbner butikkens
 * tilbudsavis som overlay, så man aldrig forlader siden. Listen over aviser og
 * deres sider hentes direkte fra Tjek (eTilbudsavis) i browseren, og siderne
 * er billeder fra Tjeks egen billed-CDN. Intet går gennem workeren, D1, KV
 * eller Supabase, og intet gemmes hos os. Appen gør det samme
 * (apps/mobile/src/flyers/).
 */
(function () {
    'use strict';

    const TJEK_API = 'https://squid-api.tjek.com/v2';
    const section = document.getElementById('flyersSection');
    if (!section) return;

    const buttons = Array.from(section.querySelectorAll('.flyer-logo'));
    // dealer-id -> aviser, sorteret så ugens avis står først.
    let catalogsByDealer = null;

    function escapeText(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    /** Samme rækkefølge som appen (apps/mobile/src/flyers/flyers.ts). */
    function sortCatalogs(list, now) {
        const DAY = 86400000;
        const rank = (c) => {
            const from = Date.parse(c.run_from);
            const till = Date.parse(c.run_till);
            if (from > now) return 2;              // kommende uge
            return (till - from) <= 8 * DAY ? 0 : 1; // ugeavis før lange kataloger
        };
        return list.slice().sort((a, b) =>
            rank(a) - rank(b)
            || Date.parse(a.run_from) - Date.parse(b.run_from)
            || (b.page_count || 0) - (a.page_count || 0));
    }

    async function loadCatalogs() {
        const ids = buttons.map(b => b.dataset.tjek).join(',');
        const url = `${TJEK_API}/catalogs?dealer_ids=${encodeURIComponent(ids)}&limit=100`;
        const res = await fetch(url, { credentials: 'omit' });
        if (!res.ok) throw new Error('Tjek ' + res.status);
        const data = await res.json();
        const now = Date.now();
        const byDealer = {};
        (Array.isArray(data) ? data : []).forEach(c => {
            if (!c || !c.dealer_id || !(c.page_count > 0)) return;
            if (!(c.types || []).includes('paged')) return;
            if (Date.parse(c.run_till) < now) return;
            (byDealer[c.dealer_id] = byDealer[c.dealer_id] || []).push(c);
        });
        Object.keys(byDealer).forEach(k => { byDealer[k] = sortCatalogs(byDealer[k], now); });
        return byDealer;
    }

    function isSelected(label) {
        return typeof isStoreSelected !== 'function' || isStoreSelected(label);
    }

    /** Skjul logoer for fravalgte butikker og butikker uden en avis lige nu. */
    function refreshLogos() {
        let visible = 0;
        buttons.forEach(btn => {
            const hasCatalog = !catalogsByDealer || !!catalogsByDealer[btn.dataset.tjek];
            const show = hasCatalog && isSelected(btn.dataset.label);
            btn.hidden = !show;
            if (show) visible++;
        });
        section.hidden = catalogsByDealer !== null && visible === 0;
    }
    document.addEventListener('madshopper:stores', refreshLogos);

    // --- Overlay -----------------------------------------------------------
    let overlay = null;
    let state = null; // { label, catalogs, catalog, pages, index }
    let lastFocus = null;

    function buildOverlay() {
        overlay = document.createElement('div');
        overlay.className = 'flyer-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'flyerTitle');
        overlay.innerHTML = `
            <div class="flyer-top">
              <div class="flyer-heading">
                <h2 id="flyerTitle" class="flyer-title"></h2>
                <div class="flyer-tabs" role="tablist" aria-label="Aviser"></div>
              </div>
              <button type="button" class="flyer-close" aria-label="Luk avisen">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div class="flyer-stage">
              <button type="button" class="flyer-nav flyer-prev" aria-label="Forrige side">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <div class="flyer-page-wrap">
                <img class="flyer-page" alt="" decoding="async">
                <div class="flyer-status" role="status" aria-live="polite"></div>
              </div>
              <button type="button" class="flyer-nav flyer-next" aria-label="Næste side">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </div>
            <div class="flyer-bottom">
              <span class="flyer-counter" aria-live="polite"></span>
              <span class="flyer-source">Kilde: eTilbudsavis</span>
            </div>`;
        document.body.appendChild(overlay);

        overlay.querySelector('.flyer-close').addEventListener('click', closeViewer);
        overlay.querySelector('.flyer-prev').addEventListener('click', () => go(-1));
        overlay.querySelector('.flyer-next').addEventListener('click', () => go(1));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.classList.contains('flyer-stage')) closeViewer();
        });
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); closeViewer(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
            else if (e.key === 'Tab') trapFocus(e);
        });

        // Swipe mellem siderne på telefon. Kun vandrette bevægelser tæller,
        // så man stadig kan zoome og rulle på siden.
        const wrap = overlay.querySelector('.flyer-page-wrap');
        let sx = 0, sy = 0, tracking = false;
        wrap.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) { tracking = false; return; }
            tracking = true;
            sx = e.touches[0].clientX; sy = e.touches[0].clientY;
        }, { passive: true });
        wrap.addEventListener('touchend', (e) => {
            if (!tracking || !e.changedTouches.length) return;
            tracking = false;
            if (window.visualViewport && window.visualViewport.scale > 1.05) return;
            const dx = e.changedTouches[0].clientX - sx;
            const dy = e.changedTouches[0].clientY - sy;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
        }, { passive: true });

        const img = overlay.querySelector('.flyer-page');
        img.addEventListener('load', () => setStatus(''));
        img.addEventListener('error', () => setStatus('Siden kunne ikke hentes. Prøv igen om lidt.'));
    }

    function trapFocus(e) {
        const focusables = Array.from(overlay.querySelectorAll('button:not([disabled])'));
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    function setStatus(text) {
        const el = overlay.querySelector('.flyer-status');
        el.textContent = text;
        el.hidden = !text;
    }

    function renderTabs() {
        const tabs = overlay.querySelector('.flyer-tabs');
        tabs.hidden = state.catalogs.length < 2;
        tabs.innerHTML = state.catalogs.map((c, i) => {
            const active = c.id === state.catalog.id;
            const upcoming = Date.parse(c.run_from) > Date.now();
            const from = new Date(c.run_from);
            const label = (c.label || 'Avis').trim()
                + (upcoming ? ` (fra ${from.getDate()}/${from.getMonth() + 1})` : '');
            return `<button type="button" role="tab" class="flyer-tab${active ? ' active' : ''}"
                aria-selected="${active}" data-i="${i}">${escapeText(label)}</button>`;
        }).join('');
        tabs.querySelectorAll('.flyer-tab').forEach(btn => {
            btn.addEventListener('click', () => openCatalog(state.catalogs[+btn.dataset.i]));
        });
    }

    function showPage() {
        const page = state.pages[state.index];
        const img = overlay.querySelector('.flyer-page');
        const total = state.pages.length;
        if (!page) return;
        setStatus('Henter siden …');
        img.src = page.view;
        img.srcset = `${page.view} 700w, ${page.zoom} 1400w`;
        img.sizes = '(max-width: 760px) 100vw, 700px';
        img.alt = `${state.label}, ${state.catalog.label || 'tilbudsavis'}, side ${state.index + 1} af ${total}`;
        overlay.querySelector('.flyer-counter').textContent = `Side ${state.index + 1} af ${total}`;
        overlay.querySelector('.flyer-prev').disabled = state.index === 0;
        overlay.querySelector('.flyer-next').disabled = state.index >= total - 1;
        // Hent næste side i forvejen, så bladring føles øjeblikkelig.
        const next = state.pages[state.index + 1];
        if (next) { const pre = new Image(); pre.src = next.view; }
    }

    function go(delta) {
        if (!state || !state.pages.length) return;
        const i = Math.min(Math.max(state.index + delta, 0), state.pages.length - 1);
        if (i === state.index) return;
        state.index = i;
        showPage();
    }

    async function openCatalog(catalog) {
        state.catalog = catalog;
        state.pages = [];
        state.index = 0;
        renderTabs();
        overlay.querySelector('.flyer-page').removeAttribute('src');
        overlay.querySelector('.flyer-page').removeAttribute('srcset');
        overlay.querySelector('.flyer-counter').textContent = '';
        setStatus('Henter avisen …');
        try {
            const res = await fetch(`${TJEK_API}/catalogs/${encodeURIComponent(catalog.id)}/pages`, { credentials: 'omit' });
            if (!res.ok) throw new Error('Tjek ' + res.status);
            const pages = await res.json();
            if (state.catalog !== catalog) return; // brugeren skiftede avis imens
            state.pages = (Array.isArray(pages) ? pages : []).filter(p => p && p.view);
            if (!state.pages.length) throw new Error('Ingen sider');
            showPage();
        } catch (err) {
            if (state.catalog === catalog) setStatus('Avisen kunne ikke hentes. Prøv igen om lidt.');
        }
    }

    async function openViewer(btn) {
        if (!catalogsByDealer) {
            try { await start(); } catch (_) { return; }
        }
        const catalogs = (catalogsByDealer && catalogsByDealer[btn.dataset.tjek]) || [];
        if (!catalogs.length) return;
        if (!overlay) buildOverlay();
        lastFocus = btn;
        state = { label: btn.dataset.label, catalogs, catalog: null, pages: [], index: 0 };
        overlay.querySelector('.flyer-title').textContent = `Tilbudsavis fra ${btn.dataset.label}`;
        overlay.classList.add('active');
        document.body.classList.add('flyer-open');
        overlay.querySelector('.flyer-close').focus();
        openCatalog(catalogs[0]);
    }

    function closeViewer() {
        if (!overlay) return;
        overlay.classList.remove('active');
        document.body.classList.remove('flyer-open');
        state = null;
        if (lastFocus) lastFocus.focus();
    }

    buttons.forEach(btn => btn.addEventListener('click', () => openViewer(btn)));

    // Listen hentes først, når sektionen er ved at komme til syne, så
    // forsiden ikke venter på Tjek.
    let loading = null;
    function start() {
        if (!loading) {
            loading = loadCatalogs().then(byDealer => {
                catalogsByDealer = byDealer;
                refreshLogos();
            }).catch(err => {
                // Tjek svarer ikke: skjul sektionen hellere end at vise
                // logoer, der ikke kan åbnes.
                section.hidden = true;
                throw err;
            });
        }
        return loading;
    }
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            if (entries.some(e => e.isIntersecting)) { io.disconnect(); start().catch(() => {}); }
        }, { rootMargin: '300px' });
        io.observe(section);
    } else {
        start().catch(() => {});
    }
    refreshLogos();
})();
