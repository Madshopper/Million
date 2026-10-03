import React from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CATEGORY_LINKS } from '../categories/categories';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from '../navigation/types';

/**
 * Kategorimenu der glider ind fra venstre over forsiden (Kalle 03-10-2026:
 * "en åbningsmenu som slider ind fra venstre" i stedet for en hel skærm).
 * Bygget på Modal + Animated, så den ikke kræver en drawer-navigator eller
 * nye native afhængigheder. Tryk på den mørke baggrund lukker den.
 * Neutrale farver; kun Ugens Tilbud er gul.
 */
export function CategoriesDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(320, Math.round(width * 0.8));

  const progress = React.useRef(new Animated.Value(0)).current;
  // Modal'en skal blive stående mens lukke-animationen kører.
  const [mounted, setMounted] = React.useState(open);

  React.useEffect(() => {
    if (open) setMounted(true);
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: open ? 240 : 200,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
  }, [open, progress]);

  const go = (slug: string, label: string) => {
    onClose();
    if (slug === 'sale') navigation.navigate('Sale');
    else navigation.navigate('Category', { slug, title: label });
  };

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-panelWidth, 0],
  });

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Luk kategorier"
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.panel,
            {
              width: panelWidth,
              backgroundColor: colors.surface,
              paddingTop: insets.top + 12,
              paddingBottom: insets.bottom + 12,
              transform: [{ translateX }],
            },
          ]}
        >
          <View style={styles.head}>
            <Text style={[styles.title, { color: colors.text }]}>Kategorier</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Luk"
            >
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView>
            {CATEGORY_LINKS.map((c) => {
              const isSale = c.slug === 'sale';
              return (
                <Pressable
                  key={c.slug}
                  accessibilityRole="button"
                  accessibilityLabel={c.label}
                  onPress={() => go(c.slug, c.label)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: isSale
                        ? colors.warningMuted
                        : pressed
                          ? colors.bg
                          : 'transparent',
                    },
                  ]}
                >
                  <Ionicons
                    name={c.icon}
                    size={22}
                    color={isSale ? colors.warning : colors.textMuted}
                  />
                  <Text style={[styles.label, { color: colors.text }]}>{c.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
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
  backdrop: { backgroundColor: 'rgba(0,0,0,0.4)' },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 2, height: 0 },
    elevation: 12,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 12,
  },
  title: { fontSize: 22, fontWeight: '800' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 2,
  },
  label: { flex: 1, fontSize: 16, fontWeight: '600' },
});
