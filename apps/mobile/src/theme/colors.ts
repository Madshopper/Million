/**
 * Tre faste farver (Kalle 03-10-2026):
 *  1. primær   = grøn (primary/primarySolid): knapper, butiksmærker, besparelse
 *  2. sekundær = mørk tekst (text): titler, priser, links som "Vis alle"
 *  3. tertiær  = gul (deal): ALT tilbud, intet andet
 * Rød (sale) er kun til fejl og "slet". Tilføj ikke nye grønne nuancer;
 * brug primary, primarySolid eller primaryMuted.
 */
export const lightColors = {
  bg: '#F7F8F5',
  surface: '#FFFFFF',
  text: '#1A1C19',
  textMuted: '#5C6358',
  border: '#E2E6DE',
  primary: '#1B5E20',
  // Fast grøn flade med hvid tekst, ens i lys og mørk tilstand (mærkater,
  // bannere). primary selv er lys grøn i mørk tilstand og bærer ikke hvid tekst.
  primarySolid: '#1B5E20',
  primaryMuted: '#E8F5E9',
  // Kun til fejl og "slet"-handlinger. Tilbud er gule (deal*), ikke røde.
  sale: '#C62828',
  // Tilbud: samme gule som SPAR-mærkatet (#FFD500) med mørk tekst ovenpå.
  // dealInk er til tilbudstekst direkte på baggrunden, hvor ren gul ikke
  // kan læses på hvidt.
  deal: '#FFD500',
  dealText: '#1A1C19',
  dealInk: '#A16207',
  badge: '#1B5E20',
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
  primary: '#81C784',
  primarySolid: '#1B5E20',
  primaryMuted: '#1B3A1D',
  sale: '#EF9A9A',
  deal: '#FFD500',
  dealText: '#1A1C19',
  dealInk: '#FACC15',
  badge: '#81C784',
  tabInactive: '#6B7268',
  warning: '#F5B94D',
  warningMuted: '#3A2E12',
};

export type ThemeColors = typeof lightColors;
