/**
 * Hentning af butikslisten og det gemte postnummer (Feature-panelet 'lokation').
 * Adskilt fra nearby.ts, så regnestykkerne kan testes uden React Native.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { env } from '../config/env';
import { getSupabase } from '../auth/supabase';
import type { StoreLocations } from './nearby';

const PC_KEY = 'lokation_postnummer';
const ASKED_KEY = 'lokation_spurgt';

let cache: Promise<StoreLocations> | null = null;

export function loadStoreLocations(): Promise<StoreLocations> {
  if (!cache) {
    cache = fetch(`${env.apiBaseUrl}/static/data/butikker.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<StoreLocations>;
      })
      .catch((e) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}

// Postnummeret gemmes også på kontoen (user_metadata.postnummer, ligesom
// navnet), når man er logget ind: så følger det med til en ny telefon og
// slettes sammen med kontoen. Telefonens placering gemmes aldrig.
async function accountPostcode(): Promise<string> {
  try {
    const { data } = (await getSupabase()?.auth.getSession()) ?? { data: { session: null } };
    const pc = data.session?.user?.user_metadata?.postnummer;
    return typeof pc === 'string' && /^\d{4}$/.test(pc) ? pc : '';
  } catch {
    return '';
  }
}

export async function savedPostcode(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(PC_KEY)) || (await accountPostcode());
  } catch {
    return accountPostcode();
  }
}

export async function savePostcode(pc: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PC_KEY, pc);
  } catch {
    // ingen lagring - så spørger vi bare igen
  }
  try {
    const sb = getSupabase();
    const { data } = (await sb?.auth.getSession()) ?? { data: { session: null } };
    if (sb && data.session && data.session.user.user_metadata?.postnummer !== pc) {
      await sb.auth.updateUser({ data: { postnummer: pc } });
    }
  } catch {
    // prøver igen næste gang
  }
}

// Svaret i opret-konto-formularen. Sættes før signUp, fordi den nye session
// (og ProfileScreens spørgsmål) kan komme før signUp selv er færdig.
const ANSWERED_KEY = `${ASKED_KEY}:ny`;

export async function markAnsweredAtSignup(on: boolean): Promise<void> {
  try {
    if (on) await AsyncStorage.setItem(ANSWERED_KEY, '1');
    else await AsyncStorage.removeItem(ANSWERED_KEY);
  } catch {
    // ingen lagring - så spørger vi bare efter login
  }
}

/** Sand første gang for en ny konto, medmindre man svarede i formularen; derefter falsk. */
export async function shouldAskAfterSignup(userId: string, createdAt?: string): Promise<boolean> {
  if (!createdAt || Date.now() - new Date(createdAt).getTime() > 15 * 60 * 1000) return false;
  const key = `${ASKED_KEY}:${userId}`;
  try {
    if (await AsyncStorage.getItem(ANSWERED_KEY)) {
      await AsyncStorage.removeItem(ANSWERED_KEY);
      await AsyncStorage.setItem(key, '1');
      return false;
    }
    if (await AsyncStorage.getItem(key)) return false;
    await AsyncStorage.setItem(key, '1');
  } catch {
    // uden lagring spørger vi bare
  }
  return true;
}
