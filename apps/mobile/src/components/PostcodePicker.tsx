import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { lookupPostcode, type Pos } from '../location/nearby';
import { loadStoreLocations, savedPostcode, savePostcode } from '../location/storage';
import { useTheme } from '../theme/ThemeContext';

/**
 * Postnummer i stedet for telefonens placering (Feature-panelet 'lokation').
 * Telefonens placering kræver en ny opbygning af appen og kommer senere.
 * Et gemt postnummer bruges med det samme, når skærmen åbner.
 */
export function PostcodePicker({ onPos }: { onPos: (pos: Pos) => void }) {
  const { colors } = useTheme();
  const [pc, setPc] = React.useState('');
  const [msg, setMsg] = React.useState('');

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
    void savedPostcode().then((saved) => {
      if (saved) {
        setPc(saved);
        void find(saved);
      }
    });
    // Kun ved første visning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View>
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
          style={[styles.btn, { backgroundColor: colors.primary }]}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>Find</Text>
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
});
