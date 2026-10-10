import React from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import {
  buyRecipeAccess,
  loadRecipeOffer,
  manageRecipeAccess,
  restoreRecipeAccess,
  useRecipeAccess,
} from '../recipes/access';

// Apples standardvilkår for køb i apps. Apple kræver et link til vilkår og
// privatliv på den skærm, hvor abonnementet sælges (retningslinje 3.1.2).
const APPLE_EULA = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

/**
 * Abonnement på opskrifterne (Feature-panelet 'recipes', docs/abonnement.md).
 * Åbnes fra Opskrift-fanen, når man prøver at åbne en opskrift eller
 * madplanen uden adgang. Se src/recipes/access.ts.
 */
export function RecipeAccessScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const s = useRecipeAccess();

  React.useEffect(() => {
    void loadRecipeOffer();
  }, []);

  const onRestore = React.useCallback(async () => {
    const found = await restoreRecipeAccess();
    Alert.alert(
      found ? 'Dit abonnement er fundet' : 'Intet abonnement fundet',
      found ? 'Du har adgang til opskrifterne.' : 'Der er intet aktivt abonnement på dit Apple-ID.',
    );
  }, []);

  const card = { backgroundColor: colors.surface, borderColor: colors.border };
  const canBuy = s.available && !!s.price && s.access !== true && !!user;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <View style={[styles.card, card, { alignItems: 'center' }]}>
        <Ionicons name="restaurant-outline" size={40} color={colors.primary} accessibilityElementsHidden />
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Opskrifter med priser
        </Text>
        <Text style={{ color: colors.textMuted, textAlign: 'center', lineHeight: 20 }}>
          Få alle opskrifterne med ingredienser, fremgangsmåde og dagens pris fra butikkerne, læg
          varerne i kurven med ét tryk, og få din egen madplan inden for dit budget. Adgangen følger
          din konto, så den også virker på madshopper.dk.
        </Text>
      </View>

      {s.access === true ? (
        <View style={[styles.card, card]}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>Du har adgang</Text>
          <Text style={{ color: colors.textMuted, marginTop: 4 }}>
            Dit abonnement er aktivt. Du kan stoppe det når som helst.
          </Text>
          <Pressable
            onPress={() => navigation.goBack()}
            style={[styles.btn, { backgroundColor: colors.primary, marginTop: 12 }]}
            accessibilityRole="button"
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Til opskrifterne</Text>
          </Pressable>
          {s.available ? (
            <Pressable
              onPress={() => void manageRecipeAccess()}
              style={[styles.btn, { borderColor: colors.border, borderWidth: 1, marginTop: 10 }]}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.text, fontWeight: '600' }}>Administrér abonnement</Text>
            </Pressable>
          ) : null}
        </View>
      ) : !user ? (
        <View style={[styles.card, card]}>
          <Text style={{ color: colors.text, marginBottom: 12 }}>
            Log ind først, så adgangen følger din konto og også virker på madshopper.dk.
          </Text>
          <Pressable
            onPress={() => navigation.navigate('Auth')}
            style={[styles.btn, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Log ind</Text>
          </Pressable>
        </View>
      ) : !s.available ? (
        <Text style={{ color: colors.textMuted, textAlign: 'center', marginVertical: 12 }}>
          Abonnementet kan købes i appen på iPhone. Har du købt det dér, så log ind med samme konto.
        </Text>
      ) : !s.price ? (
        <View style={{ paddingVertical: 20, alignItems: 'center' }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.textMuted, marginTop: 8 }}>Henter pris fra App Store…</Text>
        </View>
      ) : (
        <View style={[styles.card, card]}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>
            {s.title || 'MadShopper Opskrifter'}
          </Text>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 4 }}>
            {s.price} <Text style={{ fontSize: 14, fontWeight: '400', color: colors.textMuted }}>pr. måned</Text>
          </Text>
          <Pressable
            onPress={() => void buyRecipeAccess()}
            disabled={!canBuy || s.busy}
            style={[styles.btn, { backgroundColor: colors.primary, opacity: s.busy ? 0.6 : 1, marginTop: 14 }]}
            accessibilityRole="button"
            accessibilityLabel={`Få adgang for ${s.price} pr. måned`}
            accessibilityState={{ disabled: !canBuy || s.busy, busy: s.busy }}
          >
            {s.busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Få adgang for {s.price} pr. måned</Text>
            )}
          </Pressable>
        </View>
      )}

      {s.error ? (
        <Text style={{ color: colors.sale, textAlign: 'center', marginBottom: 8 }} accessibilityRole="alert">
          {s.error}
        </Text>
      ) : null}

      {s.available && user && s.access !== true ? (
        <Pressable onPress={() => void onRestore()} disabled={s.busy} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'center', padding: 8 }}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Gendan køb</Text>
        </Pressable>
      ) : null}

      {/* Apples krav: varighed, pris, fornyelse og links til vilkår og privatliv. */}
      <Text style={[styles.small, { color: colors.textMuted }]}>
        Abonnementet varer en måned ad gangen og fornyes automatisk til samme pris, indtil du stopper
        det. Betalingen trækkes fra dit Apple-ID. Du kan stoppe det i Indstillinger på din iPhone senest
        24 timer før næste måned starter.
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
