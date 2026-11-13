/**
 * Priser med dansk komma, ét sted for hele appen (GitHub-issue #157):
 * Find billigste og produktsiden viste "63.75 kr", mens kurven viste
 * "63,75 kr", fordi hver skærm selv kaldte toFixed(2).
 */

/** "22,45" (uden "kr"), til "22,45 kr/kg" og lignende. */
export function krNum(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

/** "22,45 kr". */
export function kr(value: number): string {
  return `${krNum(value)} kr`;
}

/**
 * "kg" eller "l": enheden bag kiloprisen. En vare solgt i rumfang ("1,5 l",
 * "24 x 33 cl", "250 ML") har en literpris, som skal stå som "kr/l" og ikke
 * "kr/kg". Samme regel som app_support.kg_price_unit og script.js::kgUnitOf.
 * API'et sender den som kg_unit; ældre svar og gemte kurve har den ikke.
 */
export function kgUnitOf(weightText: string | null | undefined): 'kg' | 'l' {
  return /\d\s*(?:ml|cl|dl|l|ltr|liter|litre|lt)\.?$/i.test(String(weightText || '').trim()) ? 'l' : 'kg';
}

/** "22,45 kr/kg" eller "22,45 kr/l". */
export function krPerUnit(value: number, unit: string | null | undefined): string {
  return `${krNum(value)} kr/${unit === 'l' ? 'l' : 'kg'}`;
}

/** "pr. kilo" eller "pr. liter", til VoiceOver. */
export function spokenPerUnit(unit: string | null | undefined): string {
  return unit === 'l' ? 'pr. liter' : 'pr. kilo';
}
