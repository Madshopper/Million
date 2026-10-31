import React from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, cardShadow } from '../theme/Typography';
import { Ionicons } from '@expo/vector-icons';
import type { Recipe } from '../api/recipes';
import { useTheme } from '../theme/ThemeContext';
import { joinLabel, spokenKr } from '../a11y/speech';
import { ShelfPrice } from './ShelfPrice';

type Props = {
  recipe: Recipe;
  onPress: (recipe: Recipe) => void;
  /** Falsk = teaser ("hvad er på vej"): kortet kan ikke trykkes på, og
   * pille/ingrediens-linje/pris erstattes af "Kommer snart". Nøjagtig samme
   * felt-for-felt-adfærd som webbens recipe_card(clickable=false). */
  clickable?: boolean;
};

/** Opskriftskortet i C2 (31-10-2026): samme form som varekortet
 * (ProductCard), men egen komponent - en opskrift har ingen butik eller
 * kurv-knap på selve kortet (web-paritet, se templates/macros/recipe_card.html). */
export function RecipeCard({ recipe, onPress, clickable = true }: Props) {
  const { colors } = useTheme();
  const salePct = recipe.sale_ratio > 0 ? Math.floor(recipe.sale_ratio * 100) : null;
  const people = recipe.servings && recipe.servings > 0 ? recipe.servings : 4;

  // Ét samlet element for VoiceOver i stedet for løse tekster.
  const a11yLabel = clickable
    ? joinLabel([
        recipe.title,
        salePct ? `${salePct} procent på tilbud` : null,
        recipe.total_time_minutes ? `${recipe.total_time_minutes} minutter` : null,
        recipe.total_ingredient_count
          ? `${recipe.matched_ingredient_count} af ${recipe.total_ingredient_count} varer fundet`
          : null,
        recipe.cheapest_total_price
          ? `cirka ${spokenKr(recipe.cheapest_total_price)} til ${people} personer`
          : 'pris ukendt',
      ])
    : joinLabel([recipe.title, 'kommer snart']);

  const body = (
    <>
      <View style={[styles.imageWrap, { backgroundColor: colors.primaryMuted }]}>
        {recipe.image_url ? (
          <Image source={{ uri: recipe.image_url }} style={styles.image} resizeMode="cover" />
        ) : (
          // Egne opskrifter (data/egne_opskrifter.json) har intet foto: samme
          // bestik-ikon som webbens static/images/opskrift-standard.svg.
          <View style={styles.imagePlaceholder} accessible={false}>
            <Ionicons name="restaurant-outline" size={40} color={colors.primaryDark} />
          </View>
        )}
        {clickable && salePct ? (
          <View style={[styles.salePill, { backgroundColor: colors.deal }]}>
            <Text style={[styles.salePillText, { color: colors.dealText }]}>{salePct}% på tilbud</Text>
          </View>
        ) : null}
        {clickable && recipe.total_time_minutes ? (
          <View style={[styles.timePill, { backgroundColor: colors.surface }]}>
            <Ionicons name="time-outline" size={12} color={colors.text} />
            <Text style={[styles.timeText, { color: colors.text }]}>{recipe.total_time_minutes} min</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.content}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
          {recipe.title}
        </Text>
        {clickable && recipe.total_ingredient_count ? (
          <Text style={[styles.meta, { color: colors.textMuted }]}>
            {recipe.matched_ingredient_count} af {recipe.total_ingredient_count} varer fundet
          </Text>
        ) : null}
        {!clickable ? (
          <Text style={[styles.soon, { color: colors.textMuted }]}>Kommer snart</Text>
        ) : recipe.cheapest_total_price ? (
          <View style={styles.priceRow}>
            <Text style={[styles.priceSmall, { color: colors.textMuted }]}>ca.</Text>
            <ShelfPrice value={recipe.cheapest_total_price} color={colors.text} size={26} />
            <Text style={[styles.priceSmall, { color: colors.textMuted, marginLeft: 4 }]}>/ {people} pers.</Text>
          </View>
        ) : (
          <Text style={[styles.soon, { color: colors.textMuted }]}>Pris ukendt</Text>
        )}
      </View>
    </>
  );

  const cardStyle = [styles.card, { backgroundColor: colors.surface }, cardShadow(colors.shadow)];

  // View, ikke en deaktiveret TouchableOpacity: teaseren skal hverken kunne
  // trykkes, give tryk-feedback eller optræde som knap for VoiceOver -
  // svarer til at webben renderer <div> i stedet for <a>.
  if (!clickable) {
    return (
      <View accessible accessibilityLabel={a11yLabel} style={cardStyle}>
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
      style={cardStyle}
    >
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 22,
    margin: 6,
    paddingBottom: 12,
  },
  imageWrap: {
    marginTop: 8,
    marginHorizontal: 8,
    height: 120,
    borderRadius: 16,
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  salePill: {
    position: 'absolute',
    top: 8,
    left: 8,
    height: 22,
    borderRadius: 999,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  salePillText: { fontSize: 12, fontWeight: '800' },
  timePill: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    height: 24,
    borderRadius: 999,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeText: { fontSize: 12, fontWeight: '700' },
  content: { paddingTop: 8, paddingHorizontal: 12 },
  name: { fontSize: 14, fontWeight: '600', lineHeight: 18, minHeight: 36 },
  meta: { fontSize: 12, marginTop: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 3, marginTop: 8 },
  priceSmall: { fontSize: 12, marginTop: 5 },
  soon: { fontSize: 15, fontWeight: '700', marginTop: 10 },
});
