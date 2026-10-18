import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../theme/Typography';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  quantity: number;
  /** Navnet bruges i etiketterne, så ti steppere i en liste kan skelnes. */
  name: string;
  onAdd: () => void;
  onRemove: () => void;
  /**
   * `card`: produktkortet - rund lysegrøn "+" uden for kurven, grøn pille i
   * den. `row`: kurvens lille grå pille.
   */
  variant?: 'card' | 'row';
};

/**
 * "+" der bliver til "− 1 +" (version C). Tryk når antallet er 1 og man
 * trykker "−", fjerner varen (CartContext.updateQuantity med 0).
 */
export function QuantityStepper({ quantity, name, onAdd, onRemove, variant = 'card' }: Props) {
  const { colors } = useTheme();

  if (variant === 'card' && quantity <= 0) {
    return (
      <Pressable
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel={`Læg ${name} i kurv`}
        style={({ pressed }) => [
          styles.addRound,
          { backgroundColor: colors.primaryMuted, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Ionicons name="add" size={26} color={colors.primaryDark} />
      </Pressable>
    );
  }

  const row = variant === 'row';
  const fg = row ? colors.primary : colors.onPrimary;
  const btn = row ? styles.btnRow : styles.btnCard;
  // Kurvens pille er 30 høj; hitSlop giver alligevel et tryk-mål på 44.
  const slop = row ? { top: 7, bottom: 7, left: 4, right: 4 } : { top: 2, bottom: 2, left: 4, right: 4 };
  return (
    <View
      style={[
        row ? styles.pillRow : styles.pillCard,
        { backgroundColor: row ? colors.stepperBg : colors.primary },
      ]}
    >
      <Pressable
        onPress={onRemove}
        hitSlop={slop}
        accessibilityRole="button"
        accessibilityLabel={quantity <= 1 ? `Fjern ${name} fra kurven` : `Fjern en ${name}`}
        style={({ pressed }) => [btn, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Ionicons name="remove" size={row ? 16 : 20} color={fg} />
      </Pressable>
      <Text
        style={[styles.qty, { color: row ? colors.text : colors.onPrimary, fontSize: row ? 13 : 15 }]}
        accessibilityLabel={`${quantity} i kurven`}
      >
        {quantity}
      </Text>
      <Pressable
        onPress={onAdd}
        hitSlop={slop}
        accessibilityRole="button"
        accessibilityLabel={`Tilføj en ${name}`}
        style={({ pressed }) => [btn, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Ionicons name="add" size={row ? 16 : 20} color={fg} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  addRound: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillCard: {
    height: 40,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  pillRow: {
    height: 30,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  btnCard: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  btnRow: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  qty: { minWidth: 16, textAlign: 'center', fontWeight: '800' },
});
