import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text } from '../theme/Typography';
import { useTheme } from '../theme/ThemeContext';
import { lookupPostcode, useLokationEnabled } from '../location/nearby';
import { loadStoreLocations, savedPostcode } from '../location/storage';
import type { RootStackParamList } from '../navigation/types';

/**
 * Forsidens top til venstre: kun "MadShopper". Det grønne kurv-ikon er
 * fjernet (Kalle 21-10-2026), så kurv-knappen til højre er den eneste kurv.
 */
export function HomeHeaderTitle() {
  const { colors } = useTheme();
  return (
    <View style={styles.titleRow} accessible accessibilityRole="header" accessibilityLabel="MadShopper">
      <Text style={[styles.title, { color: colors.text }]}>MadShopper</Text>
    </View>
  );
}

/**
 * Hvid pille med en grøn nål og brugerens postnummer og by (location/
 * storage.ts). Uden postnummer: "Vælg butikker". Med "Butikker nær mig"
 * udgivet åbner den postnummer-vælgeren (Nearby); ellers butiksvalget i
 * Indstillinger.
 */
export function LocationPill() {
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const lokation = useLokationEnabled();
  const [label, setLabel] = React.useState('');

  useFocusEffect(
    React.useCallback(() => {
      let alive = true;
      void (async () => {
        const pc = await savedPostcode();
        if (!pc) {
          if (alive) setLabel('');
          return;
        }
        if (alive) setLabel(pc);
        try {
          const pos = lookupPostcode(await loadStoreLocations(), pc);
          if (alive && pos) setLabel(pos.label);
        } catch {
          // Kun postnummeret, når butikslisten ikke kan hentes.
        }
      })();
      return () => {
        alive = false;
      };
    }, []),
  );

  const text = label || 'Vælg butikker';
  return (
    <Pressable
      onPress={() => (lokation ? navigation.navigate('Nearby') : navigation.navigate('Settings'))}
      accessibilityRole="button"
      accessibilityLabel={label ? `Din placering: ${label}` : 'Vælg butikker'}
      accessibilityHint={lokation ? 'Åbner butikker nær dig' : 'Åbner indstillinger'}
      hitSlop={4}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name="location" size={16} color={colors.primary} />
      <Text style={[styles.pillText, { color: colors.text }]} numberOfLines={1}>
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  title: { fontSize: 21, fontWeight: '800', letterSpacing: -0.3 },
  pill: {
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 150,
  },
  pillText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
});
