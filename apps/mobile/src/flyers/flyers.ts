/**
 * Butikkernes tilbudsaviser (Feature-panelet 'flyers' i /admin).
 *
 * Samme som hjemmesiden (static/js/flyers.js): listen over aviser og deres
 * sider hentes direkte fra Tjek (eTilbudsavis), og siderne vises fra Tjeks
 * billed-CDN. Intet går gennem vores server, og intet gemmes hos os.
 */
const TJEK_API = 'https://squid-api.tjek.com/v2';
const DAY_MS = 86400000;

export type FlyerCatalog = {
  id: string;
  dealer_id: string;
  label: string;
  run_from: string;
  run_till: string;
  page_count: number;
  types?: string[];
};

export type FlyerPage = { thumb?: string; view: string; zoom?: string };

/** Ugens avis først, så lange kataloger, til sidst næste uges avis. */
export function sortCatalogs(list: FlyerCatalog[], now: number): FlyerCatalog[] {
  const rank = (c: FlyerCatalog) => {
    const from = Date.parse(c.run_from);
    const till = Date.parse(c.run_till);
    if (from > now) return 2;
    return till - from <= 8 * DAY_MS ? 0 : 1;
  };
  return list
    .slice()
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        Date.parse(a.run_from) - Date.parse(b.run_from) ||
        (b.page_count || 0) - (a.page_count || 0),
    );
}

/** Alle aktuelle og kommende aviser for butikkerne, pr. forhandler-id. */
export async function fetchCatalogs(
  dealerIds: string[],
): Promise<Record<string, FlyerCatalog[]>> {
  const url = `${TJEK_API}/catalogs?dealer_ids=${encodeURIComponent(dealerIds.join(','))}&limit=100`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tjek ${res.status}`);
  const data: unknown = await res.json();
  const now = Date.now();
  const byDealer: Record<string, FlyerCatalog[]> = {};
  for (const c of Array.isArray(data) ? (data as FlyerCatalog[]) : []) {
    if (!c || !c.dealer_id || !(c.page_count > 0)) continue;
    if (!(c.types || []).includes('paged')) continue;
    if (Date.parse(c.run_till) < now) continue;
    (byDealer[c.dealer_id] ||= []).push(c);
  }
  for (const k of Object.keys(byDealer)) byDealer[k] = sortCatalogs(byDealer[k], now);
  return byDealer;
}

export async function fetchPages(catalogId: string): Promise<FlyerPage[]> {
  const res = await fetch(`${TJEK_API}/catalogs/${encodeURIComponent(catalogId)}/pages`);
  if (!res.ok) throw new Error(`Tjek ${res.status}`);
  const data: unknown = await res.json();
  return (Array.isArray(data) ? (data as FlyerPage[]) : []).filter((p) => p && p.view);
}

/** Navnet på fanen, fx "Netto uge 42 (fra 10/10)" for næste uges avis. */
export function catalogLabel(c: FlyerCatalog, now = Date.now()): string {
  const from = new Date(c.run_from);
  const label = (c.label || 'Avis').trim();
  return from.getTime() > now ? `${label} (fra ${from.getDate()}/${from.getMonth() + 1})` : label;
}
