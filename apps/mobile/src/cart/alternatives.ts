/**
 * Erstatninger for varer, en butik ikke har (/api/alternatives). Delt af
 * "Find billigste" (ScoScreen) og kurvens vinderkort (CartScreen).
 */
import { apiPost } from '../api/client';
import type { ScoStoreResult } from './sco';
import type { CartItem } from './types';

export type AlternativeItem = {
  cart_id: string;
  store: string;
  alt_id: string;
  alt_name: string;
  alt_price: number;
  alt_image: string;
  alt_storePrices: Record<string, number>;
  alt_category: string;
  alt_unitMeasure: string;
  alt_kgPrice: string;
  alt_store: string;
};

type AlternativesResponse = {
  success: boolean;
  alternatives: AlternativeItem[];
  error?: string;
};

export async function fetchAlternatives(
  store: ScoStoreResult,
): Promise<Record<string, AlternativeItem>> {
  const missing_items = store.missingDetails.map((m) => ({
    cart_id: m.cart_id,
    product_id: m.product_id,
    store: store.name,
    category: m.category,
    name: m.name,
    weight_str: m.weight_str,
    price: m.price,
    image: m.image,
  }));
  const res = await apiPost<AlternativesResponse>('/api/alternatives', { missing_items });
  const map: Record<string, AlternativeItem> = {};
  for (const alt of res.alternatives || []) map[alt.cart_id] = alt;
  return map;
}

/** Kurv-varen der erstatter den manglende (samme antal). */
export function alternativeAsCartItem(alt: AlternativeItem, original?: CartItem): CartItem {
  const nextId = alt.alt_id.startsWith('product') ? alt.alt_id : `product${alt.alt_id}`;
  return {
    id: nextId,
    name: alt.alt_name,
    store: alt.alt_store,
    price: alt.alt_price,
    storePrices: alt.alt_storePrices || {},
    storeMultiDeals: {},
    image: alt.alt_image,
    category: alt.alt_category,
    unitMeasure: alt.alt_unitMeasure,
    kgPrice: alt.alt_kgPrice ? `${alt.alt_kgPrice} kr/kg` : '',
    quantity: original?.quantity ?? 1,
  };
}
