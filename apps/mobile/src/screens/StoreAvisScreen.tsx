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

/** Logo-flisens størrelse i baggrunden (static/images/avis/<butik>.png er 460x300). */
const TILE_W = 230;
const TILE_H = 150;

/**
 * Tilbudsavis for én butik (Feature-panelet 'butiksaviser'), samme skabelon
 * som hjemmesidens /tilbud/<butik> (templates/butiksavis.html): ét stykke
 * "avispapir" med butikkens logo svagt gentaget i baggrunden, overskrift,
 * uge, bånd over hvert afsnit og varefelter med rødt SPAR-mærke og gult
 * prisskilt. Ens for alle butikker; kun logoet skifter. Bygget af de priser
 * vi selv henter fra butikken; butikkens egen avis åbnes kun som link.
 */
export function StoreAvisScreen({ route, navigation }: Props) {
  const { storeKey, label, avisUrl } = route.params;
  const { colors, isDark } = useTheme();
  const [paper, setPaper] = useState({ w: 0, h: 0 });
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
          <ProductCard product={p} onPress={openProduct} variant="avis" />
        </View>
      ))}
    </View>
  );

  const head = (title: string, count: number, kategori?: string) => (
    <View style={styles.sectionHead}>
      <View style={[styles.ribbon, { backgroundColor: colors.text }]}>
        <Text style={[styles.ribbonText, { color: colors.surface }]} accessibilityRole="header">
          {title.toUpperCase()}
        </Text>
      </View>
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
        <View
          style={[styles.paper, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onLayout={(e) => setPaper({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        >
          {avis.watermark && paper.h ? (
            <View style={styles.watermark} pointerEvents="none" importantForAccessibility="no-hide-descendants">
              {Array.from({ length: Math.ceil(paper.h / TILE_H) }, (_, r) => (
                <View key={r} style={styles.watermarkRow}>
                  {Array.from({ length: Math.ceil(paper.w / TILE_W) }, (_, c) => (
                    <Image
                      key={c}
                      source={{ uri: logoUrl(avis.watermark!) }}
                      style={[styles.tile, isDark && { tintColor: '#FFFFFF', opacity: 0.08 }]}
                      accessible={false}
                    />
                  ))}
                </View>
              ))}
            </View>
          ) : null}

          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header" accessibilityLabel={`Tilbudsavis fra ${avis.label}`}>
            TILBUDSAVIS
          </Text>
          <View style={[styles.headMeta, { borderBottomColor: colors.text }]}>
            <View style={[styles.week, { backgroundColor: colors.text }]}>
              <Text style={[styles.weekText, { color: colors.surface }]}>Uge {avis.week}</Text>
            </View>
            <Text style={{ color: colors.text, fontWeight: '600' }}>{avis.total} tilbud</Text>
            <Pressable
              onPress={() => void Linking.openURL(avis.avis_url)}
              accessibilityRole="link"
              accessibilityHint="Åbner butikkens hjemmeside"
              hitSlop={8}
            >
              <Text style={{ color: colors.primary, fontWeight: '700', textDecorationLine: 'underline' }}>
                Se {avis.label}s egen avis
              </Text>
            </Pressable>
          </View>

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
                onPress={() => scrollRef.current?.scrollTo({ y: (sectionY.current[s.slug] ?? 0) + 12, animated: true })}
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
        </View>
      </ScrollView>
    </StackScreenBody>
  );
}

const styles = StyleSheet.create({
  center: { padding: 24, alignItems: 'center', gap: 10 },
  retry: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  paper: {
    margin: 12,
    paddingTop: 16,
    paddingBottom: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  watermark: { ...StyleSheet.absoluteFillObject },
  watermarkRow: { flexDirection: 'row' },
  tile: { width: TILE_W, height: TILE_H, opacity: 0.12 },
  title: { fontSize: 32, fontWeight: '900', letterSpacing: -0.5, paddingHorizontal: 14 },
  headMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 14,
    marginTop: 4,
    paddingBottom: 12,
    borderBottomWidth: 3,
  },
  week: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  weekText: { fontWeight: '800' },
  chips: { paddingHorizontal: 12, paddingVertical: 12, gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1 },
  empty: { padding: 24, textAlign: 'center' },
  section: { marginTop: 12 },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  // Mørkt, skråt bånd over hvert afsnit, som .avis-ribbon på web.
  ribbon: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: -4,
    transform: [{ skewX: '-10deg' }],
    flexShrink: 1,
  },
  ribbonText: { fontSize: 15, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 6 },
  gridItem: { width: '50%' },
});
