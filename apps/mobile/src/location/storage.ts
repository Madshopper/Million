/**
 * Hentning af butikslisten og det gemte postnummer (Feature-panelet 'lokation').
 * Adskilt fra nearby.ts, så regnestykkerne kan testes uden React Native.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { env } from '../config/env';
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

export async function savedPostcode(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(PC_KEY)) || '';
  } catch {
    return '';
  }
}

export async function savePostcode(pc: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PC_KEY, pc);
  } catch {
    // ingen lagring - så spørger vi bare igen
  }
}

/** Sand første gang for en ny konto; derefter falsk. */
export async function shouldAskAfterSignup(userId: string, createdAt?: string): Promise<boolean> {
  if (!createdAt || Date.now() - new Date(createdAt).getTime() > 15 * 60 * 1000) return false;
  const key = `${ASKED_KEY}:${userId}`;
  try {
    if (await AsyncStorage.getItem(key)) return false;
    await AsyncStorage.setItem(key, '1');
  } catch {
    // uden lagring spørger vi bare
  }
  return true;
}
