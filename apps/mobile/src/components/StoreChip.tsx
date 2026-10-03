import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

/**
 * Lille butiksmærkat. Alle butikker har samme grønne (primarySolid), så appen
 * holder sig til tre farver: grøn, mørk tekst og gul til tilbud.
 */
export function StoreChip({ store, size = 'sm' }: { store: string; size?: 'sm' | 'md' }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.chip,
        size === 'md' && styles.chipMd,
        { backgroundColor: colors.primarySolid },
      ]}
    >
      <Text style={[styles.text, size === 'md' && styles.textMd]} numberOfLines={1}>
        {store}
      </Text>
    </View>
  );
}

/** Grøn prik til steder hvor et helt mærkat fylder for meget. */
export function StoreDot({ size = 8 }: { store?: string; size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.primary,
      }}
    />
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  chipMd: { paddingHorizontal: 9, paddingVertical: 3 },
  text: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },
  textMd: { fontSize: 12 },
});
