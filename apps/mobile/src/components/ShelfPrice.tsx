import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../theme/Typography';
import { spokenKr } from '../a11y/speech';

/** "22,45 kr" med komma (skrift og tale ens). Bor nu i format/kr.ts. */
export { kr } from '../format/kr';

/**
 * Pris som et hyldeskilt (version C): kroner store, ører små og hævet,
 * fx "15" + "00". Én samlet etiket for skærmlæseren.
 */
export function ShelfPrice({
  value,
  color,
  size = 26,
}: {
  value: number;
  color: string;
  size?: number;
}) {
  const [whole, ore] = value.toFixed(2).split('.');
  return (
    <View style={styles.row} accessible accessibilityLabel={spokenKr(value)}>
      <Text
        style={{
          color,
          fontSize: size,
          lineHeight: Math.round(size * 1.1),
          fontWeight: '900',
          letterSpacing: -0.8,
        }}
      >
        {whole}
      </Text>
      <Text
        style={{
          color,
          fontSize: Math.round(size / 2),
          lineHeight: Math.round(size * 0.62),
          fontWeight: '800',
          marginLeft: 1,
          marginTop: Math.round(size * 0.1),
        }}
      >
        {ore}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
});
