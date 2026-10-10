/**
 * MadShopper Test henter ny appkode fra main (EAS Update, kanalen "test").
 *
 * Kun testappen har opdateringer slået til (app.config.js); i butiksappen og
 * under udvikling er Updates.isEnabled false, og intet her gør noget.
 * Tjekker når appen åbnes og når den kommer tilbage i forgrunden, og genstarter
 * med det samme, når der er ny kode, så Kalle altid tester det nyeste fra main
 * (.github/workflows/test-app-update.yml).
 */
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

let busy = false;

async function pullLatest(): Promise<void> {
  if (busy || __DEV__ || !Updates.isEnabled) return;
  busy = true;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    const res = await Updates.fetchUpdateAsync();
    if (res.isNew) await Updates.reloadAsync();
  } catch {
    // Intet net eller Expo nede: kør videre med den kode vi har.
  } finally {
    busy = false;
  }
}

export function startTestAppUpdates(): void {
  if (__DEV__ || !Updates.isEnabled) return;
  void pullLatest();
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void pullLatest();
  });
}
