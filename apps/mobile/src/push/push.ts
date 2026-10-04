/**
 * Beskeder på telefonen (prisalarmer) - Feature-panelet 'push' i /admin.
 *
 * Appen henter en Expo-push-adresse (gratis tjeneste, der selv videregiver
 * til Apple/Google) og gemmer den via register_push_device-RPC'en
 * (scripts/supabase-push.sql). Nattens updater.py (push_notify.py) sender så
 * prisalarmen hertil. Når funktionen er udgivet, sendes ingen mails (Kalle
 * 04-10-2026): uden tilmeldt enhed venter alarmen. Webben har samme knap
 * (static/js/auth.js::refreshPushUI).
 *
 * Synlig når buildet har EXPO_PUBLIC_PUSH_ENABLED=1 (test-udgaverne, som
 * recipesEnabled) ELLER når madshopper.dk's /api/home siger at funktionen er
 * udgivet - så kræver udgivelsen ingen ny app-version, kun at denne kode er med.
 */
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { getSupabase } from '../auth/supabase';
import { pushEnabledBuild, rpcName } from '../config/env';

const TOKEN_KEY = 'push_token_v1';

// Vises også mens appen er åben (ellers viser iOS intet banner i forgrunden).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/* ---- Er funktionen slået til? (build-flag eller serverens svar) ---- */
let serverEnabled = false;
const listeners = new Set<() => void>();

/** Kaldes af HomeScreen med /api/home's push_enabled. */
export function setServerPushEnabled(on: boolean | undefined) {
  if (!!on === serverEnabled) return;
  serverEnabled = !!on;
  listeners.forEach((l) => l());
}

export function usePushFeature(): boolean {
  const server = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => serverEnabled,
  );
  return pushEnabledBuild || server;
}

/* ---- Tilmelding ---- */
export type PushState = 'on' | 'off' | 'denied' | 'unsupported';

export async function getPushState(): Promise<PushState> {
  if (!Device.isDevice) return 'unsupported';
  const perm = await Notifications.getPermissionsAsync();
  if (perm.status === 'denied' && !perm.canAskAgain) return 'denied';
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  return perm.granted && token ? 'on' : 'off';
}

async function currentToken(): Promise<string> {
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ||
    Constants.easConfig?.projectId;
  const res = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return res.data;
}

async function save(token: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { data, error } = await sb.rpc(rpcName('register_push_device'), { kind: 'expo', token });
  return !error && data === true;
}

/** Spørger om lov og tilmelder enheden. Returnerer den nye tilstand. */
export async function enablePush(): Promise<PushState> {
  if (!Device.isDevice) return 'unsupported';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Prisalarmer',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return perm.canAskAgain ? 'off' : 'denied';
  const token = await currentToken();
  if (!(await save(token))) throw new Error('register_push_device afviste');
  await AsyncStorage.setItem(TOKEN_KEY, token);
  return 'on';
}

/** Afmelder enheden (knappen, og ved log ud). Fejler aldrig højlydt. */
export async function disablePush(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  try {
    const sb = getSupabase();
    if (sb) await sb.rpc(rpcName('unregister_push_device'), { token });
  } catch {
    /* ignore */
  }
  await AsyncStorage.removeItem(TOKEN_KEY);
}

/** Ved login: var beskeder slået til på telefonen, følger de nu denne bruger. */
export async function resyncPush(): Promise<void> {
  try {
    if (!Device.isDevice || !(await AsyncStorage.getItem(TOKEN_KEY))) return;
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    const token = await currentToken();
    if (await save(token)) await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}
