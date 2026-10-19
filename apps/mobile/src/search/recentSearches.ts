/**
 * "Seneste søgninger" i Søg (C2, 19-10-2026): de seneste 8 forskellige
 * søgeord, kun gemt på telefonen (AsyncStorage). Gemmes, når man søger med
 * tastaturets søg-knap, trykker på et forslag eller åbner en vare fra
 * resultaterne, så halve ord fra tastningen ikke kommer med.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'madshopper_recent_searches';
export const RECENT_SEARCHES_MAX = 8;

let searches: string[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** Nyeste først, uden dubletter (store/små bogstaver ens), højst 8. */
export function mergeSearches(newest: string[], older: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...newest, ...older]) {
    const q = raw.trim().replace(/\s+/g, ' ');
    const k = q.toLowerCase();
    if (q.length < 2 || seen.has(k)) continue;
    seen.add(k);
    out.push(q);
    if (out.length >= RECENT_SEARCHES_MAX) break;
  }
  return out;
}

function load() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      searches = mergeSearches(searches, parsed.filter((s): s is string => typeof s === 'string'));
      emit();
    })
    .catch(() => {});
}

export function rememberSearch(q: string): void {
  const next = mergeSearches([q], searches);
  if (next.join('\n') === searches.join('\n')) return;
  searches = next;
  void AsyncStorage.setItem(KEY, JSON.stringify(searches)).catch(() => {});
  emit();
}

export function useRecentSearches(): string[] {
  load();
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => searches,
  );
}
