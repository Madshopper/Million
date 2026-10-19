/**
 * SCO unit tests — coverage→price sort + multi-deal kun i SCO-totals.
 * Kør: node --experimental-strip-types src/cart/sco.test.ts
 */
import { applyDealPrice } from './multiDeal.ts';
import {
  bestTwoStoreSplit,
  calculateStoreComparisons,
  compareSavingsRange,
  extraCostVs,
  sortScoStores,
} from './sco.ts';
import type { CartItem } from './types.ts';
import type { StoreInfo } from '../api/types.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const stores: StoreInfo[] = [
  { key: 'rema', label: 'Rema 1000', logo: '' },
  { key: 'bilka', label: 'Bilka', logo: '' },
  { key: 'netto', label: 'Netto', logo: '' },
];

const cart: CartItem[] = [
  {
    id: 'product1',
    name: 'Mælk',
    store: 'Rema 1000',
    price: 10,
    storePrices: { 'Rema 1000': 10, Bilka: 12, Netto: 11 },
    storeMultiDeals: { Bilka: '2 for 18' },
    image: '',
    category: 'Køl',
    unitMeasure: '1 L',
    kgPrice: '',
    quantity: 2,
  },
  {
    id: 'product2',
    name: 'Brød',
    store: 'Rema 1000',
    price: 20,
    storePrices: { 'Rema 1000': 20, Bilka: 15 },
    storeMultiDeals: {},
    image: '',
    category: 'Brød',
    unitMeasure: '',
    kgPrice: '',
    quantity: 1,
  },
];

const selected = new Set(['Rema 1000', 'Bilka', 'Netto']);

const fakeFetch = async () => ({ success: true as const, rema_products: [] });

const result = await calculateStoreComparisons(cart, stores, selected, fakeFetch);
const sorted = sortScoStores(result.stores);

assert(sorted.length === 3, '3 stores');
// Rema coverage 2, Bilka 2, Netto 1 → Rema/Bilka før Netto
assert(sorted[2].name === 'Netto', 'Netto lowest coverage last');
assert(sorted[0].coverage >= sorted[1].coverage, 'coverage desc');

const bilka = result.stores.find((s) => s.name === 'Bilka')!;
// Mælk 2× med 2 for 18 → 18; Brød 15 → total 33
assert(bilka.totalPrice === 33, `Bilka deal total got ${bilka.totalPrice}`);
assert(applyDealPrice(12, 2, '2 for 18') === 18, 'deal helper');

const rema = result.stores.find((s) => s.name === 'Rema 1000')!;
// 10*2 + 20 = 40 (ingen deal)
assert(rema.totalPrice === 40, `Rema total got ${rema.totalPrice}`);

/* ---------------------------------------------------------------------------
   Live-priser skal OVERSKRIVE de gemte, ikke kun udfylde huller.

   Regressionstest for det fund, at appen kun satte en pris hvis pladsen var
   tom (`if (prices[label] == null)`), mens webben overskriver. En kurv hentet
   fra Supabase har gemte priser fra dengang den blev gemt - uden overskrivning
   blev "Find billigste" ved med at regne på dem for evigt og kunne pege på den
   forkerte butik. Testen ovenfor kunne ikke fange det: den sender
   `rema_products: []`, så kodestien blev aldrig kørt.
--------------------------------------------------------------------------- */
const staleCart: CartItem[] = [
  {
    id: 'product1',
    name: 'Mælk',
    store: 'Rema 1000',
    price: 10,
    // Gemte (forældede) priser - Rema var billigst dengang.
    storePrices: { 'Rema 1000': 10, Bilka: 12 },
    storeMultiDeals: {},
    image: '',
    category: 'Køl',
    unitMeasure: '1 L',
    kgPrice: '',
    quantity: 1,
  },
];

// Live: Rema er steget til 14, Bilka faldet til 9 - altså modsat de gemte.
const liveFetch = async () => ({
  success: true as const,
  rema_products: [
    {
      '/product/id': '1',
      '/product/price': 14,
      '/product/sale_price': null,
      '/product/store_matches': { bilka: { price: 9 } },
    },
  ],
});

const live = await calculateStoreComparisons(
  staleCart,
  stores,
  new Set(['Rema 1000', 'Bilka']),
  liveFetch,
);
const liveRema = live.stores.find((s) => s.name === 'Rema 1000')!;
const liveBilka = live.stores.find((s) => s.name === 'Bilka')!;
assert(liveRema.totalPrice === 14, `Rema live-pris skal overskrive 10→14, fik ${liveRema.totalPrice}`);
assert(liveBilka.totalPrice === 9, `Bilka live-pris skal overskrive 12→9, fik ${liveBilka.totalPrice}`);
assert(sortScoStores(live.stores)[0].name === 'Bilka', 'billigste butik skal følge live-priser');

// Personlig besparelse: anbefalet butik mod dyreste anden, kun fælles varer.
const range = compareSavingsRange(sorted, result.matchedItemsPerStore);
assert(sorted[0].name === 'Bilka', `Bilka anbefales (33 kr), fik ${sorted[0].name}`);
assert(
  range !== null && range.cheap === 33 && range.expensive === 40,
  `Bilka 33 mod Rema 40 (multikøb talt med), fik ${JSON.stringify(range)}`,
);

// Ingen butik har hele kurven to steder: før gav det ingen besparelse (null).
const partialCart: CartItem[] = [
  ...cart,
  { ...cart[1], id: 'product3', name: 'Ost', storePrices: { 'Rema 1000': 30 } },
];
const partial = await calculateStoreComparisons(partialCart, stores, selected, fakeFetch);
const partialSorted = sortScoStores(partial.stores);
assert(partialSorted[0].name === 'Rema 1000', 'Rema har flest varer');
const partialRange = compareSavingsRange(partialSorted, partial.matchedItemsPerStore);
// Rema 2x10 mod Netto 2x11 på mælken; Bilka er billigere end Rema og tæller ikke.
assert(
  partialRange !== null && partialRange.cheap === 20 && partialRange.expensive === 22,
  `delvis kurv skal give 20/22, fik ${JSON.stringify(partialRange)}`,
);
assert(compareSavingsRange(partialSorted.slice(0, 1), partial.matchedItemsPerStore) === null, 'én butik: ingen besparelse');

// Vinderkortet: merpris kun på fælles varer (Rema har ingen Bilka-Ost osv.).
const vsRema = extraCostVs('Bilka', 'Rema 1000', result.matchedItemsPerStore);
assert(vsRema.diff === 7 && vsRema.shared === 2, `Rema 7 kr dyrere end Bilka, fik ${JSON.stringify(vsRema)}`);
const vsSelf = extraCostVs('Rema 1000', 'Netto', partial.matchedItemsPerStore);
assert(vsSelf.diff === 2 && vsSelf.shared === 1, `Netto 2 kr dyrere på mælken, fik ${JSON.stringify(vsSelf)}`);
assert(extraCostVs('Bilka', 'Ukendt', result.matchedItemsPerStore).shared === 0, 'ukendt butik: ingen fælles varer');

// "Handl i 2 butikker": kun vinderens varer, hver købt hvor den er billigst af de to.
const line = (cart_id: string, lineTotal: number) => ({ cart_id, name: cart_id, image: '', price: lineTotal, quantity: 1, lineTotal });
const perStore = {
  Netto: [line('a', 10), line('b', 20), line('c', 30)],
  'Rema 1000': [line('a', 12), line('b', 12)],
  Bilka: [line('c', 29.5), line('d', 5)],
};
const split = bestTwoStoreSplit('Netto', ['Netto', 'Rema 1000', 'Bilka'], perStore);
assert(
  split !== null && split.other === 'Rema 1000' && split.total === 52 && split.saving === 8 && split.otherItems === 1,
  `Netto + Rema: 52 kr, spar 8, fik ${JSON.stringify(split)}`,
);
assert(bestTwoStoreSplit('Netto', ['Bilka'], perStore) === null, 'spar under 1 kr: intet kort');
assert(bestTwoStoreSplit('Netto', ['Netto'], perStore) === null, 'ingen anden butik: intet kort');

console.log('sco tests OK');
