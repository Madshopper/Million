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
