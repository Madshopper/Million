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
  // Fast rød flade med hvid tekst, ens i lys og mørk tilstand ("Fjern fra
  // kurv" bag en vare man swiper).
  saleSolid: '#C62828',
  // Tilbud: én varm guldgul (#DFA300) overalt, som flade på SPAR-mærket
  // (mørk tekst) og som tekstfarve på tilbudsprisen. Valgt så den kan ses i
  // både lys og mørk tilstand (Kalle 04-10-2026).
  deal: '#DFA300',
  dealText: '#1A1C19',
  dealInk: '#DFA300',
  badge: '#047857',
  tabInactive: '#8A9184',
  // Web-paritet (styles.css --yellow/--yellow-light): samme advarselsfarve
  // som .price-insight-badge.fake-deal — et tilbud der næppe er et rigtigt
  // tilbud, IKKE en positiv besparelse.
  warning: '#D97706',
  warningMuted: '#FEF3C7',
  // Version C (18-10-2026): ét neutralt grå bag antalsvælgeren i kurven.
  stepperBg: '#F2F4EF',
  // Sporet bag et segment (to faner som én pille), og den tomme kant på en
  // afkrydsning (opskriftens "Har jeg"). Opskrifter i C2, 31-10-2026.
  segmentBg: '#ECEEE8',
  checkBorder: '#C9CFC3',
  // Fast hvid på de faste grønne flader (vinderkort, besparelses-banner) og
  // den lidt lysere boks inde i vinderkortet.
  onPrimary: '#FFFFFF',
  onPrimarySoft: 'rgba(255,255,255,0.14)',
  // Besparelses-banneret: samme mørkegrønne flade i lys og mørk tilstand
  // (#047857, sekundær grøn), med lysegrøn tekst (#D6F5E3, tertiær grøn).
  bannerBg: '#047857',
  bannerSoft: '#D6F5E3',
  // Meget let skygge under kort.
  shadow: '#1A1C19',
  // Butikslogoerne har hvid baggrund i selve billedet, så deres pille er hvid
  // i begge tilstande.
  logoBg: '#FFFFFF',
};

// Mørk tilstand bruger hjemmesidens blågrå farver (static/css/styles.css,
// html.c2 mørk). Neutral grå var for sort; Kalle 22-10-2026.
export const darkColors = {
  bg: '#111827',
  surface: '#1F2937',
  text: '#F9FAFB',
  textMuted: '#9CA3AF',
  border: '#374151',
  primary: '#059669',
  primarySolid: '#059669',
  // I mørk tilstand bytter sekundær og tertiær plads: lys grøn tekst på mørk
  // grøn flade, så teksten stadig kan læses.
  primaryDark: '#D6F5E3',
  primaryMuted: '#047857',
  sale: '#EF9A9A',
  saleSolid: '#C62828',
  deal: '#DFA300',
  dealText: '#1A1C19',
  dealInk: '#DFA300',
  badge: '#059669',
  tabInactive: '#6B7280',
  warning: '#F5B94D',
  warningMuted: '#3A2E12',
  stepperBg: '#374151',
  segmentBg: '#0B1220',
  checkBorder: '#4B5563',
  onPrimary: '#FFFFFF',
  onPrimarySoft: 'rgba(255,255,255,0.14)',
  bannerBg: '#047857',
  bannerSoft: '#D6F5E3',
  shadow: '#000000',
  logoBg: '#FFFFFF',
};

export type ThemeColors = typeof lightColors;
