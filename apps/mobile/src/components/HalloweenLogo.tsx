/**
 * Halloween-logoet (Feature-panelet 'halloween_logo' i /admin, forslag C3,
 * Kalle 27-10-2026): den normale kurv med et spøgelse der blinker, rækker
 * tunge og holder en græskar-slikspand. Samme tegning som webbens
 * templates/partials/halloween_logo.html.
 *
 * Vises kun, når /api/home siger halloween_logo_enabled, så hjemmesiden og
 * appen skifter samtidig. På dev.madshopper.dk (MadShopper Test) er det
 * altid til. Ikonet på hjemmeskærmen skifter ikke.
 */
import React, { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

let enabled = false;
const listeners = new Set<() => void>();

/** Kaldes af HomeScreen med /api/home's halloween_logo_enabled. */
export function setServerHalloweenLogoEnabled(on: boolean | undefined) {
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

export function useHalloweenLogoEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabled);
}

const XML =
  '<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#059669"/><defs><clipPath id="hw-rim-app"><rect width="64" height="26.3"/></clipPath></defs><g clip-path="url(#hw-rim-app)"><g transform="rotate(5 33 27)"><path d="M24.2 28C23.6 22 24.4 15.5 27.5 12.6C30.4 9.9 35.8 9.6 38.8 12.4C41.9 15.2 42.4 21.5 41.8 28Z" fill="#fff" stroke="#065f46" stroke-width="1.1" stroke-linejoin="round"/><path d="M28.6 18.6q1.6-1.8 3.2 0" fill="none" stroke="#1f2937" stroke-width="1.2" stroke-linecap="round"/><ellipse cx="35.8" cy="18.2" rx="1.55" ry="2.15" fill="#1f2937"/><circle cx="35.3" cy="17.4" r="0.6" fill="#fff"/><ellipse cx="28" cy="22.4" rx="1.5" ry=".9" fill="#fb7185" opacity=".7"/><ellipse cx="38.2" cy="22.4" rx="1.5" ry=".9" fill="#fb7185" opacity=".7"/><path d="M30.6 22.2Q33.2 24.6 35.8 22.2" fill="none" stroke="#1f2937" stroke-width="1.2" stroke-linecap="round"/><path d="M32.4 23.2q.8 2.4 1.9 0" fill="#fb7185" stroke="#be123c" stroke-width=".4"/></g></g><g transform="translate(12.6 17) scale(1.55)"><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="21" r="1.8" fill="#fff"/><circle cx="20" cy="21" r="1.8" fill="#fff"/></g><ellipse cx="26.4" cy="26.5" rx="2.7" ry="2.1" transform="rotate(-15 26.4 26.5)" fill="#fff" stroke="#065f46" stroke-width="1.1"/><path d="M46 27.8Q49.6 17.6 53.2 27.8" fill="none" stroke="#1f2937" stroke-width="1"/><ellipse cx="47.6" cy="31.6" rx="3.2" ry="4.2" fill="#ea580c"/><ellipse cx="51.6" cy="31.6" rx="3.2" ry="4.2" fill="#ea580c"/><ellipse cx="49.6" cy="31.6" rx="3.4" ry="4.5" fill="#f97316"/><path d="M47.4 30.4l1-1.5 1 1.5zM50.4 30.4l1-1.5 1 1.5zM47 32.6q2.6 2 5.2 0q-2.6 1-5.2 0z" fill="#3b0764"/><ellipse cx="49.6" cy="27.7" rx="3.4" ry=".8" fill="#9a3412"/><path d="M42.6 23.4Q46 22.2 48.4 22.6" fill="none" stroke="#065f46" stroke-width="5.4" stroke-linecap="round"/><path d="M42.6 23.4Q46 22.2 48.4 22.6" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><ellipse cx="49.4" cy="22.6" rx="2.7" ry="2.1" transform="rotate(20 49.4 22.6)" fill="#fff" stroke="#065f46" stroke-width="1.1"/></svg>';

export function HalloweenLogo({ size = 30 }: { size?: number }) {
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

/** Halloween-baggrunden: flagermus, græskar, spøgelser, stjerner og slik, svagt
 * bag forsidens indhold. Samme mønster som webbens
 * static/images/halloween-baggrund.svg. */
const BG_XML =
  '<svg width="100%" height="100%"><defs><pattern id="hw" width="345" height="345" patternUnits="userSpaceOnUse">' +
  '<g opacity=".22" transform="scale(1.5)"><g transform="translate(18 26) rotate(-10) scale(1.6)"><path fill="#7c3aed" d="M0 0q2-2.6 4.4-1.2q.5-1.4 1.6-1.6l.6 1 .6-1q1.1.2 1.6 1.6q2.4-1.4 4.4 1.2q-2-.3-2.6 1q-1-1-2 0l-2 1.6-2-1.6q-1-1-2 0Q2-.3 0 0z"/></g><g transform="translate(150 40) scale(1.5)"><rect x="-.6" y="-5.6" width="1.2" height="2.4" rx=".5" fill="#65a30d"/><ellipse cx="-2.2" cy="0" rx="3" ry="4" fill="#ea580c"/><ellipse cx="2.2" cy="0" rx="3" ry="4" fill="#ea580c"/><ellipse cx="0" cy="0" rx="3" ry="4.3" fill="#f97316"/><path d="M-2.4-1l.9-1.4.9 1.4zM.6-1l.9-1.4.9 1.4zM-2.6 1.2q2.6 2 5.2 0q-2.6 1-5.2 0z" fill="#7c2d12"/></g><g transform="translate(84 104) rotate(-8) scale(1.6)"><path d="M-4 5V-1a4 4 0 0 1 8 0v6l-1.3-1.2-1.4 1.2-1.3-1.2-1.3 1.2-1.4-1.2z" fill="#c4b5fd"/><circle cx="-1.4" cy="-.6" r=".7" fill="#4c1d95"/><circle cx="1.4" cy="-.6" r=".7" fill="#4c1d95"/></g><g transform="translate(158 150) rotate(12) scale(1.2)"><path fill="#7c3aed" d="M0 0q2-2.6 4.4-1.2q.5-1.4 1.6-1.6l.6 1 .6-1q1.1.2 1.6 1.6q2.4-1.4 4.4 1.2q-2-.3-2.6 1q-1-1-2 0l-2 1.6-2-1.6q-1-1-2 0Q2-.3 0 0z"/></g><path transform="translate(116 22) scale(1.2)" d="M0-3l.9 2.1 2.1.9-2.1.9L0 3l-.9-2.1L-3 0l2.1-.9z" fill="#f59e0b"/><path transform="translate(40 160) scale(1)" d="M0-3l.9 2.1 2.1.9-2.1.9L0 3l-.9-2.1L-3 0l2.1-.9z" fill="#f59e0b"/><g transform="translate(196 96) rotate(25) scale(1.3)"><path d="M-5-2.2l2.4 2.2-2.4 2.2zM5-2.2L2.6 0 5 2.2z" fill="#fb923c"/><circle r="2.6" fill="#f97316"/><path d="M-1.6-1.6l3.2 3.2" stroke="#fff" stroke-width=".8"/></g><g transform="translate(28 92) scale(1.0)"><rect x="-.6" y="-5.6" width="1.2" height="2.4" rx=".5" fill="#65a30d"/><ellipse cx="-2.2" cy="0" rx="3" ry="4" fill="#ea580c"/><ellipse cx="2.2" cy="0" rx="3" ry="4" fill="#ea580c"/><ellipse cx="0" cy="0" rx="3" ry="4.3" fill="#f97316"/><path d="M-2.4-1l.9-1.4.9 1.4zM.6-1l.9-1.4.9 1.4zM-2.6 1.2q2.6 2 5.2 0q-2.6 1-5.2 0z" fill="#7c2d12"/></g><g transform="translate(190 192) rotate(10) scale(1.1)"><path d="M-4 5V-1a4 4 0 0 1 8 0v6l-1.3-1.2-1.4 1.2-1.3-1.2-1.3 1.2-1.4-1.2z" fill="#c4b5fd"/><circle cx="-1.4" cy="-.6" r=".7" fill="#4c1d95"/><circle cx="1.4" cy="-.6" r=".7" fill="#4c1d95"/></g><path transform="translate(212 150) scale(0.9)" d="M0-3l.9 2.1 2.1.9-2.1.9L0 3l-.9-2.1L-3 0l2.1-.9z" fill="#f59e0b"/><g transform="translate(96 196) rotate(-4) scale(1.0)"><path fill="#7c3aed" d="M0 0q2-2.6 4.4-1.2q.5-1.4 1.6-1.6l.6 1 .6-1q1.1.2 1.6 1.6q2.4-1.4 4.4 1.2q-2-.3-2.6 1q-1-1-2 0l-2 1.6-2-1.6q-1-1-2 0Q2-.3 0 0z"/></g></g></pattern></defs>' +
  '<rect width="100%" height="100%" fill="url(#hw)"/></svg>';

export function HalloweenBackground() {
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
