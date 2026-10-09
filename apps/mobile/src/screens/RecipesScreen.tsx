import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { fetchRecipes, type Recipe } from '../api/recipes';
import { RecipeCard } from '../components/RecipeCard';
import { TabScreenBody } from '../components/ScreenBody';
import { MealPlanWizard } from '../recipes/MealPlanWizard';
import { MealPlanView } from '../recipes/MealPlanView';
import { defaultPrefs, loadPrefs, savePrefs, type MealPrefs } from '../recipes/mealPlan';
import { useRecipeAccess } from '../recipes/access';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from '../navigation/types';

/** Opskrift-fanen: EGEN søgning, adskilt fra SearchScreen (produkter).
 * Web-paritet med templates/opskrifter.html - søger kun i den allerede
 * hentede opskrift-liste (client-side substring på titel), aldrig produkter.
 *
 * Madplan: første gang stilles spørgsmålene (MealPlanWizard), bagefter står
 * planen øverst over listen (MealPlanView). Svarene gemmes kun på telefonen.
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
  // undefined = henter stadig de gemte svar, null = ingen svar endnu.
  const [prefs, setPrefs] = useState<MealPrefs | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [thinking, setThinking] = useState(false);
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

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return recipes;
    return recipes.filter((r) => r.title.toLowerCase().includes(query));
  }, [recipes, q]);

  const openRecipe = (r: Recipe) =>
    locked ? navigation.navigate('RecipeAccess') : navigation.navigate('RecipeDetail', { recipeId: r.id });

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
            setThinking(true);
            setTimeout(() => setThinking(false), 1100);
          }}
        />
      </TabScreenBody>
    );
  }

  if (thinking) {
    return (
      <TabScreenBody style={{ backgroundColor: colors.bg }}>
        <View style={styles.thinking} accessibilityLiveRegion="polite">
          <View style={[styles.thinkingIcon, { backgroundColor: colors.primaryMuted }]}>
            <Text style={{ fontSize: 40 }}>🛒</Text>
          </View>
          <Text style={[styles.thinkingTitle, { color: colors.text }]}>Vi laver din madplan</Text>
          {[
            'Finder opskrifter der passer til jer',
            'Tjekker priserne i butikkerne',
            'Holder planen inden for budgettet',
          ].map((t) => (
            <View key={t} style={styles.thinkingRow}>
              <View style={[styles.thinkingCheck, { backgroundColor: colors.primarySolid }]}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text>
              </View>
              <Text style={{ color: colors.text, fontSize: 15 }}>{t}</Text>
            </View>
          ))}
          <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
        </View>
      </TabScreenBody>
    );
  }

  const searchInput = (
    <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Søg efter opskrifter…"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="Søg efter opskrifter"
        style={[
          styles.input,
          { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border },
        ]}
      />
  );

  const header = (
    <View>
      {locked ? (
        <Pressable
          onPress={() => navigation.navigate('RecipeAccess')}
          style={[styles.paywall, { borderColor: colors.primary, backgroundColor: colors.surface }]}
          accessibilityRole="button"
          accessibilityHint="Viser abonnementet på opskrifterne"
        >
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>Opskrifterne kræver et abonnement</Text>
          <Text style={{ color: colors.textMuted, marginTop: 4, lineHeight: 19 }}>
            Se alle opskrifterne herunder. Med et abonnement kan du åbne dem, lægge varerne i kurven og
            få din egen madplan.
          </Text>
          <Text style={{ color: colors.primary, fontWeight: '700', marginTop: 8 }}>Se abonnement</Text>
        </Pressable>
      ) : prefs ? (
        <MealPlanView
          recipes={recipes}
          prefs={prefs}
          onChange={changePrefs}
          onEdit={() => setEditing(true)}
          onOpen={openRecipe}
        />
      ) : null}
      {searchInput}
    </View>
  );

  return (
    <TabScreenBody style={{ backgroundColor: colors.bg }}>
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
          columnWrapperStyle={{ paddingHorizontal: 2 }}
          contentContainerStyle={{ padding: 4 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          renderItem={({ item }) => <RecipeCard recipe={item} onPress={openRecipe} />}
        />
      )}
    </TabScreenBody>
  );
}

const styles = StyleSheet.create({
  thinking: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  thinkingTitle: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  thinkingIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', paddingHorizontal: 24 },
  thinkingCheck: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  paywall: { margin: 12, marginBottom: 0, padding: 14, borderRadius: 12, borderWidth: 2 },
  input: {
    margin: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
});
