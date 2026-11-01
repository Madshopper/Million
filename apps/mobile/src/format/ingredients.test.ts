import { ingredientParts, ingredientText } from './ingredients.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const eg = ingredientParts('Økologiske <b>æg</b>. <br>Str M/L');
assert(eg.length === 3, `tre dele, fik ${JSON.stringify(eg)}`);
assert(eg[1].bold && eg[1].text === 'æg', 'æg er fed');
assert(ingredientText('Økologiske <b>æg</b>. <br>Str M/L') === 'Økologiske æg.\nStr M/L', 'linjeskift');
assert(ingredientText('<p>Mel, <i>sukker</i> &amp; salt</p>') === 'Mel, sukker & salt', 'andre tags væk');
assert(ingredientText(null) === '', 'tom');
assert(ingredientText('Vand, <B>HVEDE</B>MEL') === 'Vand, HVEDEMEL', 'store bogstaver i tag');
console.log('ingredients ok');
