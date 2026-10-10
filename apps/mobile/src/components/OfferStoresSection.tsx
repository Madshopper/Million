import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { OfferStore } from '../api/types';
import { useStoreCatalog } from '../stores/StoreCatalogContext';
import { useTheme } from '../theme/ThemeContext';

/**
 * "Tilbudsaviser" på forsiden (Feature-panelet 'butiksaviser'): logoerne for
 * de valgte butikker. Tryk åbner butikkens tilbud (StoreOffersScreen). Samme
 * som hjemmesiden (templates/index.html + /tilbud/<butik>).
 */
export function OfferStoresSection({
  stores,
  onOpen,
}: {
  stores: OfferStore[];
  onOpen: (store: OfferStore) => void;
}) {
  const { colors } = useTheme();
  const { catalog, selectedLabels, logoUrl } = useStoreCatalog();
  // Uden katalog (fx offline) vises alle frem for ingen, som webbens
  // isStoreSelected.
  const shown = stores.filter((s) => !catalog.length || selectedLabels.has(s.label));
  if (!shown.length) return null;

  return (
    <View style={styles.section}>
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
        Tilbudsaviser
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {shown.map((s) => (
          <Pressable
            key={s.key}
            accessibilityRole="button"
            accessibilityLabel={`Se ugens tilbud hos ${s.label}`}
            onPress={() => onOpen(s)}
            style={({ pressed }) => [
              styles.logoBtn,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Image source={{ uri: logoUrl(s.logo) }} style={styles.logo} resizeMode="contain" />
            <Text style={[styles.logoText, { color: colors.text }]} numberOfLines={2}>
              {s.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 12 },
  title: { fontSize: 18, fontWeight: '700', paddingHorizontal: 16, marginBottom: 8 },
  row: { paddingHorizontal: 12, gap: 8 },
  logoBtn: {
    width: 88,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderRadius: 12,
  },
  logo: { width: 52, height: 52, borderRadius: 10, backgroundColor: '#fff' },
  logoText: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
});
