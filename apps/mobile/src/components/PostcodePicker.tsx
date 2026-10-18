import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../theme/Typography';
import { lookupPostcode, type Pos } from '../location/nearby';
import { loadStoreLocations, savedPostcode, savePostcode } from '../location/storage';
import { canUseDeviceLocation, devicePosition, devicePositionIfAllowed } from '../location/device';
import { useTheme } from '../theme/ThemeContext';

/**
 * "Brug min placering" eller postnummer (Feature-panelet 'lokation'). Telefonen
 * spørger selv om lov første gang man trykker på knappen. Har man sagt ja,
 * bruges placeringen af sig selv, når skærmen åbner; ellers et gemt postnummer.
 */
export function PostcodePicker({ onPos }: { onPos: (pos: Pos) => void }) {
  const { colors } = useTheme();
  const [pc, setPc] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const gps = canUseDeviceLocation();

  const useDevice = React.useCallback(async () => {
    setMsg('Finder din placering…');
    try {
      const pos = await devicePosition();
      setMsg('');
      onPos(pos);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Noget gik galt. Prøv igen.');
    }
  }, [onPos]);

  const find = React.useCallback(
    async (value: string) => {
      const v = value.trim();
      setMsg('');
      try {
        const data = await loadStoreLocations();
        const pos = lookupPostcode(data, v);
        if (!pos) {
          setMsg(`Vi kender ikke postnummeret ${v}. Tjek at det har 4 cifre.`);
          return;
        }
        await savePostcode(v);
        onPos(pos);
      } catch {
        setMsg('Butikslisten kunne ikke hentes. Prøv igen.');
      }
    },
    [onPos],
  );

  React.useEffect(() => {
    // Har man givet lov til placering, bruges den, så det passer, også når man
    // er et andet sted end hjemme. Ellers det gemte postnummer.
    void (async () => {
      const saved = await savedPostcode();
      if (saved) setPc(saved);
      const here = await devicePositionIfAllowed();
      if (here) onPos(here);
      else if (saved) void find(saved);
    })();
    // Kun ved første visning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View>
      {gps ? (
        <>
          <Pressable
            onPress={() => void useDevice()}
            accessibilityRole="button"
            style={[styles.btn, styles.gpsBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Brug min placering</Text>
          </Pressable>
          <Text style={{ color: colors.textMuted, marginVertical: 6 }}>eller skriv dit postnummer</Text>
        </>
      ) : null}
      <View style={styles.row}>
        <TextInput
          value={pc}
          onChangeText={(t) => setPc(t.replace(/\D/g, '').slice(0, 4))}
          onSubmitEditing={() => void find(pc)}
          placeholder="Postnummer"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          returnKeyType="search"
          maxLength={4}
          accessibilityLabel="Postnummer"
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
        />
        <Pressable
          onPress={() => void find(pc)}
          accessibilityRole="button"
          style={[styles.btn, gps ? { borderWidth: 1, borderColor: colors.border } : { backgroundColor: colors.primary }]}
        >
          <Text style={{ color: gps ? colors.text : '#fff', fontWeight: '700' }}>Find</Text>
        </Pressable>
      </View>
      {msg ? (
        <Text style={{ color: colors.textMuted, marginTop: 6 }} accessibilityLiveRegion="polite">
          {msg}
        </Text>
      ) : null}
    </View>
  );
}

export function OsmCredit() {
  const { colors } = useTheme();
  return (
    <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 10 }}>
      Butikkernes adresser: © OpenStreetMap-bidragydere
    </Text>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, width: 130, fontSize: 16 },
  btn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11 },
  gpsBtn: { alignSelf: 'flex-start' },
});
