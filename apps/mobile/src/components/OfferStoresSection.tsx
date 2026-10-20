import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../theme/Typography';
import type { OfferStore } from '../api/types';
import { useStoreCatalog } from '../stores/StoreCatalogContext';
import { storeLogo, StoreLogo } from '../stores/storeLogos';
import { useTheme } from '../theme/ThemeContext';

/**
 * Ugedagen hver butiks nye avis starter (JS getDay: 0 = søndag). Målt i Tjeks
 * katalog-API (run_from) 19-10-2026 og i nightly-dispatcher.yml's butiksdage;
 * ændrer en butik dag, ret den her.
 */
const AVIS_START_DAY: Record<string, number> = {
  netto: 6,
  foetex: 5,
  bilka: 5,
  rema: 0,
  lidl: 0,
  meny: 5,
  spar: 5,
  mk: 5,
  loevbjerg: 5,
  abclavpris: 2,
};

const WEEKDAYS = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];

/** "Ny i dag" eller ugedagen avisen starter; null når dagen ikke kendes. */
export function avisStart(storeKey: string, today: Date = new Date()): { isNew: boolean; label: string } | null {
  const day = AVIS_START_DAY[storeKey];
  if (day == null) return null;
  return day === today.getDay() ? { isNew: true, label: 'Ny i dag' } : { isNew: false, label: WEEKDAYS[day] };
}

/**
 * "Aviser denne uge" på forsiden (C2, Feature-panelet 'butiksaviser'): en
 * vandret række af runde butikslogoer med grøn ring, når avisen starter i dag.
 * Tryk åbner butikkens avis (StoreAvisScreen). Webben har stadig logo-kortene
 * (templates/index.html), se docs/paritet.md.
 */
export function OfferStoresSection({
  stores,
  onOpen,
  onAll,
}: {
  stores: OfferStore[];
  onOpen: (store: OfferStore) => void;
  onAll: () => void;
}) {
  const { colors } = useTheme();
  const { catalog, selectedLabels, logoUrl } = useStoreCatalog();
  // Uden katalog (fx offline) vises alle frem for ingen, som webbens
  // isStoreSelected.
  const shown = stores.filter((s) => !catalog.length || selectedLabels.has(s.label));
  if (!shown.length) return null;
  // Aviser der starter i dag først, ellers serverens rækkefølge.
  const today = new Date();
  const withStart = shown
    .map((s, i) => ({ s, i, start: avisStart(s.key, today) }))
    .sort((a, b) => Number(!!b.start?.isNew) - Number(!!a.start?.isNew) || a.i - b.i);

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Aviser denne uge
        </Text>
        <Pressable
          onPress={onAll}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Se alle ugens tilbud"
        >
          <Text style={[styles.link, { color: colors.primaryDark }]}>Alle {shown.length}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {withStart.map(({ s, start }) => (
          <Pressable
            key={s.key}
            accessibilityRole="button"
            accessibilityLabel={[
              `Se ugens tilbud hos ${s.label}`,
              start ? (start.isNew ? 'ny avis i dag' : `avisen starter ${start.label.toLowerCase()}`) : '',
              s.count ? `${s.count} tilbud` : '',
            ]
              .filter(Boolean)
              .join(', ')}
            onPress={() => onOpen(s)}
            style={({ pressed }) => [styles.item, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View
              style={[
                styles.ring,
                { borderColor: start?.isNew ? colors.primary : colors.border },
              ]}
            >
              <View style={[styles.inner, { backgroundColor: colors.logoBg, borderColor: colors.border }]}>
                {storeLogo(s.label) ? (
                  <StoreLogo store={s.label} maxHeight={30} minHeight={11} maxWidth={40} />
                ) : (
                  <Image source={{ uri: logoUrl(s.logo) }} style={styles.remoteLogo} resizeMode="contain" />
                )}
              </View>
            </View>
            {start ? (
              <Text
                style={[
                  styles.when,
                  start.isNew
                    ? { color: colors.primaryDark, fontWeight: '700' }
                    : { color: colors.textMuted, fontWeight: '500' },
                ]}
                numberOfLines={1}
              >
                {start.label}
              </Text>
            ) : (
              <Text style={[styles.when, { color: colors.textMuted, fontWeight: '500' }]} numberOfLines={1}>
                {s.label}
              </Text>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 20 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  title: { fontSize: 17, fontWeight: '800' },
  link: { fontSize: 13, fontWeight: '600' },
  row: { paddingHorizontal: 16, gap: 12 },
  item: { width: 60, alignItems: 'center', gap: 6 },
  ring: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2.5,
    padding: 3,
  },
  inner: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  remoteLogo: { width: 36, height: 36 },
  when: { fontSize: 11 },
});
