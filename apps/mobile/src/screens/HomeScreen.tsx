import React from 'react';
import { setServerLokationEnabled } from '../location/nearby';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text } from '../theme/Typography';
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useHeaderHeight } from '@react-navigation/elements';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { fetchHome } from '../api/listing';
import type { HomeSection, OfferStore, Product } from '../api/types';
import type { Recipe } from '../api/recipes';
import { useAuth } from '../auth/AuthContext';
import { CategoriesDrawer } from '../components/CategoriesDrawer';
import { OfferStoresSection } from '../components/OfferStoresSection';
import { applyClientFilters, FiltersBar, type FiltersValue } from '../components/FiltersBar';
import { ProductCard } from '../components/ProductCard';
import { RecipeCard } from '../components/RecipeCard';
import {
  emptySavings,
  fetchPersonalSavings,
  formatKr,
  monthLabel,
  type PersonalSavings,
} from '../savings/personalSavings';
import { useStoreCatalog, storesParam } from '../stores/StoreCatalogContext';
import { useTheme } from '../theme/ThemeContext';
import { recipesEnabled } from '../config/env';
import { setServerPushEnabled } from '../push/push';
import { setServerSwipeEnabled } from '../cart/swipeFlag';
import { setServerMejeriNavnEnabled } from '../categories/categories';
import { setServerStatsEnabled } from '../stats/stats';
import type { RootStackParamList } from '../navigation/types';
import { useCart } from '../cart/CartContext';
import { useRecentItems, type RecentItem } from '../cart/recentItems';
import { cartItemTitle } from '../cart/stripStoreBrand';
import { cardShadow } from '../theme/Typography';

type HomeRow =
  | { key: string; kind: 'search' }
  | { key: string; kind: 'buyAgain'; items: RecentItem[] }
  | { key: string; kind: 'offerStores'; stores: OfferStore[] }
  | { key: string; kind: 'filters' }
  | { key: string; kind: 'error'; message: string }
  | { key: string; kind: 'section'; section: HomeSection; products: Product[]; title: string }
  | { key: string; kind: 'savings'; savings: PersonalSavings }
  | { key: string; kind: 'recipes'; recipes: Recipe[] };

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const { user } = useAuth();
  const { addItem } = useCart();
  const recentItems = useRecentItems();
  // queryLabels (ikke selectedLabels): debouncet 300 ms som webben, saa et
  // hurtigt til-/fravalg af flere butikker i filter-arket giver ÉT /api/home-
  // kald i stedet for ét pr. tryk.
  const { queryLabels, catalog, ready } = useStoreCatalog();
  const { height: windowHeight } = useWindowDimensions();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const listHeight = Math.max(240, windowHeight - headerHeight - tabBarHeight);

  const [sections, setSections] = React.useState<HomeSection[]>([]);
  const [recipes, setRecipes] = React.useState<Recipe[]>([]);
  // Kortene må kun være klikbare når BEGGE dele holder: serveren har featuren
  // åben (recipes_clickable), OG dette build har overhovedet skærmen/fanen i
  // navigatoren (recipesEnabled, build-tid). Ellers ville et tryk navigere til
  // en route der ikke er registreret. Falder tilbage til build-flaget alene,
  // hvis serveren er ældre og ikke sender feltet.
  const [recipesClickable, setRecipesClickable] = React.useState(recipesEnabled);
  const [filters, setFilters] = React.useState<FiltersValue>({ sort: 'relevance' });
  const [savings, setSavings] = React.useState<PersonalSavings>(() => emptySavings(false));
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [catsOpen, setCatsOpen] = React.useState(false);
  // Tilbudsavis pr. butik (Feature-panelet 'butiksaviser'): /api/home sender
  // kun butikkerne, når den er udgivet, så web og app følges ad.
  const [offerStores, setOfferStores] = React.useState<OfferStore[]>([]);
  // Antal tilbud i alt (KV-optællingen d1_stats_v1), til "214 tilbud"-linket.
  const [saleCount, setSaleCount] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const loadSavings = React.useCallback(async () => {
    if (!user) {
      setSavings(emptySavings(false));
      return;
    }
    try {
      const data = await fetchPersonalSavings();
      setSavings(data);
    } catch {
      setSavings(emptySavings(true));
    }
  }, [user]);

  const load = React.useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        // Filtrene SKAL med til serveren, ikke kun anvendes på svaret.
        // Før sendte vi kun `stores` og filtrerede så de 60 hentede varer pr.
        // sektion klientside. Webben re-renderer server-side over hele puljen
        // (app.py::apply_product_filters), så "Kun tilbud" på web fandt
        // tilbudsvarer i hele kategorien, mens appen kun kunne finde dem blandt
        // de 60 den tilfældigvis havde - og viste en tom sektion, hvor webben
        // viste varer. applyClientFilters nedenfor bliver stående som
        // sikkerhedsnet for felter serveren ikke kender.
        const data = await fetchHome({
          stores: storesParam(queryLabels, catalog),
          ...filters,
        });
        if (!data.success) throw new Error(data.error || 'Fejl');
        setSections(data.sections || []);
        setRecipes(data.recipes || []);
        setRecipesClickable(recipesEnabled && (data.recipes_clickable ?? true));
        setServerPushEnabled(data.push_enabled);
        setServerStatsEnabled(data.stats_enabled);
        setServerSwipeEnabled(data.swipe_enabled);
        setServerMejeriNavnEnabled(data.mejeri_navn_enabled);
        setServerLokationEnabled(data.lokation_enabled);
        setOfferStores(data.butiksaviser_enabled ? data.offer_stores || [] : []);
        setSaleCount(typeof data.sale_count === 'number' && data.sale_count > 0 ? data.sale_count : null);
        await loadSavings();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Kunne ikke hente forsiden');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [queryLabels, catalog, filters, loadSavings],
  );

  React.useEffect(() => {
    if (ready) void load(false);
  }, [ready, load]);

  useFocusEffect(
    React.useCallback(() => {
      void loadSavings();
    }, [loadSavings]),
  );

  const openProduct = (product: Product) => {
    navigation.navigate('ProductDetail', { product });
  };

  const rows = React.useMemo<HomeRow[]>(() => {
    // Version C (18-10-2026): søgefelt, besparelse, "Køb igen", tilbudsaviser,
    // kategorier/filter og så "Ugens største fald" først af varesektionerne.
    const out: HomeRow[] = [
      { key: 'search', kind: 'search' },
      { key: 'savings', kind: 'savings', savings },
      ...(recentItems.length
        ? [{ key: 'buyAgain', kind: 'buyAgain', items: recentItems } as const]
        : []),
      ...(offerStores.length
        ? [{ key: 'offerStores', kind: 'offerStores', stores: offerStores } as const]
        : []),
      { key: 'filters', kind: 'filters' },
    ];
    if (error) out.push({ key: 'error', kind: 'error', message: error });
    const isSale = (sec: HomeSection) => sec.href === '/ugens_tilbud';
    const ordered = [...sections.filter(isSale), ...sections.filter((sec) => !isSale(sec))];
    for (const section of ordered) {
      let pool = applyClientFilters(section.products, filters);
      if (isSale(section)) {
        // "Største fald": de varer i puljen med størst rabat i procent først.
        pool = [...pool].sort((a, b) => discountOf(b) - discountOf(a));
      }
      const products = pool.slice(0, 6);
      if (!products.length) continue;
      out.push({
        key: `section-${section.key}`,
        kind: 'section',
        section,
        products,
        title: isSale(section) ? 'Ugens største fald' : section.title,
      });
    }
    // Sektionen vises i ALLE miljøer, præcis som webforsiden. Er featuren ikke
    // åben, renderes den som ikke-klikbar teaser (recipesClickable nedenfor),
    // så hverken kort eller "Vis alle" kan navigere til en skærm/tab der ikke
    // findes i produktion.
    if (recipes.length) {
      out.push({ key: 'recipes', kind: 'recipes', recipes });
    }
    return out;
  }, [sections, filters, error, savings, recipes, offerStores, recentItems]);

  if (!ready || (loading && !sections.length)) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg, height: listHeight }]}>
        <ActivityIndicator color={colors.primary} accessibilityLabel="Henter forsiden" />
      </View>
    );
  }

  return (
    <View style={{ height: listHeight, backgroundColor: colors.bg }}>
      <FlatList
        style={{ height: listHeight }}
        data={rows}
        keyExtractor={(item) => item.key}
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
        scrollEnabled
        bounces
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />
        }
        renderItem={({ item }) => {
          if (item.kind === 'search') {
            return (
              <Pressable
                onPress={() => navigation.navigate('Tabs', { screen: 'Search' })}
                accessibilityRole="search"
                accessibilityLabel={`Søg i ${catalog.length || 14} butikker`}
                accessibilityHint="Åbner søgning"
                style={({ pressed }) => [
                  styles.searchBar,
                  { backgroundColor: colors.surface, opacity: pressed ? 0.8 : 1 },
                  cardShadow(colors.shadow),
                ]}
              >
                <Ionicons name="search" size={20} color={colors.textMuted} />
                <Text style={[styles.searchText, { color: colors.textMuted }]}>
                  Søg i {catalog.length || 14} butikker
                </Text>
              </Pressable>
            );
          }

          if (item.kind === 'buyAgain') {
            return (
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
                    Køb igen
                  </Text>
                </View>
                <FlatList
                  horizontal
                  data={item.items}
                  keyExtractor={(r) => r.id}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.buyAgainRow}
                  renderItem={({ item: r }) => (
                    <Pressable
                      onPress={() => {
                        addItem(r);
                        AccessibilityInfo.announceForAccessibility(
                          `${cartItemTitle(r)} lagt i kurven`,
                        );
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Læg ${cartItemTitle(r)} i kurv igen`}
                      style={({ pressed }) => [styles.buyAgainItem, { opacity: pressed ? 0.7 : 1 }]}
                    >
                      <View
                        style={[
                          styles.buyAgainCircle,
                          { backgroundColor: colors.logoBg, borderColor: colors.border },
                        ]}
                      >
                        {r.image ? (
                          <Image source={{ uri: r.image }} style={styles.buyAgainImg} resizeMode="contain" />
                        ) : null}
                        <View
                          style={[
                            styles.buyAgainPlus,
                            { backgroundColor: colors.primary, borderColor: colors.bg },
                          ]}
                        >
                          <Ionicons name="add" size={16} color={colors.onPrimary} />
                        </View>
                      </View>
                      <Text
                        style={[styles.buyAgainName, { color: colors.text }]}
                        numberOfLines={2}
                      >
                        {cartItemTitle(r)}
                      </Text>
                    </Pressable>
                  )}
                />
              </View>
            );
          }

          if (item.kind === 'offerStores') {
            return (
              <OfferStoresSection
                stores={item.stores}
                onOpen={(s) =>
                  navigation.navigate('StoreOffers', {
                    storeKey: s.key,
                    label: s.label,
                    avisUrl: s.avis_url,
                  })
                }
              />
            );
          }

          if (item.kind === 'filters') {
            // "Kategorier" åbner skuffen med alle kategorier (03-10-2026);
            // den står nu i samme række som "Filter", som runde piller.
            return (
              <View style={{ marginTop: 14 }}>
                <FiltersBar
                  values={filters}
                  onChange={setFilters}
                  leading={
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Kategorier"
                      onPress={() => setCatsOpen(true)}
                      style={({ pressed }) => [
                        styles.catsButton,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <Ionicons name="grid-outline" size={16} color={colors.text} />
                      <Text style={[styles.catsButtonText, { color: colors.text }]}>Kategorier</Text>
                    </Pressable>
                  }
                />
              </View>
            );
          }

          if (item.kind === 'error') {
            return (
              <Text
                style={[styles.error, { color: colors.sale }]}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
              >
                {item.message}
              </Text>
            );
          }

          if (item.kind === 'savings') {
            const s = item.savings;
            if (!s.available) {
              return (
                <Pressable
                  onPress={() => navigation.navigate('Auth')}
                  accessibilityRole="button"
                  accessibilityLabel="Personlig besparelse. Log ind for at følge, hvor meget du sparer"
                  style={[styles.savingsBanner, { backgroundColor: colors.bannerBg }, cardShadow(colors.shadow)]}
                >
                  <View style={styles.savingsContent}>
                    <Text style={[styles.savingsLabel, { color: colors.bannerSoft }]}>Personlig besparelse</Text>
                    <Text style={[styles.savingsAmount, { color: colors.onPrimary }]}>
                      Log ind for at tracke besparelse
                    </Text>
                  </View>
                  <View style={[styles.savingsBadge, { backgroundColor: colors.onPrimary }]}>
                    <Text style={[styles.savingsBadgeText, { color: colors.bannerBg }]}>Log ind</Text>
                  </View>
                </Pressable>
              );
            }
            return (
              <View
                style={[styles.savingsBanner, { backgroundColor: colors.bannerBg }, cardShadow(colors.shadow)]}
                accessible
                accessibilityLabel={[
                  `Personlig besparelse. Du har sparet ${formatKr(s.amount)} kr denne måned`,
                  s.show_prev && s.prev_amount > 0
                    ? `I ${monthLabel(s.prev_month_key)} sparede du ${formatKr(s.prev_amount)} kr`
                    : '',
                  `Top ${s.top_pct} procent`,
                ]
                  .filter(Boolean)
                  .join('. ')}
              >
                <View style={styles.savingsContent}>
                  <Text style={[styles.savingsLabel, { color: colors.bannerSoft }]}>Personlig besparelse</Text>
                  <Text style={[styles.savingsAmount, { color: colors.onPrimary }]}>
                    Du har sparet {formatKr(s.amount)} kr denne måned
                  </Text>
                  {s.show_prev && s.prev_amount > 0 ? (
                    <Text style={[styles.savingsPrev, { color: colors.bannerSoft }]}>
                      I {monthLabel(s.prev_month_key)} sparede du {formatKr(s.prev_amount)} kr
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.savingsBadge, { backgroundColor: colors.onPrimary }]}>
                  <Text style={[styles.savingsBadgeText, { color: colors.bannerBg }]}>Top {s.top_pct}%</Text>
                </View>
              </View>
            );
          }

          if (item.kind === 'recipes') {
            return (
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
                    Lækre opskrifter
                  </Text>
                  {recipesClickable ? (
                    <Pressable
                      onPress={() => navigation.navigate('Tabs', { screen: 'Recipes' })}
                      accessibilityRole="button"
                      accessibilityLabel="Vis alle opskrifter"
                      hitSlop={10}
                    >
                      <Text style={[styles.sectionLink, { color: colors.primaryDark }]}>Vis alle</Text>
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.grid}>
                  {item.recipes.slice(0, 10).map((recipe) => (
                    <View key={recipe.id} style={styles.gridItem}>
                      <RecipeCard
                        recipe={recipe}
                        clickable={recipesClickable}
                        onPress={(r) => navigation.navigate('RecipeDetail', { recipeId: r.id })}
                      />
                    </View>
                  ))}
                </View>
              </View>
            );
          }

          const { section, products, title } = item;
          return (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
                  {title}
                </Text>
                {section.href === '/ugens_tilbud' ? (
                  <Pressable
                    onPress={() => navigation.navigate('Sale')}
                    accessibilityRole="button"
                    accessibilityLabel={saleCount ? `Vis alle ${saleCount} tilbud` : 'Vis alle tilbud'}
                    hitSlop={10}
                  >
                    <Text style={[styles.sectionLink, { color: colors.primaryDark }]}>
                      {saleCount ? `${saleCount} tilbud` : 'Vis alle'}
                    </Text>
                  </Pressable>
                ) : section.href ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Vis alle i ${section.title}`}
                    hitSlop={10}
                    onPress={() =>
                      navigation.navigate('Category', {
                        slug: section.href!.replace(/^\//, ''),
                        title: section.title,
                      })
                    }
                  >
                    <Text style={[styles.sectionLink, { color: colors.primaryDark }]}>Vis alle</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.grid}>
                {products.map((product) => (
                  <View key={product.id} style={styles.gridItem}>
                    <ProductCard product={product} onPress={openProduct} />
                  </View>
                ))}
              </View>
            </View>
          );
        }}
      />
      <CategoriesDrawer
        visible={catsOpen}
        onClose={() => setCatsOpen(false)}
        onSelect={(c) => {
          if (c.slug === 'sale') navigation.navigate('Sale');
          else navigation.navigate('Category', { slug: c.slug, title: c.label });
        }}
      />
    </View>
  );
}

/** Rabat i procent (0 uden førpris), til "Ugens største fald". */
function discountOf(p: Product): number {
  return p.is_sale && p.normal_price > p.price ? 1 - p.price / p.normal_price : 0;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  searchBar: {
    height: 48,
    borderRadius: 999,
    marginHorizontal: 16,
    marginTop: 4,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchText: { fontSize: 15, flex: 1 },
  catsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  catsButtonText: { fontSize: 14, fontWeight: '700' },
  section: { marginTop: 18 },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  sectionTitle: { fontSize: 17, fontWeight: '800' },
  sectionLink: { fontSize: 14, fontWeight: '700' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 6,
    // Plads til tilbudsmærket, der stikker ud over kortets hjørne.
    paddingTop: 6,
  },
  gridItem: {
    width: '50%',
    paddingHorizontal: 2,
  },
  buyAgainRow: { paddingHorizontal: 12, gap: 6 },
  buyAgainItem: { width: 78, alignItems: 'center' },
  buyAgainCircle: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buyAgainImg: { width: 52, height: 52 },
  buyAgainPlus: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buyAgainName: { fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 6 },
  savingsBanner: {
    marginHorizontal: 16,
    marginTop: 14,
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 16,
    paddingLeft: 18,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  savingsContent: { flex: 1 },
  savingsLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginBottom: 4,
  },
  savingsAmount: {
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 23,
  },
  savingsPrev: {
    marginTop: 4,
    fontSize: 13,
  },
  savingsBadge: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savingsBadgeText: {
    fontWeight: '800',
    fontSize: 16,
  },
  error: { padding: 16 },
});
