/**
 * Betaling for opskrifterne: månedligt abonnement via Apple (Feature-panelet
 * 'recipes', se docs/abonnement.md). Listen er åben for alle; selve
 * opskriften og madplanen kræver adgang.
 *
 * Adgangen hører til kontoen, ikke telefonen, så den også virker på
 * hjemmesiden og på Android:
 * 1. Køb kræver login. Kontoens id sendes med til Apple som appAccountToken.
 * 2. Apples underskrevne kvittering (JWS) sendes til edge-funktionen
 *    recipe-access (supabase/functions/recipe-access), som tjekker
 *    underskriften og skriver adgangen i recipe_access.
 * 3. Om man har adgang, spørger vi altid serveren om (has_recipe_access),
 *    aldrig telefonen. Admins har altid adgang.
 *
 * Købet kan kun laves på iPhone for nu (Google Play-kontoen findes ikke
 * endnu). expo-iap hentes først, når der er brug for den, og et manglende
 * native modul (Expo Go, en ældre build) giver bare "ikke tilgængelig".
 */
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { getSupabase } from '../auth/supabase';

/** Produkt-ID'et skal stå præcis sådan i App Store Connect og i edge-funktionen. */
export const RECIPE_PRODUCT_ID = 'dk.madshopper.opskrifter.maaned';

type Iap = typeof import('expo-iap');

export type RecipeAccessState = {
  /** Serverens svar. null = ikke spurgt endnu (eller ingen forbindelse). */
  access: boolean | null;
  /** Kan købes på denne telefon (iPhone + native modul til stede). */
  available: boolean;
  /** Pris og navn fra App Store, fx "19,00 kr.". null indtil hentet. */
  price: string | null;
  title: string | null;
  busy: boolean;
  error: string | null;
};

let state: RecipeAccessState = {
  access: null,
  available: false,
  price: null,
  title: null,
  busy: false,
  error: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<RecipeAccessState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let started = false;

/** Adgangen til opskrifterne. Spørger serveren første gang og ved login/logud. */
export function useRecipeAccess(): RecipeAccessState {
  useEffect(() => {
    if (started) return;
    started = true;
    const sb = getSupabase();
    sb?.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
        void refreshRecipeAccess().then(() => syncPurchases());
      }
    });
    void refreshRecipeAccess().then(() => syncPurchases());
  }, []);
  return useSyncExternalStore(subscribe, () => state);
}

async function currentUserId(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Spørger serveren om kontoen har adgang lige nu. */
export async function refreshRecipeAccess(): Promise<boolean> {
  const sb = getSupabase();
  if (!sb || !(await currentUserId())) {
    set({ access: false });
    return false;
  }
  const { data, error } = await sb.rpc('has_recipe_access');
  if (error) {
    // Behold sidst kendte svar; uden svar er der ingen adgang.
    if (state.access === null) set({ access: false });
    return state.access === true;
  }
  set({ access: data === true });
  return data === true;
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

/** Sender Apples kvittering til serveren, som giver kontoen adgang. */
async function sendToServer(jws: string | null | undefined): Promise<string | null> {
  const sb = getSupabase();
  if (!sb || !jws) return 'Købet kunne ikke tjekkes. Prøv "Gendan køb".';
  const { error } = await sb.functions.invoke('recipe-access', { body: { transaction: jws } });
  if (!error) return null;
  const status = (error as { context?: { status?: number } }).context?.status;
  if (status === 409) return 'Abonnementet hører til en anden MadShopper-konto. Log ind med den.';
  return 'Købet kunne ikke tjekkes. Prøv "Gendan køb" om lidt.';
}

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
    iap.purchaseUpdatedListener(async (purchase) => {
      if (purchase.productId !== RECIPE_PRODUCT_ID) return;
      const error = await sendToServer(purchase.purchaseToken);
      // Først når serveren har det, er købet færdigt. Ellers sender App
      // Store det igen ved næste opstart, og vi prøver igen.
      if (!error) iap.finishTransaction({ purchase, isConsumable: false }).catch(() => {});
      await refreshRecipeAccess();
      set({ busy: false, error });
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

/**
 * Sender et aktivt abonnement på telefonen til serveren, hvis serveren ikke
 * allerede kender det (fx efter en fornyelse, eller hvis appen lukkede midt i
 * et køb). Kun når man er logget ind.
 */
async function syncPurchases(): Promise<void> {
  if (state.access === true || !(await currentUserId())) return;
  const iap = loadIap();
  if (!iap) return;
  const ready = await connect();
  if (!ready) return;
  try {
    const purchases = await ready.getAvailablePurchases({ onlyIncludeActiveItemsIOS: true });
    const mine = (purchases || [])
      .filter((p) => p.productId === RECIPE_PRODUCT_ID && p.purchaseToken)
      .sort((a, b) => b.transactionDate - a.transactionDate)[0];
    if (!mine) return;
    const error = await sendToServer(mine.purchaseToken);
    await refreshRecipeAccess();
    if (error) set({ error });
  } catch {
    // Uden net kan Apple ikke svare; næste gang.
  }
}

/** Henter pris fra App Store. Sikker at kalde flere gange. */
export async function loadRecipeOffer(): Promise<void> {
  const iap = await connect();
  if (!iap) {
    set({ available: false });
    return;
  }
  set({ available: true });
  try {
    const products = await iap.fetchProducts({ skus: [RECIPE_PRODUCT_ID], type: 'subs' });
    const p = (products || []).find((x) => x.id === RECIPE_PRODUCT_ID);
    // Produktet findes først, når Kalle har oprettet det i App Store Connect.
    set({ price: p?.displayPrice ?? null, title: p?.title ?? null });
  } catch {
    set({ price: null });
  }
}

export async function buyRecipeAccess(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) {
    set({ error: 'Log ind først, så adgangen følger din konto.' });
    return;
  }
  const iap = await connect();
  if (!iap || state.busy) return;
  set({ busy: true, error: null });
  try {
    await iap.requestPurchase({
      request: { apple: { sku: RECIPE_PRODUCT_ID, appAccountToken: userId } },
      type: 'subs',
    });
    // Resultatet kommer via purchaseUpdatedListener/purchaseErrorListener.
  } catch {
    set({ busy: false, error: 'Kunne ikke åbne betalingen. Prøv igen.' });
  }
}

/** "Gendan køb" er et krav fra Apple. */
export async function restoreRecipeAccess(): Promise<boolean> {
  const iap = await connect();
  if (!iap) return false;
  set({ busy: true, error: null });
  try {
    await iap.restorePurchases();
  } catch {
    // Vi tjekker status nedenfor alligevel.
  }
  await syncPurchases();
  const ok = await refreshRecipeAccess();
  set({ busy: false });
  return ok;
}

/** Åbner Apples egen side, hvor abonnementet kan stoppes. */
export async function manageRecipeAccess(): Promise<void> {
  const iap = await connect();
  if (!iap) {
    set({ error: 'Åbn Indstillinger > dit navn > Abonnementer på din iPhone for at ændre det.' });
    return;
  }
  try {
    await iap.deepLinkToSubscriptions({});
  } catch {
    set({ error: 'Åbn Indstillinger > dit navn > Abonnementer for at ændre det.' });
  }
}
