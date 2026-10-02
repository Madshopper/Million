import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { useStoreCatalog } from '../stores/StoreCatalogContext';
import { useTheme } from '../theme/ThemeContext';

/**
 * Indstillinger - åbnes fra Profil-fanen (ProfileScreen), ikke længere en fane
 * for sig. Her ligger det, der handler om hvordan appen opfører sig (tema,
 * standardbutikker) og den destruktive kontosletning; alt der handler om
 * brugeren selv (navn, delt kurv, prisalarmer) ligger på Profil.
 */
export function SettingsScreen() {
  const { colors, mode, setMode } = useTheme();
  const { catalog, selectedLabels, toggleStore, selectAll } = useStoreCatalog();
  const { user, deleteAccount } = useAuth();
  const [deleting, setDeleting] = React.useState(false);

  // Apple Guideline 5.1.1(v): sletning skal kunne startes inde i appen.
  const confirmDelete = React.useCallback(() => {
    Alert.alert(
      'Slet konto',
      'Din konto, din gemte kurv og din besparelseshistorik slettes permanent. Det kan ikke fortrydes.',
      [
        { text: 'Annullér', style: 'cancel' },
        {
          text: 'Slet konto',
          style: 'destructive',
          onPress: () => {
            setDeleting(true);
            void deleteAccount()
              .then((err) => {
                if (err) Alert.alert('Kunne ikke slette kontoen', err);
                else Alert.alert('Konto slettet', 'Din konto og dine data er slettet.');
              })
              .finally(() => setDeleting(false));
          },
        },
      ],
    );
  }, [deleteAccount]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Text style={[styles.h, { color: colors.text }]}>Udseende</Text>
      {/* ThemeContext understøttede allerede "system" — kun UI'et manglede en
          vej til det (fundet under paritetsrevisionen 2026-08-17). */}
      <View style={[styles.row, styles.themeRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {(
          [
            ['system', 'Følg system'],
            ['light', 'Lys'],
            ['dark', 'Mørk'],
          ] as const
        ).map(([value, label]) => {
          const active = mode === value;
          return (
            <Pressable
              key={value}
              onPress={() => setMode(value)}
              style={[
                styles.themeOption,
                { backgroundColor: active ? colors.primary : 'transparent' },
              ]}
            >
              <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '600', fontSize: 13 }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.h, { color: colors.text }]}>Standardbutikker</Text>
      <Pressable onPress={selectAll} style={{ marginBottom: 8 }}>
        <Text style={{ color: colors.primary }}>Vælg alle</Text>
      </Pressable>
      {catalog.map((s) => (
        <View
          key={s.key}
          style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={{ color: colors.text, flex: 1 }}>{s.label}</Text>
          <Switch
            value={selectedLabels.has(s.label)}
            onValueChange={() => toggleStore(s.label)}
          />
        </View>
      ))}

      {/* Apple Guideline 5.1.1(v): sletning skal kunne startes inde i appen.
          Privatlivspolitikken (templates/privacy.html) peger hertil:
          Profil → Indstillinger → "Slet konto". */}
      {user ? (
        <>
          <Text style={[styles.h, { color: colors.text }]}>Konto</Text>
          <Pressable
            onPress={confirmDelete}
            disabled={deleting}
            style={[
              styles.row,
              { backgroundColor: colors.surface, borderColor: colors.border, opacity: deleting ? 0.5 : 1 },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.sale, fontWeight: '600' }}>
                {deleting ? 'Sletter konto…' : 'Slet konto'}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                Sletter permanent din konto, gemte kurv og besparelseshistorik
              </Text>
            </View>
          </Pressable>
        </>
      ) : null}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h: { fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  themeRow: { padding: 4, gap: 4 },
  themeOption: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8 },
});
