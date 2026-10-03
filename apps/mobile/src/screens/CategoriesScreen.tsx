import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CATEGORY_LINKS } from '../categories/categories';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from '../navigation/types';

/**
 * Oversigt over alle kategorier som et gitter, åbnet fra forsidens
 * "Kategorier"-knap. Bevidst neutrale farver (ikke grøn): kun Ugens Tilbud
 * får tilbudsfarven gul, så den skiller sig ud.
 */
export function CategoriesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
    >
      <View style={styles.grid}>
        {CATEGORY_LINKS.map((c) => {
          const isSale = c.slug === 'sale';
          return (
            <View key={c.slug} style={styles.cell}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={c.label}
                onPress={() => {
                  // replace: tilbage fra kategorien går til forsiden, ikke
                  // tilbage til oversigten.
                  if (isSale) navigation.replace('Sale');
                  else navigation.replace('Category', { slug: c.slug, title: c.label });
                }}
                style={({ pressed }) => [
                  styles.card,
                  {
                    backgroundColor: isSale ? colors.warningMuted : colors.surface,
                    borderColor: isSale ? colors.warning : colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={c.icon}
                  size={28}
                  color={isSale ? colors.warning : colors.textMuted}
                />
                <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
                  {c.label}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 10, paddingBottom: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '50%', padding: 6 },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 10,
  },
  label: { fontSize: 15, fontWeight: '700' },
});
