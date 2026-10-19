/**
 * "Køb igen" i Søg og "Glemt noget?" nederst i kurven (C2, 19-10-2026).
 * Data: de varer man oftest selv har lagt i kurven (cart/recentItems.ts, kun på
 * telefonen). Uden data vises intet.
 */
import React from 'react';
import { AccessibilityInfo, Image, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, cardShadow } from '../theme/Typography';
import { useTheme } from '../theme/ThemeContext';
import { useCart } from '../cart/CartContext';
import type { RecentItem } from '../cart/recentItems';
import { cartItemTitle } from '../cart/stripStoreBrand';
import { StoreLogo } from '../stores/storeLogos';
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

function timesLabel(n: number): string {
  return n === 1 ? 'Købt 1 gang' : `Købt ${n} gange`;
}

/** Ét hvidt kort med rækker: billede, navn, butik + "Købt N gange", pris og "+". */
export function BuyAgainCard({ items }: { items: RecentItem[] }) {
  const { colors } = useTheme();
  const add = useAddAgain();
  if (!items.length) return null;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, cardShadow(colors.shadow)]}>
      {items.map((r, i) => {
        const title = cartItemTitle(r);
        const times = r.timesAdded ?? 1;
        return (
          <View key={r.id}>
            {i > 0 ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
            <View style={styles.row}>
              <View
                style={[styles.thumb, { backgroundColor: colors.logoBg }]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {r.image ? <Image source={{ uri: r.image }} style={styles.thumbImg} resizeMode="contain" /> : null}
              </View>
              <View
                style={styles.body}
                accessible
                accessibilityLabel={`${title}, ${r.store}, ${timesLabel(times).toLowerCase()}, ${spokenKr(r.price)}`}
              >
                <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                  {title}
                </Text>
                <View style={styles.metaRow}>
                  <View style={[styles.logoPill, { backgroundColor: colors.logoBg, borderColor: colors.border }]}>
                    <StoreLogo store={r.store} maxHeight={14} minHeight={9} maxWidth={40} />
                  </View>
                  <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
                    {timesLabel(times)}
                  </Text>
                </View>
              </View>
              <Text style={[styles.price, { color: colors.text }]} importantForAccessibility="no">
                {kr(r.price)}
              </Text>
              <Pressable
                onPress={() => add(r)}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={`Læg ${title} i kurv`}
                style={({ pressed }) => [
                  styles.plus,
                  { backgroundColor: colors.primaryMuted, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Ionicons name="add" size={22} color={colors.primaryDark} />
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
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
  card: { borderRadius: 24, paddingVertical: 4 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 76 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImg: { width: 44, height: 44 },
  body: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontSize: 14, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  logoPill: {
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { fontSize: 12, flexShrink: 1 },
  price: { fontSize: 15, fontWeight: '800' },
  plus: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
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
