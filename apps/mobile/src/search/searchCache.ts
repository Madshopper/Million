/**
 * Seneste søgesvar i hukommelsen (21-10-2026), så en søgning man lige har
 * lavet, vises med det samme: når man sletter et bogstav igen, trykker på en
 * af "Seneste søgninger" eller bladrer tilbage til side 1. Uden den gik hvert
 * af dem en tur til serveren (0,1-3 s afhængig af om svaret lå i edge-cachen).
 *
 * Kun i hukommelsen og kun i 10 minutter: priserne skifter kun ved nattens
 * opdatering, så 10 minutter gamle tal er aldrig forkerte i praksis, og en
 * genstartet app henter altid frisk.
 */
export const SEARCH_CACHE_MAX = 30;
export const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;

type Entry<T> = { at: number; value: T };

export class SearchCache<T> {
  private map = new Map<string, Entry<T>>();
  private max: number;
  private ttlMs: number;

  constructor(max = SEARCH_CACHE_MAX, ttlMs = SEARCH_CACHE_TTL_MS) {
    this.max = max;
    this.ttlMs = ttlMs;
  }

  get(key: string, now = Date.now()): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (now - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    // Nyligt brugt flyttes bagerst, så den ældst brugte smides ud først.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T, now = Date.now()): void {
    this.map.delete(key);
    this.map.set(key, { at: now, value });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

/**
 * Seneste søgninger der passer til det man er ved at skrive (starter med det,
 * eller et ord i dem gør). Vises med det samme under søgefeltet i stedet for
 * serverens autocomplete, se SearchScreen.
 */
export function matchRecentSearches(recent: string[], typed: string, max = 5): string[] {
  const t = typed.trim().toLowerCase();
  if (t.length < 1) return [];
  return recent
    .filter((s) => {
      const l = s.toLowerCase();
      return l !== t && (l.startsWith(t) || l.split(/\s+/).some((w) => w.startsWith(t)));
    })
    .slice(0, max);
}
