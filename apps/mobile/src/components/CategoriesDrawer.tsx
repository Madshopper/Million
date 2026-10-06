import React from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CATEGORY_LINKS, useCategoryLinks } from '../categories/categories';
import { useTheme } from '../theme/ThemeContext';

type CategoryLink = (typeof CATEGORY_LINKS)[number];

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Kaldes når skuffen er gledet helt ud, så navigationen ikke sker bag den. */
  onSelect: (category: CategoryLink) => void;
};

/**
 * Kategorimenu som en skuffe, der glider ind fra venstre oven på forsiden
 * (åbnes af forsidens "Kategorier"-knap). Forsiden bliver synlig bag en
 * dæmpet baggrund; tryk dér eller på krydset lukker. Bevidst neutrale farver:
 * kun Ugens Tilbud får tilbudsfarven gul, så den skiller sig ud.
 */
export function CategoriesDrawer({ visible, onClose, onSelect }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const categoryLinks = useCategoryLinks();
  const { width: windowWidth } = useWindowDimensions();
  const drawerWidth = Math.min(320, Math.round(windowWidth * 0.8));

  // Modal'en skal blive stående, mens skuffen glider ud, så den har sin egen
  // "mounted"-tilstand ved siden af visible.
  const [mounted, setMounted] = React.useState(visible);
  const progress = React.useRef(new Animated.Value(0)).current;
  const pending = React.useRef<CategoryLink | null>(null);

  React.useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 240 : 200,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || visible) return;
      setMounted(false);
      const chosen = pending.current;
      pending.current = null;
      if (chosen) onSelect(chosen);
    });
    // onSelect bevidst udeladt: en ny funktion pr. render må ikke genstarte animationen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, progress]);

  if (!mounted) return null;

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-drawerWidth, 0],
  });

  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: progress }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Luk kategorier"
            onPress={onClose}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.drawer,
            {
              width: drawerWidth,
              backgroundColor: colors.surface,
              borderRightColor: colors.border,
              paddingTop: insets.top + 8,
              transform: [{ translateX }],
            },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>Kategorier</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Luk"
              hitSlop={10}
              onPress={onClose}
            >
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingVertical: 8, paddingBottom: insets.bottom + 16 }}>
            {categoryLinks.map((c) => {
              const isSale = c.slug === 'sale';
              return (
                <Pressable
                  key={c.slug}
                  accessibilityRole="button"
                  accessibilityLabel={c.label}
                  onPress={() => {
                    pending.current = c;
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: isSale ? colors.warningMuted : 'transparent',
                      opacity: pressed ? 0.6 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    name={c.icon}
                    size={22}
                    color={isSale ? colors.warning : colors.textMuted}
                  />
                  <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
                    {c.label}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
              );
            })}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 20, fontWeight: '800' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 8,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 12,
  },
  label: { flex: 1, fontSize: 16, fontWeight: '600' },
});
