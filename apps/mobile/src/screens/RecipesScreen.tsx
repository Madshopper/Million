import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, TextInput, cardShadow } from '../theme/Typography';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { fetchRecipes, type Recipe } from '../api/recipes';
import { RecipeCard } from '../components/RecipeCard';
import { TabScreenBody } from '../components/ScreenBody';
import { MealPlanWizard } from '../recipes/MealPlanWizard';
import { MealPlanView } from '../recipes/MealPlanView';
import {
  BUDGET,
  MOODS,
  defaultPrefs,
  krRound,
  loadPrefs,
  savePrefs,
  type MealPrefs,
} from '../recipes/mealPlan';
import { useRecipeAccess } from '../recipes/access';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from '../navigation/types';

type Tab = 'plan' | 'all';

/** Opskrift-fanen: EGEN søgning, adskilt fra SearchScreen (produkter).
 * Web-paritet med templates/opskrifter.html - søger kun i den allerede
 * hentede opskrift-liste (client-side substring på titel), aldrig produkter.
 *
 * C2 (31-10-2026): to faner øverst, "Min madplan" og "Alle opskrifter".
 * Første gang stilles spørgsmålene (MealPlanWizard); bagefter står planen
 * under "Min madplan". Svarene gemmes kun på telefonen.
 *
 * Betaling (src/recipes/access.ts): listen kan ses af alle, men opskriften
 * selv og madplanen kræver adgang. Uden adgang fører et tryk til
 * RecipeAccess, og madplanen vises ikke. Samme regel som webben. */
export function RecipesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [mood, setMood] = useState<string | null>(null);
  // undefined = henter stadig de gemte svar, null = ingen svar endnu.
  const [prefs, setPrefs] = useState<MealPrefs | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [thinking, setThinking] = useState(false);
  // Hvilken fane brugeren selv har valgt (null = standard ud fra tilstanden).
  const [picked, setPicked] = useState<Tab | null>(null);
  const { access } = useRecipeAccess();
  const locked = access !== true;

  useEffect(() => {
    loadPrefs().then((p) => setPrefs(p && p.done ? p : null));
  }, []);

  const changePrefs = (p: MealPrefs) => {
    setPrefs(p);
    savePrefs(p);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchRecipes()
      .then((res) => {
        if (!cancelled) setRecipes(res.success ? res.recipes || [] : []);
      })
      .catch(() => {
        if (!cancelled) setRecipes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filterpillerne: kun de lyst-mærker, der faktisk findes i opskrifterne.
  const moodFilters = useMemo(
    () => MOODS.filter((m) => recipes.some((r) => r.plan?.moods.includes(m.key))),
    [recipes],
  );

  // "Billigst denne uge": sorteret efter prisen fra listen (ingen nye kald).
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const list = recipes.filter(
      (r) =>
        (!query || r.title.toLowerCase().includes(query)) &&
        (!mood || !!r.plan?.moods.includes(mood)),
    );
    return [...list].sort(
      (a, b) =>
        (a.cheapest_total_price ?? Number.POSITIVE_INFINITY) -
        (b.cheapest_total_price ?? Number.POSITIVE_INFINITY),
    );
  }, [recipes, q, mood]);

  const openRecipe = (r: Recipe) =>
    locked
      ? navigation.navigate('RecipeAccess')
      : navigation.navigate('RecipeDetail', { recipeId: r.id, diets: r.plan?.diet });

  if (loading || prefs === undefined || access === null) {
    return (
      <TabScreenBody style={{ backgroundColor: colors.bg }}>
        <ActivityIndicator
          color={colors.primary}
          style={{ marginTop: 20 }}
          accessibilityLabel="Henter opskrifter"
        />
      </TabScreenBody>
    );
  }

  if (!locked && recipes.length && (prefs === null || editing)) {
    return (
      <TabScreenBody style={{ backgroundColor: colors.bg }}>
        <MealPlanWizard
          recipes={recipes}
          initial={prefs || defaultPrefs()}
          onCancel={prefs ? () => setEditing(false) : undefined}
          onDone={(p) => {
            changePrefs(p);
            setEditing(false);
            setPicked('plan');
            setThinking(true);
          }}
        />
      </TabScreenBody>
    );
  }

  if (thinking && prefs) {
    return (
      <TabScreenBody style={{ backgroundColor: colors.bg }}>
        <ThinkingView prefs={prefs} onDone={() => setThinking(false)} />
      </TabScreenBody>
    );
  }

  // Uden madplan eller med betalingsmur starter fanen på "Alle opskrifter".
  const hasPlan = !locked && !!prefs;
  const tab: Tab = picked ?? (hasPlan ? 'plan' : 'all');

  const paywall = (
    <Pressable
      onPress={() => navigation.navigate('RecipeAccess')}
      style={[styles.paywall, { backgroundColor: colors.surface }, cardShadow(colors.shadow)]}
      accessibilityRole="button"
      accessibilityHint="Viser abonnementet på opskrifterne"
    >
      <Text style={[styles.paywallTitle, { color: colors.text }]}>Opskrifterne kræver et abonnement</Text>
      <Text style={[styles.paywallText, { color: colors.textMuted }]}>
        Se alle opskrifterne herunder. Med et abonnement kan du åbne dem, lægge varerne i kurven og
        få din egen madplan.
      </Text>
      <Text style={[styles.paywallLink, { color: colors.primaryDark }]}>Se abonnement</Text>
    </Pressable>
  );

  const segment = (
    <View style={[styles.segment, { backgroundColor: colors.segmentBg }]} accessibilityRole="tablist">
      {(
        [
          ['plan', 'Min madplan'],
          ['all', 'Alle opskrifter'],
        ] as [Tab, string][]
      ).map(([key, label]) => {
        const on = tab === key;
        return (
          <Pressable
            key={key}
            onPress={() => setPicked(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[
              styles.segmentBtn,
              on && { backgroundColor: colors.surface },
              on && cardShadow(colors.shadow),
            ]}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: on ? '700' : '500',
                color: on ? colors.text : colors.textMuted,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  if (tab === 'plan') {
    return (
      <TabScreenBody style={{ backgroundColor: colors.bg }}>
        {segment}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }}>
          {hasPlan && prefs ? (
            <MealPlanView
              recipes={recipes}
              prefs={prefs}
              onChange={changePrefs}
              onEdit={() => setEditing(true)}
              onOpen={openRecipe}
            />
          ) : (
            paywall
          )}
        </ScrollView>
      </TabScreenBody>
    );
  }

  const header = (
    <View>
      {locked ? paywall : null}
      <View style={[styles.search, { backgroundColor: colors.surface }, cardShadow(colors.shadow)]}>
        <Ionicons name="search" size={20} color={colors.textMuted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={`Søg i ${recipes.length} opskrifter`}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Søg i opskrifterne"
          returnKeyType="search"
          style={[styles.searchInput, { color: colors.text }]}
        />
      </View>
      {moodFilters.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
          keyboardShouldPersistTaps="handled"
        >
          {[{ key: null as string | null, label: 'Alle' }, ...moodFilters].map((m) => {
            const on = mood === m.key;
            return (
              <Pressable
                key={m.key ?? 'alle'}
                onPress={() => setMood(m.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[
                  styles.filter,
                  on
                    ? { backgroundColor: colors.primaryMuted, borderColor: colors.primaryMuted }
                    : { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: on ? '700' : '500',
                    color: on ? colors.primaryDark : colors.text,
                  }}
                >
                  {m.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
          Billigst denne uge
        </Text>
        <Text style={{ fontSize: 13, color: colors.textMuted }}>Med ugens tilbud</Text>
      </View>
    </View>
  );

  return (
    <TabScreenBody style={{ backgroundColor: colors.bg }}>
      {segment}
      {recipes.length === 0 ? (
        <View style={{ padding: 16 }}>
          <Text style={{ color: colors.textMuted }} accessibilityLiveRegion="polite">
            Ingen opskrifter endnu.
          </Text>
        </View>
      ) : (
        <FlatList
          ListHeaderComponent={header}
          ListEmptyComponent={
            <View style={{ padding: 16 }}>
              <Text style={{ color: colors.textMuted }} accessibilityLiveRegion="polite">
                Ingen opskrifter matcher din søgning.
              </Text>
            </View>
          }
          style={{ flex: 1 }}
          data={filtered}
          keyExtractor={(r) => String(r.id)}
          numColumns={2}
          columnWrapperStyle={{ paddingHorizontal: 10 }}
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          renderItem={({ item }) => <RecipeCard recipe={item} onPress={openRecipe} />}
        />
      )}
    </TabScreenBody>
  );
}

/** "Vi laver din madplan": tre trin der krydses af, mens en ring drejer. */
function ThinkingView({ prefs, onDone }: { prefs: MealPrefs; onDone: () => void }) {
  const { colors } = useTheme();
  const [done, setDone] = useState(0);
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    const timers = [
      setTimeout(() => setDone(1), 450),
      setTimeout(() => setDone(2), 900),
      setTimeout(onDone, 1400),
    ];
    return () => {
      loop.stop();
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const lines = [
    'Finder retter, der passer til jer',
    'Tjekker priserne i butikkerne',
    'Holder planen inden for budgettet',
  ];

  return (
    <View style={styles.thinking} accessibilityLiveRegion="polite">
      <View style={[styles.thinkCircle, { backgroundColor: colors.primaryMuted }]}>
        <Animated.View
          style={[
            styles.thinkRing,
            { borderColor: colors.border, borderTopColor: colors.primary, transform: [{ rotate }] },
          ]}
        />
        <Ionicons name="restaurant-outline" size={52} color={colors.primaryDark} />
      </View>
      <View style={{ alignItems: 'center' }}>
        <Text style={[styles.thinkTitle, { color: colors.text }]} accessibilityRole="header">
          Vi laver din madplan
        </Text>
        <Text style={{ fontSize: 15, color: colors.textMuted, marginTop: 8 }}>
          {prefs.people} {prefs.people === 1 ? 'person' : 'personer'} · {krRound(prefs.budget)}{' '}
          {BUDGET[prefs.budgetPeriod].label}
        </Text>
      </View>
      <View style={[styles.thinkCard, { backgroundColor: colors.surface }, cardShadow(colors.shadow)]}>
        {lines.map((t, i) => {
          const isDone = i < done;
          return (
            <View
              key={t}
              style={[
                styles.thinkRow,
                i < lines.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
              ]}
            >
              {isDone ? (
                <View style={[styles.thinkCheck, { backgroundColor: colors.primary }]}>
                  <Ionicons name="checkmark" size={15} color={colors.onPrimary} />
                </View>
              ) : (
                <Animated.View
                  style={[
                    styles.thinkSmallRing,
                    {
                      borderColor: i === done ? colors.primaryMuted : colors.border,
                      borderTopColor: i === done ? colors.primary : colors.border,
                      transform: i === done ? [{ rotate }] : [],
                    },
                  ]}
                />
              )}
              <Text
                style={{
                  flex: 1,
                  fontSize: 15,
                  fontWeight: i === done ? '700' : '600',
                  color: i === done ? colors.text : colors.textMuted,
                }}
              >
                {t}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  segment: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 2,
    padding: 4,
    gap: 4,
    borderRadius: 999,
  },
  segmentBtn: { flex: 1, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  paywall: { marginHorizontal: 16, marginTop: 14, padding: 18, borderRadius: 22 },
  paywallTitle: { fontSize: 16, fontWeight: '800' },
  paywallText: { fontSize: 14, lineHeight: 20, marginTop: 6 },
  paywallLink: { fontSize: 15, fontWeight: '700', marginTop: 10 },
  search: {
    height: 48,
    borderRadius: 999,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchInput: { flex: 1, fontSize: 15, height: 48 },
  filters: { paddingHorizontal: 16, gap: 8, paddingTop: 12 },
  filter: {
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 18,
    marginBottom: 4,
  },
  sectionTitle: { fontSize: 17, fontWeight: '800' },
  thinking: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 22 },
  thinkCircle: { width: 132, height: 132, borderRadius: 66, alignItems: 'center', justifyContent: 'center' },
  thinkRing: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    bottom: 8,
    borderRadius: 58,
    borderWidth: 4,
  },
  thinkTitle: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6, textAlign: 'center' },
  thinkCard: { alignSelf: 'stretch', borderRadius: 24, overflow: 'hidden' },
  thinkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  thinkCheck: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  thinkSmallRing: { width: 26, height: 26, borderRadius: 13, borderWidth: 3 },
});
