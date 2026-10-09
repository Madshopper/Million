import React from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { memberInitial, useSharedCart } from '../cart/SharedCartContext';
import { useTheme } from '../theme/ThemeContext';
import { env } from '../config/env';
import { PriceAlertsSection } from '../components/PriceAlertsSection';
import type { RootStackParamList } from '../navigation/types';

/**
 * Profil-fanen (erstattede fanen "Indstillinger" 02-10-2026).
 *
 * Alt om brugeren selv: konto, vist navn, "Fælles kurv" (hvem man deler kurv
 * med) og prisalarmer. Appens indstillinger (tema, standardbutikker, slet
 * konto) ligger bag rækken "Indstillinger", der åbner SettingsScreen i
 * stakken. Feedback har sin egen tydelige række (03-10-2026), så den er let
 * at finde. Farver: kun knapper og eget avatar er grønne; resten er neutralt.
 */
export function ProfileScreen() {
  const { colors } = useTheme();
  const { user, displayName, logout, saveDisplayName } = useAuth();
  const { active, title, members, maxMembers, inviteUrl, createShared, leaveShared } = useSharedCart();
  const [sharing, setSharing] = React.useState(false);

  // Samme standardnavn som kurvens "Del kurv" (CartScreen), så man kan starte
  // en fælles kurv direkte herfra uden at lede efter "···"-menuen.
  const onStartShare = React.useCallback(async () => {
    setSharing(true);
    const err = await createShared('Fælles kurv');
    setSharing(false);
    if (err) Alert.alert('Kunne ikke dele kurven', err);
  }, [createShared]);

  const confirmLeave = React.useCallback(() => {
    Alert.alert('Stop deling', 'Du forlader den fælles kurv. Dine varer bliver i din egen kurv.', [
      { text: 'Annullér', style: 'cancel' },
      { text: 'Forlad', style: 'destructive', onPress: () => void leaveShared() },
    ]);
  }, [leaveShared]);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // Web-paritet (base.html #auth-account-name / auth.js saveDisplayNameFromAccount)
  // — funktionen fandtes allerede i AuthContext, men uden nogen skærm der kaldte
  // den. Fundet under paritetsrevisionen 2026-08-17.
  const [nameInput, setNameInput] = React.useState(displayName);
  const [nameSaving, setNameSaving] = React.useState(false);
  const [nameMsg, setNameMsg] = React.useState<{ text: string; error: boolean } | null>(null);
  React.useEffect(() => setNameInput(displayName), [displayName]);

  const onSaveName = React.useCallback(async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameMsg({ text: 'Skriv et navn (max 40 tegn).', error: true });
      return;
    }
    setNameSaving(true);
    setNameMsg(null);
    const err = await saveDisplayName(trimmed);
    setNameSaving(false);
    setNameMsg(err ? { text: err, error: true } : { text: 'Navnet er gemt.', error: false });
  }, [nameInput, saveDisplayName]);

  const card = { backgroundColor: colors.surface, borderColor: colors.border };
  const shownName = displayName || user?.email || '';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      {user ? (
        <View style={[styles.row, card]}>
          <View
            style={[styles.bigAvatar, { backgroundColor: colors.primary }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={styles.bigAvatarText}>{memberInitial(shownName)}</Text>
          </View>
          <View
            style={{ flex: 1 }}
            accessible
            accessibilityLabel={
              shownName === user.email
                ? `Logget ind som ${user.email}`
                : `Logget ind som ${shownName}, ${user.email}`
            }
          >
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{shownName}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>{user.email}</Text>
          </View>
          <Pressable onPress={() => void logout()} hitSlop={8} accessibilityRole="button">
            <Text style={{ color: colors.sale, fontWeight: '600' }}>Log ud</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => navigation.navigate('Auth')}
          style={[styles.row, card]}
          accessibilityRole="button"
          accessibilityLabel="Log ind eller opret konto"
          accessibilityHint="Gem din kurv, del den med andre og få prisalarmer"
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>Log ind / Opret konto</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>
              Gem din kurv, del den med andre og få prisalarmer
            </Text>
          </View>
        </Pressable>
      )}

      {user ? (
        <View style={[styles.row, styles.column, card]}>
          <Text
            style={{ color: colors.text, fontWeight: '600', marginBottom: 8 }}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            Dit navn
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="Vises for andre i en delt kurv"
              placeholderTextColor={colors.textMuted}
              maxLength={40}
              accessibilityLabel="Dit navn"
              accessibilityHint="Vises for andre i en delt kurv"
              style={[styles.nameInput, { color: colors.text, borderColor: colors.border }]}
            />
            <Pressable
              onPress={() => void onSaveName()}
              disabled={nameSaving}
              accessibilityRole="button"
              accessibilityLabel="Gem navn"
              accessibilityState={{ disabled: nameSaving, busy: nameSaving }}
              style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: nameSaving ? 0.6 : 1 }]}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>{nameSaving ? '…' : 'Gem'}</Text>
            </Pressable>
          </View>
          {nameMsg ? (
            <Text
              style={{ color: nameMsg.error ? colors.sale : colors.badge, fontSize: 12, marginTop: 6 }}
              accessibilityLiveRegion="polite"
              accessibilityRole={nameMsg.error ? 'alert' : undefined}
            >
              {nameMsg.text}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Delt kurv kræver login (requireAuth i SharedCartContext), så sektionen
          giver kun mening for en logget ind bruger. */}
      {user ? (
        <>
          <Text style={[styles.h, { color: colors.text }]} accessibilityRole="header">
            Fælles kurv
          </Text>
          <View style={[styles.row, styles.column, card]}>
            {active ? (
              <>
                <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 8 }}>
                  {title ? `"${title}" · ` : ''}
                  {members.length}/{maxMembers} personer deler kurven
                </Text>
                {members.map((m, i) => (
                  <View
                    key={m.id || `${m.name}-${i}`}
                    style={styles.memberRow}
                    accessible
                    accessibilityLabel={`${m.name || 'Ukendt'}${m.me ? ', dig' : ''}`}
                  >
                    <View style={[styles.avatar, { backgroundColor: colors.border }]}>
                      <Text style={[styles.avatarText, { color: colors.text }]}>{memberInitial(m.name)}</Text>
                    </View>
                    <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>
                      {m.name || 'Ukendt'}
                      {m.me ? <Text style={{ color: colors.textMuted }}> (dig)</Text> : null}
                    </Text>
                  </View>
                ))}
                {members.length <= 1 ? (
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>
                    Ingen andre er med endnu. Send en invitation.
                  </Text>
                ) : null}
                <View style={styles.actions}>
                  {inviteUrl ? (
                    <Pressable
                      onPress={() => void Share.share({ message: inviteUrl })}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Inviter til kurven"
                    >
                      <Text style={{ color: colors.primary, fontWeight: '700' }}>Inviter</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => navigation.navigate('Cart')}
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    <Text style={{ color: colors.primary, fontWeight: '600' }}>Åbn kurven</Text>
                  </Pressable>
                  <Pressable onPress={confirmLeave} hitSlop={8} accessibilityRole="button">
                    <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Stop deling</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={{ color: colors.text }}>Du deler ikke din kurv med nogen.</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                  Del kurven med familien, så I handler ind på den samme liste.
                </Text>
                <View style={styles.actions}>
                  <Pressable
                    onPress={() => void onStartShare()}
                    disabled={sharing}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: sharing, busy: sharing }}
                  >
                    <Text style={{ color: colors.primary, fontWeight: '700', opacity: sharing ? 0.5 : 1 }}>
                      {sharing ? 'Deler…' : 'Del kurv'}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </>
      ) : null}

      <PriceAlertsSection />

      <Text style={[styles.h, { color: colors.text }]} accessibilityRole="header">
        Indstillinger og hjælp
      </Text>
      {(
        [
          ['Indstillinger', 'Udseende, butikker og slet konto', 'settings-outline', () => navigation.navigate('Settings')],
          ['Feedback', 'Ris, ros eller en fejl? Skriv til os', 'chatbubble-ellipses-outline', () => navigation.navigate('Feedback')],
        ] as const
      ).map(([label, sub, icon, onPress]) => (
        <Pressable
          key={label}
          onPress={onPress}
          style={[styles.row, card]}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={sub}
        >
          <Ionicons name={icon} size={20} color={colors.text} style={{ marginRight: 12 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>{label}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>{sub}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      ))}

      <Text style={[styles.h, { color: colors.text }]} accessibilityRole="header">
        Om MadShopper
      </Text>
      {(
        [
          ['Vilkår', 'document-text-outline', () => navigation.navigate('Legal', { kind: 'terms' })],
          ['Privatliv', 'lock-closed-outline', () => navigation.navigate('Legal', { kind: 'privacy' })],
          ['Om os', 'information-circle-outline', () => navigation.navigate('Legal', { kind: 'about' })],
        ] as const
      ).map(([label, icon, onPress]) => (
        <Pressable key={label} onPress={onPress} style={[styles.row, card]} accessibilityRole="button">
          <Ionicons name={icon} size={18} color={colors.textMuted} style={{ marginRight: 10 }} />
          <Text style={{ color: colors.text, flex: 1 }}>{label}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      ))}

      {/* Brugere har intet at bruge flavor/RPC-suffix til - kun vi har. I
          produktion vises derfor kun versionen, som er det, en fejlmelding
          skal indeholde. */}
      <Text style={[styles.meta, { color: colors.textMuted }]}>
        MadShopper {env.appVersion}
        {env.flavor !== 'production'
          ? ` · ${env.flavor} · RPC${env.rpcSuffix || ' (prod)'} · ${env.apiBaseUrl}`
          : ''}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h: { fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  column: { flexDirection: 'column', alignItems: 'stretch' },
  bigAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  bigAvatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 20, marginTop: 10 },
  nameInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8 },
  meta: { marginTop: 24, fontSize: 12, marginBottom: 40 },
});
