/**
 * "Køb igen" (version C 18-10-2026, C2 19-10-2026: nederst i kurven som
 * "Glemt noget?"; fjernet fra Søg 21-10-2026). Appen har ingen købshistorik, så vi husker de varer, man selv har
 * lagt i kurven, og hvor mange gange, kun her på telefonen (AsyncStorage).
 * Intet sendes til serveren.
 */
import { useMemo, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CartItem } from './types';

const KEY = 'madshopper_recent_items';
// Nok varer til at tællingen giver mening, men stadig en lille liste.
export const RECENT_MAX = 40;

export type RecentItem = Omit<CartItem, 'quantity'> & {
  /** Antal gange varen er lagt i kurven (ældre gemte lister har ikke feltet). */
  timesAdded?: number;
};

let items: RecentItem[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  void AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => {});
}

export function loadRecentItems(): void {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const fromDisk = parsed.filter(
        (i): i is RecentItem => !!i && typeof i.id === 'string' && typeof i.name === 'string',
      );
      // Varer lagt i kurven, før listen blev læst, står forrest.
      items = mergeRecent(items, fromDisk);
      emit();
    })
    .catch(() => {});
}

function timesOf(i: RecentItem): number {
  return typeof i.timesAdded === 'number' && i.timesAdded > 0 ? i.timesAdded : 1;
}

/** Nyeste først, én gang pr. vare (antallet lægges sammen), højst RECENT_MAX. */
export function mergeRecent(newest: RecentItem[], older: RecentItem[]): RecentItem[] {
  const byId = new Map<string, RecentItem>();
  const out: RecentItem[] = [];
  for (const it of [...newest, ...older]) {
    const seen = byId.get(it.id);
    if (seen) {
      seen.timesAdded = timesOf(seen) + timesOf(it);
      continue;
    }
    const copy = { ...it, timesAdded: timesOf(it) };
    byId.set(it.id, copy);
    out.push(copy);
  }
  return out.slice(0, RECENT_MAX);
}

export function rememberRecentItem(item: CartItem | RecentItem): void {
  const { quantity: _q, timesAdded: _t, ...rest } = item as CartItem & RecentItem;
  const prev = items.find((i) => i.id === rest.id);
  const next: RecentItem = { ...rest, timesAdded: (prev ? timesOf(prev) : 0) + 1 };
  items = [next, ...items.filter((i) => i.id !== rest.id)].slice(0, RECENT_MAX);
  persist();
  emit();
}

export function useRecentItems(): RecentItem[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => items,
  );
}

/** De varer man oftest har lagt i kurven (flest gange først, så nyeste). */
export function topBuyAgain(list: RecentItem[], limit: number, excludeIds?: Set<string>): RecentItem[] {
  return list
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => !excludeIds?.has(it.id))
    .sort((a, b) => timesOf(b.it) - timesOf(a.it) || a.idx - b.idx)
    .slice(0, limit)
    .map(({ it }) => ({ ...it, timesAdded: timesOf(it) }));
}

export function useBuyAgain(limit: number, excludeIds?: Set<string>): RecentItem[] {
  const list = useRecentItems();
  return useMemo(() => topBuyAgain(list, limit, excludeIds), [list, limit, excludeIds]);
}
