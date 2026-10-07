import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useStoreCatalog } from '../stores/StoreCatalogContext';
import { useTheme } from '../theme/ThemeContext';
import { fetchCatalogs, type FlyerCatalog } from '../flyers/flyers';
import { FlyerViewer } from './FlyerViewer';

/**
 * "Tilbudsaviser" på forsiden (Feature-panelet 'flyers'): logoerne for de
 * valgte butikker, der har en avis lige nu. Tryk åbner avisen i FlyerViewer
 * oven på forsiden. Samme som hjemmesiden (templates/index.html + flyers.js).
 */
export function FlyersSection() {
  const { colors } = useTheme();
  const { catalog, selectedLabels, logoUrl } = useStoreCatalog();
  const [byDealer, setByDealer] = React.useState<Record<string, FlyerCatalog[]> | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [open, setOpen] = React.useState<{ label: string; catalogs: FlyerCatalog[] } | null>(null);

  const dealerIds = React.useMemo(
    () => catalog.map((s) => s.tjek).filter((id): id is string => !!id),
    [catalog],
  );
  const dealerKey = dealerIds.join(',');

  React.useEffect(() => {
    if (!dealerKey) return;
    let cancelled = false;
    setFailed(false);
    fetchCatalogs(dealerKey.split(','))
      .then((data) => {
        if (!cancelled) setByDealer(data);
      })
      .catch(() => {
        // Tjek svarer ikke: vis hellere ingen sektion end logoer, der ikke
        // kan åbnes.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [dealerKey]);

  if (failed || !byDealer) return null;
  const stores = catalog.filter(
    (s) => s.tjek && byDealer[s.tjek]?.length && selectedLabels.has(s.label),
  );
  if (!stores.length) return null;

  return (
    <View style={styles.section}>
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
        Tilbudsaviser
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {stores.map((s) => (
          <Pressable
            key={s.key}
            accessibilityRole="button"
            accessibilityLabel={`Se tilbudsavisen fra ${s.label}`}
            onPress={() => setOpen({ label: s.label, catalogs: byDealer[s.tjek!] })}
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
      <FlyerViewer
        visible={!!open}
        storeLabel={open?.label ?? ''}
        catalogs={open?.catalogs ?? []}
        onClose={() => setOpen(null)}
      />
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
    borderRadius: 12,
    borderWidth: 1,
  },
  logo: { width: 52, height: 52, borderRadius: 10, backgroundColor: '#FFFFFF' },
  logoText: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
});
