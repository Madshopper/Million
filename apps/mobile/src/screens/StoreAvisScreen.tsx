import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
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

/** Logo-flisens størrelse i baggrunden (static/images/avis/<butik>.png er 460x300). */
const TILE_W = 230;
const TILE_H = 150;

/** Varer pr. side og på forsiden; samme som app.py::_AVIS_PAGE_ITEMS/_AVIS_FRONT_ITEMS. */
const PAGE_ITEMS = 6;
const FRONT_ITEMS = 4;

type AvisSection = StoreAvisResponse['sections'][number];
type AvisPage = {
  front: boolean;
  title: string;
  slug: string;
  products: Product[];
  more: AvisSection | null;
};

/** Deler avisen op i sider på samme måde som app.py::_avis_pages. */
export function avisPages(avis: StoreAvisResponse): AvisPage[] {
  const pages: AvisPage[] = [];
  if (avis.best.length) {
    pages.push({ front: true, title: 'Ugens bedste tilbud', slug: '', products: avis.best.slice(0, FRONT_ITEMS), more: null });
    const rest = avis.best.slice(FRONT_ITEMS);
    for (let i = 0; i < rest.length; i += PAGE_ITEMS) {
      pages.push({ front: false, title: 'Ugens bedste tilbud', slug: '', products: rest.slice(i, i + PAGE_ITEMS), more: null });
    }
  }
  for (const sec of avis.sections) {
    for (let i = 0; i < sec.products.length; i += PAGE_ITEMS) {
      pages.push({
        front: false,
        title: sec.title,
        slug: i === 0 ? sec.slug : '',
        products: sec.products.slice(i, i + PAGE_ITEMS),
        more: i + PAGE_ITEMS >= sec.products.length ? sec : null,
      });
    }
  }
  return pages;
}

/** Butikkens logo svagt gentaget hen over hele siden. */
function Watermark({ uri, isDark }: { uri: string; isDark: boolean }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {size.h
        ? Array.from({ length: Math.ceil(size.h / TILE_H) }, (_, r) => (
            <View key={r} style={styles.watermarkRow}>
              {Array.from({ length: Math.ceil(size.w / TILE_W) }, (_, c) => (
                <Image
                  key={c}
                  source={{ uri }}
                  style={[styles.tile, isDark && { tintColor: '#FFFFFF', opacity: 0.08 }]}
                  accessible={false}
                />
              ))}
            </View>
          ))
        : null}
    </View>
  );
}

/**
 * Tilbudsavis for én butik (Feature-panelet 'butiksaviser'), samme skabelon
 * som hjemmesidens /tilbud/<butik> (templates/butiksavis.html): en rigtig
 * avis med sider (Kalle 10-10-2026), som man bladrer i ved at swipe eller med
 * pilene i siderne. Forsiden har de fire bedste tilbud; derefter seks varer
 * pr. side, afsnit for afsnit. Butikkens logo står svagt i baggrunden; ellers
 * ens for alle butikker. Bygget af de priser vi selv henter fra butikken;
 * butikkens egen avis åbnes kun som link.
 */
export function StoreAvisScreen({ route, navigation }: Props) {
  const { storeKey, label, avisUrl } = route.params;
  const { colors, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const { logoUrl } = useStoreCatalog();
  const [avis, setAvis] = useState<StoreAvisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const listRef = useRef<FlatList<AvisPage>>(null);

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

  const pages = useMemo(() => (avis ? avisPages(avis) : []), [avis]);

  const goTo = useCallback(
    (i: number) => {
      const target = Math.max(0, Math.min(pages.length - 1, i));
      listRef.current?.scrollToIndex({ index: target, animated: true });
      setPage(target);
      AccessibilityInfo.announceForAccessibility(`Side ${target + 1} af ${pages.length}`);
    },
    [pages.length],
  );

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

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

  const watermark = avis.watermark ? logoUrl(avis.watermark) : null;

  const renderPage = ({ item, index }: { item: AvisPage; index: number }) => (
    <ScrollView style={{ width }} contentContainerStyle={styles.pageScroll}>
      <View
        style={[styles.paper, { backgroundColor: colors.surface, borderColor: colors.border }]}
        accessibilityLabel={`Side ${index + 1} af ${pages.length}: ${item.title}`}
      >
        {watermark ? <Watermark uri={watermark} isDark={isDark} /> : null}
        {item.front ? (
          <View style={[styles.frontHead, { borderBottomColor: colors.text }]}>
            <Text style={[styles.frontTitle, { color: colors.text }]} accessibilityRole="header">
              TILBUDSAVIS
            </Text>
            <View style={styles.frontMeta}>
              <View style={[styles.week, { backgroundColor: colors.text }]}>
                <Text style={[styles.weekText, { color: colors.surface }]}>Uge {avis.week}</Text>
              </View>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{avis.total} tilbud</Text>
            </View>
          </View>
        ) : null}
        <View style={[styles.ribbon, { backgroundColor: colors.text }]}>
          <Text style={[styles.ribbonText, { color: colors.surface }]} accessibilityRole="header">
            {item.title.toUpperCase()}
          </Text>
        </View>
        <View style={styles.grid}>
          {item.products.map((p) => (
            <View key={p.id} style={styles.gridItem}>
              <ProductCard product={p} onPress={openProduct} variant="avis" />
            </View>
          ))}
        </View>
        <View style={styles.foot}>
          {item.more ? (
            <Pressable
              onPress={() => openList(`${label}: ${item.more!.title}`, item.more!.slug)}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={{ color: colors.primary, fontWeight: '700' }}>
                Se alle {item.more.count} i {item.more.title}
              </Text>
            </Pressable>
          ) : item.front ? (
            <Pressable onPress={() => openList(`Tilbud hos ${label}`)} accessibilityRole="button" hitSlop={8}>
              <Text style={{ color: colors.primary, fontWeight: '700' }}>Se alle {avis.total} tilbud</Text>
            </Pressable>
          ) : (
            <View />
          )}
          <Text style={{ color: colors.textMuted, fontWeight: '700' }}>Side {index + 1}</Text>
        </View>
      </View>
    </ScrollView>
  );

  return (
    <StackScreenBody style={{ backgroundColor: colors.bg }}>
      <View style={styles.bar}>
        <Text style={[styles.barTitle, { color: colors.text }]} numberOfLines={1}>
          Side {page + 1} af {pages.length || 1}
        </Text>
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

      {pages.length ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            style={styles.chipsWrap}
            accessibilityLabel="Afsnit i avisen"
          >
            {avis.sections.map((s) => (
              <Pressable
                key={s.slug}
                accessibilityRole="button"
                onPress={() => goTo(pages.findIndex((pg) => pg.slug === s.slug))}
                style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>{s.title}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={{ flex: 1 }}>
            <FlatList
              ref={listRef}
              data={pages}
              keyExtractor={(_, i) => String(i)}
              renderItem={renderPage}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onScrollEnd}
              getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
              initialNumToRender={2}
              windowSize={3}
            />
            {page > 0 ? (
              <Pressable
                onPress={() => goTo(page - 1)}
                accessibilityRole="button"
                accessibilityLabel="Forrige side"
                style={[styles.nav, styles.navPrev, { backgroundColor: colors.text }]}
              >
                <Text style={[styles.navText, { color: colors.surface }]}>‹</Text>
              </Pressable>
            ) : null}
            {page < pages.length - 1 ? (
              <Pressable
                onPress={() => goTo(page + 1)}
                accessibilityRole="button"
                accessibilityLabel="Næste side"
                style={[styles.nav, styles.navNext, { backgroundColor: colors.text }]}
              >
                <Text style={[styles.navText, { color: colors.surface }]}>›</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : (
        <Text style={[styles.empty, { color: colors.textMuted }]}>
          {avis.label} har ingen tilbud lige nu. Kig forbi igen, når den nye avis er ude.
        </Text>
      )}
    </StackScreenBody>
  );
}

const styles = StyleSheet.create({
  center: { padding: 24, alignItems: 'center', gap: 10 },
  retry: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  barTitle: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
  chipsWrap: { flexGrow: 0 },
  chips: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1 },
  empty: { padding: 24, textAlign: 'center' },
  pageScroll: { padding: 10, paddingBottom: 28 },
  paper: {
    paddingTop: 14,
    paddingBottom: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  watermarkRow: { flexDirection: 'row' },
  tile: { width: TILE_W, height: TILE_H, opacity: 0.12 },
  frontHead: { marginHorizontal: 12, marginBottom: 12, paddingBottom: 10, borderBottomWidth: 3 },
  frontTitle: { fontSize: 32, fontWeight: '900', letterSpacing: -0.5 },
  frontMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  week: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  weekText: { fontWeight: '800' },
  // Mørkt, skråt bånd over siden, som .avis-ribbon på web.
  ribbon: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 8,
    marginBottom: 8,
    transform: [{ skewX: '-10deg' }],
  },
  ribbonText: { fontSize: 15, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 6 },
  gridItem: { width: '50%' },
  foot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  nav: {
    position: 'absolute',
    top: '45%',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.9,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  navPrev: { left: 4 },
  navNext: { right: 4 },
  navText: { fontSize: 30, fontWeight: '700', marginTop: -4 },
});
