/**
 * "Glemt noget?" nederst i kurven (C2, 19-10-2026). "Køb igen" i Søg er
 * fjernet igen (Kalle 21-10-2026): det vises kun i kurven.
 * Data: de varer man oftest selv har lagt i kurven (cart/recentItems.ts, kun på
 * telefonen). Uden data vises intet.
 */
import React from 'react';
import { AccessibilityInfo, Image, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../theme/Typography';
import { useTheme } from '../theme/ThemeContext';
import { useCart } from '../cart/CartContext';
import type { RecentItem } from '../cart/recentItems';
import { cartItemTitle } from '../cart/stripStoreBrand';
import { kr } from './ShelfPrice';
import { spokenKr } from '../a11y/speech';

function useAddAgain() {
  const { addItem } = useCart();
  return (r: RecentItem) => {
    const { timesAdded: _t, ...item } = r;
    addItem(item);
    AccessibilityInfo.announceForAccessibility(`${cartItemTitle(r)} lagt i kurven`);
  };
}

/** To hvide piller side om side: lille billede, navn, pris og en grøn "+" (kurvens bund). */
export function ForgotPills({ items }: { items: RecentItem[] }) {
  const { colors } = useTheme();
  const add = useAddAgain();
  return (
    <View style={styles.pills}>
      {items.map((r) => {
        const title = cartItemTitle(r);
        return (
          <Pressable
            key={r.id}
            onPress={() => add(r)}
            accessibilityRole="button"
            accessibilityLabel={`Læg ${title} i kurv, ${spokenKr(r.price)}`}
            style={({ pressed }) => [
              styles.pill,
              { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <View style={[styles.pillImgWrap, { backgroundColor: colors.logoBg }]}>
              {r.image ? <Image source={{ uri: r.image }} style={styles.pillImg} resizeMode="contain" /> : null}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.pillName, { color: colors.text }]} numberOfLines={1}>
                {title}
              </Text>
              <Text style={[styles.pillPrice, { color: colors.text }]}>{kr(r.price).replace(' kr', '')}</Text>
            </View>
            <View style={[styles.pillPlus, { backgroundColor: colors.primary }]}>
              <Ionicons name="add" size={18} color={colors.onPrimary} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', gap: 10 },
  pill: {
    flex: 1,
    minWidth: 0,
    height: 56,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
  },
  pillImgWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillImg: { width: 36, height: 36 },
  pillName: { fontSize: 12, fontWeight: '600' },
  pillPrice: { fontSize: 12, fontWeight: '800' },
  pillPlus: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
