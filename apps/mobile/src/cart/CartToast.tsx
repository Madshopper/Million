/**
 * "Lagt i kurven" (Feature-panelet 'kurv_besked' i /admin, Kalle 21-10-2026).
 *
 * En lille, svag grøn besked lige over fanerne, hver gang en vare lægges i
 * kurven. Står ~1,8 s, kan ikke trykkes på og følger lys/mørk tilstand. Samme
 * som webbens showCartToast() i static/js/script.js.
 *
 * Vises kun, når /api/home siger kurv_besked_enabled, så hjemmesiden og appen
 * følges ad. På dev.madshopper.dk (MadShopper Test) er den altid til.
 *
 * Skærmlæseren hører ikke beskeden: stederne der lægger i kurven, siger
 * allerede selv "<vare> lagt i kurven" (fx ProductCard), og det er mere præcist.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, cardShadow } from '../theme/Typography';
import { useTheme } from '../theme/ThemeContext';

const SHOW_MS = 1800;

let enabled = false;
const flagListeners = new Set<() => void>();

/** Kaldes af HomeScreen med /api/home's kurv_besked_enabled. */
export function setServerCartToastEnabled(on: boolean | undefined) {
  const next = !!on;
  if (next === enabled) return;
  enabled = next;
  flagListeners.forEach((l) => l());
}

function subscribeFlag(listener: () => void) {
  flagListeners.add(listener);
  return () => {
    flagListeners.delete(listener);
  };
}

// Flere varer lagt i på én gang (fx "Læg alle i kurv" på en opskrift) bliver
// til én besked med antallet i stedet for mange efter hinanden.
let pending = 0;
let flushQueued = false;
let showListener: ((count: number) => void) | null = null;

/** Kaldes hver gang en vare lægges i kurven. */
export function showCartToast() {
  if (!enabled) return;
  pending += 1;
  if (flushQueued) return;
  flushQueued = true;
  setTimeout(() => {
    const n = pending;
    pending = 0;
    flushQueued = false;
    showListener?.(n);
  }, 0);
}

/** Lægges én gang over hele appen (App.tsx). */
export function CartToast() {
  const on = useSyncExternalStore(subscribeFlag, () => enabled);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [count, setCount] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotion = useRef(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      reduceMotion.current = v;
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      reduceMotion.current = v;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    showListener = (n) => {
      setCount(n);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      hideTimer.current = setTimeout(() => {
        Animated.timing(anim, { toValue: 0, duration: 220, useNativeDriver: true }).start(
          ({ finished }) => {
            if (finished) setCount(0);
          },
        );
      }, SHOW_MS);
    };
    return () => {
      showListener = null;
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [anim]);

  if (!on || count === 0) return null;

  const translateY = reduceMotion.current
    ? 0
    : anim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      // Lige over fanerne (RootNavigator: 62 + insets.bottom).
      style={[styles.wrap, { bottom: 62 + insets.bottom + 12 }]}
    >
      <Animated.View
        style={[
          styles.pill,
          { backgroundColor: colors.primaryMuted, opacity: anim, transform: [{ translateY }] },
          cardShadow(colors.shadow),
        ]}
      >
        <Ionicons name="checkmark" size={16} color={colors.primaryDark} />
        <Text style={[styles.label, { color: colors.primaryDark }]}>
          {count > 1 ? `${count} varer lagt i kurven` : 'Lagt i kurven'}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
});
