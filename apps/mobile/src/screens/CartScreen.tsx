import React, { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../cart/CartContext';
import { memberInitial, useSharedCart } from '../cart/SharedCartContext';
import type { CartItem } from '../cart/types';
import { cartItemTitle } from '../cart/stripStoreBrand';
import { useTheme } from '../theme/ThemeContext';
import { StackScreenBody } from '../components/ScreenBody';
import { StoreChip } from '../components/StoreChip';
import { SwipeableCartRow } from '../cart/SwipeableCartRow';
import { useSwipeEnabled } from '../cart/swipeFlag';
import { joinLabel, spokenKr } from '../a11y/speech';
import type { RootStackParamList } from '../navigation/types';

type PromptMode = 'save' | 'share' | 'join' | 'rename' | null;

/** Pris med små øre — Rema-agtig, men uden deres typografi. */
function PriceText({
  value,
  color,
  size = 22,
}: {
  value: number;
  color: string;
  size?: number;
}) {
  const [kr, ore] = value.toFixed(2).split('.');
  return (
    // "24" og "95" er to tekster; uden samlet etiket læser VoiceOver dem
    // som to løse tal.
    <View style={styles.priceRow} accessible accessibilityLabel={spokenKr(value)}>
      <Text style={{ color, fontSize: size, fontWeight: '800', letterSpacing: -0.3 }}>{kr}</Text>
      <Text
        style={{
          color,
          fontSize: size * 0.55,
          fontWeight: '800',
          lineHeight: size * 0.7,
          marginTop: 1,
        }}
      >
        {ore}
      </Text>
    </View>
  );
}

export function CartScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { items, updateQuantity, removeItem, clearCart, count } = useCart();
  const { user } = useAuth();
  const {
    active, title, members, maxMembers, inviteUrl,
    createShared, joinShared, leaveShared,
    saveList, savedLists, loadList, deleteList, maxSavedLists,
  } = useSharedCart();

  const [prompt, setPrompt] = useState<PromptMode>(null);
  const [promptValue, setPromptValue] = useState('');
  const [promptError, setPromptError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listTitle, setListTitle] = useState('Min kurv');
  const [menuOpen, setMenuOpen] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const [listBusy, setListBusy] = useState<string | null>(null);
  const [loginOverlay, setLoginOverlay] = useState(false);
  // Listen må ikke rulle, mens man swiper en vare til siden.
  const [swiping, setSwiping] = useState(false);
  const swipeEnabled = useSwipeEnabled();

  const displayTitle = active ? title || 'Fælles kurv' : listTitle;

  const groups = useMemo(() => {
    const map = new Map<string, CartItem[]>();
    for (const item of items) {
      const cat = item.category || 'Andre varer';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return Array.from(map.entries());
  }, [items]);

  /** Footer-total UDEN multi-deal (docs/native-app.md §7.4). */
  const footerTotal = useMemo(
    () => items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [items],
  );

  const openPrompt = (mode: PromptMode) => {
    setMenuOpen(false);
    setPromptValue(mode === 'rename' ? listTitle : '');
    setPromptError(null);
    setPrompt(mode);
  };

  const closePrompt = () => {
    setPrompt(null);
    setPromptValue('');
    setPromptError(null);
  };

  const submitPrompt = async () => {
    setPromptError(null);
    setBusy(true);
    try {
      if (prompt === 'rename') {
        if (!promptValue.trim()) {
          setPromptError('Angiv et navn');
          return;
        }
        setListTitle(promptValue.trim());
        closePrompt();
      } else if (prompt === 'save') {
        if (!promptValue.trim()) {
          setPromptError('Angiv et navn');
          return;
        }
        const err = await saveList(promptValue.trim());
        if (err) setPromptError(err);
        else closePrompt();
      } else if (prompt === 'share') {
        const err = await createShared(promptValue.trim() || 'Fælles kurv');
        if (err) setPromptError(err);
        else closePrompt();
      } else if (prompt === 'join') {
        if (!promptValue.trim()) {
          setPromptError('Angiv en kode');
          return;
        }
        const err = await joinShared(promptValue.trim());
        if (err) setPromptError(err);
        else closePrompt();
      }
    } finally {
      setBusy(false);
    }
  };

  const requireLogin = () => {
    setMenuOpen(false);
    setLoginOverlay(true);
  };

  const onSavePress = () => {
    if (!user) {
      requireLogin();
      return;
    }
    openPrompt('save');
  };

  const onSharePress = () => {
    if (!user) {
      requireLogin();
      return;
    }
    openPrompt('share');
  };

  const onInvite = () => {
    if (inviteUrl) void Share.share({ message: inviteUrl });
  };

  /**
   * Webben spoerger foer den forlader en gruppe (`confirm(...)` i script.js);
   * appen gjorde det ikke, saa et fejltryk paa "Forlad" - som sidder lige ved
   * siden af "Inviter" - meldte brugeren ud af gruppen med det samme og uden
   * vej tilbage uden et nyt invitationslink.
   */
  const confirmLeaveShared = () => {
    Alert.alert(
      'Forlad listen?',
      'Du kan kun komme med igen via et nyt invitationslink. Din egen kurv beholder varerne.',
      [
        { text: 'Annullér', style: 'cancel' },
        { text: 'Forlad', style: 'destructive', onPress: () => void leaveShared() },
      ],
    );
  };

  /** Samme bekræftelse som webbens clearCart() i script.js: et fejltryk
   *  tømte ellers hele kurven (og i en delt kurv alle medlemmers). */
  const confirmClearCart = () => {
    Alert.alert(
      'Tøm kurven?',
      active
        ? 'Det rammer hele gruppens fælles kurv og kan ikke fortrydes.'
        : 'Det kan ikke fortrydes.',
      [
        { text: 'Annullér', style: 'cancel' },
        { text: 'Tøm kurv', style: 'destructive', onPress: () => clearCart() },
      ],
    );
  };

  const goAddItem = () => {
    navigation.navigate('Tabs', { screen: 'Search' });
  };

  const header = (
    <View style={styles.topBlock}>
      {/* Delt kurv: avatarer + handlinger */}
      {active ? (
        <View style={styles.sharedRow}>
          {/* Forbogstaverne siger intet oplæst; antallet står i teksten ved siden af. */}
          <View
            style={styles.avatarStack}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {members.slice(0, 4).map((m, i) => (
              <View
                key={m.id || `${m.name}-${i}`}
                style={[
                  styles.avatar,
                  {
                    backgroundColor: colors.primary,
                    marginLeft: i === 0 ? 0 : -10,
                    zIndex: 10 - i,
                    borderColor: colors.bg,
                  },
                ]}
              >
                <Text style={styles.avatarText}>{memberInitial(m.name)}</Text>
              </View>
            ))}
          </View>
          <Text
            style={{ color: colors.textMuted, fontSize: 12, flex: 1 }}
            accessibilityLabel={`Delt liste, ${members.length} af ${maxMembers} medlemmer`}
          >
            {members.length}/{maxMembers} medlemmer
          </Text>
          <Pressable
            onPress={onInvite}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Inviter til listen"
          >
            <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>Inviter</Text>
          </Pressable>
          <Pressable
            onPress={confirmLeaveShared}
            hitSlop={8}
            style={{ marginLeft: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Forlad listen"
          >
            <Text style={{ color: colors.sale, fontWeight: '600', fontSize: 13 }}>Forlad</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.titleRow}>
        <Text
          style={[styles.listTitle, { color: colors.text }]}
          numberOfLines={2}
          accessibilityRole="header"
        >
          {displayTitle}
        </Text>
        {!active ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Omdøb listen"
            onPress={() => openPrompt('rename')}
            style={[styles.editBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            hitSlop={6}
          >
            <Text style={{ color: colors.textMuted, fontSize: 14 }}>✎</Text>
          </Pressable>
        ) : null}
        {/* "✎" og "···" er rene symboler - uden etiket annoncerer VoiceOver
            dem som "pil" / "prik prik prik". */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Flere handlinger"
          accessibilityState={{ expanded: menuOpen }}
          onPress={() => setMenuOpen((v) => !v)}
          style={[styles.editBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          hitSlop={6}
        >
          <Text style={{ color: colors.textMuted, fontSize: 16, fontWeight: '700' }}>···</Text>
        </Pressable>
      </View>

      {menuOpen ? (
        <View style={[styles.menu, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable
            onPress={onSavePress}
            style={styles.menuItem}
            accessibilityRole="button"
            accessibilityLabel={user ? 'Gem liste' : 'Gem liste, kræver login'}
          >
            <View style={styles.menuItemRow}>
              <Text style={{ color: colors.text }}>Gem liste</Text>
              {!user ? <Text style={styles.lockIcon}>🔒</Text> : null}
            </View>
          </Pressable>
          <Pressable
            onPress={() => {
              setMenuOpen(false);
              if (!user) { setLoginOverlay(true); return; }
              setListsOpen(true);
            }}
            style={styles.menuItem}
            accessibilityRole="button"
            accessibilityLabel={joinLabel([
              active ? 'Gruppens lister' : 'Mine lister',
              savedLists.length ? `${savedLists.length} gemt` : null,
              !user ? 'kræver login' : null,
            ])}
          >
            <View style={styles.menuItemRow}>
              <Text style={{ color: colors.text }}>
                {active ? 'Gruppens lister' : 'Mine lister'}
                {savedLists.length ? ` (${savedLists.length})` : ''}
              </Text>
              {!user ? <Text style={styles.lockIcon}>🔒</Text> : null}
            </View>
          </Pressable>
          {!active ? (
            <>
              <Pressable
                onPress={onSharePress}
                style={styles.menuItem}
                accessibilityRole="button"
                accessibilityLabel={user ? 'Del kurv' : 'Del kurv, kræver login'}
              >
                <View style={styles.menuItemRow}>
                  <Text style={{ color: colors.text }}>Del kurv</Text>
                  {!user ? <Text style={styles.lockIcon}>🔒</Text> : null}
                </View>
              </Pressable>
              <Pressable
                onPress={() => openPrompt('join')}
                style={styles.menuItem}
                accessibilityRole="button"
              >
                <Text style={{ color: colors.text }}>Tilslut kurv</Text>
              </Pressable>
            </>
          ) : null}
          {items.length ? (
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                confirmClearCart();
              }}
              style={styles.menuItem}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.sale }}>Ryd kurv</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <Pressable
        onPress={goAddItem}
        accessibilityRole="button"
        accessibilityLabel="Tilføj vare"
        accessibilityHint="Åbner søgning"
        style={[styles.addBar, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text style={{ color: colors.textMuted, fontSize: 16 }}>🔍</Text>
        <Text style={[styles.addPlaceholder, { color: colors.textMuted }]}>Tilføj vare</Text>
      </Pressable>
    </View>
  );

  const renderItemRow = (item: CartItem) => {
    const lineTotal = item.price * item.quantity;
    // Butikken vises som et grønt mærkat, så man med det samme kan se hvilken
    // butik hver vare er fra (Kalle 03-10-2026).
    return (
      <SwipeableCartRow
        key={item.id}
        onAddOne={() => updateQuantity(item.id, item.quantity + 1)}
        onRemoveAll={() => removeItem(item.id)}
        onSwipeActive={setSwiping}
        enabled={swipeEnabled}
      >
        <View style={[styles.itemRow, { backgroundColor: colors.surface }]}>
          {/* Billede og antals-mærkat er med i etiketten nedenfor. */}
          <View
            style={styles.thumbWrap}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {item.image ? (
              <Image source={{ uri: item.image }} style={styles.thumb} resizeMode="contain" />
            ) : (
              <View style={[styles.thumb, { backgroundColor: colors.border }]} />
            )}
            <View style={[styles.qtyBadge, { backgroundColor: colors.text }]}>
              <Text style={[styles.qtyBadgeText, { color: colors.surface }]}>{item.quantity}</Text>
            </View>
          </View>

          <View style={styles.itemBody}>
            {/* Varens oplysninger som ét element; knapperne under er egne. */}
            {/* Samme to handlinger som swipe, så de også kan bruges med
                VoiceOver/TalkBack (stryg op/ned og tryk to gange). */}
            <View
              accessible
              accessibilityActions={
                swipeEnabled
                  ? [
                      { name: 'addOne', label: 'Tilføj én mere til kurven' },
                      { name: 'removeAll', label: 'Fjern fra kurv' },
                    ]
                  : undefined
              }
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === 'addOne') {
                  updateQuantity(item.id, item.quantity + 1);
                } else if (e.nativeEvent.actionName === 'removeAll') {
                  removeItem(item.id);
                }
              }}
              accessibilityLabel={joinLabel([
                cartItemTitle(item),
                `${item.quantity} stk`,
                item.store,
                item.unitMeasure,
                item.kgPrice ? item.kgPrice.replace('kr/kg', 'kr pr. kilo').replace('.', ',') : null,
                !item.kgPrice ? item.multiDeal : null,
                `i alt ${spokenKr(lineTotal)}`,
              ])}
            >
              {item.store || item.unitMeasure ? (
                <View style={styles.storeRow}>
                  {item.store ? <StoreChip store={item.store} /> : null}
                  {item.unitMeasure ? (
                    <Text style={[styles.itemMeta, { color: colors.textMuted }]} numberOfLines={1}>
                      {item.unitMeasure.toUpperCase()}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={2}>
                {cartItemTitle(item)}
              </Text>
              {item.kgPrice ? (
                <Text style={[styles.itemMeta, { color: colors.textMuted }]}>{item.kgPrice}</Text>
              ) : item.multiDeal ? (
                <Text style={[styles.itemMeta, { color: colors.badge }]}>{item.multiDeal}</Text>
              ) : null}
            </View>

            {/* Etiketterne naevner varen. En kurv med ti linjer har ellers ti
                identiske "minus"-knapper, og VoiceOver kan ikke skelne dem. */}
            <View style={styles.qtyControls}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Færre ${item.name}`}
                onPress={() => updateQuantity(item.id, item.quantity - 1)}
                style={[styles.qtyCtrl, { borderColor: colors.border }]}
                hitSlop={6}
              >
                <Text style={{ color: colors.primary, fontSize: 18, fontWeight: '600' }}>−</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Fjern ${item.name} fra kurven`}
                onPress={() => removeItem(item.id)}
                hitSlop={8}
              >
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>Fjern</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Flere ${item.name}`}
                onPress={() => updateQuantity(item.id, item.quantity + 1)}
                style={[styles.qtyCtrl, { borderColor: colors.border }]}
                hitSlop={6}
              >
                <Text style={{ color: colors.primary, fontSize: 18, fontWeight: '600' }}>+</Text>
              </Pressable>
            </View>
          </View>

          <View
            style={styles.itemPriceCol}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <PriceText value={lineTotal} color={colors.text} size={20} />
          </View>
        </View>
      </SwipeableCartRow>
    );
  };

  return (
    <StackScreenBody style={{ backgroundColor: colors.bg }}>
      <FlatList
        style={{ flex: 1 }}
        scrollEnabled={!swiping}
        data={groups}
        keyExtractor={([cat]) => cat}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ color: colors.textMuted, textAlign: 'center', fontSize: 15 }}>
              Ingen varer endnu. Tryk «Tilføj vare» for at søge.
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        renderItem={({ item: [cat, catItems] }) => (
          <View style={styles.section}>
            <Text
              style={[styles.cat, { color: colors.textMuted }]}
              accessibilityRole="header"
              accessibilityLabel={cat}
            >
              {cat.toUpperCase()}
            </Text>
            <View style={[styles.sectionCard, { backgroundColor: colors.surface }]}>
              {catItems.map((item, idx) => (
                <View key={item.id}>
                  {renderItemRow(item)}
                  {idx < catItems.length - 1 ? (
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        )}
      />

      {items.length > 0 ? (
        <View style={[styles.footerPad, { backgroundColor: colors.bg }]}>
          <Pressable
            onPress={() => navigation.navigate('Sco')}
            accessibilityRole="button"
            accessibilityLabel={`Find billigste. ${count} varer, i alt ${spokenKr(footerTotal)}`}
            accessibilityHint="Sammenligner kurven på tværs af butikker"
            style={[styles.cta, { backgroundColor: colors.primary }]}
          >
            <View style={styles.ctaCount}>
              <Text style={[styles.ctaCountText, { color: colors.primary }]}>{count}</Text>
            </View>
            <Text style={styles.ctaLabel}>Find billigste</Text>
            <View style={styles.ctaPrice}>
              <PriceText value={footerTotal} color="#fff" size={20} />
              <Text style={styles.ctaChevron}>›</Text>
            </View>
          </Pressable>
        </View>
      ) : null}

      <Modal visible={prompt !== null} transparent animationType="fade" onRequestClose={closePrompt}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text
              style={{ color: colors.text, fontWeight: '700', fontSize: 16, marginBottom: 10 }}
              accessibilityRole="header"
            >
              {prompt === 'save' && 'Gem liste'}
              {prompt === 'share' && 'Del kurv'}
              {prompt === 'join' && 'Tilslut delt kurv'}
              {prompt === 'rename' && 'Omdøb kurv'}
            </Text>
            <TextInput
              value={promptValue}
              onChangeText={setPromptValue}
              placeholder={
                prompt === 'save'
                  ? 'Navn på liste'
                  : prompt === 'share'
                    ? 'Navn på kurv (valgfrit)'
                    : prompt === 'rename'
                      ? 'Kurvens navn'
                      : 'Invitationskode'
              }
              placeholderTextColor={colors.textMuted}
              autoCapitalize={prompt === 'join' ? 'none' : 'sentences'}
              accessibilityLabel={
                prompt === 'save'
                  ? 'Navn på liste'
                  : prompt === 'share'
                    ? 'Navn på kurv, valgfrit'
                    : prompt === 'rename'
                      ? 'Kurvens navn'
                      : 'Invitationskode'
              }
              style={[
                styles.input,
                { backgroundColor: colors.bg, color: colors.text, borderColor: colors.border },
              ]}
            />
            {promptError ? (
              <Text
                style={{ color: colors.sale, marginBottom: 8 }}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
              >
                {promptError}
              </Text>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                onPress={closePrompt}
                accessibilityRole="button"
                style={[styles.modalBtn, { borderColor: colors.border }]}
              >
                <Text style={{ color: colors.text }}>Annuller</Text>
              </Pressable>
              <Pressable
                onPress={() => void submitPrompt()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy, busy }}
                style={[
                  styles.modalBtnPrimary,
                  { backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 },
                ]}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>
                  {prompt === 'join' ? 'Tilslut' : prompt === 'share' ? 'Del' : 'Gem'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Gemte lister. Uden denne skaerm var "Gem liste" et sort hul: listen
          blev gemt, men kunne hverken ses, indlaeses eller slettes igen. */}
      <Modal visible={listsOpen} transparent animationType="fade" onRequestClose={() => setListsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text
              style={{
                color: colors.text,
                fontWeight: '700',
                fontSize: 16,
                marginBottom: 4,
                // Tom tilstand er centreret; overskriften følger med.
                textAlign: savedLists.length ? 'left' : 'center',
              }}
              accessibilityRole="header"
            >
              {active ? 'Gruppens lister' : 'Mine lister'}
            </Text>
            {savedLists.length ? (
              <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 12 }}>
                {savedLists.length}/{maxSavedLists} gemt
                {active ? ' · hele gruppen kan indlæse dem' : ''}
              </Text>
            ) : null}

            {savedLists.length === 0 ? (
              // Tom tilstand: før var det en grå tekstklump og en "Luk"-knap,
              // der blev klemt sammen (flex: 1 i en kolonne uden højde).
              <View style={styles.listsEmpty}>
                <View
                  style={[styles.listsEmptyIcon, { backgroundColor: colors.bg, borderColor: colors.border }]}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  <Text style={{ fontSize: 28 }}>📝</Text>
                </View>
                <Text style={[styles.listsEmptyTitle, { color: colors.text }]}>
                  Ingen gemte lister endnu
                </Text>
                <Text style={[styles.listsEmptyText, { color: colors.textMuted }]}>
                  {items.length
                    ? 'Gem din kurv som en liste, så kan du hente den frem igen med ét tryk.'
                    : 'Læg nogle varer i kurven og gem den som en liste. Så kan du hente den frem igen med ét tryk.'}
                </Text>
              </View>
            ) : (
              savedLists.map((list) => (
                <View
                  key={list.id}
                  style={[styles.savedListRow, { borderColor: colors.border }]}
                >
                  <View
                    style={{ flex: 1, paddingRight: 8 }}
                    accessible
                    accessibilityLabel={joinLabel([
                      list.name,
                      `${list.items.length} varer`,
                      list.createdAt,
                    ])}
                  >
                    <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>
                      {list.name}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                      {list.items.length} varer{list.createdAt ? ` · ${list.createdAt}` : ''}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      loadList(list.id);
                      setListsOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Indlæs listen ${list.name}`}
                    style={[styles.savedListBtn, { borderColor: colors.border }]}
                    hitSlop={4}
                  >
                    <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 13 }}>
                      Indlæs
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={async () => {
                      setListBusy(list.id);
                      try {
                        await deleteList(list.id);
                      } finally {
                        setListBusy(null);
                      }
                    }}
                    disabled={listBusy === list.id}
                    style={[styles.savedListBtn, { borderColor: colors.border, opacity: listBusy === list.id ? 0.5 : 1 }]}
                    hitSlop={4}
                    accessibilityRole="button"
                    accessibilityLabel={`Slet listen ${list.name}`}
                    accessibilityState={{ disabled: listBusy === list.id, busy: listBusy === list.id }}
                  >
                    <Text style={{ color: colors.sale, fontWeight: '600', fontSize: 13 }}>Slet</Text>
                  </Pressable>
                </View>
              ))
            )}

            <View style={[styles.modalActions, { marginTop: 12 }]}>
              <Pressable
                onPress={() => setListsOpen(false)}
                accessibilityRole="button"
                style={[styles.modalBtn, { borderColor: colors.border }]}
              >
                <Text style={{ color: colors.text }}>Luk</Text>
              </Pressable>
              {items.length && savedLists.length < maxSavedLists ? (
                <Pressable
                  onPress={() => {
                    setListsOpen(false);
                    // iOS afviser at vise en ny Modal, mens den gamle lukker.
                    setTimeout(() => openPrompt('save'), 400);
                  }}
                  accessibilityRole="button"
                  style={[styles.modalBtnPrimary, { backgroundColor: colors.primary }]}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Gem kurven</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={loginOverlay}
        transparent
        animationType="fade"
        onRequestClose={() => setLoginOverlay(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, alignItems: 'center' }]}>
            <Text
              style={{ fontSize: 28, marginBottom: 8 }}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              🔒
            </Text>
            <Text
              style={{
                color: colors.text,
                fontWeight: '700',
                fontSize: 16,
                marginBottom: 6,
                textAlign: 'center',
              }}
              accessibilityRole="header"
            >
              Log ind for at fortsætte
            </Text>
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 14,
                textAlign: 'center',
                marginBottom: 16,
              }}
            >
              Du skal være logget ind for at gemme eller dele din kurv.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setLoginOverlay(false)}
                accessibilityRole="button"
                style={[styles.modalBtn, { borderColor: colors.border }]}
              >
                <Text style={{ color: colors.text }}>Luk</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setLoginOverlay(false);
                  // iOS afviser present, mens RN-Modalen stadig lukker.
                  setTimeout(() => navigation.navigate('Auth'), 400);
                }}
                accessibilityRole="button"
                style={[styles.modalBtnPrimary, { backgroundColor: colors.primary }]}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>Log ind</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </StackScreenBody>
  );
}

const styles = StyleSheet.create({
  topBlock: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  sharedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  avatarStack: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  avatarText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  listTitle: {
    flex: 1,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  editBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menu: {
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  menuItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  menuItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lockIcon: {
    fontSize: 13,
  },
  addBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
  },
  addPlaceholder: { fontSize: 16, flex: 1 },
  listContent: { paddingBottom: 16 },
  empty: { paddingHorizontal: 32, paddingTop: 48 },
  section: { paddingHorizontal: 16, marginTop: 16 },
  cat: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionCard: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 12,
  },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 84 },
  thumbWrap: { width: 64, height: 64 },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 14,
  },
  qtyBadge: {
    position: 'absolute',
    left: -4,
    bottom: -4,
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  qtyBadgeText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  itemBody: { flex: 1, minWidth: 0, gap: 2 },
  itemMeta: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  itemName: { fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },
  qtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  qtyCtrl: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemPriceCol: { alignItems: 'flex-end', paddingTop: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-start' },
  footerPad: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  ctaCount: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaCountText: { fontWeight: '800', fontSize: 15 },
  ctaLabel: {
    flex: 1,
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  ctaPrice: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ctaChevron: { color: '#fff', fontSize: 26, fontWeight: '300', marginTop: -2 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: { width: '100%', borderRadius: 16, padding: 20 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 10,
  },
  modalActions: { flexDirection: 'row', gap: 8 },
  listsEmpty: { alignItems: 'center', paddingTop: 12, paddingBottom: 8, gap: 8 },
  listsEmptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  listsEmptyTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  listsEmptyText: { fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: 8 },
  savedListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    paddingVertical: 10,
  },
  savedListBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  modalBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  modalBtnPrimary: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
});
