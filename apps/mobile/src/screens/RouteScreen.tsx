import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { calculateButiksrute, type RouteResult } from '../cart/butiksrute';
import { useCart } from '../cart/CartContext';
import { useStoreCatalog } from '../stores/StoreCatalogContext';
import { useTheme } from '../theme/ThemeContext';
import { StoreChip } from '../components/StoreChip';
import { joinLabel, spokenKr } from '../a11y/speech';

export function RouteScreen() {
  const { colors } = useTheme();
  const { items } = useCart();
  const { catalog, selectedLabels, ready } = useStoreCatalog();
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<RouteResult | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!items.length) {
      setRoute(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void calculateButiksrute(items, catalog, selectedLabels)
      .then(setRoute)
      .finally(() => setLoading(false));
  }, [ready, items, catalog, selectedLabels]);

  if (!ready || loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.primary} accessibilityLabel="Beregner rute" />
      </View>
    );
  }

  if (!items.length || !route) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <Text style={{ color: colors.textMuted }}>Kurven er tom</Text>
      </View>
    );
  }

  const groups = [...route.groups].sort((a, b) => b.subtotal - a.subtotal);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Text style={{ color: colors.textMuted, marginBottom: 12 }}>
        Billigste butik pr. vare, splittet på tværs af butikker
      </Text>

      <View
        style={[styles.totalBox, { backgroundColor: colors.primaryMuted }]}
        accessible
        accessibilityLabel={joinLabel([
          `Rutens total: ${spokenKr(route.routeTotal)}`,
          route.savings > 0.05 && route.singleCheapest
            ? `Du sparer ${spokenKr(route.savings)} i forhold til kun ${route.singleCheapest.name}`
            : null,
        ])}
      >
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>Rutens total</Text>
        <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 22, marginTop: 4 }}>
          {route.routeTotal.toFixed(2)} kr
        </Text>
        {route.savings > 0.05 && route.singleCheapest ? (
          <Text style={{ color: colors.badge, marginTop: 6, fontWeight: '600' }}>
            Du sparer {route.savings.toFixed(2)} kr i forhold til kun {route.singleCheapest.name}
          </Text>
        ) : null}
      </View>

      {groups.map((g) => (
        <View
          key={g.store}
          style={[
            styles.storeBlock,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View
            style={styles.storeHead}
            accessible
            accessibilityRole="header"
            accessibilityLabel={`${g.store}, ${spokenKr(g.subtotal)}`}
          >
            <StoreChip store={g.store} size="md" />
            <Text style={{ color: colors.text, fontWeight: '700' }}>{g.subtotal.toFixed(2)} kr</Text>
          </View>
          {g.items.map((ri, idx) => (
            <View
              key={`${ri.item.id}-${idx}`}
              style={styles.itemRow}
              accessible
              accessibilityLabel={joinLabel([
                ri.displayName,
                `${ri.item.quantity} stk à ${spokenKr(ri.price)}`,
                `i alt ${spokenKr(ri.price * ri.item.quantity)}`,
              ])}
            >
              {ri.item.image ? (
                <Image source={{ uri: ri.item.image }} style={styles.itemImg} resizeMode="contain" />
              ) : null}
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text }} numberOfLines={2}>
                  {ri.displayName}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                  {ri.item.quantity} × {ri.price.toFixed(2)} kr
                </Text>
              </View>
              <Text style={{ color: colors.text, fontWeight: '600' }}>
                {(ri.price * ri.item.quantity).toFixed(2)} kr
              </Text>
            </View>
          ))}
        </View>
      ))}

      {route.unavailable.length > 0 ? (
        <View style={[styles.storeBlock, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text
            style={[styles.storeName, { color: colors.text, marginBottom: 8 }]}
            accessibilityRole="header"
          >
            Ikke tilgængelig i dine valgte butikker
          </Text>
          {route.unavailable.map((item, idx) => (
            <View key={`${item.id}-${idx}`} style={styles.itemRow}>
              {item.image ? (
                <Image source={{ uri: item.image }} style={styles.itemImg} resizeMode="contain" />
              ) : null}
              <Text style={{ color: colors.textMuted, flex: 1 }} numberOfLines={2}>
                {item.name}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  totalBox: { padding: 16, borderRadius: 12, marginBottom: 16 },
  storeBlock: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  storeHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  storeName: { fontSize: 16, fontWeight: '700' },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 10,
  },
  itemImg: { width: 32, height: 32 },
});
