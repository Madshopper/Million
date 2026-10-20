/**
 * Butikslogoer i appen (version C). Kopieret fra static/images/*-logo.png,
 * beskåret og gjort mindre (højst 96 px høje), så de kan ligge i appens egne
 * filer og virker uden net. Nøglen er butikkens navn, som det står på varen
 * og i kurven ('Netto', 'Rema 1000', ...).
 */
import React from 'react';
import { Image, type ImageSourcePropType } from 'react-native';
import { Text } from '../theme/Typography';
import { useTheme } from '../theme/ThemeContext';

type Logo = { source: ImageSourcePropType; aspect: number };

const LOGOS: Record<string, Logo> = {
  'rema 1000': { source: require('../../assets/stores/rema.png'), aspect: 1 },
  bilka: { source: require('../../assets/stores/bilka.png'), aspect: 1 },
  netto: { source: require('../../assets/stores/netto.png'), aspect: 4.26 },
  føtex: { source: require('../../assets/stores/foetex.png'), aspect: 1.8 },
  'min købmand': { source: require('../../assets/stores/mk.png'), aspect: 1 },
  meny: { source: require('../../assets/stores/meny.png'), aspect: 1 },
  spar: { source: require('../../assets/stores/spar.png'), aspect: 1 },
  superbrugsen: { source: require('../../assets/stores/sb.png'), aspect: 2.03 },
  brugsen: { source: require('../../assets/stores/brugsen.png'), aspect: 3.95 },
  kvickly: { source: require('../../assets/stores/kvickly.png'), aspect: 2.03 },
  '365 discount': { source: require('../../assets/stores/discount365.png'), aspect: 1 },
  lidl: { source: require('../../assets/stores/lidl.png'), aspect: 1 },
  løvbjerg: { source: require('../../assets/stores/loevbjerg.png'), aspect: 1 },
  'abc lavpris': { source: require('../../assets/stores/abclavpris.png'), aspect: 4.22 },
};

export function storeLogo(store: string | null | undefined): Logo | null {
  return LOGOS[String(store || '').trim().toLowerCase()] ?? null;
}

/**
 * Logoet i en given ramme: brede logoer (Netto, ABC Lavpris) lave, firkantede
 * høje, så de fylder nogenlunde lige meget. Mangler et logo, vises navnet.
 */
export function StoreLogo({
  store,
  maxHeight = 22,
  minHeight = 14,
  maxWidth = 64,
}: {
  store: string;
  maxHeight?: number;
  minHeight?: number;
  maxWidth?: number;
}) {
  const { colors } = useTheme();
  const logo = storeLogo(store);
  if (!logo) {
    return (
      <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }} numberOfLines={1}>
        {store}
      </Text>
    );
  }
  const t = Math.min(1, Math.max(0, (logo.aspect - 1) / 3));
  let height = maxHeight - (maxHeight - minHeight) * t;
  let width = height * logo.aspect;
  if (width > maxWidth) {
    width = maxWidth;
    height = width / logo.aspect;
  }
  return (
    <Image
      source={logo.source}
      style={{ width, height }}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}
