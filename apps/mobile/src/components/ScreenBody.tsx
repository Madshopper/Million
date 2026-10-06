import React, { useState } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useHeaderHeight } from '@react-navigation/elements';

/**
 * Giver scroll-children en begrænset højde.
 * Uden det kan Yoga lade FlatList/ScrollView vokse med indholdet,
 * så indholdet klippes af parent uden at der kan scrolls.
 */

/** Tab-skærme (Home, Cart, Profile). */
export function TabScreenBody({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const bodyHeight = Math.max(200, windowHeight - headerHeight - tabBarHeight);

  return (
    <MeasuredBody fallbackHeight={bodyHeight} maxHeight={windowHeight} style={style}>
      {children}
    </MeasuredBody>
  );
}

/** Stack-skærme (ProductDetail, Category, Search, …). */
export function StackScreenBody({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const headerHeight = useHeaderHeight();
  const bodyHeight = Math.max(200, windowHeight - headerHeight);

  return (
    <MeasuredBody fallbackHeight={bodyHeight} maxHeight={windowHeight} style={style}>
      {children}
    </MeasuredBody>
  );
}

/**
 * Den beregnede højde (vindue minus header/fanebjælke) passer på iPhone,
 * men på Android (edge-to-edge) blev den for lav: den nederste femtedel af
 * kategori, tilbud, produktside og kurv stod tom, og indholdet blev skåret
 * af midt i et varekort. Vi måler derfor den plads skærmen reelt har og
 * bruger den. Den beregnede højde bruges kun indtil målingen er klar, og
 * hvis målingen er urimelig (højere end vinduet = forælderen voksede med
 * indholdet, som var den oprindelige grund til den faste højde).
 */
function MeasuredBody({
  children,
  style,
  fallbackHeight,
  maxHeight,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  fallbackHeight: number;
  maxHeight: number;
}) {
  const [measured, setMeasured] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h !== measured) setMeasured(h);
  };
  const height = measured >= 200 && measured <= maxHeight ? measured : fallbackHeight;

  return (
    <View style={styles.fill} onLayout={onLayout}>
      <View style={[styles.fill, { height, maxHeight: height }, style]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
});
