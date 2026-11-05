/**
 * Jule-pynten på appens forside (Feature 'jul_tema', Kalle 05-11-2026):
 * girlande under toppen, sne der falder langsomt bag indholdet og en
 * snebunke i bunden af listen. Samme tegninger som webbens
 * static/images/jul-*.svg. Sneen står stille, hvis telefonen har
 * "Reducer bevægelse" slået til.
 */
import React from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useTheme } from '../theme/ThemeContext';

const GARLAND_XML = '<svg width="100%" height="40"><defs><pattern id="g" width="160" height="40" patternUnits="userSpaceOnUse"><g transform="scale(1.3333)"><rect x="28.4" y="9.6" width="3.2" height="3" rx=".6" fill="#9ca3af"/><ellipse cx="30" cy="16.0" rx="3.3" ry="4.4" fill="#dc2626"/><ellipse cx="28.9" cy="14.6" rx=".9" ry="1.5" fill="#fff" opacity=".55"/><rect x="58.4" y="12" width="3.2" height="3" rx=".6" fill="#9ca3af"/><ellipse cx="60" cy="18.4" rx="3.3" ry="4.4" fill="#f59e0b"/><ellipse cx="58.9" cy="17" rx=".9" ry="1.5" fill="#fff" opacity=".55"/><rect x="88.4" y="9.6" width="3.2" height="3" rx=".6" fill="#9ca3af"/><ellipse cx="90" cy="16.0" rx="3.3" ry="4.4" fill="#3b82f6"/><ellipse cx="88.9" cy="14.6" rx=".9" ry="1.5" fill="#fff" opacity=".55"/><path d="M0 4Q60 24 120 4" fill="none" stroke="#14532d" stroke-width="6.4" stroke-linecap="round"/><path d="M0 4Q60 24 120 4" fill="none" stroke="#16a34a" stroke-width="4.6" stroke-dasharray="1.6 2.2"/><path d="M0 4Q60 24 120 4" fill="none" stroke="#4ade80" stroke-width="1.6" stroke-dasharray="1 4" opacity=".8"/><g transform="translate(0 4)"><path d="M0 0c-3-3.6-7.4-3-6.4-.4.6 1.6 3.8 1.4 6.4.4Zm0 0c3-3.6 7.4-3 6.4-.4-.6 1.6-3.8 1.4-6.4.4Z" fill="#dc2626"/><path d="M0 0l-3 6.2M0 0l3 6.2" stroke="#dc2626" stroke-width="1.8" stroke-linecap="round"/><circle r="1.6" fill="#b91c1c"/></g><g transform="translate(120 4)"><path d="M0 0c-3-3.6-7.4-3-6.4-.4.6 1.6 3.8 1.4 6.4.4Zm0 0c3-3.6 7.4-3 6.4-.4-.6 1.6-3.8 1.4-6.4.4Z" fill="#dc2626"/><path d="M0 0l-3 6.2M0 0l3 6.2" stroke="#dc2626" stroke-width="1.8" stroke-linecap="round"/><circle r="1.6" fill="#b91c1c"/></g></g></pattern></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>';
const SNOW_LIGHT = '<svg width="100%" height="100%"><defs><pattern id="s" width="300" height="300" patternUnits="userSpaceOnUse"><g fill="#93c5fd" opacity=".75"><circle cx="97.1" cy="45.3" r="2.0"/><circle cx="21.7" cy="160.8" r="1.6"/><circle cx="17.4" cy="152.2" r="1.2"/><circle cx="130.1" cy="21.0" r="1.3"/><circle cx="127.4" cy="248.1" r="1.3"/><circle cx="67.0" cy="188.2" r="2.3"/><circle cx="173.1" cy="119.0" r="2.4"/><circle cx="14.0" cy="257.5" r="1.5"/><circle cx="43.3" cy="35.3" r="1.6"/><circle cx="244.8" cy="54.2" r="1.9"/><circle cx="191.7" cy="111.7" r="1.9"/><circle cx="18.8" cy="17.9" r="1.4"/><circle cx="204.1" cy="128.3" r="1.6"/><circle cx="175.7" cy="136.0" r="1.6"/><circle cx="238.3" cy="209.7" r="1.5"/><circle cx="172.3" cy="157.6" r="2.3"/><circle cx="218.8" cy="86.4" r="2.4"/><circle cx="35.4" cy="125.4" r="2.1"/><circle cx="45.6" cy="146.7" r="1.2"/><circle cx="200.5" cy="229.4" r="1.9"/><circle cx="262.6" cy="94.1" r="2.0"/><circle cx="178.3" cy="174.0" r="1.7"/></g></pattern></defs><rect width="100%" height="100%" fill="url(#s)"/></svg>';
const SNOW_DARK = '<svg width="100%" height="100%"><defs><pattern id="s" width="300" height="300" patternUnits="userSpaceOnUse"><g fill="#ffffff" opacity=".55"><circle cx="97.1" cy="45.3" r="2.0"/><circle cx="21.7" cy="160.8" r="1.6"/><circle cx="17.4" cy="152.2" r="1.2"/><circle cx="130.1" cy="21.0" r="1.3"/><circle cx="127.4" cy="248.1" r="1.3"/><circle cx="67.0" cy="188.2" r="2.3"/><circle cx="173.1" cy="119.0" r="2.4"/><circle cx="14.0" cy="257.5" r="1.5"/><circle cx="43.3" cy="35.3" r="1.6"/><circle cx="244.8" cy="54.2" r="1.9"/><circle cx="191.7" cy="111.7" r="1.9"/><circle cx="18.8" cy="17.9" r="1.4"/><circle cx="204.1" cy="128.3" r="1.6"/><circle cx="175.7" cy="136.0" r="1.6"/><circle cx="238.3" cy="209.7" r="1.5"/><circle cx="172.3" cy="157.6" r="2.3"/><circle cx="218.8" cy="86.4" r="2.4"/><circle cx="35.4" cy="125.4" r="2.1"/><circle cx="45.6" cy="146.7" r="1.2"/><circle cx="200.5" cy="229.4" r="1.9"/><circle cx="262.6" cy="94.1" r="2.0"/><circle cx="178.3" cy="174.0" r="1.7"/></g></pattern></defs><rect width="100%" height="100%" fill="url(#s)"/></svg>';
const SNOW_BIG_LIGHT = '<svg width="100%" height="100%"><defs><pattern id="b" width="420" height="420" patternUnits="userSpaceOnUse"><g fill="#93c5fd" opacity=".6"><circle cx="190.0" cy="235.1" r="4.1"/><circle cx="195.6" cy="213.3" r="3.5"/><circle cx="77.6" cy="215.0" r="3.6"/><circle cx="333.1" cy="39.5" r="3.1"/><circle cx="38.1" cy="340.1" r="3.7"/><circle cx="17.6" cy="412.5" r="4.1"/><circle cx="274.6" cy="258.5" r="2.9"/><circle cx="6.3" cy="221.9" r="2.7"/><circle cx="79.9" cy="101.6" r="2.6"/><circle cx="194.9" cy="185.0" r="3.9"/></g></pattern></defs><rect width="100%" height="100%" fill="url(#b)"/></svg>';
const SNOW_BIG_DARK = '<svg width="100%" height="100%"><defs><pattern id="b" width="420" height="420" patternUnits="userSpaceOnUse"><g fill="#ffffff" opacity=".45"><circle cx="190.0" cy="235.1" r="4.1"/><circle cx="195.6" cy="213.3" r="3.5"/><circle cx="77.6" cy="215.0" r="3.6"/><circle cx="333.1" cy="39.5" r="3.1"/><circle cx="38.1" cy="340.1" r="3.7"/><circle cx="17.6" cy="412.5" r="4.1"/><circle cx="274.6" cy="258.5" r="2.9"/><circle cx="6.3" cy="221.9" r="2.7"/><circle cx="79.9" cy="101.6" r="2.6"/><circle cx="194.9" cy="185.0" r="3.9"/></g></pattern></defs><rect width="100%" height="100%" fill="url(#b)"/></svg>';
const DRIFT_LIGHT = '<svg width="100%" height="48"><defs><pattern id="d" width="240" height="48" patternUnits="userSpaceOnUse"><path d="M0 48V26Q30 6 62 20Q92 32 122 14Q152 0 184 18Q212 32 240 26V48Z" fill="#ffffff"/><path d="M0 26Q30 6 62 20Q92 32 122 14Q152 0 184 18Q212 32 240 26" fill="none" stroke="#bfdbfe" stroke-width="2"/></pattern></defs><rect width="100%" height="100%" fill="url(#d)"/></svg>';
const DRIFT_DARK = '<svg width="100%" height="48"><defs><pattern id="d" width="240" height="48" patternUnits="userSpaceOnUse"><path d="M0 48V26Q30 6 62 20Q92 32 122 14Q152 0 184 18Q212 32 240 26V48Z" fill="#e2e8f0"/><path d="M0 26Q30 6 62 20Q92 32 122 14Q152 0 184 18Q212 32 240 26" fill="none" stroke="#94a3b8" stroke-width="2"/></pattern></defs><rect width="100%" height="100%" fill="url(#d)"/></svg>';

const hidden = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants' as const,
};

/** Girlanden øverst i forsidens liste: hænger under toppen og ruller væk med
 * indholdet, så den aldrig ligger hen over varerne. */
export function JulGarland() {
  return (
    <View style={styles.garland} pointerEvents="none" {...hidden}>
      <SvgXml xml={GARLAND_XML} width="100%" height={40} />
    </View>
  );
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduce(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** Et lag sne, der glider en hel tern ned og starter forfra (ser uendeligt ud). */
function SnowLayer({ xml, tile, seconds, still }: { xml: string; tile: number; seconds: number; still: boolean }) {
  const y = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (still) {
      y.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(y, {
        toValue: tile,
        duration: seconds * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [still, tile, seconds, y]);
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { top: -tile, transform: [{ translateY: y }] }]}
    >
      <SvgXml xml={xml} width="100%" height="100%" />
    </Animated.View>
  );
}

/** Sne der falder langsomt bag forsidens indhold. */
export function JulSnow() {
  const { isDark } = useTheme();
  const still = useReduceMotion();
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} pointerEvents="none" {...hidden}>
      <SnowLayer xml={isDark ? SNOW_DARK : SNOW_LIGHT} tile={300} seconds={40} still={still} />
      <SnowLayer xml={isDark ? SNOW_BIG_DARK : SNOW_BIG_LIGHT} tile={420} seconds={34} still={still} />
    </View>
  );
}

/** Snebunken nederst i forsidens liste. */
export function JulSnowDrift() {
  const { isDark } = useTheme();
  return (
    <View style={styles.drift} pointerEvents="none" {...hidden}>
      <SvgXml xml={isDark ? DRIFT_DARK : DRIFT_LIGHT} width="100%" height={48} />
    </View>
  );
}

const styles = StyleSheet.create({
  garland: { height: 40 },
  drift: { height: 48, marginTop: 24 },
});
