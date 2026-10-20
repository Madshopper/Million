import React, { useContext } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';

/**
 * Glas-fanebjælke, kun iOS (Thomas 20-10-2026). Android er uændret.
 *
 * På iOS er fanebjælken en svævende glaspille (som Apples egne apps på iOS
 * 26), der ligger over indholdet, så listerne ses sløret bag den. iOS 26+ får
 * Apples Liquid Glass (expo-glass-effect), ældre iOS den klassiske
 * "chrome"-blur (expo-blur).
 */
export const GLASS_TAB_BAR = Platform.OS === 'ios';

/** iOS 26+: systemet lægger selv en glasboble om knapperne i headeren. */
export const LIQUID_GLASS = GLASS_TAB_BAR && isLiquidGlassAvailable();

/** Pillens mål. Højden giver plads til ikon-pillen (30) og teksten (12). */
export const PILL_HEIGHT = 64;
const PILL_RADIUS = PILL_HEIGHT / 2;
const PILL_SIDE_MARGIN = 16;

/** Afstand fra skærmens bund til pillen: lige over hjemme-stregen. */
function pillBottom(insets: EdgeInsets): number {
  return Math.max(insets.bottom - 12, 12);
}

/** tabBarStyle for pillen; lægges oven på navigatorens standard-stil. */
export function glassPillTabBarStyle(insets: EdgeInsets) {
  return {
    position: 'absolute' as const,
    left: PILL_SIDE_MARGIN,
    right: PILL_SIDE_MARGIN,
    bottom: pillBottom(insets),
    height: PILL_HEIGHT,
    // Navigatoren lægger ellers hjemme-stregens højde ind i bunden af bjælken.
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 4,
    borderRadius: PILL_RADIUS,
    borderTopWidth: 0,
    backgroundColor: 'transparent',
    elevation: 0,
  };
}

export function GlassTabBarBackground() {
  const { colors, isDark } = useTheme();
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: PILL_RADIUS,
          overflow: 'hidden',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
        },
      ]}
      pointerEvents="none"
    >
      {LIQUID_GLASS ? (
        <GlassView
          style={StyleSheet.absoluteFill}
          glassEffectStyle="regular"
          // Appen har sit eget lys/mørk-valg; følg det, ikke systemets.
          colorScheme={isDark ? 'dark' : 'light'}
        />
      ) : (
        <BlurView
          style={StyleSheet.absoluteFill}
          intensity={100}
          tint={isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        />
      )}
    </View>
  );
}

/**
 * Hvor meget af skærmen fanebjælken dækker i bunden: pillen plus luften
 * under den på iOS (den svæver), 0 på Android og uden for fanerne (fx
 * stak-skærme). Lister på fane-skærmene lægger den til deres bund-padding, så
 * sidste række kan scrolles fri af pillen.
 */
export function useTabBarOverlap(): number {
  const height = useContext(BottomTabBarHeightContext);
  const insets = useSafeAreaInsets();
  return GLASS_TAB_BAR && height ? height + pillBottom(insets) : 0;
}
