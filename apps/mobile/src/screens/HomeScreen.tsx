import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useHeaderHeight } from '@react-navigation/elements';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { fetchHome } from '../api/listing';
import type { HomeSection, Product } from '../api/types';
import type { Recipe } from '../api/recipes';
import { useAuth } from '../auth/AuthContext';
import { CategoriesDrawer } from '../components/CategoriesDrawer';
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

type HomeRow =
  | { key: string; kind: 'cats' }
  | { key: string; kind: 'filters' }
  | { key: string; kind: 'error'; message: string }
  | { key: string; kind: 'section'; section: HomeSection; products: Product[] }
  | { key: string; kind: 'savings'; savings: PersonalSavings }
  | { key: string; kind: 'recipes'; recipes: Recipe[] };

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const { user } = useAuth();
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
    const out: HomeRow[] = [
      { key: 'savings', kind: 'savings', savings },
      { key: 'cats', kind: 'cats' },
      { key: 'filters', kind: 'filters' },
    ];
    if (error) out.push({ key: 'error', kind: 'error', message: error });
    for (const section of sections) {
      const products = applyClientFilters(section.products, filters).slice(0, 6);
      if (!products.length) continue;
      out.push({ key: `section-${section.key}`, kind: 'section', section, products });
    }
    // Sektionen vises i ALLE miljøer, præcis som webforsiden. Er featuren ikke
    // åben, renderes den som ikke-klikbar teaser (recipesClickable nedenfor),
    // så hverken kort eller "Vis alle" kan navigere til en skærm/tab der ikke
    // findes i produktion.
    if (recipes.length) {
      out.push({ key: 'recipes', kind: 'recipes', recipes });
    }
    return out;
  }, [sections, filters, error, savings, recipes]);

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
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 40 }}
        scrollEnabled
        bounces
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />
        }
        renderItem={({ item }) => {
          if (item.kind === 'cats') {
            // Én knap i stedet for en vandret chip-bjælke (03-10-2026): man
            // så kun de første par kategorier og skulle swipe efter resten.
            // Skuffen (CategoriesDrawer) viser dem alle på én gang.
            return (
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
                <Ionicons name="grid-outline" size={20} color={colors.text} />
                <Text style={[styles.catsButtonText, { color: colors.text }]}>Kategorier</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
            );
          }

          if (item.kind === 'filters') {
            return <FiltersBar values={filters} onChange={setFilters} />;
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
                  style={styles.savingsBanner}
                >
                  <View style={styles.savingsContent}>
                    <Text style={styles.savingsLabel}>Personlig besparelse</Text>
                    <Text style={styles.savingsAmount}>Log ind for at tracke besparelse</Text>
                  </View>
                  <View style={styles.savingsBadge}>
                    <Text style={styles.savingsBadgeText}>Log ind</Text>
                  </View>
                </Pressable>
              );
            }
            return (
              <View
                style={styles.savingsBanner}
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
                  <Text style={styles.savingsLabel}>Personlig besparelse</Text>
                  <Text style={styles.savingsAmount}>
                    Du har sparet {formatKr(s.amount)} kr denne måned
                  </Text>
                  {s.show_prev && s.prev_amount > 0 ? (
                    <Text style={styles.savingsPrev}>
                      I {monthLabel(s.prev_month_key)} sparede du {formatKr(s.prev_amount)} kr
                    </Text>
                  ) : null}
                </View>
                <View style={styles.savingsBadge}>
                  <Text style={styles.savingsBadgeText}>Top {s.top_pct}%</Text>
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
                      <Text style={{ color: colors.text, fontWeight: '600' }}>Vis alle</Text>
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

          const { section, products } = item;
          return (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
                  {section.title}
                </Text>
                {section.href === '/ugens_tilbud' ? (
                  <Pressable
                    onPress={() => navigation.navigate('Sale')}
                    accessibilityRole="button"
                    accessibilityLabel={`Vis alle i ${section.title}`}
                    hitSlop={10}
                  >
                    <Text style={{ color: colors.text, fontWeight: '600' }}>Vis alle</Text>
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
                    <Text style={{ color: colors.text, fontWeight: '600' }}>Vis alle</Text>
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

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  catsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  catsButtonText: { flex: 1, fontSize: 16, fontWeight: '700' },
  section: { marginTop: 12 },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 4,
  },
  gridItem: {
    width: '50%',
    paddingHorizontal: 2,
  },
  savingsBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#059669',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  savingsContent: { flex: 1 },
  savingsLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  savingsAmount: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 22,
  },
  savingsPrev: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
  },
  savingsBadge: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  savingsBadgeText: {
    color: '#059669',
    fontWeight: '800',
    fontSize: 13,
  },
  error: { padding: 16 },
});
