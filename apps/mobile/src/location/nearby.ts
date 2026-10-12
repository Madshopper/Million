/**
 * Butikker nær mig (Feature-panelet 'lokation').
 *
 * Samme regler som hjemmesidens static/js/lokation.js. Hold dem ens.
 * Butikslisten er static/data/butikker.json (OpenStreetMap, se
 * scripts/build-store-locations.py). Alt regnes ud på telefonen; placeringen
 * og postnummeret sendes aldrig til os. Postnummeret gemmes kun på telefonen.
 */
import { useSyncExternalStore } from 'react';

export type StoreRow = [string, number, number, string, string, string];

export type StoreLocations = {
  updated?: string;
  stores: StoreRow[];
  postcodes: Record<string, [number, number, string]>;
};

export type Pos = { lat: number; lon: number; label: string; precise: boolean };

export type Place = {
  key: string;
  lat: number;
  lon: number;
  street: string;
  postcode: string;
  city: string;
  dist: number;
};

export type NearbyChain = Place & { near: boolean };

const RADII_KM = [5, 10, 20];
const MIN_CHAINS = 3;

export function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLon = (bLon - aLon) * r;
  // Skrevet præcis som lokation.js, så de to giver samme tur ned til sidste decimal.
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function nearestOfChain(data: StoreLocations, pos: Pos, key: string, n: number): Place[] {
  return data.stores
    .filter((row) => row[0] === key)
    .map((row) => ({
      key: row[0],
      lat: row[1],
      lon: row[2],
      street: row[3],
      postcode: row[4],
      city: row[5],
      dist: km(pos.lat, pos.lon, row[1], row[2]),
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n);
}

/** Nærmeste butik pr. kæde, og hvilke kæder der tæller som "nær". */
export function nearbyChains(
  data: StoreLocations,
  pos: Pos,
  keys: string[],
): { stores: NearbyChain[]; radius: number } {
  const rows = keys
    .map((k) => nearestOfChain(data, pos, k, 1)[0])
    .filter((s): s is Place => !!s)
    .sort((a, b) => a.dist - b.dist);
  let radius = RADII_KM[RADII_KM.length - 1];
  for (const r of RADII_KM) {
    if (rows.filter((s) => s.dist <= r).length >= MIN_CHAINS) {
      radius = r;
      break;
    }
  }
  return { stores: rows.map((s) => ({ ...s, near: s.dist <= radius })), radius };
}

/**
 * Korteste tur i fugleflugt gennem én butik af hver kæde, blandt de tre
 * nærmeste i hver kæde. roundTrip: hjem igen bagefter (rigtig placering);
 * ellers slutter turen i sidste butik. Held-Karp over kæderne (op til 8),
 * ellers "tag altid den nærmeste næste". Samme som lokation.js.
 */
export function planRoute(
  data: StoreLocations,
  pos: Pos,
  keys: string[],
  roundTrip: boolean,
): { km: number; stops: Place[] } | null {
  const cands = keys.map((k) => nearestOfChain(data, pos, k, 3)).filter((c) => c.length);
  if (!cands.length) return null;
  const pts: Place[] = [];
  const chainOf: number[] = [];
  cands.forEach((c, ci) =>
    c.forEach((s) => {
      pts.push(s);
      chainOf.push(ci);
    }),
  );
  const home = pts.map((p) => km(pos.lat, pos.lon, p.lat, p.lon));
  let stops: Place[] = [];
  if (cands.length <= 8) {
    const n = pts.length;
    const full = (1 << cands.length) - 1;
    const D = pts.map((a) => pts.map((b) => km(a.lat, a.lon, b.lat, b.lon)));
    const cost = new Map<string, number>();
    const prev = new Map<string, number>();
    for (let i = 0; i < n; i++) cost.set(`${1 << chainOf[i]}:${i}`, home[i]);
    for (let mask = 1; mask <= full; mask++) {
      for (let a = 0; a < n; a++) {
        const ca = cost.get(`${mask}:${a}`);
        if (ca === undefined) continue;
        for (let b = 0; b < n; b++) {
          if (mask & (1 << chainOf[b])) continue;
          const key = `${mask | (1 << chainOf[b])}:${b}`;
          const c = ca + D[a][b];
          const old = cost.get(key);
          if (old === undefined || c < old) {
            cost.set(key, c);
            prev.set(key, a);
          }
        }
      }
    }
    let bestEnd = -1;
    let bestKm = Infinity;
    for (let e = 0; e < n; e++) {
      let ce = cost.get(`${full}:${e}`);
      if (ce === undefined) continue;
      if (roundTrip) ce += home[e];
      if (ce < bestKm) {
        bestKm = ce;
        bestEnd = e;
      }
    }
    let m = full;
    let at: number | undefined = bestEnd;
    while (at !== undefined) {
      stops.unshift(pts[at]);
      const p: number | undefined = prev.get(`${m}:${at}`);
      m &= ~(1 << chainOf[at]);
      at = p;
    }
  } else {
    const left = cands.map((c) => c[0]);
    let here: { lat: number; lon: number } = pos;
    stops = [];
    while (left.length) {
      const h = here;
      left.sort((x, y) => km(h.lat, h.lon, x.lat, x.lon) - km(h.lat, h.lon, y.lat, y.lon));
      const next = left.shift() as Place;
      stops.push(next);
      here = next;
    }
  }
  let total = 0;
  let from: { lat: number; lon: number } = pos;
  for (const s of stops) {
    total += km(from.lat, from.lon, s.lat, s.lon);
    from = s;
  }
  if (roundTrip) total += km(from.lat, from.lon, pos.lat, pos.lon);
  return { km: total, stops };
}

export function mapsUrl(pos: Pos, stops: Place[], roundTrip: boolean): string {
  const ll = (p: { lat: number; lon: number }) => `${p.lat},${p.lon}`;
  const q = ['api=1', 'travelmode=driving'];
  const way = stops.slice();
  if (roundTrip) q.push(`origin=${ll(pos)}`, `destination=${ll(pos)}`);
  else q.push(`destination=${ll(way.pop() as Place)}`);
  if (way.length) q.push(`waypoints=${encodeURIComponent(way.map(ll).join('|'))}`);
  return `https://www.google.com/maps/dir/?${q.join('&')}`;
}

export function lookupPostcode(data: StoreLocations, input: string): Pos | null {
  const pc = String(input || '').trim();
  if (!/^\d{4}$/.test(pc)) return null;
  let hit = data.postcodes[pc];
  if (!hit) {
    const n = Number(pc);
    let bestPc: string | null = null;
    for (const k of Object.keys(data.postcodes)) {
      const d = Math.abs(Number(k) - n);
      if (d <= 20 && (bestPc === null || d < Math.abs(Number(bestPc) - n))) bestPc = k;
    }
    if (!bestPc) return null;
    hit = data.postcodes[bestPc];
  }
  return { lat: hit[0], lon: hit[1], label: pc + (hit[2] ? ` ${hit[2]}` : ''), precise: false };
}

export function fmtKm(d: number): string {
  return d < 1
    ? `${Math.round((d * 1000) / 50) * 50} m`
    : `${d.toFixed(1).replace('.', ',')} km`;
}

export function address(s: Place): string {
  return [s.street, [s.postcode, s.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

// ── Udgivet i Feature-panelet? (/api/home lokation_enabled) ───────────────
let enabled = false;
const listeners = new Set<() => void>();

export function setServerLokationEnabled(on: boolean | undefined) {
  const next = !!on;
  if (next === enabled) return;
  enabled = next;
  listeners.forEach((l) => l());
}

export function useLokationEnabled(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => enabled,
  );
}
