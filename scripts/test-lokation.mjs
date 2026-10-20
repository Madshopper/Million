// Regnestykkerne bag "Butikker nær mig" (static/js/lokation.js, Feature
// 'lokation'): nærmeste butikker, korteste tur, postnummer og Maps-linket.
// Kør: node scripts/test-lokation.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../static/js/lokation.js', import.meta.url), 'utf8');
const ctx = { window: {}, document: { addEventListener() {} }, console };
vm.runInNewContext(src, ctx);
const L = ctx.window.Lokation;

// Lille by ved (56.0, 10.0) og en større by 30 km mod nord.
const data = {
  stores: [
    ['netto', 56.001, 10.001, 'Torvet 1', '8000', 'Byen'],
    ['rema', 56.004, 10.010, 'Vejen 2', '8000', 'Byen'],
    ['spar', 55.995, 9.990, 'Gaden 3', '8000', 'Byen'],
    ['netto', 56.020, 10.000, 'Nord 4', '8001', 'Byen N'],
    ['bilka', 56.270, 10.000, 'Storcenter 1', '8200', 'Storby'],
    ['lidl', 56.030, 10.020, 'Lidlvej 5', '8001', 'Byen N'],
  ],
  postcodes: { '8000': [56.0, 10.0, 'Byen'], '8200': [56.27, 10.0, 'Storby'] },
};
const home = { lat: 56.0, lon: 10.0, label: 'hjem', precise: true };

// Nær: netto, rema, spar (og lidl ~3,5 km) er inden for 5 km, Bilka ~30 km er ikke.
const near = L._nearbyChains(data, home, ['netto', 'rema', 'spar', 'bilka', 'lidl']);
assert.equal(near.radius, 5);
const on = JSON.parse(JSON.stringify(near.stores.filter(s => s.near).map(s => s.key).sort()));
assert.deepEqual(on, ['lidl', 'netto', 'rema', 'spar']);
assert.equal(near.stores.find(s => s.key === 'bilka').near, false);

// Tur: tager den nærmeste Netto, ikke den nordlige, og en fornuftig rækkefølge.
const plan = L._planRoute(data, home, ['netto', 'rema', 'lidl'], true);
assert.equal(plan.stops.length, 3);
assert.equal(plan.stops.find(s => s.key === 'netto').street, 'Torvet 1');
assert.ok(plan.km > 6 && plan.km < 10, `tur ${plan.km}`);
// Brute force må ikke være dårligere end grådig rækkefølge.
const dist = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 62);
let greedy = 0, at = home;
for (const s of [...plan.stops].sort((a, b) => dist(home, a) - dist(home, b))) { greedy += dist(at, s); at = s; }
greedy += dist(at, home);
assert.ok(plan.km <= greedy + 0.5);

// Postnummer: kendt, ukendt men tæt på, og forkert.
assert.equal(L._lookupPostcode(data, '8000').label, '8000 Byen');
assert.equal(L._lookupPostcode(data, '8005').label, '8005 Byen');
assert.equal(L._lookupPostcode(data, '9999'), null);
assert.equal(L._lookupPostcode(data, 'abc'), null);

// Maps-link: rundtur har hjemmet som start og slut; postnummer slutter i sidste butik.
const u1 = new URL(L._mapsUrl(home, plan.stops, true));
assert.equal(u1.searchParams.get('origin'), '56,10');
assert.equal(u1.searchParams.get('destination'), '56,10');
assert.equal(u1.searchParams.get('waypoints').split('|').length, 3);
const u2 = new URL(L._mapsUrl(home, plan.stops, false));
assert.equal(u2.searchParams.get('origin'), null);
assert.equal(u2.searchParams.get('waypoints').split('|').length, 2);

// Mange kæder: grådig vej, stadig én butik pr. kæde.
const many = L._planRoute(data, home, ['netto', 'rema', 'spar', 'bilka', 'lidl', 'netto', 'rema'], true);
assert.equal(many.stops.length, 7);

console.log('test-lokation: OK');
