import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, cardShadow } from '../theme/Typography';
import { useHeaderHeight } from '@react-navigation/elements';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  fetchRecipeDetail,
  recordRecipeClick,
  type MatchedProduct,
  type RecipeDetail,
  type RecipeIngredient,
  type RecipeSnapshot,
} from '../api/recipes';
import { useCart } from '../cart/CartContext';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from '../navigation/types';
import { joinLabel, spokenKr } from '../a11y/speech';
import { StackScreenBody } from '../components/ScreenBody';
import { ApiError } from '../api/client';
import { StoreLogo } from '../stores/storeLogos';
import { DIETS } from '../recipes/mealPlan';
import { displayTotal, haveSummary, toggleHave } from '../recipes/have';
import { loadHave, saveHave } from '../recipes/haveStore';
import { krNum } from '../format/kr';

type Props = NativeStackScreenProps<RootStackParamList, 'RecipeDetail'>;

// Samme g/kg/l/ml/cl/dl-konvertering som app_support.py::_unit_to_grams og
// templates/opskrift.html's UNIT_TO_GRAMS - "gram-ækvivalent" til at
// sammenligne opskrift-mængder med pakkers weight_g.
const UNIT_TO_GRAMS: Record<string, number> = { g: 1, kg: 1000, ml: 1, cl: 10, dl: 100, l: 1000 };

function formatQty(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return String(rounded).replace('.', ',');
}

type PickedCandidate = { product: MatchedProduct; units: number; cost: number };

/** Billigste kandidat (og antal pakker) for den skalerede mængde, eller null
 * hvis ingen kandidat kan mængdevurderes (fx vægtløse Dagrofa-varer) - i så
 * fald beholdes det oprindelige match. Port af samme funktion i
 * templates/opskrift.html (web-paritet). */
function pickBestCandidate(
  scaledQty: number,
  unit: string,
  candidates: MatchedProduct[],
): PickedCandidate | null {
  if (!candidates || candidates.length === 0) return null;
  const targetGrams = UNIT_TO_GRAMS[unit] ? scaledQty * UNIT_TO_GRAMS[unit] : null;
  let best: PickedCandidate | null = null;
  for (const c of candidates) {
    let units: number | null = null;
    if (targetGrams !== null && c.weight_g) {
      units = Math.max(1, Math.ceil(targetGrams / c.weight_g));
    } else if (!unit && c.stk_count) {
      units = Math.max(1, Math.ceil(scaledQty / c.stk_count));
    } else {
      continue;
    }
    const cost = units * c.price;
    if (!best || cost < best.cost) {
      best = { product: c, units, cost };
    }
  }
  return best;
}

/** "12,95" (uden "kr"), som på hyldeskiltet i ingredienslisten. */
const price2 = (n: number) => n.toFixed(2).replace('.', ',');

/** "512 kcal" -> ["512", "kcal"]; tekst uden tal vises som den er. */
function splitNutrition(v: string | undefined, fallbackUnit: string): [string, string] | null {
  if (!v) return null;
  const m = String(v).trim().match(/^([\d.,]+)\s*(.*)$/);
  if (!m) return [String(v), ''];
  return [m[1].replace('.', ','), m[2] || fallbackUnit];
}

const round1 = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

export function RecipeDetailScreen({ route, navigation }: Props) {
  const { recipeId, diets } = route.params;
  const { colors } = useTheme();
  const { addItem } = useCart();
  const { height: windowHeight } = useWindowDimensions();
  const headerHeight = useHeaderHeight();
  const bodyHeight = Math.max(240, windowHeight - headerHeight);

  const [loading, setLoading] = useState(true);
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [snapshot, setSnapshot] = useState<RecipeSnapshot | null>(null);
  const [servings, setServings] = useState(4);
  const [baseServings, setBaseServings] = useState(4);
  const [addedLabel, setAddedLabel] = useState<string | null>(null);
  // "Har jeg": ingredienser man har i forvejen (gemt på telefonen).
  const [have, setHave] = useState<Set<number>>(new Set());
  // Serveren svarer 403, når kontoen ikke har betalt for opskrifterne.
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchRecipeDetail(recipeId)
      .then((res) => {
        if (cancelled || !res.success || !res.recipe) return;
        setRecipe(res.recipe);
        setIngredients(res.ingredients || []);
        setSnapshot(res.snapshot);
        const base = res.recipe.servings || 4;
        setBaseServings(base);
        setServings(base);
      })
      .catch((e) => {
        if (!cancelled && e instanceof ApiError && e.status === 403) setLocked(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    void loadHave(recipeId).then((h) => {
      if (!cancelled) setHave(h);
    });
    void recordRecipeClick(recipeId);
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  const scale = servings / baseServings;

  // Ved udgangspunktet (scale=1) vises serverens oprindelige navne-match
  // uændret - kun ved faktisk ændret personer-tal genvurderes hvilken
  // pakke der er billigst for den nye mængde (web-paritet).
  const computed = useMemo(() => {
    let total = 0;
    const rows = ingredients.map((ing) => {
      let displayText = ing.raw_text;
      let matchProduct = ing.matched_product;
      let units = 1;

      if (ing.quantity !== null) {
        const scaled = ing.quantity * scale;
        const parts = [formatQty(scaled), ing.unit, ing.ingredient_name || ing.raw_text].filter(
          Boolean,
        );
        displayText = parts.join(' ');

        if (scale !== 1) {
          const picked = pickBestCandidate(scaled, ing.unit, ing.candidates);
          if (picked) {
            matchProduct = picked.product;
            units = picked.units;
          }
        }
      }

      const lineCost = matchProduct ? matchProduct.price * units : null;
      if (lineCost !== null) total += lineCost;

      return { ing, displayText, matchProduct, units, lineCost };
    });
    return { rows, total };
  }, [ingredients, scale]);

  const summary = useMemo(
    () => haveSummary(computed.rows.map((r) => ({ id: r.ing.id, lineCost: r.lineCost })), have),
    [computed, have],
  );

  const baseTotal =
    scale !== 1 && computed.total > 0 ? computed.total : snapshot?.cheapest_total_price ?? null;
  const shownTotal = displayTotal(baseTotal, summary, have.size > 0);

  // Billigste butik: kun når alle de varer, man mangler, ligger i samme butik
  // (det er den butik, matchet allerede har valgt). Ellers vises kun prisen.
  const store = useMemo(() => {
    const stores = new Set(
      computed.rows
        .filter((r) => r.matchProduct && !have.has(r.ing.id))
        .map((r) => r.matchProduct!.store),
    );
    return stores.size === 1 ? [...stores][0] : null;
  }, [computed, have]);

  const onToggleHave = (id: number) => {
    const next = toggleHave(have, id);
    setHave(next);
    void saveHave(recipeId, next);
  };

  const onAddAll = () => {
    const matched = computed.rows.filter((r) => r.matchProduct && !have.has(r.ing.id));
    matched.forEach(({ matchProduct, units }) => {
      if (!matchProduct) return;
      addItem({
        id: `product${matchProduct.id}`,
        name: matchProduct.name,
        store: matchProduct.store,
        price: matchProduct.price,
        storePrices: matchProduct.store_prices || {},
        storeMultiDeals: {},
        image: matchProduct.image,
        category: matchProduct.category || 'Andre varer',
        unitMeasure: matchProduct.unit_measure,
        kgPrice: matchProduct.kg_price != null ? `${krNum(matchProduct.kg_price)} kr/kg` : '',
        multiDeal: matchProduct.multi_deal || undefined,
        quantity: units,
      });
    });
    setAddedLabel(`${matched.length} ${matched.length === 1 ? 'vare' : 'varer'} lagt i kurven`);
    setTimeout(() => setAddedLabel(null), 2000);
  };

  if (loading) {
    return (
      <View style={[styles.center, { height: bodyHeight, backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.primary} accessibilityLabel="Henter opskriften" />
      </View>
    );
  }

  if (locked) {
    return (
      <View style={[styles.center, { height: bodyHeight, backgroundColor: colors.bg, padding: 24 }]}>
        <Text style={{ color: colors.text, textAlign: 'center', marginBottom: 12 }}>
          Opskriften kræver et abonnement på opskrifterne.
        </Text>
        <Pressable onPress={() => navigation.replace('RecipeAccess')} accessibilityRole="button" hitSlop={8}>
          <Text style={{ color: colors.primaryDark, fontWeight: '700' }}>Se abonnement</Text>
        </Pressable>
      </View>
    );
  }

  if (!recipe) {
    return (
      <View style={[styles.center, { height: bodyHeight, backgroundColor: colors.bg }]}>
        <Text style={{ color: colors.textMuted }}>Opskriften blev ikke fundet.</Text>
      </View>
    );
  }

  const salePct =
    snapshot && snapshot.total_ingredient_count && snapshot.ingredients_on_sale_count
      ? Math.floor((snapshot.ingredients_on_sale_count / snapshot.total_ingredient_count) * 100)
      : 0;
  const dietLabels = DIETS.filter((d) => diets?.includes(d.key)).slice(0, 2);
  const source = recipe.source_name || recipe.source_url;
  const n = summary.found;
  const setPeople = (v: number) => setServings(Math.max(1, v));

  const src = recipe.nutrition_source;
  const est = recipe.nutrition_estimate;
  const nutrition: { value: string; unit: string; label: string }[] = [];
  if (src) {
    const add = (v: string | undefined, unit: string, label: string) => {
      const sp = splitNutrition(v, unit);
      if (sp) nutrition.push({ value: sp[0], unit: sp[1], label });
    };
    add(src.calories, '', 'Energi');
    add(src.protein, 'g', 'Protein');
    add(src.fat, 'g', 'Fedt');
    add(src.carbohydrate, 'g', 'Kulhydrat');
  } else if (est) {
    nutrition.push(
      { value: round1(est.kcal * scale), unit: 'kcal', label: 'Energi' },
      { value: round1(est.protein * scale), unit: 'g', label: 'Protein' },
      { value: round1(est.fedt * scale), unit: 'g', label: 'Fedt' },
      { value: round1(est.kulhydrat * scale), unit: 'g', label: 'Kulhydrat' },
    );
  }

  return (
    <StackScreenBody style={{ backgroundColor: colors.bg }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator>
        <View style={[styles.hero, { backgroundColor: colors.primaryMuted }]}>
          {recipe.image_url ? (
            <Image
              source={{ uri: recipe.image_url }}
              style={styles.heroImage}
              resizeMode="cover"
              accessible
              accessibilityRole="image"
              accessibilityLabel={`Billede af ${recipe.title}`}
            />
          ) : (
            <View style={[styles.heroImage, styles.center]}>
              <Ionicons name="restaurant-outline" size={64} color={colors.primaryDark} />
            </View>
          )}
          {salePct > 0 ? (
            <View style={[styles.heroSale, { backgroundColor: colors.deal }]}>
              <Text style={{ color: colors.dealText, fontSize: 13, fontWeight: '800' }}>
                {salePct}% af varerne på tilbud
              </Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.sheet, { backgroundColor: colors.bg }]}>
          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
            {recipe.title}
          </Text>
          <View style={styles.pillRow}>
            {recipe.total_time_minutes ? (
              <View
                style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.border }]}
                accessible
                accessibilityLabel={`Tid: ${recipe.total_time_minutes} minutter`}
              >
                <Ionicons name="time-outline" size={13} color={colors.text} />
                <Text style={[styles.pillText, { color: colors.text }]}>{recipe.total_time_minutes} min</Text>
              </View>
            ) : null}
            {dietLabels.map((d) => (
              <View key={d.key} style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.pillText, { color: colors.text }]}>{d.label}</Text>
              </View>
            ))}
            {source ? (
              <Text style={{ fontSize: 13, color: colors.textMuted }}>Opskrift fra {source}</Text>
            ) : null}
          </View>

          {/* Pris-kortet, som kurvens vinderkort. */}
          <View style={[styles.priceCard, { backgroundColor: colors.primary }, cardShadow(colors.primary)]}>
            <View style={styles.priceTop}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.onPrimary }}>Ingredienser til</Text>
              <View
                style={[styles.people, { backgroundColor: colors.onPrimarySoft }]}
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel="Antal personer"
                accessibilityValue={{ text: `${servings} ${servings === 1 ? 'person' : 'personer'}` }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={(e) =>
                  setPeople(servings + (e.nativeEvent.actionName === 'increment' ? 1 : -1))
                }
              >
                <Pressable
                  onPress={() => setPeople(servings - 1)}
                  disabled={servings <= 1}
                  style={[styles.stepBtn, { opacity: servings <= 1 ? 0.4 : 1 }]}
                >
                  <Text style={[styles.stepText, { color: colors.onPrimary }]}>−</Text>
                </Pressable>
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.onPrimary }}>
                  {servings} {servings === 1 ? 'person' : 'personer'}
                </Text>
                <Pressable onPress={() => setPeople(servings + 1)} style={styles.stepBtn}>
                  <Text style={[styles.stepText, { color: colors.onPrimary }]}>+</Text>
                </Pressable>
              </View>
            </View>

            <View
              style={styles.priceMain}
              accessible
              accessibilityLabel={joinLabel([
                store ? `Billigst i ${store}` : null,
                `${n} af ${summary.needed} varer fundet`,
                shownTotal ? `cirka ${spokenKr(shownTotal)}` : 'prisen kunne ikke beregnes endnu',
              ])}
            >
              {store ? (
                <View style={[styles.logo, { backgroundColor: colors.logoBg }]}>
                  <StoreLogo store={store} maxWidth={34} maxHeight={24} minHeight={12} />
                </View>
              ) : null}
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: colors.bannerSoft }}>
                  {store ? `Billigst i ${store}, ` : ''}
                  {n} af {summary.needed} varer{store ? '' : ' fundet'}
                </Text>
                <Text style={[styles.priceTotal, { color: colors.onPrimary }]}>
                  {shownTotal ? `ca. ${price2(shownTotal)} kr` : 'Pris ukendt'}
                </Text>
              </View>
            </View>

            <Pressable
              onPress={onAddAll}
              disabled={n === 0}
              accessibilityRole="button"
              accessibilityState={{ disabled: n === 0 }}
              accessibilityLabel={addedLabel || `Læg ${n} ${n === 1 ? 'vare' : 'varer'} i kurven`}
              style={({ pressed }) => [
                styles.addBtn,
                { backgroundColor: colors.surface, opacity: n === 0 ? 0.6 : pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons name={addedLabel ? 'checkmark' : 'add'} size={20} color={colors.primaryDark} />
              <Text style={[styles.addText, { color: colors.primaryDark }]}>
                {addedLabel || `Læg ${n} ${n === 1 ? 'vare' : 'varer'} i kurven`}
              </Text>
            </Pressable>
          </View>

          <View style={styles.sectionHead}>
            <Text style={[styles.h, { color: colors.text }]} accessibilityRole="header">
              Ingredienser
            </Text>
            <Text style={{ fontSize: 13, color: colors.textMuted }}>Tryk på det, du har</Text>
          </View>
          <View style={[styles.listCard, { backgroundColor: colors.surface }, cardShadow(colors.shadow)]}>
            {computed.rows.map(({ ing, displayText, matchProduct, units, lineCost }, i) => {
              const owned = have.has(ing.id);
              const productLine = matchProduct
                ? `${[matchProduct.name, matchProduct.unit_measure].filter(Boolean).join(' ')}${units > 1 ? ` × ${units}` : ''} · ${matchProduct.store}`
                : null;
              return (
                <View
                  key={ing.id}
                  style={[
                    styles.ingRow,
                    i < computed.rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                  ]}
                >
                  <Pressable
                    onPress={() => onToggleHave(ing.id)}
                    hitSlop={9}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: owned }}
                    accessibilityLabel={`Har jeg: ${displayText}`}
                    style={[
                      styles.check,
                      owned
                        ? { backgroundColor: colors.primary }
                        : { borderWidth: 2, borderColor: colors.checkBorder },
                    ]}
                  >
                    {owned ? <Ionicons name="checkmark" size={16} color={colors.onPrimary} /> : null}
                  </Pressable>
                  <Pressable
                    style={styles.ingBody}
                    disabled={!matchProduct?.api}
                    accessibilityRole={matchProduct?.api ? 'button' : 'text'}
                    accessibilityLabel={joinLabel([
                      displayText,
                      owned
                        ? 'har jeg'
                        : matchProduct
                          ? joinLabel([
                              productLine,
                              spokenKr(matchProduct.price * units),
                              matchProduct.is_sale ? 'tilbud' : null,
                            ])
                          : 'ikke fundet i prissammenligningen',
                    ])}
                    accessibilityHint={matchProduct?.api ? 'Åbner varen' : undefined}
                    onPress={() => {
                      // matchProduct er den AKTUELT viste pakke (base-match eller
                      // en kandidat ved ændret personer-tal); .api følger med.
                      if (matchProduct?.api) navigation.navigate('ProductDetail', { product: matchProduct.api });
                    }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        style={[
                          styles.ingText,
                          { color: owned ? colors.textMuted : colors.text },
                          owned && { textDecorationLine: 'line-through' },
                        ]}
                      >
                        {displayText}
                      </Text>
                      {productLine && !owned ? (
                        <Text style={{ fontSize: 12, color: colors.textMuted }} numberOfLines={2}>
                          {productLine}
                        </Text>
                      ) : null}
                    </View>
                    {owned ? (
                      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.primaryDark }}>Har jeg</Text>
                    ) : lineCost != null ? (
                      <Text
                        style={{
                          fontSize: 15,
                          fontWeight: '800',
                          color: matchProduct?.is_sale ? colors.dealInk : colors.text,
                        }}
                      >
                        {price2(lineCost)}
                      </Text>
                    ) : (
                      <Text style={{ fontSize: 13, color: colors.textMuted }}>Ikke fundet</Text>
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>

          {recipe.instructions && recipe.instructions.length > 0 ? (
            <>
              <Text style={[styles.h, styles.hSpace, { color: colors.text }]} accessibilityRole="header">
                Fremgangsmåde
              </Text>
              <View style={{ gap: 14 }}>
                {recipe.instructions.map((step, i) => (
                  <View key={i} style={styles.stepRow} accessible accessibilityLabel={`Trin ${i + 1}: ${step}`}>
                    <View style={[styles.stepNumber, { backgroundColor: colors.primaryMuted }]}>
                      <Text style={{ color: colors.primaryDark, fontWeight: '800', fontSize: 14 }}>{i + 1}</Text>
                    </View>
                    <Text style={{ color: colors.text, flex: 1, fontSize: 15, lineHeight: 22, marginTop: 4 }}>
                      {step}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : recipe.source_url ? (
            <>
              <Text style={[styles.h, styles.hSpace, { color: colors.text }]} accessibilityRole="header">
                Fremgangsmåde
              </Text>
              <Pressable
                onPress={() => Linking.openURL(recipe.source_url)}
                accessibilityRole="link"
                accessibilityLabel={`Se hele fremgangsmåden hos ${recipe.source_name || 'kilden'}`}
                accessibilityHint="Åbner siden i browseren"
              >
                <Text style={{ color: colors.primaryDark, fontWeight: '600', fontSize: 15 }}>
                  Se hele fremgangsmåden hos {recipe.source_name || 'kilden'}
                </Text>
              </Pressable>
            </>
          ) : null}

          {nutrition.length ? (
            <>
              <View style={[styles.sectionHead, styles.hSpace]}>
                <Text style={[styles.h, { color: colors.text }]} accessibilityRole="header">
                  {src
                    ? src.serving_size
                      ? `Næring pr. ${src.serving_size}`
                      : 'Næring'
                    : 'Næring for hele opskriften'}
                </Text>
                {!src ? <Text style={{ fontSize: 12, color: colors.textMuted }}>Estimat</Text> : null}
              </View>
              <View style={styles.nutritionRow}>
                {nutrition.map((x) => (
                  <View
                    key={x.label}
                    style={[styles.nutritionTile, { backgroundColor: colors.surface }, cardShadow(colors.shadow)]}
                    accessible
                    accessibilityLabel={`${x.label}: ${x.value} ${x.unit}`}
                  >
                    <Text style={{ color: colors.text }} numberOfLines={1} adjustsFontSizeToFit>
                      <Text style={styles.nutritionValue}>{x.value}</Text>
                      {x.unit ? <Text style={styles.nutritionUnit}> {x.unit}</Text> : null}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{x.label}</Text>
                  </View>
                ))}
              </View>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 10, lineHeight: 17 }}>
                {src
                  ? 'Ifølge kilden.'
                  : `Estimat for hele opskriften, baseret på ${est!.contributing_ingredient_count} af ${est!.total_ingredient_count} ingredienser. Det kan afvige fra det faktiske indhold og er mest tænkt som et udgangspunkt.`}
              </Text>
            </>
          ) : null}
        </View>
      </ScrollView>
    </StackScreenBody>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  hero: { height: 300 },
  heroImage: { width: '100%', height: '100%' },
  heroSale: {
    position: 'absolute',
    left: 16,
    bottom: 44,
    height: 26,
    borderRadius: 999,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  sheet: {
    marginTop: -28,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 22,
    paddingHorizontal: 16,
  },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6, lineHeight: 32 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 },
  pill: {
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pillText: { fontSize: 13, fontWeight: '600' },
  priceCard: { borderRadius: 24, padding: 16, gap: 12, marginTop: 16 },
  priceTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  people: { height: 36, borderRadius: 999, flexDirection: 'row', alignItems: 'center' },
  stepBtn: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 20, fontWeight: '700', lineHeight: 22 },
  priceMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  priceTotal: { fontSize: 30, fontWeight: '900', letterSpacing: -0.9, lineHeight: 34 },
  addBtn: {
    height: 50,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addText: { fontSize: 16, fontWeight: '800' },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 22,
    marginBottom: 10,
  },
  h: { fontSize: 17, fontWeight: '800' },
  hSpace: { marginTop: 24, marginBottom: 12 },
  listCard: { borderRadius: 24, overflow: 'hidden' },
  ingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  check: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  ingBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 },
  ingText: { fontSize: 14, fontWeight: '600' },
  stepRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  stepNumber: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  nutritionRow: { flexDirection: 'row', gap: 8 },
  nutritionTile: { flex: 1, borderRadius: 16, padding: 12 },
  nutritionValue: { fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  nutritionUnit: { fontSize: 12, fontWeight: '700' },
});
