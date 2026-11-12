import { kgUnitOf, krNum, krPerUnit, spokenPerUnit } from './kr.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

// Samme tilfælde som scripts/test-listing-api.py og app_support.kg_price_unit.
assert(kgUnitOf('1,5 l') === 'l', '1,5 l er liter');
assert(kgUnitOf('24 x 33 cl') === 'l', 'en kasse øl er liter');
assert(kgUnitOf('250 ML') === 'l', 'ML med versaler');
assert(kgUnitOf('75 cl.') === 'l', 'punktum til sidst');
assert(kgUnitOf('500 g') === 'kg', '500 g er kilo');
assert(kgUnitOf('1 kg') === 'kg', '1 kg er kilo');
assert(kgUnitOf('10 stk') === 'kg', 'stk er ikke liter');
assert(kgUnitOf('') === 'kg', 'tom');
assert(kgUnitOf(null) === 'kg', 'null');
assert(krPerUnit(13.333, 'l') === '13,33 kr/l', 'literpris');
assert(krPerUnit(79.88, 'kg') === '79,88 kr/kg', 'kilopris');
assert(krPerUnit(79.88, undefined) === '79,88 kr/kg', 'ukendt enhed er kilo');
assert(spokenPerUnit('l') === 'pr. liter' && spokenPerUnit('kg') === 'pr. kilo', 'VoiceOver');
assert(krNum(63.75) === '63,75', 'dansk komma');
console.log('kr ok');
