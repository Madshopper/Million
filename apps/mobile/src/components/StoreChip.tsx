import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { storeColor } from '../theme/storeColors';

/** Lille mærkat i butikkens egen farve (theme/storeColors.ts). */
export function StoreChip({ store, size = 'sm' }: { store: string; size?: 'sm' | 'md' }) {
  return (
    <View
      style={[
        styles.chip,
        size === 'md' && styles.chipMd,
        { backgroundColor: storeColor(store) },
      ]}
    >
      <Text style={[styles.text, size === 'md' && styles.textMd]} numberOfLines={1}>
        {store}
      </Text>
    </View>
  );
}

/** Farvet prik til steder hvor et helt mærkat fylder for meget. */
export function StoreDot({ store, size = 8 }: { store: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: storeColor(store),
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
