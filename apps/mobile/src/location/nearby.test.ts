/**
 * Butikker nær mig: samme tilfælde som scripts/test-lokation.mjs (hjemmesiden),
 * så appen og hjemmesiden regner ens.
 * Kør: node --experimental-strip-types src/location/nearby.test.ts
 */
import { lookupPostcode, mapsUrl, nearbyChains, planRoute, type StoreLocations } from './nearby.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const data: StoreLocations = {
  stores: [
    ['netto', 56.001, 10.001, 'Torvet 1', '8000', 'Byen'],
    ['rema', 56.004, 10.01, 'Vejen 2', '8000', 'Byen'],
    ['spar', 55.995, 9.99, 'Gaden 3', '8000', 'Byen'],
    ['netto', 56.02, 10.0, 'Nord 4', '8001', 'Byen N'],
    ['bilka', 56.27, 10.0, 'Storcenter 1', '8200', 'Storby'],
    ['lidl', 56.03, 10.02, 'Lidlvej 5', '8001', 'Byen N'],
  ],
  postcodes: { '8000': [56.0, 10.0, 'Byen'], '8200': [56.27, 10.0, 'Storby'] },
};
const home = { lat: 56.0, lon: 10.0, label: 'hjem', precise: true };

const near = nearbyChains(data, home, ['netto', 'rema', 'spar', 'bilka', 'lidl']);
assert(near.radius === 5, `radius ${near.radius}`);
const on = near.stores.filter((s) => s.near).map((s) => s.key).sort().join(',');
assert(on === 'lidl,netto,rema,spar', `nær: ${on}`);

const plan = planRoute(data, home, ['netto', 'rema', 'lidl'], true);
assert(!!plan && plan.stops.length === 3, 'tre stop');
assert(plan!.stops.find((s) => s.key === 'netto')!.street === 'Torvet 1', 'nærmeste Netto');
assert(plan!.km > 6 && plan!.km < 10, `tur ${plan!.km}`);

assert(lookupPostcode(data, '8000')!.label === '8000 Byen', 'kendt postnummer');
assert(lookupPostcode(data, '8005')!.label === '8005 Byen', 'nabo-postnummer');
assert(lookupPostcode(data, '9999') === null, 'ukendt');
assert(lookupPostcode(data, 'abc') === null, 'ugyldigt');

const u1 = new URL(mapsUrl(home, plan!.stops, true));
assert(u1.searchParams.get('origin') === '56,10', 'origin');
assert(u1.searchParams.get('waypoints')!.split('|').length === 3, 'waypoints rundtur');
const u2 = new URL(mapsUrl(home, plan!.stops, false));
assert(u2.searchParams.get('origin') === null, 'ingen origin');
assert(u2.searchParams.get('waypoints')!.split('|').length === 2, 'waypoints postnummer');

const many = planRoute(data, home, ['netto', 'rema', 'spar', 'bilka', 'lidl', 'netto', 'rema'], true);
assert(many!.stops.length === 7, 'grådig');

console.log('nearby.test: OK');
