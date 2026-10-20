import React, { useContext } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useTheme } from '../theme/ThemeContext';

/**
 * Glas-fanebjælke, kun iOS (Thomas 20-10-2026). Android er uændret.
 *
 * På iOS svæver fanebjælken over indholdet (position absolute), så listerne
 * kan ses sløret bag den. iOS 26+ får Apples Liquid Glass (expo-glass-effect),
 * ældre iOS den klassiske "chrome"-blur (expo-blur).
 */
export const GLASS_TAB_BAR = Platform.OS === 'ios';

/** iOS 26+: systemet lægger selv en glasboble om knapperne i headeren. */
export const LIQUID_GLASS = GLASS_TAB_BAR && isLiquidGlassAvailable();

export function GlassTabBarBackground() {
  const { colors, isDark } = useTheme();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
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
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: StyleSheet.hairlineWidth,
          backgroundColor: colors.border,
        }}
      />
    </View>
  );
}

/**
 * Hvor meget af skærmen fanebjælken dækker i bunden: hele dens højde på iOS
 * (den svæver), 0 på Android og uden for fanerne (fx stak-skærme). Lister på
 * fane-skærmene lægger den til deres bund-padding, så sidste række kan
 * scrolles fri af bjælken.
 */
export function useTabBarOverlap(): number {
  const height = useContext(BottomTabBarHeightContext);
  return GLASS_TAB_BAR && height ? height : 0;
}
