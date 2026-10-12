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
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
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

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr.slice()];
  const out: T[][] = [];
  arr.forEach((x, i) => {
    for (const p of permutations([...arr.slice(0, i), ...arr.slice(i + 1)])) out.push([x, ...p]);
  });
  return out;
}

/**
 * Korteste tur i fugleflugt gennem én butik af hver kæde. roundTrip: hjem
 * igen bagefter (rigtig placering); ellers slutter turen i sidste butik.
 */
export function planRoute(
  data: StoreLocations,
  pos: Pos,
  keys: string[],
  roundTrip: boolean,
): { km: number; stops: Place[] } | null {
  const perChain = keys.length <= 5 ? 3 : 2;
  const cands = keys.map((k) => nearestOfChain(data, pos, k, perChain)).filter((c) => c.length);
  if (!cands.length) return null;
  const legKm = (stops: Place[]) => {
    let t = 0;
    let prev: { lat: number; lon: number } = pos;
    for (const s of stops) {
      t += km(prev.lat, prev.lon, s.lat, s.lon);
      prev = s;
    }
    if (roundTrip) t += km(prev.lat, prev.lon, pos.lat, pos.lon);
    return t;
  };
  let best: { km: number; stops: Place[] } | null = null;
  if (cands.length <= 6) {
    for (const order of permutations(cands)) {
      const walk = (i: number, chosen: Place[]) => {
        if (i === order.length) {
          const t = legKm(chosen);
          if (!best || t < best.km) best = { km: t, stops: chosen.slice() };
          return;
        }
        for (const s of order[i]) {
          chosen.push(s);
          walk(i + 1, chosen);
          chosen.pop();
        }
      };
      walk(0, []);
    }
  } else {
    const left = cands.map((c) => c[0]);
    const stops: Place[] = [];
    let at: { lat: number; lon: number } = pos;
    while (left.length) {
      const here = at;
      left.sort((a, b) => km(here.lat, here.lon, a.lat, a.lon) - km(here.lat, here.lon, b.lat, b.lon));
      at = left.shift() as Place;
      stops.push(at as Place);
    }
    best = { km: legKm(stops), stops };
  }
  return best;
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
