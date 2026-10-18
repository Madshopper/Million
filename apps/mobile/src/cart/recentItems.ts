/**
 * "Køb igen" på forsiden (version C, 18-10-2026). Appen har ingen
 * købshistorik, så vi husker de seneste varer, man selv har lagt i kurven,
 * kun her på telefonen (AsyncStorage). Intet sendes til serveren.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CartItem } from './types';

const KEY = 'madshopper_recent_items';
export const RECENT_MAX = 12;

export type RecentItem = Omit<CartItem, 'quantity'>;

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

/** Nyeste først, én gang pr. vare, højst RECENT_MAX. */
export function mergeRecent(newest: RecentItem[], older: RecentItem[]): RecentItem[] {
  const seen = new Set<string>();
  const out: RecentItem[] = [];
  for (const it of [...newest, ...older]) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
    if (out.length >= RECENT_MAX) break;
  }
  return out;
}

export function rememberRecentItem(item: CartItem | RecentItem): void {
  const { quantity: _q, ...rest } = item as CartItem;
  items = mergeRecent([rest], items);
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
