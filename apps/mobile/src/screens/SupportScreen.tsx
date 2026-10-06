import React from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from '../navigation/types';
import { buySupport, loadSupport, manageSupport, restoreSupport, useSupport } from '../subscription/subscription';

// Apples standardvilkår for køb i apps. Apple kræver et link til vilkår og
// privatliv på den skærm, hvor abonnementet sælges (retningslinje 3.1.2).
const APPLE_EULA = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

/**
 * "Støt MadShopper" (Feature-panelet 'subscription'). Frivilligt månedligt
 * abonnement: appen er gratis og uden reklamer for alle, og støtterne får et
 * "Støtter"-mærke på Profil. Se src/subscription/subscription.ts.
 */
export function SupportScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const s = useSupport();

  React.useEffect(() => {
    void loadSupport();
  }, []);

  const onRestore = React.useCallback(async () => {
    const found = await restoreSupport();
    Alert.alert(
      found ? 'Dit abonnement er fundet' : 'Intet abonnement fundet',
      found ? 'Tak fordi du støtter MadShopper.' : 'Der er intet aktivt abonnement på dit Apple-ID.',
    );
  }, []);

  const card = { backgroundColor: colors.surface, borderColor: colors.border };
  const canBuy = s.available && !!s.price && !s.active;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <View style={[styles.card, card, { alignItems: 'center' }]}>
        <Ionicons name="heart" size={40} color={colors.primary} accessibilityElementsHidden />
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Støt MadShopper
        </Text>
        <Text style={{ color: colors.textMuted, textAlign: 'center', lineHeight: 20 }}>
          MadShopper er gratis og uden reklamer. Med et månedligt bidrag hjælper du med at holde
          priserne opdateret hver dag, og du får et Støtter-mærke på din profil.
        </Text>
      </View>

      {s.active ? (
        <View style={[styles.card, card]}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>Tak for din støtte</Text>
          <Text style={{ color: colors.textMuted, marginTop: 4 }}>
            Dit abonnement er aktivt. Du kan stoppe det når som helst.
          </Text>
          <Pressable
            onPress={() => void manageSupport()}
            style={[styles.btn, { borderColor: colors.border, borderWidth: 1, marginTop: 12 }]}
            accessibilityRole="button"
          >
            <Text style={{ color: colors.text, fontWeight: '600' }}>Administrér abonnement</Text>
          </Pressable>
        </View>
      ) : !s.available ? (
        <Text style={{ color: colors.textMuted, textAlign: 'center', marginVertical: 12 }}>
          Abonnementet kan kun købes i appen på iPhone.
        </Text>
      ) : !s.price ? (
        <View style={{ paddingVertical: 20, alignItems: 'center' }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.textMuted, marginTop: 8 }}>Henter pris fra App Store…</Text>
        </View>
      ) : (
        <View style={[styles.card, card]}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>
            {s.title || 'MadShopper Støtte'}
          </Text>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 4 }}>
            {s.price} <Text style={{ fontSize: 14, fontWeight: '400', color: colors.textMuted }}>pr. måned</Text>
          </Text>
          <Pressable
            onPress={() => void buySupport()}
            disabled={!canBuy || s.busy}
            style={[styles.btn, { backgroundColor: colors.primary, opacity: s.busy ? 0.6 : 1, marginTop: 14 }]}
            accessibilityRole="button"
            accessibilityLabel={`Støt for ${s.price} pr. måned`}
            accessibilityState={{ disabled: !canBuy || s.busy, busy: s.busy }}
          >
            {s.busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Støt for {s.price} pr. måned</Text>
            )}
          </Pressable>
        </View>
      )}

      {s.error ? (
        <Text style={{ color: colors.sale, textAlign: 'center', marginBottom: 8 }} accessibilityRole="alert">
          {s.error}
        </Text>
      ) : null}

      {s.available ? (
        <Pressable onPress={() => void onRestore()} disabled={s.busy} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'center', padding: 8 }}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Gendan køb</Text>
        </Pressable>
      ) : null}

      {/* Apples krav: varighed, pris, fornyelse og links til vilkår og privatliv. */}
      <Text style={[styles.small, { color: colors.textMuted }]}>
        Abonnementet varer en måned ad gangen og fornyes automatisk til samme pris, indtil du stopper
        det. Betalingen trækkes fra dit Apple-ID. Du kan stoppe det i Indstillinger på din iPhone senest
        24 timer før næste måned starter. Alle funktioner i MadShopper er gratis, også uden abonnement.
      </Text>
      <View style={styles.links}>
        <Pressable onPress={() => navigation.navigate('Legal', { kind: 'terms' })} accessibilityRole="link" hitSlop={8}>
          <Text style={{ color: colors.primary }}>Vilkår</Text>
        </Pressable>
        <Pressable onPress={() => void Linking.openURL(APPLE_EULA)} accessibilityRole="link" hitSlop={8}>
          <Text style={{ color: colors.primary }}>Apples vilkår</Text>
        </Pressable>
        <Pressable onPress={() => navigation.navigate('Legal', { kind: 'privacy' })} accessibilityRole="link" hitSlop={8}>
          <Text style={{ color: colors.primary }}>Privatliv</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '800', marginTop: 8, marginBottom: 6 },
  btn: { paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  small: { fontSize: 12, lineHeight: 17, marginTop: 16 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 12, marginBottom: 40 },
});
