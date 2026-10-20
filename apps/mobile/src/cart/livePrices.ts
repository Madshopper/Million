/**
 * Kurvens vinderkort (version C) regner sammenligningen hver gang antallet
 * ændres. /api/products er hele kataloget, så svaret genbruges i 10 minutter
 * i stedet for at blive hentet ved hvert tryk på "+".
 */
import { fetchProductPrices } from '../api/listing';

const TTL_MS = 10 * 60 * 1000;
let cached: { at: number; data: Promise<Awaited<ReturnType<typeof fetchProductPrices>>> } | null = null;

export function cachedProductPrices(): ReturnType<typeof fetchProductPrices> {
  if (!cached || Date.now() - cached.at > TTL_MS) {
    const data = fetchProductPrices().then((r) => {
      if (!r.success) cached = null;
      return r;
    });
    data.catch(() => {
      cached = null;
    });
    cached = { at: Date.now(), data };
  }
  return cached.data;
}
