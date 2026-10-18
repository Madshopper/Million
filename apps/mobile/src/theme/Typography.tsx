/**
 * Appens skrift: Schibsted Grotesk (Google Font, OFL), version C 18-10-2026.
 *
 * React Native har ingen global standardskrift, og med en indlæst skrift skal
 * hver vægt være sin egen familie (på Android virker fontWeight ikke sammen med
 * en egen fontFamily). Derfor importerer skærmene Text/TextInput herfra i
 * stedet for fra react-native: komponenten oversætter fontWeight til den rette
 * familie. Indlejret tekst uden egen vægt arver forælderens familie.
 *
 * Indlæses skriften ikke (fejl eller langsomt net ved opstart, se App.tsx),
 * bruges systemskriften med de normale vægte, præcis som før.
 *
 * Brug ikke fontVariant: ['tabular-nums'] på løbende tekst: i Schibsted giver
 * det mellemrum ved kommaet ("1 , 5%"). Højst på rene tal.
 */
import React, { createContext, forwardRef, useContext } from 'react';
import {
  Animated,
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';
import {
  SchibstedGrotesk_400Regular,
  SchibstedGrotesk_500Medium,
  SchibstedGrotesk_600SemiBold,
  SchibstedGrotesk_700Bold,
  SchibstedGrotesk_800ExtraBold,
  SchibstedGrotesk_900Black,
} from '@expo-google-fonts/schibsted-grotesk';

export const FONT_ASSETS = {
  SchibstedGrotesk_400Regular,
  SchibstedGrotesk_500Medium,
  SchibstedGrotesk_600SemiBold,
  SchibstedGrotesk_700Bold,
  SchibstedGrotesk_800ExtraBold,
  SchibstedGrotesk_900Black,
};

const FAMILIES: Array<[number, keyof typeof FONT_ASSETS]> = [
  [900, 'SchibstedGrotesk_900Black'],
  [800, 'SchibstedGrotesk_800ExtraBold'],
  [700, 'SchibstedGrotesk_700Bold'],
  [600, 'SchibstedGrotesk_600SemiBold'],
  [500, 'SchibstedGrotesk_500Medium'],
  [0, 'SchibstedGrotesk_400Regular'],
];

let fontsReady = false;

/** Kaldes af App.tsx, før træet vises første gang. */
export function setFontsReady(ready: boolean) {
  fontsReady = ready;
}

function weightNumber(weight: TextStyle['fontWeight']): number {
  if (weight == null || weight === 'normal') return 400;
  if (weight === 'bold') return 700;
  const n = Number(weight);
  return Number.isFinite(n) ? n : 400;
}

/** Familien for en vægt, eller undefined når skriften ikke er indlæst. */
export function fontFamily(weight?: TextStyle['fontWeight']): string | undefined {
  if (!fontsReady) return undefined;
  const w = weightNumber(weight);
  return FAMILIES.find(([min]) => w >= min)?.[1];
}

/** Style til tredjeparts-tekst (header-titler, fanetekster). */
export function fontStyle(
  weight?: TextStyle['fontWeight'],
): Pick<TextStyle, 'fontFamily' | 'fontWeight'> {
  const family = fontFamily(weight);
  return family ? { fontFamily: family, fontWeight: undefined } : { fontWeight: weight };
}

function withFont(style: StyleProp<TextStyle>, nested: boolean): StyleProp<TextStyle> {
  if (!fontsReady) return style;
  const flat = StyleSheet.flatten(style) || {};
  if (flat.fontFamily) return style;
  // Indlejret tekst uden egen vægt arver forælderens familie af sig selv.
  if (nested && flat.fontWeight == null) return style;
  const { fontWeight, ...rest } = flat;
  return { ...rest, fontFamily: fontFamily(fontWeight) };
}

const InText = createContext(false);

export const Text = forwardRef<RNText, TextProps>(function Text({ style, children, ...rest }, ref) {
  const nested = useContext(InText);
  return (
    <RNText ref={ref} {...rest} style={withFont(style, nested)}>
      {nested ? children : <InText.Provider value>{children}</InText.Provider>}
    </RNText>
  );
});

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput(
  { style, ...rest },
  ref,
) {
  return <RNTextInput ref={ref} {...rest} style={withFont(style, false)} />;
});

export const AnimatedText = Animated.createAnimatedComponent(Text);

/** Meget let skygge under kort (version C). */
export function cardShadow(color: string) {
  return {
    shadowColor: color,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  } as const;
}
