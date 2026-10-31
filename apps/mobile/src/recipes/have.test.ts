/** Kør: node --experimental-strip-types src/recipes/have.test.ts */
import assert from 'node:assert/strict';
import { displayTotal, haveSummary, toggleHave } from './have.ts';

const rows = [
  { id: 1, lineCost: 12.95 },
  { id: 2, lineCost: 15 },
  { id: 3, lineCost: 24.95 },
  { id: 4, lineCost: null }, // ikke fundet
];

// Intet valgt: alt tæller, serverens pris vises.
let s = haveSummary(rows, new Set());
assert.deepEqual(s, { needed: 4, found: 3, foundCost: 52.9, haveCost: 0 });
assert.equal(displayTotal(64.85, s, false), 64.85);

// "Har jeg" på æggene: trækkes fra pris og antal.
let have = toggleHave(new Set(), 3);
s = haveSummary(rows, have);
assert.deepEqual(s, { needed: 3, found: 2, foundCost: 27.95, haveCost: 24.95 });
assert.equal(displayTotal(64.85, s, have.size > 0), 27.95);

// "Har jeg" på en vare der ikke er fundet: ændrer kun antallet af linjer.
have = toggleHave(have, 4);
s = haveSummary(rows, have);
assert.equal(s.needed, 2);
assert.equal(s.found, 2);

// Slå fra igen.
have = toggleHave(toggleHave(have, 3), 4);
assert.equal(have.size, 0);

// Har man alt der er fundet, er der ingen pris at vise.
s = haveSummary(rows, new Set([1, 2, 3]));
assert.equal(displayTotal(64.85, s, true), null);
assert.equal(s.found, 0);

console.log('have.test.ts: ok');
