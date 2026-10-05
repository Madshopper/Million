import React, { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

/**
 * En kurvlinje man kan swipe på (Kalle 05-10-2026):
 *  - mod venstre: hele varen ud af kurven, alle stk ("Fjern fra kurv", rød)
 *  - mod højre: én mere af varen ("Tilføj til kurv", grøn)
 * (Byttet om efter Kalles første prøve i simulatoren.)
 *
 * Knapperne på linjen virker som før; swipe er kun en ekstra vej. Bygget på
 * React Natives egen PanResponder, så appen ikke får et nyt indbygget modul.
 * Skærmlæseren får de samme to handlinger via accessibilityActions på
 * linjen i CartScreen, fordi VoiceOver selv bruger swipe-bevægelserne.
 */

/** Hvor langt man skal swipe, før handlingen sker (andel af bredden). */
const TRIGGER_SHARE = 0.3;
const TRIGGER_MIN_PX = 80;

type Props = {
  onAddOne: () => void;
  onRemoveAll: () => void;
  /** Kaldes når et swipe starter/slutter, så listen kan holde op med at rulle. */
  onSwipeActive?: (active: boolean) => void;
  children: React.ReactNode;
};

export function SwipeableCartRow({ onAddOne, onRemoveAll, onSwipeActive, children }: Props) {
  const { colors } = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const widthRef = useRef(0);
  const [width, setWidth] = useState(0);

  // Callbacks i en ref, så PanResponder kun bygges én gang, men altid kalder
  // den nyeste version (antallet ændrer sig mellem to swipes).
  const cb = useRef({ onAddOne, onRemoveAll, onSwipeActive });
  cb.current = { onAddOne, onRemoveAll, onSwipeActive };

  const responder = useMemo(() => {
    // Kun vandrette bevægelser er et swipe; lodrette lader listen rulle.
    const isHorizontal = (dx: number, dy: number) =>
      Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5;

    const finish = (dx: number) => {
      cb.current.onSwipeActive?.(false);
      const w = widthRef.current || 320;
      const trigger = Math.max(TRIGGER_MIN_PX, w * TRIGGER_SHARE);
      if (dx <= -trigger) {
        Animated.timing(translateX, {
          toValue: -w,
          duration: 160,
          useNativeDriver: true,
        }).start(() => {
          cb.current.onRemoveAll();
          // Forsvinder linjen ikke (fx en delt kurv der ikke svarede), skal
          // den ikke blive hængende uden for skærmen.
          setTimeout(() => translateX.setValue(0), 600);
        });
        return;
      }
      if (dx >= trigger) cb.current.onAddOne();
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
      }).start();
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      // Capture: et swipe der starter på "+"/"−"-knappen skal også virke.
      onMoveShouldSetPanResponderCapture: (_e, g) => isHorizontal(g.dx, g.dy),
      onMoveShouldSetPanResponder: (_e, g) => isHorizontal(g.dx, g.dy),
      onPanResponderGrant: () => cb.current.onSwipeActive?.(true),
      onPanResponderMove: (_e, g) => translateX.setValue(g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_e, g) => finish(g.dx),
      onPanResponderTerminate: () => finish(0),
    });
  }, [translateX]);

  const w = width || 320;
  // Teksten bag linjen tones frem i den side man swiper mod.
  const addOpacity = translateX.interpolate({
    inputRange: [0, 24],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const removeOpacity = translateX.interpolate({
    inputRange: [-24, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  // Lidt større tekst når man er forbi grænsen, så man kan mærke det.
  const trigger = Math.max(TRIGGER_MIN_PX, w * TRIGGER_SHARE);
  const addScale = translateX.interpolate({
    inputRange: [trigger - 1, trigger],
    outputRange: [1, 1.08],
    extrapolate: 'clamp',
  });
  const removeScale = translateX.interpolate({
    inputRange: [-trigger, -trigger + 1],
    outputRange: [1.08, 1],
    extrapolate: 'clamp',
  });

  return (
    <View
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width;
        setWidth(e.nativeEvent.layout.width);
      }}
    >
      {/* Ren pynt: skærmlæseren får handlingerne på selve linjen. */}
      <View
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.bgRight,
            { backgroundColor: colors.saleSolid, opacity: removeOpacity },
          ]}
        >
          <Animated.Text style={[styles.label, { transform: [{ scale: removeScale }] }]}>
            Fjern fra kurv
          </Animated.Text>
        </Animated.View>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.bgLeft,
            { backgroundColor: colors.primarySolid, opacity: addOpacity },
          ]}
        >
          <Animated.Text style={[styles.label, { transform: [{ scale: addScale }] }]}>
            Tilføj til kurv
          </Animated.Text>
        </Animated.View>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...responder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  bgLeft: { justifyContent: 'center', alignItems: 'flex-start', paddingLeft: 20 },
  bgRight: { justifyContent: 'center', alignItems: 'flex-end', paddingRight: 20 },
  label: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
