/**
 * Varestatistik (Feature-panelet 'stats' i /admin) - appens udgave af
 * static/js/script.js::queueStat.
 *
 * Tæller hvilke varer der åbnes (ProductDetailScreen) og hvad der søges efter
 * (SearchScreen). Samles og sendes højst hvert 15. sekund, og når appen går i
 * baggrunden, som ét /api/cart-event-kald pr. slags - så det ikke æder af
 * grænsen på 20 kald/min. Kun tal: intet bruger-id, ingen login-token.
 *
 * Sender kun, når /api/home siger stats_enabled (funktionen er udgivet i
 * Feature-panelet, eller det er dev.madshopper.dk). Serveren tjekker selv
 * flaget igen, så en gammel app kan aldrig tælle før udgivelsen.
 */
import { AppState } from 'react-native';
import { apiPost } from '../api/client';

const FLUSH_MS = 15000;
const MAX_ITEMS = 50; // = _CART_EVENT_MAX_IDS i app.py
const MAX_TERMS = 10; // = _SEARCH_TERMS_MAX i app.py

let enabled = false;
const views = new Map<string, number>();
const searches: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** Kaldes af HomeScreen og SearchScreen med /api/home's stats_enabled. */
export function setServerStatsEnabled(on: boolean | undefined) {
  enabled = !!on;
  if (!enabled) {
    views.clear();
    searches.length = 0;
  }
}

function send(body: unknown) {
  apiPost('/api/cart-event', body).catch(() => {
    /* statistik er bedst-muligt; en tabt pakke er ligegyldig */
  });
}

export function flushStats() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (views.size) {
    const items = Array.from(views, ([id, qty]) => ({ id, qty })).slice(0, MAX_ITEMS);
    views.clear();
    send({ event: 'view', items });
  }
  if (searches.length) {
    send({ event: 'search', terms: searches.splice(0, MAX_TERMS) });
    searches.length = 0;
  }
}

function schedule() {
  if (!timer) timer = setTimeout(flushStats, FLUSH_MS);
}

export function trackView(productId: string | number | undefined | null) {
  if (!enabled || productId == null || productId === '') return;
  const id = String(productId);
  views.set(id, (views.get(id) || 0) + 1);
  schedule();
}

export function trackSearch(term: string) {
  const t = term.trim().toLowerCase().slice(0, 40);
  if (!enabled || t.length < 2 || searches.length >= MAX_TERMS) return;
  searches.push(t);
  schedule();
}

// Lukkes appen eller skiftes der væk, sendes det samlede med det samme.
AppState.addEventListener('change', (state) => {
  if (state !== 'active' && (views.size || searches.length)) flushStats();
});
