import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { fetchStoreAvis } from '../api/listing';
import type { Product, StoreAvisResponse } from '../api/types';
import { ProductCard } from '../components/ProductCard';
import { StackScreenBody } from '../components/ScreenBody';
import { useStoreCatalog } from '../stores/StoreCatalogContext';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'StoreOffers'>;

/** Antal varer pr. afsnit i appen (to rækker á to); resten ligger bag "Se alle". */
const SECTION_ITEMS = 4;
const BEST_ITEMS = 6;

/**
 * Tilbudsavis for én butik (Feature-panelet 'butiksaviser'), samme som
 * hjemmesidens /tilbud/<butik> (templates/butiksavis.html): bånd i butikkens
 * farver, "Ugens bedste tilbud" og et afsnit pr. kategori med de største
 * besparelser først. Bygget af de priser vi selv henter fra butikken;
 * butikkens egen avis åbnes kun som link.
 */
export function StoreAvisScreen({ route, navigation }: Props) {
  const { storeKey, label, avisUrl } = route.params;
  const { colors } = useTheme();
  const { logoUrl } = useStoreCatalog();
  const [avis, setAvis] = useState<StoreAvisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = React.useRef<ScrollView>(null);
  const sectionY = React.useRef<Record<string, number>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchStoreAvis(storeKey);
      if (!data.success) throw new Error(data.error || 'Kunne ikke hente avisen.');
      setAvis(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente avisen.');
    }
  }, [storeKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const openList = (title: string, kategori?: string) =>
    navigation.navigate('StoreOffersList', { storeKey, label, avisUrl, title, kategori });
  const openProduct = (p: Product) => navigation.navigate('ProductDetail', { product: p });

  if (error) {
    return (
      <StackScreenBody style={{ backgroundColor: colors.bg }}>
        <View style={styles.center}>
          <Text style={{ color: colors.text, fontWeight: '600', textAlign: 'center' }} accessibilityRole="alert">
            {error}
          </Text>
          <Pressable onPress={() => void load()} accessibilityRole="button" style={[styles.retry, { borderColor: colors.border }]}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>Prøv igen</Text>
          </Pressable>
        </View>
      </StackScreenBody>
    );
  }
  if (!avis) {
    return (
      <StackScreenBody style={{ backgroundColor: colors.bg }}>
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} accessibilityLabel="Henter avisen" />
      </StackScreenBody>
    );
  }

  const grid = (products: Product[]) => (
    <View style={styles.grid}>
      {products.map((p) => (
        <View key={p.id} style={styles.gridItem}>
          <ProductCard product={p} onPress={openProduct} />
        </View>
      ))}
    </View>
  );

  const head = (title: string, count: number, kategori?: string) => (
    <View style={styles.sectionHead}>
      <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
        {title}
      </Text>
      <Pressable
        onPress={() => openList(kategori ? `${label}: ${title}` : `Tilbud hos ${label}`, kategori)}
        accessibilityRole="button"
        accessibilityLabel={`Se alle ${count} tilbud i ${title}`}
        hitSlop={10}
      >
        <Text style={{ color: colors.primary, fontWeight: '700' }}>Se alle {count}</Text>
      </Pressable>
    </View>
  );

  return (
    <StackScreenBody style={{ backgroundColor: colors.bg }}>
      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={[styles.banner, { backgroundColor: avis.color }]}>
          <Image source={{ uri: logoUrl(avis.logo) }} style={styles.bannerLogo} resizeMode="contain" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.kicker, { color: avis.text_color }]}>TILBUDSAVIS · UGE {avis.week}</Text>
            <Text style={[styles.bannerTitle, { color: avis.text_color }]} accessibilityRole="header">
              {avis.label}
            </Text>
            <Text style={{ color: avis.text_color, opacity: 0.9 }}>
              {avis.total} tilbud denne uge, hentet direkte fra butikken
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => void Linking.openURL(avis.avis_url)}
          accessibilityRole="link"
          accessibilityHint="Åbner butikkens hjemmeside"
          style={styles.avisLink}
          hitSlop={8}
        >
          <Text style={{ color: colors.primary, fontWeight: '700' }}>Se {avis.label}s egen avis</Text>
        </Pressable>

        {avis.sections.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            accessibilityLabel="Afsnit i avisen"
          >
            {avis.sections.map((s) => (
              <Pressable
                key={s.slug}
                accessibilityRole="button"
                onPress={() => scrollRef.current?.scrollTo({ y: sectionY.current[s.slug] ?? 0, animated: true })}
                style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>{s.title}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <Text style={[styles.empty, { color: colors.textMuted }]}>
            {avis.label} har ingen tilbud lige nu. Kig forbi igen, når den nye avis er ude.
          </Text>
        )}

        {avis.best.length ? (
          <View style={styles.section}>
            {head('Ugens bedste tilbud', avis.total)}
            {grid(avis.best.slice(0, BEST_ITEMS))}
          </View>
        ) : null}

        {avis.sections.map((s) => (
          <View
            key={s.slug}
            style={styles.section}
            onLayout={(e) => {
              sectionY.current[s.slug] = e.nativeEvent.layout.y;
            }}
          >
            {head(s.title, s.count, s.slug)}
            {grid(s.products.slice(0, SECTION_ITEMS))}
          </View>
        ))}
      </ScrollView>
    </StackScreenBody>
  );
}

const styles = StyleSheet.create({
  center: { padding: 24, alignItems: 'center', gap: 10 },
  retry: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    margin: 12,
    marginBottom: 6,
    padding: 16,
    borderRadius: 16,
  },
  bannerLogo: { width: 60, height: 60, borderRadius: 12, backgroundColor: '#fff' },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1, opacity: 0.85 },
  bannerTitle: { fontSize: 28, fontWeight: '900' },
  avisLink: { paddingHorizontal: 16, paddingVertical: 6 },
  chips: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1 },
  empty: { padding: 24, textAlign: 'center' },
  section: { marginTop: 12 },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 4 },
  gridItem: { width: '50%', paddingHorizontal: 2 },
});
