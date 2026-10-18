/**
 * "Personlig besparelse": anbefalet butik mod dyreste anden butik på de varer
 * begge har (compareSavingsRange), kræver login. Kaldes både fra "Find
 * billigste" (ScoScreen) og fra kurvens vinderkort (version C).
 *
 * KUN én gang pr. kurv-sammensætning, fælles for begge skærme, så samme kurv
 * ikke tæller to gange, fordi man ser den begge steder. Web-paritet
 * (script.js): signaturen rummer også det beregnede prisinterval, så en reelt
 * ændret pris på samme varer tæller som en ny sammenligning.
 */
import { recordCompareSavings } from '../savings/personalSavings';
import { compareSavingsRange, type ScoMatchedItem, type ScoStoreResult } from './sco';
import type { CartItem } from './types';

let lastSig: string | null = null;

export function recordSavingsOnce(
  items: CartItem[],
  selectedLabels: Set<string>,
  sortedStores: ScoStoreResult[],
  matchedItemsPerStore: Record<string, ScoMatchedItem[]>,
): void {
  const range = compareSavingsRange(sortedStores, matchedItemsPerStore);
  if (!range) return;
  const sig =
    items
      .map((i) => `${i.id}:${i.quantity}`)
      .sort()
      .join('|') +
    '#' +
    [...selectedLabels].sort().join(',') +
    `#${range.cheap.toFixed(2)}/${range.expensive.toFixed(2)}`;
  if (lastSig === sig) return;
  lastSig = sig;
  void recordCompareSavings(range.cheap, range.expensive).catch(() => {});
}
