/**
 * "Støt MadShopper": månedligt abonnement via Apple (Feature-panelet
 * 'subscription' i /admin). Se docs/abonnement.md.
 *
 * Skjult, til Kalle har oprettet produktet i App Store Connect og udgiver det
 * i panelet. Appen viser kun "Støt MadShopper", når /api/home siger
 * subscription_enabled. På dev.madshopper.dk er den altid til.
 *
 * Kun iPhone for nu: Google Play-kontoen findes ikke endnu. Købet håndteres
 * helt af Apple (StoreKit 2 via expo-iap), som også tjekker kvitteringen;
 * vi gemmer intet om købet på vores server.
 *
 * expo-iap hentes først, når der er brug for den, og en manglende native
 * modul (Expo Go, en ældre build) giver bare "ikke tilgængelig" i stedet
 * for et nedbrud.
 */
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Produkt-ID'et skal stå præcis sådan i App Store Connect. */
export const SUPPORT_PRODUCT_ID = 'dk.madshopper.stoette.maaned';

const ACTIVE_KEY = 'supporter_active_v1';

type Iap = typeof import('expo-iap');

export type SupportState = {
  /** Udgivet i Feature-panelet (eller dev-siden). */
  enabled: boolean;
  /** Kan købes på denne telefon (iPhone + native modul til stede). */
  available: boolean;
  /** Pris og navn fra App Store, fx "19,00 kr.". null indtil hentet. */
  price: string | null;
  title: string | null;
  /** Har et aktivt abonnement. */
  active: boolean;
  busy: boolean;
  error: string | null;
};

let state: SupportState = {
  enabled: false,
  available: false,
  price: null,
  title: null,
  active: false,
  busy: false,
  error: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<SupportState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSupport(): SupportState {
  return useSyncExternalStore(subscribe, () => state);
}

// Sidst kendte status, så "Støtter"-mærket står med det samme ved opstart
// og uden net. App Store-tjekket nedenfor retter den bagefter.
AsyncStorage.getItem(ACTIVE_KEY)
  .then((v) => {
    if (v === '1' && !state.active) set({ active: true });
  })
  .catch(() => {});

function setActive(active: boolean) {
  if (active !== state.active) set({ active });
  AsyncStorage.setItem(ACTIVE_KEY, active ? '1' : '0').catch(() => {});
}

let iapModule: Iap | null | undefined;
function loadIap(): Iap | null {
  if (iapModule !== undefined) return iapModule;
  if (Platform.OS !== 'ios') return (iapModule = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    iapModule = require('expo-iap') as Iap;
  } catch {
    iapModule = null;
  }
  return iapModule;
}

let connecting: Promise<Iap | null> | null = null;

/** Én forbindelse til App Store i hele appens levetid. */
function connect(): Promise<Iap | null> {
  if (connecting) return connecting;
  connecting = (async () => {
    const iap = loadIap();
    if (!iap) return null;
    try {
      await iap.initConnection();
    } catch {
      connecting = null; // prøv igen næste gang
      return null;
    }
    iap.purchaseUpdatedListener((purchase) => {
      if (purchase.productId !== SUPPORT_PRODUCT_ID) return;
      // Apple har allerede tjekket købet (StoreKit 2). Uden finish sender
      // App Store det igen ved hver opstart.
      iap.finishTransaction({ purchase, isConsumable: false }).catch(() => {});
      setActive(true);
      set({ busy: false, error: null });
    });
    iap.purchaseErrorListener((err) => {
      set({
        busy: false,
        error: iap.isUserCancelledError(err) ? null : 'Købet gik ikke igennem. Prøv igen.',
      });
    });
    return iap;
  })();
  return connecting;
}

async function refreshActive(iap: Iap) {
  try {
    const subs = await iap.getActiveSubscriptions([SUPPORT_PRODUCT_ID]);
    setActive(subs.some((s) => s.productId === SUPPORT_PRODUCT_ID && s.isActive));
  } catch {
    // Behold sidst kendte status; uden net kan Apple ikke svare.
  }
}

/** Kaldes af HomeScreen med /api/home's subscription_enabled. */
export function setServerSubscriptionEnabled(on: boolean | undefined) {
  const next = !!on;
  if (next === state.enabled) return;
  set({ enabled: next });
  if (next) void loadSupport();
}

/** Henter pris og status fra App Store. Sikker at kalde flere gange. */
export async function loadSupport(): Promise<void> {
  const iap = await connect();
  if (!iap) {
    set({ available: false });
    return;
  }
  set({ available: true });
  try {
    const products = await iap.fetchProducts({ skus: [SUPPORT_PRODUCT_ID], type: 'subs' });
    const p = (products || []).find((x) => x.id === SUPPORT_PRODUCT_ID);
    // Produktet findes først, når Kalle har oprettet det i App Store Connect.
    set({ price: p?.displayPrice ?? null, title: p?.title ?? null });
  } catch {
    set({ price: null });
  }
  await refreshActive(iap);
}

export async function buySupport(): Promise<void> {
  const iap = await connect();
  if (!iap || state.busy) return;
  set({ busy: true, error: null });
  try {
    await iap.requestPurchase({ request: { apple: { sku: SUPPORT_PRODUCT_ID } }, type: 'subs' });
    // Resultatet kommer via purchaseUpdatedListener/purchaseErrorListener.
  } catch {
    set({ busy: false, error: 'Kunne ikke åbne betalingen. Prøv igen.' });
  }
}

/** "Gendan køb" er et krav fra Apple. */
export async function restoreSupport(): Promise<boolean> {
  const iap = await connect();
  if (!iap) return false;
  set({ busy: true, error: null });
  try {
    await iap.restorePurchases();
  } catch {
    // Vi tjekker status nedenfor alligevel.
  }
  await refreshActive(iap);
  set({ busy: false });
  return state.active;
}

/** Åbner Apples egen side, hvor abonnementet kan stoppes. */
export async function manageSupport(): Promise<void> {
  const iap = await connect();
  if (!iap) return;
  try {
    await iap.deepLinkToSubscriptions({});
  } catch {
    set({ error: 'Åbn Indstillinger > dit navn > Abonnementer for at ændre det.' });
  }
}
