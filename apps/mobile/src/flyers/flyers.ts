/**
 * Butikkernes tilbudsaviser (Feature-panelet 'flyers' i /admin).
 *
 * Samme som hjemmesiden (static/js/flyers.js): listen over aviser og deres
 * sider hentes direkte fra Tjek (eTilbudsavis), og siderne vises fra Tjeks
 * billed-CDN. Intet går gennem vores server, og intet gemmes hos os.
 */
const TJEK_API = 'https://squid-api.tjek.com/v2';
const DAY_MS = 86400000;

// Kun aviser med mad (Kalle 07-10-2026): ingen legetøj, Halloween-kostumer,
// skønhed, elektronik osv. Tjek giver alle butikkens aviser samme kategori
// ("groceries"), så det afgøres på avisens navn. Samme liste i
// static/js/flyers.js.
const NON_FOOD_WORDS = ['legetøj', 'halloween', 'nonfood', 'non-food', 'skønhed', 'velvære', 'prosonic', 'elektronik', 'tekstil', 'kostume'];

export function isFoodCatalog(c: { label?: string }): boolean {
  const label = (c.label || '').toLowerCase();
  return !NON_FOOD_WORDS.some((w) => label.includes(w));
}

export type FlyerCatalog = {
  id: string;
  dealer_id: string;
  label: string;
  run_from: string;
  run_till: string;
  page_count: number;
  offer_count?: number;
  types?: string[];
};

export type FlyerPage = { thumb?: string; view: string; zoom?: string };

/**
 * Kun ugens avis og næste uges avis (Kalle 07-10-2026), ikke indstik,
 * weekendaviser eller lange sæsonkataloger. Samme regel som hjemmesiden
 * (static/js/flyers.js::pickWeekly). Tjek har altid de nyeste aviser, så
 * skiftet til en ny uge sker af sig selv.
 */
export function pickWeekly(list: FlyerCatalog[], now: number): FlyerCatalog[] {
  const from = (c: FlyerCatalog) => Date.parse(c.run_from);
  const weekNo = /\buge\s*\d/i;
  let weekly = list.filter(
    (c) =>
      Date.parse(c.run_till) - from(c) <= 16 * DAY_MS && !/indstik|weekend/i.test(c.label || ''),
  );
  // Hedder butikkens aviser "Uge 42" o.l., er det kun dem. ABC Lavpris
  // kalder sine aviser efter byen (se oneOf).
  if (weekly.some((c) => weekNo.test(c.label || ''))) {
    weekly = weekly.filter((c) => weekNo.test(c.label || ''));
  }
  const active = weekly.filter((c) => from(c) <= now);
  const upcoming = weekly.filter((c) => from(c) > now);
  const newest = Math.max(...active.map(from));
  const next = Math.min(...upcoming.map(from));
  return [
    oneOf(active.filter((c) => from(c) === newest)),
    oneOf(upcoming.filter((c) => from(c) === next)),
  ].filter((c): c is FlyerCatalog => !!c);
}

/**
 * ABC Lavpris har én avis pr. by med (næsten) samme tilbud (målt
 * 07-10-2026: 14 af 16 byer ens). Kalle vil kun se én: den hvis antal
 * tilbud flest byer deler, altså den almindelige udgave.
 */
function oneOf(group: FlyerCatalog[]): FlyerCatalog | undefined {
  if (group.length < 2) return group[0];
  const count: Record<number, number> = {};
  for (const c of group) count[c.offer_count ?? 0] = (count[c.offer_count ?? 0] || 0) + 1;
  return group.reduce((best, c) =>
    count[c.offer_count ?? 0] > count[best.offer_count ?? 0] ? c : best,
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
    if (!isFoodCatalog(c)) continue;
    if (Date.parse(c.run_till) < now) continue;
    (byDealer[c.dealer_id] ||= []).push(c);
  }
  for (const k of Object.keys(byDealer)) {
    byDealer[k] = pickWeekly(byDealer[k], now);
    if (!byDealer[k].length) delete byDealer[k];
  }
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
