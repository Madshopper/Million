/**
 * Én fast farve pr. butik, så man i kurven straks kan se hvilken butik en
 * vare er fra. Holdes ens med STORE_COLORS i static/js/script.js.
 *
 * Bevidst valgt så de ligner butikkens eget udtryk, men uden gul (reserveret
 * til tilbud) og med højst én grøn, så appen ikke drukner i grønt. Alle har
 * nok kontrast til hvid tekst (StoreChip), også i mørk tilstand.
 */
const STORE_COLORS: Record<string, string> = {
  'Rema 1000': '#1D4ED8',
  Bilka: '#0284C7',
  Netto: '#27272A',
  Føtex: '#1E3A8A',
  Meny: '#9F1239',
  Spar: '#C2410C',
  'Min Købmand': '#7C2D12',
  SuperBrugsen: '#B91C1C',
  Brugsen: '#BE185D',
  Kvickly: '#7C3AED',
  '365 Discount': '#0F766E',
  Lidl: '#1E40AF',
  Løvbjerg: '#15803D',
  'ABC Lavpris': '#C026D3',
};

const FALLBACK = '#52525B';

export function storeColor(store: string | null | undefined): string {
  return (store && STORE_COLORS[store]) || FALLBACK;
}
