/**
 * Telefonens egen placering (Feature-panelet 'lokation'). Telefonen spørger
 * selv om lov første gang ("Må MadShopper bruge din placering?"), og kun når
 * man trykker "Brug min placering". Placeringen bruges kun på telefonen og
 * bliver aldrig gemt eller sendt til os.
 *
 * expo-location er native kode og findes kun i builds fra runtimeVersion
 * test-2 og frem. Den hentes derfor først her, så et ældre build bare ikke
 * viser knappen i stedet for at gå ned.
 */
import type { Pos } from './nearby';

type LocationModule = typeof import('expo-location');

let mod: LocationModule | null | undefined;
function location(): LocationModule | null {
  if (mod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('expo-location') as LocationModule;
    } catch {
      mod = null;
    }
  }
  return mod;
}

/** Om appen kan spørge telefonen om placering (nyt nok build). */
export function canUseDeviceLocation(): boolean {
  return location() !== null;
}

/**
 * Har man allerede sagt ja, finder vi placeringen af os selv (uden at spørge),
 * så turen og butikkerne følger med, når man fx er i en anden by. Ellers null.
 */
export async function devicePositionIfAllowed(): Promise<Pos | null> {
  const Location = location();
  if (!Location) return null;
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    return await devicePosition();
  } catch {
    return null;
  }
}

/** Telefonens placering. Afviser med en dansk tekst til brugeren. */
export async function devicePosition(): Promise<Pos> {
  const Location = location();
  if (!Location) throw new Error('Opdatér appen for at bruge din placering. Skriv dit postnummer i stedet.');
  let perm;
  try {
    perm = await Location.requestForegroundPermissionsAsync();
  } catch {
    throw new Error('Vi kunne ikke finde din placering. Skriv dit postnummer i stedet.');
  }
  if (perm.status !== 'granted') {
    throw new Error(
      perm.canAskAgain
        ? 'Du har ikke givet lov til at bruge din placering. Skriv dit postnummer i stedet.'
        : 'Placering er slået fra for MadShopper. Slå den til under Indstillinger på telefonen, eller skriv dit postnummer.',
    );
  }
  try {
    // Butikker tæt på kræver ikke GPS-præcision; "Balanced" er hurtig og
    // sparer strøm. En nylig kendt placering bruges, hvis den findes.
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });
    const p = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { lat: p.coords.latitude, lon: p.coords.longitude, label: 'din placering', precise: true };
  } catch {
    throw new Error('Vi kunne ikke finde din placering. Skriv dit postnummer i stedet.');
  }
}
