import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, TextInput, cardShadow } from '../theme/Typography';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../cart/CartContext';
import { showCartToast } from '../cart/CartToast';
import { memberInitial, useSharedCart } from '../cart/SharedCartContext';
import type { CartItem } from '../cart/types';
import { cartItemTitle } from '../cart/stripStoreBrand';
import { useTheme } from '../theme/ThemeContext';
import { StackScreenBody } from '../components/ScreenBody';
import { StoreLogo } from '../stores/storeLogos';
import { useStoreCatalog } from '../stores/StoreCatalogContext';
import { QuantityStepper } from '../components/QuantityStepper';
import { kr } from '../components/ShelfPrice';
import {
  bestTwoStoreSplit,
  calculateStoreComparisons,
  extraCostVs,
  sortScoStores,
  type ScoResult,
  type ScoStoreResult,
} from '../cart/sco';
import { cachedProductPrices } from '../cart/livePrices';
import { recordSavingsOnce } from '../cart/recordSavings';
import { alternativeAsCartItem, fetchAlternatives, type AlternativeItem } from '../cart/alternatives';
import { SwipeableCartRow } from '../cart/SwipeableCartRow';
import { useSwipeEnabled } from '../cart/swipeFlag';
import { useBuyAgain } from '../cart/recentItems';
import { ForgotPills } from '../components/BuyAgain';
import { joinLabel, spokenKr } from '../a11y/speech';
import type { RootStackParamList } from '../navigation/types';

type PromptMode = 'save' | 'share' | 'join' | 'rename' | null;

export function CartScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { items, updateQuantity, removeItem, clearCart, replaceItem, count } = useCart();
  const { catalog, selectedLabels, ready } = useStoreCatalog();
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
  const [listTitle, setListTitle] = useState('Kurv');
  const [menuOpen, setMenuOpen] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const [listBusy, setListBusy] = useState<string | null>(null);
  const [loginOverlay, setLoginOverlay] = useState(false);
  // Listen må ikke rulle, mens man swiper en vare til siden.
  const [swiping, setSwiping] = useState(false);
  const swipeEnabled = useSwipeEnabled();

  const displayTitle = active ? title || 'Fælles kurv' : listTitle;

  // ── Vinderkortet (version C): samme sammenligning som "Find billigste",
  // regnet direkte i kurven. Priserne hentes live (cart/livePrices.ts).
  const [compare, setCompare] = useState<ScoResult | null>(null);
  const [compareState, setCompareState] = useState<'idle' | 'loading' | 'error'>('idle');
  const compareRun = useRef(0);
  useEffect(() => {
    if (!ready) return;
    if (!items.length) {
      setCompare(null);
      setCompareState('idle');
      return;
    }
    const run = ++compareRun.current;
    setCompareState((prev) => (compare ? prev : 'loading'));
    // Lidt ro, så hurtige tryk på "+" giver én beregning.
    const timer = setTimeout(() => {
      calculateStoreComparisons(items, catalog, selectedLabels, cachedProductPrices)
        .then((r) => {
          if (run !== compareRun.current) return;
          setCompare(r);
          setCompareState('idle');
          if (user) {
            recordSavingsOnce(items, selectedLabels, sortScoStores(r.stores), r.matchedItemsPerStore);
          }
        })
        .catch(() => {
          if (run !== compareRun.current) return;
          setCompare(null);
          setCompareState('error');
        });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, items, catalog, selectedLabels, user]);

  const ranked = useMemo(() => (compare ? sortScoStores(compare.stores) : []), [compare]);
  const winner: ScoStoreResult | undefined = ranked[0];
  const runnersUp = ranked.slice(1, 3).map((st) => ({
    store: st,
    extra: winner && compare ? extraCostVs(winner.name, st.name, compare.matchedItemsPerStore) : null,
  }));
  const spar = runnersUp[0]?.extra && runnersUp[0].extra.shared > 0 ? runnersUp[0].extra.diff : 0;
  // C2: "Handl i 2 butikker", kun når opdelingen sparer penge i forhold til
  // vinderen alene (regnet på vinderens varer, cart/sco.ts).
  const split = useMemo(
    () =>
      winner && compare
        ? bestTwoStoreSplit(
            winner.name,
            ranked.slice(1, 6).map((st) => st.name),
            compare.matchedItemsPerStore,
          )
        : null,
    [winner, ranked, compare],
  );

  // C2: "Glemt noget? Du plejer at købe": de to varer man oftest lægger i
  // kurven, som ikke allerede er der.
  const inCart = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const forgot = useBuyAgain(2, inCart);

  // Varer vinderbutikken ikke har, med forslag fra /api/alternatives.
  const [alternatives, setAlternatives] = useState<Record<string, AlternativeItem>>({});
  const altKey = useRef('');
  useEffect(() => {
    if (!winner || !winner.missingDetails.length) {
      altKey.current = '';
      setAlternatives({});
      return;
    }
    const key = `${winner.name}:${winner.missingDetails.map((m) => m.cart_id).join(',')}`;
    if (altKey.current === key) return;
    altKey.current = key;
    fetchAlternatives(winner)
      .then((map) => {
        if (altKey.current === key) setAlternatives(map);
      })
      .catch(() => setAlternatives({}));
  }, [winner]);

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
        <View style={{ flex: 1 }}>
          <Text
            style={[styles.listTitle, { color: colors.text }]}
            numberOfLines={2}
            accessibilityRole="header"
          >
            {displayTitle}
          </Text>
          {items.length ? (
            <Text style={[styles.subTitle, { color: colors.textMuted }]}>
              {count} {count === 1 ? 'vare' : 'varer'} · sammenlignet i {selectedLabels.size || catalog.length}{' '}
              butikker
            </Text>
          ) : null}
        </View>
        {!active ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={user ? 'Del kurv' : 'Del kurv, kræver login'}
            onPress={onSharePress}
            style={[styles.headerPill, { backgroundColor: colors.surface, borderColor: colors.border }]}
            hitSlop={6}
          >
            <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>Del kurv</Text>
          </Pressable>
        ) : null}
        {/* "···" er et rent symbol - uden etiket annoncerer VoiceOver det
            som "prik prik prik". */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Flere handlinger"
          accessibilityState={{ expanded: menuOpen }}
          onPress={() => setMenuOpen((v) => !v)}
          style={[styles.editBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          hitSlop={6}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
        </Pressable>
      </View>

      {menuOpen ? (
        <View style={[styles.menu, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {!active ? (
            <Pressable
              onPress={() => openPrompt('rename')}
              style={styles.menuItem}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.text }}>Omdøb kurv</Text>
            </Pressable>
          ) : null}
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

      {/* C2: søgefeltet "Tilføj vare" står kun i den tomme kurv; med varer
          går "Se alle" under "Glemt noget?" til Søg. */}
      {!items.length ? (
        <Pressable
          onPress={goAddItem}
          accessibilityRole="button"
          accessibilityLabel="Tilføj vare"
          accessibilityHint="Åbner søgning"
          style={[styles.addBar, { backgroundColor: colors.surface }, cardShadow(colors.shadow)]}
        >
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <Text style={[styles.addPlaceholder, { color: colors.textMuted }]}>Tilføj vare</Text>
        </Pressable>
      ) : null}

      {items.length ? winnerCard() : null}
      {items.length && winner && split ? splitCard(winner.name, split) : null}
    </View>
  );

  function winnerCard() {
    if (!winner) {
      if (compareState === 'loading' || (compareState === 'idle' && !compare)) {
        return (
          <View style={[styles.winner, styles.winnerLoading, { backgroundColor: colors.primary }]}>
            <ActivityIndicator color={colors.onPrimary} accessibilityLabel="Sammenligner butikker" />
          </View>
        );
      }
      // Fejl, eller ingen butik har varerne: "Find billigste" kan stadig åbnes.
      return (
        <Pressable
          onPress={() => navigation.navigate('Sco')}
          accessibilityRole="button"
          style={[styles.compareLink, { backgroundColor: colors.surface }, cardShadow(colors.shadow)]}
        >
          <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>
            {compareState === 'error' ? 'Kunne ikke sammenligne lige nu' : 'Sammenlign butikker'}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      );
    }
    return (
      <Pressable
        onPress={() => navigation.navigate('Sco')}
        accessibilityRole="button"
        accessibilityLabel={joinLabel([
          `Billigst i ${winner.name}`,
          spokenKr(winner.totalPrice),
          winner.coverage < winner.totalItems
            ? `har ${winner.coverage} af ${winner.totalItems} varer`
            : null,
          spar > 0 ? `spar ${spokenKr(spar)}` : null,
          ...runnersUp.map(({ store, extra }) =>
            joinLabel([
              store.name,
              spokenKr(store.totalPrice),
              extra && extra.shared > 0 && extra.diff > 0 ? `${spokenKr(extra.diff)} dyrere` : null,
            ]),
          ),
        ])}
        accessibilityHint="Åbner hele sammenligningen"
        style={[styles.winner, { backgroundColor: colors.primary }, cardShadow(colors.shadow)]}
      >
        <View style={styles.winnerTop}>
          <View style={[styles.winnerLogo, { backgroundColor: colors.logoBg }]}>
            <StoreLogo store={winner.name} maxWidth={36} maxHeight={24} minHeight={12} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.winnerLabel, { color: colors.onPrimary }]} numberOfLines={1}>
              Billigst i {winner.name}
            </Text>
            <Text style={[styles.winnerTotal, { color: colors.onPrimary }]}>
              {kr(winner.totalPrice)}
            </Text>
            {winner.coverage < winner.totalItems ? (
              <Text style={[styles.winnerNote, { color: colors.onPrimary }]}>
                Har {winner.coverage} af {winner.totalItems} varer
              </Text>
            ) : null}
          </View>
          {spar > 0 ? (
            <View style={[styles.sparPill, { backgroundColor: colors.deal }]}>
              <Text style={[styles.sparText, { color: colors.dealText }]}>
                Spar {spar.toFixed(2).replace('.', ',')}
              </Text>
            </View>
          ) : null}
        </View>
        {runnersUp.length ? (
          <View style={[styles.runners, { backgroundColor: colors.onPrimarySoft }]}>
            {runnersUp.map(({ store, extra }) => (
              <View key={store.name} style={styles.runnerRow}>
                <View style={[styles.runnerLogo, { backgroundColor: colors.logoBg }]}>
                  <StoreLogo store={store.name} maxWidth={20} maxHeight={16} minHeight={8} />
                </View>
                <Text style={[styles.runnerName, { color: colors.onPrimary }]} numberOfLines={1}>
                  {store.name}
                </Text>
                <Text style={[styles.runnerTotal, { color: colors.onPrimary }]}>{kr(store.totalPrice)}</Text>
                <Text style={[styles.runnerExtra, { color: colors.bannerSoft }]}>
                  {extra && extra.shared > 0 && extra.diff > 0
                    ? `+${extra.diff.toFixed(2).replace('.', ',')}`
                    : store.coverage < store.totalItems
                      ? `mangler ${store.totalItems - store.coverage}`
                      : ''}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>
    );
  }

  /** "Handl i 2 butikker" (C2): "Vis" åbner opdelingen (butiksruten). */
  function splitCard(
    winnerName: string,
    sp: NonNullable<ReturnType<typeof bestTwoStoreSplit>>,
  ) {
    return (
      <Pressable
        onPress={() => navigation.navigate('Route')}
        accessibilityRole="button"
        accessibilityLabel={`Handl i 2 butikker, ${winnerName} og ${sp.other}: ${spokenKr(sp.total)}. Spar ${spokenKr(sp.saving)} mere end kun ${winnerName}`}
        accessibilityHint="Viser hvilke varer du skal købe hvor"
        style={({ pressed }) => [
          styles.split,
          { backgroundColor: colors.surface, borderColor: colors.primary, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <View style={styles.splitLogos}>
          {[winnerName, sp.other].map((name, i) => (
            <View
              key={name}
              style={[
                styles.splitLogo,
                { backgroundColor: colors.logoBg, borderColor: colors.border, marginLeft: i ? -6 : 0 },
              ]}
            >
              <StoreLogo store={name} maxWidth={26} maxHeight={20} minHeight={8} />
            </View>
          ))}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.splitTitle, { color: colors.text }]} numberOfLines={1}>
            Handl i 2 butikker: {kr(sp.total)}
          </Text>
          <Text style={[styles.splitSub, { color: colors.primaryDark }]} numberOfLines={1}>
            Spar {kr(sp.saving)} mere end kun {winnerName}
          </Text>
        </View>
        <View style={[styles.splitBtn, { backgroundColor: colors.primaryMuted }]}>
          <Text style={{ color: colors.primaryDark, fontSize: 13, fontWeight: '700' }}>Vis</Text>
        </View>
      </Pressable>
    );
  }

  // "Lagt i kurven" også når der kommer én mere til inde i kurven (+, swipe,
  // VoiceOver), men ikke ved "−" (Kalle 22-10-2026). Følger Feature kurv_besked.
  const addOne = (item: CartItem) => {
    updateQuantity(item.id, item.quantity + 1);
    showCartToast();
  };

  const renderItemRow = (item: CartItem) => {
    const lineTotal = item.price * item.quantity;
    return (
      <SwipeableCartRow
        key={item.id}
        onAddOne={() => addOne(item)}
        onRemoveAll={() => removeItem(item.id)}
        onSwipeActive={setSwiping}
        enabled={swipeEnabled}
      >
        <View style={[styles.itemRow, { backgroundColor: colors.surface }]}>
          <View
            style={[styles.thumbWrap, { backgroundColor: colors.logoBg }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {item.image ? (
              <Image source={{ uri: item.image }} style={styles.thumb} resizeMode="contain" />
            ) : null}
          </View>

          {/* Varens oplysninger som ét element; stepperen er egne knapper.
              Samme to handlinger som swipe, så de også kan bruges med
              VoiceOver/TalkBack (stryg op/ned og tryk to gange). */}
          <View
            style={styles.itemBody}
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
                addOne(item);
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
            <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>
              {cartItemTitle(item)}
            </Text>
            {item.kgPrice ? (
              <Text style={[styles.itemMeta, { color: colors.textMuted }]} numberOfLines={1}>
                {item.kgPrice.replace('.', ',')}
              </Text>
            ) : item.multiDeal ? (
              <Text style={[styles.itemMeta, { color: colors.badge }]} numberOfLines={1}>
                {item.multiDeal}
              </Text>
            ) : item.unitMeasure ? (
              <Text style={[styles.itemMeta, { color: colors.textMuted }]} numberOfLines={1}>
                {item.unitMeasure}
              </Text>
            ) : null}
          </View>

          <View style={styles.itemPriceCol}>
            <Text
              style={[styles.itemPrice, { color: colors.text }]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              {kr(lineTotal)}
            </Text>
            <QuantityStepper
              variant="row"
              quantity={item.quantity}
              name={cartItemTitle(item)}
              onAdd={() => addOne(item)}
              onRemove={() => updateQuantity(item.id, item.quantity - 1)}
            />
          </View>
        </View>
      </SwipeableCartRow>
    );
  };

  const missingInWinner = winner
    ? winner.missingDetails
        .map((m) => ({ m, item: items.find((i) => i.id === m.cart_id) }))
        .filter((x) => !!x.item)
    : [];

  const itemsCard = (
    <View style={[styles.itemsCard, { backgroundColor: colors.surface }, cardShadow(colors.shadow)]}>
      {groups.map(([cat, catItems], gi) => (
        <View key={cat}>
          {groups.length > 1 ? (
            <Text
              style={[styles.cat, { color: colors.textMuted }, gi > 0 && { marginTop: 6 }]}
              accessibilityRole="header"
              accessibilityLabel={cat}
            >
              {cat.toUpperCase()}
            </Text>
          ) : null}
          {catItems.map((item, idx) => (
            <View key={item.id}>
              {renderItemRow(item)}
              {idx < catItems.length - 1 ? (
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
              ) : null}
            </View>
          ))}
        </View>
      ))}
      {winner
        ? missingInWinner.map(({ m }) => {
            const alt = alternatives[m.cart_id];
            return (
              <View key={m.cart_id} style={[styles.missing, { backgroundColor: colors.warningMuted }]}>
                {m.image ? (
                  <Image source={{ uri: m.image }} style={styles.missingImg} resizeMode="contain" />
                ) : null}
                <View
                  style={{ flex: 1 }}
                  accessible
                  accessibilityLabel={joinLabel([
                    `${m.name} findes ikke i ${winner.name}`,
                    alt ? `forslag: ${alt.alt_name}, ${spokenKr(alt.alt_price)}` : null,
                  ])}
                >
                  <Text style={[styles.missingTitle, { color: colors.text }]} numberOfLines={2}>
                    {m.name} findes ikke i {winner.name}
                  </Text>
                  {alt ? (
                    <Text style={[styles.itemMeta, { color: colors.textMuted }]} numberOfLines={2}>
                      Forslag: {alt.alt_name}, {kr(alt.alt_price)}
                    </Text>
                  ) : null}
                </View>
                {alt ? (
                  <Pressable
                    onPress={() =>
                      replaceItem(
                        alt.cart_id,
                        alternativeAsCartItem(alt, items.find((i) => i.id === alt.cart_id)),
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Byt ${m.name} til ${alt.alt_name}`}
                    hitSlop={6}
                    style={[styles.swapBtn, { backgroundColor: colors.surface }]}
                  >
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Byt</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })
        : null}
    </View>
  );

  return (
    <StackScreenBody style={{ backgroundColor: colors.bg }}>
      <FlatList
        style={{ flex: 1 }}
        scrollEnabled={!swiping}
        data={items.length ? ['items'] : []}
        keyExtractor={(k) => k}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ color: colors.textMuted, textAlign: 'center', fontSize: 15 }}>
              Ingen varer endnu. Tryk «Tilføj vare» for at søge.
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        renderItem={() => (
          <>
            <View style={styles.section}>{itemsCard}</View>
            {forgot.length ? (
              <View style={styles.forgot}>
                <View style={styles.forgotHead}>
                  <Text style={[styles.forgotTitle, { color: colors.text }]} accessibilityRole="header">
                    Glemt noget? Du plejer at købe
                  </Text>
                  <Pressable
                    onPress={goAddItem}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Se alle du plejer at købe"
                  >
                    <Text style={{ color: colors.primaryDark, fontSize: 13, fontWeight: '600' }}>Se alle</Text>
                  </Pressable>
                </View>
                <ForgotPills items={forgot} />
              </View>
            ) : null}
          </>
        )}
      />

      {items.length > 0 ? (
        <View style={[styles.footerPad, { backgroundColor: colors.bg }]}>
          {/* Åbner den eksisterende butiksrute (RouteScreen). */}
          <Pressable
            onPress={() => navigation.navigate('Route')}
            accessibilityRole="button"
            accessibilityLabel={winner ? `Vis vej til ${winner.name}` : 'Vis butiksrute'}
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: colors.text, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons name="location" size={18} color={colors.surface} />
            <Text style={[styles.ctaLabel, { color: colors.surface }]}>
              {winner ? `Vis vej til ${winner.name}` : 'Vis butiksrute'}
            </Text>
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
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subTitle: { fontSize: 13, marginTop: 2 },
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
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
    borderRadius: 16,
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
    borderRadius: 999,
    height: 48,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  addPlaceholder: { fontSize: 15, flex: 1 },
  winner: { borderRadius: 24, padding: 16, marginBottom: 4 },
  winnerLoading: { height: 112, alignItems: 'center', justifyContent: 'center' },
  winnerTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  winnerLogo: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  winnerLabel: { fontSize: 14, fontWeight: '600' },
  winnerTotal: { fontSize: 30, fontWeight: '900', letterSpacing: -0.5, lineHeight: 34 },
  winnerNote: { fontSize: 12, opacity: 0.9 },
  sparPill: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, justifyContent: 'center' },
  sparText: { fontSize: 13, fontWeight: '800' },
  runners: { borderRadius: 16, marginTop: 14, paddingHorizontal: 12, paddingVertical: 4 },
  runnerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  runnerLogo: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  runnerName: { flex: 1, fontSize: 14, fontWeight: '500' },
  runnerTotal: { fontSize: 14, fontWeight: '700' },
  runnerExtra: { minWidth: 52, textAlign: 'right', fontSize: 12 },
  split: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 12,
    borderRadius: 22,
    borderWidth: 1.5,
  },
  splitLogos: { flexDirection: 'row' },
  splitLogo: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  splitTitle: { fontSize: 14, fontWeight: '700' },
  splitSub: { fontSize: 12, fontWeight: '600', marginTop: 1 },
  splitBtn: { height: 34, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center' },
  forgot: { paddingHorizontal: 16, marginTop: 16, gap: 10 },
  forgotHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  forgotTitle: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
  compareLink: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    padding: 16,
    marginBottom: 4,
  },
  listContent: { paddingBottom: 16 },
  empty: { paddingHorizontal: 32, paddingTop: 48 },
  section: { paddingHorizontal: 16, marginTop: 12 },
  itemsCard: { borderRadius: 24, paddingVertical: 6, overflow: 'hidden' },
  cat: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 2,
    marginLeft: 14,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
  },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 78 },
  thumbWrap: {
    width: 54,
    height: 54,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: { width: 46, height: 46 },
  itemBody: { flex: 1, minWidth: 0, gap: 2 },
  itemName: { fontSize: 14, fontWeight: '600' },
  itemMeta: { fontSize: 12 },
  itemPriceCol: { alignItems: 'flex-end', gap: 6 },
  itemPrice: { fontSize: 15, fontWeight: '800' },
  missing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    padding: 10,
    margin: 10,
    marginBottom: 6,
  },
  missingImg: { width: 44, height: 44, borderRadius: 14 },
  missingTitle: { fontSize: 13, fontWeight: '700' },
  swapBtn: { height: 36, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center' },
  footerPad: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    height: 54,
    gap: 8,
  },
  ctaLabel: {
    fontWeight: '700',
    fontSize: 16,
  },
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
