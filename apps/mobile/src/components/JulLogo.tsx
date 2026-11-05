/**
 * Jule-logoet (Feature-panelet 'jul_tema' i /admin, forslag A "Nissen i
 * kurven", Kalle 05-11-2026): den normale kurv med en nisse der blinker og
 * holder en slikstok. Samme tegning som webbens templates/partials/jul_logo.html.
 *
 * Vises kun, når /api/home siger jul_tema_enabled, så hjemmesiden og appen
 * skifter samtidig. På dev.madshopper.dk (MadShopper Test) er det altid til.
 * Ikonet på hjemmeskærmen skifter ikke.
 */
import React, { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

let enabled = false;
const listeners = new Set<() => void>();

/** Kaldes af HomeScreen med /api/home's jul_tema_enabled. */
export function setServerJulTemaEnabled(on: boolean | undefined) {
  const next = !!on;
  if (next === enabled) return;
  enabled = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useJulTemaEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabled);
}

const XML =
  '<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#059669"/><defs><clipPath id="jul-rim-app"><rect width="64" height="26.3"/></clipPath></defs><g clip-path="url(#jul-rim-app)"><path d="M25 30C24.5 24 26 19.5 28 18h10c2 1.5 3.5 6 3 12Z" fill="#dc2626" stroke="#065f46" stroke-width="1"/><circle cx="33" cy="17.6" r="5.6" fill="#fde2c8" stroke="#065f46" stroke-width="1"/><path d="M27.6 18.4c0 6 2.4 9 5.4 9s5.4-3 5.4-9c-1.2 1.6-3 2.2-5.4 2.2s-4.2-.6-5.4-2.2Z" fill="#fff" stroke="#065f46" stroke-width=".9"/><path d="M30.6 22.6q2.4 1.8 4.8 0" fill="none" stroke="#1f2937" stroke-width="1.1" stroke-linecap="round"/><path d="M29.4 16.8q1.4-1.6 2.8 0" fill="none" stroke="#1f2937" stroke-width="1.1" stroke-linecap="round"/><ellipse cx="35.8" cy="16.4" rx="1.3" ry="1.8" fill="#1f2937"/><circle cx="35.4" cy="15.8" r=".5" fill="#fff"/><ellipse cx="29" cy="19.4" rx="1.2" ry=".8" fill="#fb7185" opacity=".75"/><ellipse cx="37.4" cy="19.4" rx="1.2" ry=".8" fill="#fb7185" opacity=".75"/><circle cx="33" cy="19.4" r="1.1" fill="#f9a8a8" stroke="#be123c" stroke-width=".3"/><path d="M27 13.6C28 8 33 5.2 38 6.4c3 .8 5.4 3.2 6.6 6.4-2-1.4-4-1.8-5.4-1.2l.2 2.6Z" fill="#dc2626" stroke="#065f46" stroke-width="1" stroke-linejoin="round"/><rect x="26.2" y="12.2" width="13.8" height="3" rx="1.5" fill="#fff" stroke="#065f46" stroke-width=".9"/></g><g transform="translate(12.6 17) scale(1.55)"><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="21" r="1.8" fill="#fff"/><circle cx="20" cy="21" r="1.8" fill="#fff"/></g><circle cx="44.8" cy="13.2" r="2" fill="#fff" stroke="#065f46" stroke-width=".9"/><ellipse cx="26.4" cy="26.4" rx="2.6" ry="2.1" transform="rotate(-15 26.4 26.4)" fill="#16a34a" stroke="#065f46" stroke-width="1"/><path d="M49.2 36V22.6a2.6 2.6 0 0 0-5.2 0" fill="none" stroke="#065f46" stroke-width="3.4" stroke-linecap="round"/><path d="M49.2 36V22.6a2.6 2.6 0 0 0-5.2 0" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><path d="M49.2 36V22.6a2.6 2.6 0 0 0-5.2 0" fill="none" stroke="#dc2626" stroke-width="2.2" stroke-dasharray="1.3 1.3"/><path d="M41.4 24.2Q44.6 23.4 47.6 24.6" fill="none" stroke="#065f46" stroke-width="5.2" stroke-linecap="round"/><path d="M41.4 24.2Q44.6 23.4 47.6 24.6" fill="none" stroke="#dc2626" stroke-width="3" stroke-linecap="round"/><ellipse cx="49.2" cy="25" rx="2.6" ry="2.1" fill="#16a34a" stroke="#065f46" stroke-width="1"/></svg>';

export function JulLogo({ size = 30 }: { size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size * 0.28, overflow: 'hidden' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <SvgXml xml={XML} width={size} height={size} />
    </View>
  );
}

/** Jule-baggrunden: nissehuer, gaver, slikstokke, snefnug og stjerner, svagt
 * bag forsidens indhold. Samme mønster som webbens static/images/jul-baggrund.svg. */
const BG_XML =
  '<svg width="100%" height="100%"><defs><pattern id="jul" width="360" height="360" patternUnits="userSpaceOnUse"><g opacity="0.24" transform="scale(1.5)"><g transform="translate(22 26) rotate(-10) scale(1.5)"><path d="M-4 3C-3.6-1-1-3.6 2-3.4 3.4-3.2 4.6-2 5.2-.4 4-.9 3-.9 2.4-.4L2.6 3Z" fill="#dc2626"/><rect x="-4.6" y="2.4" width="7.8" height="1.8" rx=".9" fill="#e5e7eb"/><circle cx="5.4" cy="-.6" r="1.1" fill="#e5e7eb"/></g><g transform="translate(150 40) rotate(8) scale(1.5)"><rect x="-3" y="-2" width="6" height="5" fill="#16a34a"/><rect x="-.5" y="-2" width="1" height="5" fill="#dc2626"/><rect x="-3.4" y="-3" width="6.8" height="1.4" fill="#16a34a"/><rect x="-.5" y="-3" width="1" height="1.4" fill="#dc2626"/><path d="M0-3q-2.2-2-2.2-.3zM0-3q2.2-2 2.2-.3z" fill="#dc2626"/></g><g transform="translate(112 20) rotate(0) scale(1.3)"><path d="M0-3l.9 2.1 2.1.9-2.1.9L0 3l-.9-2.1L-3 0l2.1-.9z" fill="#f59e0b"/></g><g transform="translate(84 104) rotate(-15) scale(1.6)"><path d="M1.6 5V-2a1.8 1.8 0 0 0-3.6 0" fill="none" stroke="#dc2626" stroke-width="1.4" stroke-linecap="round"/></g><g transform="translate(30 150) rotate(0) scale(1)"><g stroke="#93c5fd" stroke-width="1" stroke-linecap="round"><path d="M0-5v10M-5 0h10M-3.5-3.5l7 7M3.5-3.5l-7 7"/><path d="M-1.4-4 0-2.6 1.4-4M-1.4 4 0 2.6 1.4 4M-4-1.4-2.6 0-4 1.4M4-1.4 2.6 0 4 1.4" fill="none"/></g></g><g transform="translate(165 150) rotate(12) scale(1.2)"><path d="M-4 3C-3.6-1-1-3.6 2-3.4 3.4-3.2 4.6-2 5.2-.4 4-.9 3-.9 2.4-.4L2.6 3Z" fill="#dc2626"/><rect x="-4.6" y="2.4" width="7.8" height="1.8" rx=".9" fill="#e5e7eb"/><circle cx="5.4" cy="-.6" r="1.1" fill="#e5e7eb"/></g><g transform="translate(200 96) rotate(0) scale(1.1)"><path d="M0-3l.9 2.1 2.1.9-2.1.9L0 3l-.9-2.1L-3 0l2.1-.9z" fill="#f59e0b"/></g><g transform="translate(100 198) rotate(-6) scale(1.1)"><rect x="-3" y="-2" width="6" height="5" fill="#16a34a"/><rect x="-.5" y="-2" width="1" height="5" fill="#dc2626"/><rect x="-3.4" y="-3" width="6.8" height="1.4" fill="#16a34a"/><rect x="-.5" y="-3" width="1" height="1.4" fill="#dc2626"/><path d="M0-3q-2.2-2-2.2-.3zM0-3q2.2-2 2.2-.3z" fill="#dc2626"/></g><g transform="translate(200 200) rotate(20) scale(1.2)"><path d="M1.6 5V-2a1.8 1.8 0 0 0-3.6 0" fill="none" stroke="#dc2626" stroke-width="1.4" stroke-linecap="round"/></g><g transform="translate(36 94) rotate(0) scale(0.8)"><g stroke="#7dd3fc" stroke-width="1" stroke-linecap="round"><path d="M0-5v10M-5 0h10M-3.5-3.5l7 7M3.5-3.5l-7 7"/><path d="M-1.4-4 0-2.6 1.4-4M-1.4 4 0 2.6 1.4 4M-4-1.4-2.6 0-4 1.4M4-1.4 2.6 0 4 1.4" fill="none"/></g></g></g></pattern></defs><rect width="100%" height="100%" fill="url(#jul)"/></svg>';

export function JulBackground() {
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <SvgXml xml={BG_XML} width="100%" height="100%" />
    </View>
  );
}
