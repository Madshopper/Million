import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { fmtKm, nearbyChains, type NearbyChain, type Pos } from '../location/nearby';
import { loadStoreLocations } from '../location/storage';
import type { RootStackParamList } from '../navigation/types';
import { useStoreCatalog } from '../stores/StoreCatalogContext';
import { useTheme } from '../theme/ThemeContext';
import { OsmCredit, PostcodePicker } from '../components/PostcodePicker';

/**
 * Butikker nær mig (Feature-panelet 'lokation'): fra Indstillinger, og én gang
 * lige efter man har oprettet en profil (welcome). Samme som hjemmesidens
 * lokation.js::openNearby.
 */
export function NearbyStoresScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'Nearby'>>();
  const welcome = !!route.params?.welcome;
  const { catalog, setSelected } = useStoreCatalog();
  const [pos, setPos] = React.useState<Pos | null>(null);
  const [rows, setRows] = React.useState<NearbyChain[]>([]);
  const [radius, setRadius] = React.useState(0);
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [msg, setMsg] = React.useState('');
  const labelOf = (key: string) => catalog.find((s) => s.key === key)?.label || key;

  const onPos = React.useCallback(
    async (p: Pos) => {
      setMsg('');
      try {
        const data = await loadStoreLocations();
        const near = nearbyChains(data, p, catalog.map((s) => s.key));
        setPos(p);
        setRows(near.stores);
        setRadius(near.radius);
        setChosen(new Set(near.stores.filter((s) => s.near).map((s) => s.key)));
      } catch {
        setMsg('Butikslisten kunne ikke hentes. Prøv igen.');
      }
    },
    [catalog],
  );

  const save = () => {
    const labels = rows.filter((r) => chosen.has(r.key)).map((r) => labelOf(r.key));
    if (!labels.length) {
      setMsg('Vælg mindst én butik.');
      return;
    }
    setSelected(labels);
    navigation.goBack();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={[styles.h, { color: colors.text }]} accessibilityRole="header">
        {welcome ? 'Hvor handler du?' : 'Butikker nær dig'}
      </Text>
      <Text style={{ color: colors.textMuted, marginBottom: 12 }}>
        {welcome
          ? 'Så viser vi kun priser fra de butikker, der ligger tæt på dig. Du kan altid ændre det under Indstillinger.'
          : 'Vi slår de butikker til, der ligger tæt på dig, og resten fra. Du kan stadig ændre det bagefter.'}{' '}
        Er du logget ind, gemmes postnummeret på din konto. Din placering gemmes ikke.
      </Text>
      <PostcodePicker onPos={(p) => void onPos(p)} />
      {msg ? <Text style={{ color: colors.textMuted, marginTop: 8 }}>{msg}</Text> : null}

      {pos && rows.length ? (
        <>
          <Text style={{ color: colors.text, fontWeight: '600', marginTop: 16, marginBottom: 6 }}>
            Tæt på {pos.label} (inden for {radius} km):
          </Text>
          {rows.map((r) => (
            <View key={r.key} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ color: colors.text, flex: 1 }} accessibilityElementsHidden importantForAccessibility="no">
                {labelOf(r.key)}
              </Text>
              <Text style={{ color: colors.textMuted, marginRight: 10 }} accessibilityElementsHidden importantForAccessibility="no">
                {fmtKm(r.dist)}
              </Text>
              <Switch
                value={chosen.has(r.key)}
                onValueChange={(v) => {
                  const next = new Set(chosen);
                  if (v) next.add(r.key);
                  else next.delete(r.key);
                  setChosen(next);
                }}
                accessibilityLabel={`${labelOf(r.key)}, ${fmtKm(r.dist)} væk`}
              />
            </View>
          ))}
          <Pressable onPress={save} accessibilityRole="button" style={[styles.save, { backgroundColor: colors.primary }]}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Brug de valgte butikker</Text>
          </Pressable>
          <OsmCredit />
        </>
      ) : null}

      {welcome ? (
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" style={{ marginTop: 16, alignSelf: 'center' }} hitSlop={8}>
          <Text style={{ color: colors.primary }}>Spring over</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h: { fontSize: 20, fontWeight: '800', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 6 },
  save: { borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
});
