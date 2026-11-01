// Ren (I/O-fri) TypeScript-port af app_support.py + udvalgte hjælpere fra
// app.py. Paritet mod Python verificeres af test/parity/support.test.ts.
export * from './catalog'
export * from './display'
export * from './filters'
export * from './search'
export {
  ABBREV_COMPILED,
  FLAVOR_MAP,
  FLAVOR_VOCAB,
  cachedSearchFlavorField,
  extractImageFlavorKeywords,
  fieldMatchesTerm,
  flavorAbbrevCanonicals,
  fold,
  fuzzyTermHits,
  getProductFlavors,
  getSearchFlavorKeywords,
  normalizeName,
  productFlavorSearchField,
  rapidRatio,
  rapidTokenSort,
  termCanFuzzyMatchFlavor,
  termCanMatchFlavor,
  tokenMatchesTerm,
} from './text'
export { pyFloat, pyStr, pyTruthy } from './py'
