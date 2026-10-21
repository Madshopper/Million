import React from 'react';
import { LogBox, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Font from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { StoreCatalogProvider } from './src/stores/StoreCatalogContext';
import { CartProvider } from './src/cart/CartContext';
import { AuthProvider } from './src/auth/AuthContext';
import { SharedCartProvider } from './src/cart/SharedCartContext';
import { CartToast } from './src/cart/CartToast';
import { RootNavigator } from './src/navigation/RootNavigator';
import { startTestAppUpdates } from './src/updates/testAppUpdates';
import { FONT_ASSETS, setFontsReady } from './src/theme/Typography';

// Splash bliver stående, til skriften er indlæst (højst FONT_TIMEOUT_MS; så
// vises appen med systemskriften i stedet for at hænge).
void SplashScreen.preventAutoHideAsync().catch(() => {});
const FONT_TIMEOUT_MS = 3000;

// supabase-js's GoTrueClient logs this via console.error on every failed
// refresh tick even though it explicitly documents it as expected/transient
// (no session to refresh yet, brief network hiccup, ...) - it isn't actionable.
// getValueWithKeyAsync fails the same way on every cold start in this unsigned
// simulator build specifically: without an Apple Team ID (docs/env-setup.md §5)
// there's no keychain-access-groups entitlement, so SecItem lookups error out
// (errSecMissingEntitlement) even though the code path is correct.
// Kun MadShopper Test: hent ny appkode fra main (gør intet i butiksappen).
startTestAppUpdates();

LogBox.ignoreLogs([
  'Auto refresh tick failed with error',
  "Calling the 'getValueWithKeyAsync' function has failed",
]);

function AppShell() {
  const { isDark } = useTheme();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <RootNavigator />
      <CartToast />
    </>
  );
}

function useAppFonts(): boolean {
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      setFontsReady(ok);
      setDone(true);
    };
    const timer = setTimeout(() => finish(false), FONT_TIMEOUT_MS);
    Font.loadAsync(FONT_ASSETS)
      .then(() => finish(true))
      .catch(() => finish(false))
      .finally(() => clearTimeout(timer));
    return () => clearTimeout(timer);
  }, []);
  React.useEffect(() => {
    if (done) void SplashScreen.hideAsync().catch(() => {});
  }, [done]);
  return done;
}

export default function App() {
  const fontsDone = useAppFonts();
  if (!fontsDone) return null;
  return (
    <View style={{ flex: 1 }}>
      {/* Yderst af alle providere: en fejl i ThemeProvider, StoreCatalog-
          hentningen eller navigatoren skal ogsaa fanges - ikke kun fejl inde
          i skaermene. */}
      <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider>
          <StoreCatalogProvider>
            <CartProvider>
              <AuthProvider>
                <SharedCartProvider>
                  <AppShell />
                </SharedCartProvider>
              </AuthProvider>
            </CartProvider>
          </StoreCatalogProvider>
        </ThemeProvider>
      </SafeAreaProvider>
      </ErrorBoundary>
    </View>
  );
}
