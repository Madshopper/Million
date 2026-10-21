import React from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../theme/Typography';
import { address, fmtKm, mapsUrl, planRoute, type Place, type Pos } from '../location/nearby';
import { loadStoreLocations } from '../location/storage';
import type { StoreInfo } from '../api/types';
import { useTheme } from '../theme/ThemeContext';
import { OsmCredit, PostcodePicker } from './PostcodePicker';

/**
 * "Hvilken rækkefølge?" i Butiksrute (Feature-panelet 'lokation'): nærmeste
 * butik af hver kæde og den korteste tur, samme som hjemmesidens lokation.js.
 * onOrder får kædernes navne i turens rækkefølge, så varerne kan følge med.
 */
export function RouteOrder({
  labels,
  catalog,
  onOrder,
}: {
  labels: string[];
  catalog: StoreInfo[];
  onOrder: (ordered: string[]) => void;
}) {
  const { colors } = useTheme();
  const [plan, setPlan] = React.useState<{ pos: Pos; km: number; stops: Place[] } | null>(null);
  const [msg, setMsg] = React.useState('');
  const [showAll, setShowAll] = React.useState(false);
  const labelOf = (key: string) => catalog.find((s) => s.key === key)?.label || key;

  const onPos = React.useCallback(
    async (pos: Pos) => {
      setMsg('');
      try {
        const data = await loadStoreLocations();
        const keys = labels
          .map((l) => catalog.find((s) => s.label === l)?.key)
          .filter((k): k is string => !!k);
        const p = planRoute(data, pos, keys, pos.precise);
        if (!p) {
          setPlan(null);
          setMsg('Vi fandt ingen af butikkerne i nærheden.');
          return;
        }
        setPlan({ pos, ...p });
        onOrder(p.stops.map((s) => catalog.find((c) => c.key === s.key)?.label || s.key));
      } catch {
        setMsg('Butikslisten kunne ikke hentes. Prøv igen.');
      }
    },
    [labels, catalog, onOrder],
  );

  return (
    <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }} accessibilityRole="header">
        Hvilken rækkefølge?
      </Text>
      <Text style={{ color: colors.textMuted, marginVertical: 6 }}>
        Skriv dit postnummer, så finder vi de nærmeste butikker og den korteste tur. Er du logget ind,
        gemmes postnummeret på din konto. Din placering gemmes ikke.
      </Text>
      <PostcodePicker onPos={(p) => void onPos(p)} />
      {msg ? <Text style={{ color: colors.textMuted, marginTop: 8 }}>{msg}</Text> : null}
      {plan ? (
        <View style={{ marginTop: 12 }}>
          {(showAll || plan.stops.length <= SHOWN + 1 ? plan.stops : plan.stops.slice(0, SHOWN)).map((s, i) => (
            <View
              key={`${s.key}-${i}`}
              style={styles.stop}
              accessible
              accessibilityLabel={`Nummer ${i + 1}: ${labelOf(s.key)}, ${address(s)}, ${fmtKm(s.dist)} fra ${plan.pos.label}`}
            >
              <View style={[styles.nr, { backgroundColor: colors.primary }]}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{labelOf(s.key)}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>{address(s)}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                  {fmtKm(s.dist)} fra {plan.pos.label}
                </Text>
              </View>
            </View>
          ))}
          {plan.stops.length > SHOWN + 1 ? (
            <Pressable onPress={() => setShowAll((v) => !v)} accessibilityRole="button" style={{ paddingVertical: 4 }}>
              <Text style={{ color: colors.primary, fontWeight: '700' }}>
                {showAll ? 'Vis færre' : `Vis alle ${plan.stops.length} butikker`}
              </Text>
            </Pressable>
          ) : null}
          <Text style={{ color: colors.text, marginVertical: 6 }}>
            Turen er ca. {fmtKm(plan.km)} i fugleflugt.
          </Text>
          <Pressable
            onPress={() => void Linking.openURL(mapsUrl(plan.pos, plan.stops, plan.pos.precise))}
            accessibilityRole="link"
            style={[styles.maps, { backgroundColor: colors.primary }]}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Åbn turen i Google Maps</Text>
          </Pressable>
          <OsmCredit />
        </View>
      ) : null}
    </View>
  );
}

// Kun de første butikker vises, så kurvens varer kommer hurtigt til syne.
const SHOWN = 3;

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16 },
  stop: { flexDirection: 'row', gap: 10, marginBottom: 10, alignItems: 'flex-start' },
  nr: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  maps: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
});
