import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Recipe } from '../api/recipes';
import { useTheme } from '../theme/ThemeContext';
import { joinLabel, spokenKr } from '../a11y/speech';

type Props = {
  recipe: Recipe;
  onPress: (recipe: Recipe) => void;
  /** Falsk = teaser ("hvad er på vej"): kortet kan ikke trykkes på, og
   * badge/ingrediens-linje/pris erstattes af "Kommer snart". Nøjagtig samme
   * felt-for-felt-adfærd som webbens recipe_card(clickable=false). */
  clickable?: boolean;
};

/** Visuelt beslægtet med ProductCard, men egen komponent - en opskrift har
 * ingen butik/store_matches/kurv-knap på selve kortet (web-paritet, se
 * templates/macros/recipe_card.html for hvorfor .product ikke genbruges). */
export function RecipeCard({ recipe, onPress, clickable = true }: Props) {
  const { colors, isDark } = useTheme();
  const salePct = recipe.sale_ratio > 0 ? Math.floor(recipe.sale_ratio * 100) : null;

  // Ét samlet element for VoiceOver i stedet for fire løse tekster.
  const a11yLabel = clickable
    ? joinLabel([
        recipe.title,
        salePct ? `${salePct} procent på tilbud` : null,
        recipe.total_ingredient_count
          ? `${recipe.matched_ingredient_count} af ${recipe.total_ingredient_count} ingredienser fundet`
          : null,
        recipe.cheapest_total_price
          ? `cirka ${spokenKr(recipe.cheapest_total_price)}`
          : 'pris ukendt',
      ])
    : joinLabel([recipe.title, 'kommer snart']);

  const body = (
    <>
      <View style={[styles.imageWrap, { backgroundColor: isDark ? '#252825' : '#F3F5F0' }]}>
        {clickable && salePct ? (
          <View style={styles.saleBadge}>
            <Text style={styles.saleText}>{salePct}% på tilbud</Text>
          </View>
        ) : null}
        {recipe.image_url ? (
          <Image source={{ uri: recipe.image_url }} style={styles.image} resizeMode="cover" />
        ) : (
          // Egne opskrifter (data/egne_opskrifter.json) har intet foto: samme
          // bestik-ikon som webbens static/images/opskrift-standard.svg.
          <View
            style={[styles.imagePlaceholder, { backgroundColor: isDark ? '#1F3A2E' : '#D6F5E3' }]}
            accessible={false}
          >
            <Ionicons name="restaurant-outline" size={40} color={isDark ? '#D6F5E3' : '#047857'} />
          </View>
        )}
      </View>
      <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
        {recipe.title}
      </Text>
      {clickable && recipe.total_ingredient_count ? (
        <Text style={[styles.meta, { color: colors.textMuted }]}>
          {recipe.matched_ingredient_count}/{recipe.total_ingredient_count} ingredienser fundet
        </Text>
      ) : null}
      {clickable ? (
        <Text style={[styles.price, { color: colors.text }]}>
          {recipe.cheapest_total_price
            ? `~${recipe.cheapest_total_price.toFixed(2)} kr`
            : 'Pris ukendt'}
        </Text>
      ) : (
        <Text style={[styles.price, { color: colors.textMuted }]}>Kommer snart</Text>
      )}
    </>
  );

  // View, ikke en deaktiveret TouchableOpacity: teaseren skal hverken kunne
  // trykkes, give haptisk/visuelt tryk-feedback eller optræde som knap for
  // VoiceOver - svarer til at webben renderer <div> i stedet for <a>.
  if (!clickable) {
    return (
      <View
        accessible
        accessibilityLabel={a11yLabel}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        {body}
      </View>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      delayPressIn={80}
      onPress={() => onPress(recipe)}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint="Åbner opskriften"
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingTop: 10,
    paddingHorizontal: 10,
    paddingBottom: 12,
    marginHorizontal: 3,
    marginVertical: 4,
    overflow: 'hidden',
  },
  imageWrap: {
    height: 118,
    marginBottom: 8,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  saleBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 2,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#DFA300',
  },
  saleText: { color: '#1A1C19', fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
  name: { fontSize: 14, fontWeight: '600', minHeight: 36 },
  meta: { fontSize: 11, marginTop: 4 },
  price: { fontSize: 16, fontWeight: '700', marginTop: 6 },
});
