/**
 * Swipe i kurven (Feature-panelet 'swipe' i /admin).
 *
 * Appen swiper kun, når /api/home siger swipe_enabled, så hjemmesiden og
 * appen følges ad: Kalle udgiver begge samtidig i panelet, når en appversion
 * med swipe er i App Store (06-10-2026). På dev.madshopper.dk er den altid til.
 */
import { useSyncExternalStore } from 'react';

let enabled = false;
const listeners = new Set<() => void>();

/** Kaldes af HomeScreen med /api/home's swipe_enabled. */
export function setServerSwipeEnabled(on: boolean | undefined) {
  const next = !!on;
  if (next === enabled) return;
  enabled = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSwipeEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabled);
}
