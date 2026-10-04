/**
 * Tre grønne, og kun dem (Kalle 03-10-2026). Samme værdier som webbens
 * --green / --green-dark / --green-light i static/css/styles.css:
 *  - primær   #059669 (primary, primarySolid): knapper, butiksmærker, banner
 *  - sekundær #047857 (primaryDark, badge): grøn tekst og "Billigst"
 *  - tertiær  #D6F5E3 (primaryMuted): lyse grønne flader
 * Tilføj ikke flere grønne nuancer. Tilbud er gule (deal), aldrig grønne
 * eller røde; rød (sale) er kun til fejl og "slet".
 */
export const lightColors = {
  bg: '#F7F8F5',
  surface: '#FFFFFF',
  text: '#1A1C19',
  textMuted: '#5C6358',
  border: '#E2E6DE',
  primary: '#059669',
  // Fast grøn flade med hvid tekst, ens i lys og mørk tilstand (mærkater,
  // bannere).
  primarySolid: '#059669',
  primaryDark: '#047857',
  primaryMuted: '#D6F5E3',
  // Kun til fejl og "slet"-handlinger. Tilbud er gule (deal*), ikke røde.
  sale: '#C62828',
  // Tilbud: én gul (#FFD500) overalt, også som tekstfarve på hvidt (Kalle
  // 04-10-2026: hellere én farve end en mørkere læsbar variant).
  deal: '#FFD500',
  dealText: '#1A1C19',
  dealInk: '#FFD500',
  badge: '#047857',
  tabInactive: '#8A9184',
  // Web-paritet (styles.css --yellow/--yellow-light): samme advarselsfarve
  // som .price-insight-badge.fake-deal — et tilbud der næppe er et rigtigt
  // tilbud, IKKE en positiv besparelse.
  warning: '#D97706',
  warningMuted: '#FEF3C7',
};

export const darkColors = {
  bg: '#121412',
  surface: '#1C1F1B',
  text: '#F0F2ED',
  textMuted: '#A3AAA0',
  border: '#2C312B',
  primary: '#059669',
  primarySolid: '#059669',
  // I mørk tilstand bytter sekundær og tertiær plads: lys grøn tekst på mørk
  // grøn flade, så teksten stadig kan læses.
  primaryDark: '#D6F5E3',
  primaryMuted: '#047857',
  sale: '#EF9A9A',
  deal: '#FFD500',
  dealText: '#1A1C19',
  dealInk: '#FFD500',
  badge: '#059669',
  tabInactive: '#6B7268',
  warning: '#F5B94D',
  warningMuted: '#3A2E12',
};

export type ThemeColors = typeof lightColors;
