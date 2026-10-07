import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { catalogLabel, fetchPages, type FlyerCatalog, type FlyerPage } from '../flyers/flyers';

type Props = {
  visible: boolean;
  storeLabel: string;
  catalogs: FlyerCatalog[];
  onClose: () => void;
};

/**
 * Butikkens tilbudsavis som overlay oven på forsiden, så man aldrig forlader
 * appen. Swipe blader, knapperne nederst gør det samme (og kan bruges med
 * VoiceOver/TalkBack), og hver side kan zoomes (iOS: knib). Har butikken
 * flere aviser, vælges de i fanerne øverst. Samme som hjemmesidens overlay
 * (static/js/flyers.js).
 */
export function FlyerViewer({ visible, storeLabel, catalogs, onClose }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const listRef = React.useRef<FlatList<FlyerPage>>(null);
  const [catalog, setCatalog] = React.useState<FlyerCatalog | null>(null);
  const [pages, setPages] = React.useState<FlyerPage[]>([]);
  const [index, setIndex] = React.useState(0);
  const [status, setStatus] = React.useState<'loading' | 'error' | 'ok'>('loading');

  React.useEffect(() => {
    if (visible) setCatalog(catalogs[0] ?? null);
    else {
      setCatalog(null);
      setPages([]);
    }
  }, [visible, catalogs]);

  React.useEffect(() => {
    if (!catalog) return;
    let cancelled = false;
    setStatus('loading');
    setPages([]);
    setIndex(0);
    fetchPages(catalog.id)
      .then((p) => {
        if (cancelled) return;
        setPages(p);
        setStatus(p.length ? 'ok' : 'error');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [catalog]);

  const go = (delta: number) => {
    const next = Math.min(Math.max(index + delta, 0), pages.length - 1);
    if (next === index) return;
    setIndex(next);
    listRef.current?.scrollToIndex({ index: next, animated: true });
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(i);
  };

  const pageHeight = Math.max(200, height - insets.top - insets.bottom - 170);

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.top}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
            Tilbudsavis fra {storeLabel}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Luk avisen"
            hitSlop={10}
            style={styles.close}
          >
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </Pressable>
        </View>

        {catalogs.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabsScroll}
            contentContainerStyle={styles.tabs}
          >
            {catalogs.map((c) => {
              const active = c.id === catalog?.id;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setCatalog(c)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.tab,
                    active && { backgroundColor: colors.primarySolid, borderColor: colors.primarySolid },
                  ]}
                >
                  <Text style={styles.tabText}>{catalogLabel(c)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <View style={{ height: pageHeight, justifyContent: 'center' }}>
          {status === 'ok' ? (
            <FlatList
              ref={listRef}
              data={pages}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(_, i) => `${catalog?.id}-${i}`}
              onMomentumScrollEnd={onScrollEnd}
              getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
              initialNumToRender={2}
              windowSize={3}
              renderItem={({ item, index: i }) => (
                <ScrollView
                  style={{ width, height: pageHeight }}
                  contentContainerStyle={styles.pageWrap}
                  maximumZoomScale={3}
                  minimumZoomScale={1}
                  centerContent
                  showsHorizontalScrollIndicator={false}
                  showsVerticalScrollIndicator={false}
                >
                  <Image
                    source={{ uri: width > 500 && item.zoom ? item.zoom : item.view }}
                    style={{ width: width - 16, height: pageHeight }}
                    resizeMode="contain"
                    accessible
                    accessibilityLabel={`${storeLabel}, ${catalog?.label ?? 'tilbudsavis'}, side ${i + 1} af ${pages.length}`}
                  />
                </ScrollView>
              )}
            />
          ) : status === 'loading' ? (
            <ActivityIndicator color="#FFFFFF" accessibilityLabel="Henter avisen" />
          ) : (
            <Text style={styles.status} accessibilityRole="alert">
              Avisen kunne ikke hentes. Prøv igen om lidt.
            </Text>
          )}
        </View>

        <View style={styles.bottom}>
          <Pressable
            onPress={() => go(-1)}
            disabled={index === 0 || status !== 'ok'}
            accessibilityRole="button"
            accessibilityLabel="Forrige side"
            hitSlop={10}
            style={[styles.nav, (index === 0 || status !== 'ok') && styles.navDisabled]}
          >
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          </Pressable>
          <View style={styles.counterWrap}>
            <Text style={styles.counter} accessibilityLiveRegion="polite">
              {status === 'ok' ? `Side ${index + 1} af ${pages.length}` : ' '}
            </Text>
            <Text style={styles.source}>Kilde: eTilbudsavis</Text>
          </View>
          <Pressable
            onPress={() => go(1)}
            disabled={index >= pages.length - 1 || status !== 'ok'}
            accessibilityRole="button"
            accessibilityLabel="Næste side"
            hitSlop={10}
            style={[styles.nav, (index >= pages.length - 1 || status !== 'ok') && styles.navDisabled]}
          >
            <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111827' },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
  },
  title: { flex: 1, color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabsScroll: { flexGrow: 0, marginTop: 10 },
  tabs: { paddingHorizontal: 16, gap: 6 },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  tabText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  pageWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  status: { color: '#FFFFFF', textAlign: 'center', fontWeight: '600', paddingHorizontal: 24 },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 'auto',
  },
  nav: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navDisabled: { opacity: 0.3 },
  counterWrap: { alignItems: 'center' },
  counter: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  source: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 2 },
});
