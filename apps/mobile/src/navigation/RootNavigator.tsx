import React, { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
  DarkTheme,
  DefaultTheme,
  type LinkingOptions,
} from '@react-navigation/native';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useCart } from '../cart/CartContext';
import { CartIcon } from '../components/CartIcon';
import { HomeScreen } from '../screens/HomeScreen';
import { CategoryScreen, SaleScreen } from '../screens/CategoryScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { RecipesScreen } from '../screens/RecipesScreen';
import { CartScreen } from '../screens/CartScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { ProductDetailScreen } from '../screens/ProductDetailScreen';
import { RecipeDetailScreen } from '../screens/RecipeDetailScreen';
import { ScoScreen } from '../screens/ScoScreen';
import { RouteScreen } from '../screens/RouteScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { FeedbackScreen } from '../screens/FeedbackScreen';
import { LegalScreen } from '../screens/LegalScreen';
import { isRecoveryUrl } from '../auth/recoveryLink';
import { recipesEnabled } from '../config/env';
import type { RootStackParamList, TabParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Tryk på en prisalarm-besked (src/push/push.ts) åbner Profil, hvor
// "Mine prisalarmer" står. Ref'en virker også før en skærm har fokus.
const navRef = createNavigationContainerRef<RootStackParamList>();

function openFromNotification(resp: Notifications.NotificationResponse | null) {
  if (!resp || !navRef.isReady()) return;
  // Ryd den, så næste opstart ikke åbner Profil igen for den samme besked.
  void Notifications.clearLastNotificationResponseAsync().catch(() => {});
  navRef.navigate('Tabs', { screen: 'Profile' });
}
const Tabs = createBottomTabNavigator<TabParamList>();

/**
 * Opskrift-gaten (`recipesEnabled`, se config/env.ts) dækker fanen og
 * `RecipeDetail`-skærmen i stakken: indgangen skal væk i produktion, ikke bare
 * indholdet. Web-headeren gør det samme med {% if rpc_suffix %} omkring
 * opskrift-ikonet (templates/base.html).
 *
 * Forsidens opskriftssektion er IKKE gated her - den vises i alle miljøer som
 * ikke-klikbar teaser, ligesom webforsiden (se HomeScreen's recipesClickable +
 * app.py::api_home's recipes_clickable). Derfor må /api/home også svare med
 * puljen i produktion; det er kun klikbarheden der skifter.
 */

/**
 * BEVIDST MEGET SNÆVER deep link-konfiguration.
 *
 * Appen har med vilje ikke haft nogen `linking` på NavigationContainer: uden
 * den kan et link udefra ikke pege på en vilkårlig skærm i stakken - og det
 * er netop dét, der beskytter gatede skærme (opskrifter) mod at blive åbnet
 * i et produktions-build. `filter` slipper derfor KUN recovery-links igennem
 * (parseRecoveryLink kræver eksplicit `type=recovery` + brugbare tokens), og
 * `getStateFromPath` returnerer én fast tilstand: Tabs + Auth. Der findes
 * ingen sti-mapping, så ingen URL kan navigere nogen andre steder hen.
 *
 * Invitations-links (`?liste=`) håndteres fortsat af SharedCartContext' egen
 * Linking-lytter og har ingen navigationsvirkning.
 */
const recoveryLinking: LinkingOptions<RootStackParamList> = {
  prefixes: [Linking.createURL('/'), 'madshopper://'],
  filter: (url) => isRecoveryUrl(url),
  getStateFromPath: () => ({
    routes: [{ name: 'Tabs' as const }, { name: 'Auth' as const }],
  }),
  // Ingen `config`: der er ingen sti→skærm-mapping at misbruge.
};

function CartHeaderButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  const { count } = useCart();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Åbn indkøbskurv, ${count} varer` : 'Åbn indkøbskurv'}
      style={{ marginRight: 8, width: 52, height: 44, justifyContent: 'center' }}
    >
      <CartIcon count={count} color={colors.primary} />
      {count > 0 && (
        <View
          style={{
            position: 'absolute',
            top: 1,
            // Forankret i venstre kant, så et to- eller trecifret tal vokser
            // væk fra vognen i stedet for ind over varerne.
            left: 28,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            paddingHorizontal: 4,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: colors.surface, fontSize: 11, fontWeight: '700' }}>
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function CloseHeaderButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={12} style={{ paddingVertical: 4, paddingRight: 12 }}>
      <Text style={{ color: colors.primary, fontWeight: '600' }}>Luk</Text>
    </Pressable>
  );
}

/**
 * Egen tilbage-knap i stedet for den native. Den native iOS-knap holdt op med at
 * reagere efter at man var ind på og ud af et produkt et par gange (skærmen
 * bliver stående, ingen fejl). En JS-Pressable med goBack() er ikke afhængig
 * af den native header-transition.
 */
function BackHeaderButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 24 }}
      accessibilityRole="button"
      accessibilityLabel="Tilbage"
      style={{ paddingVertical: 4, paddingRight: 16 }}
    >
      <Ionicons name="chevron-back" size={26} color={colors.text} />
    </Pressable>
  );
}

type TabIconName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(focused: boolean, active: TabIconName, inactive: TabIconName): TabIconName {
  return focused ? active : inactive;
}

function MainTabs() {
  const { colors } = useTheme();

  return (
    <Tabs.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingTop: 4,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginBottom: 2 },
        sceneStyle: { flex: 1, minHeight: 0 },
      }}
    >
      <Tabs.Screen
        name="Home"
        component={HomeScreen}
        options={({ navigation }) => ({
          title: 'MadShopper',
          tabBarLabel: 'Hjem',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={tabIcon(focused, 'home', 'home-outline')}
              size={size}
              color={color}
            />
          ),
          headerRight: () => (
            <CartHeaderButton onPress={() => navigation.getParent()?.navigate('Cart')} />
          ),
        })}
      />
      <Tabs.Screen
        name="Search"
        component={SearchScreen}
        options={({ navigation }) => ({
          title: 'Søg',
          tabBarLabel: 'Søg',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={tabIcon(focused, 'search', 'search-outline')}
              size={size}
              color={color}
            />
          ),
          headerRight: () => (
            <CartHeaderButton onPress={() => navigation.getParent()?.navigate('Cart')} />
          ),
        })}
      />
      {recipesEnabled && (
        <Tabs.Screen
          name="Recipes"
          component={RecipesScreen}
          options={({ navigation }) => ({
            title: 'Opskrifter',
            tabBarLabel: 'Opskrifter',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={tabIcon(focused, 'restaurant', 'restaurant-outline')}
                size={size}
                color={color}
              />
            ),
            headerRight: () => (
              <CartHeaderButton onPress={() => navigation.getParent()?.navigate('Cart')} />
            ),
          })}
        />
      )}
      <Tabs.Screen
        name="Profile"
        component={ProfileScreen}
        options={({ navigation }) => ({
          title: 'Profil',
          tabBarLabel: 'Profil',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={tabIcon(focused, 'person-circle', 'person-circle-outline')}
              size={size}
              color={color}
            />
          ),
          headerRight: () => (
            <CartHeaderButton onPress={() => navigation.getParent()?.navigate('Cart')} />
          ),
        })}
      />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(openFromNotification);
    return () => sub.remove();
  }, []);
  const { colors, isDark } = useTheme();
  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.bg,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  };

  return (
    <NavigationContainer
      ref={navRef}
      theme={navTheme}
      linking={recoveryLinking}
      // Appen var lukket, da beskeden blev trykket: åbn Profil, når navigationen er klar.
      onReady={() => {
        void Notifications.getLastNotificationResponseAsync().then(openFromNotification);
      }}
    >
      <Stack.Navigator
        screenOptions={({ navigation }) => ({
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          contentStyle: { flex: 1, backgroundColor: colors.bg },
          headerBackVisible: false,
          headerLeft: ({ canGoBack }) =>
            canGoBack ? <BackHeaderButton onPress={() => navigation.goBack()} /> : null,
        })}
      >
        <Stack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen
          name="Category"
          component={CategoryScreen}
          options={({ route }) => ({ title: route.params.title })}
        />
        <Stack.Screen name="Sale" component={SaleScreen} options={{ title: 'Ugens Tilbud' }} />
        <Stack.Screen name="Cart" component={CartScreen} options={{ title: 'Indkøbsliste' }} />
        <Stack.Screen
          name="ProductDetail"
          component={ProductDetailScreen}
          options={{ title: 'Produkt' }}
        />
        {/* Samme gate som opskrift-fanen: uden den ville skærmen findes i
            stakken i produktion, hvor featuren ikke er åben. */}
        {recipesEnabled && (
          <Stack.Screen
            name="RecipeDetail"
            component={RecipeDetailScreen}
            options={{ title: 'Opskrift' }}
          />
        )}
        <Stack.Screen name="Sco" component={ScoScreen} options={{ title: 'Find billigste' }} />
        <Stack.Screen name="Route" component={RouteScreen} options={{ title: 'Butiksrute' }} />
        <Stack.Screen
          name="Auth"
          component={AuthScreen}
          options={({ navigation }) => ({
            title: 'Konto',
            presentation: 'modal',
            // Modal har ingen automatisk tilbage-knap på iOS. Er stakken kun
            // Tabs+Auth (recovery-link) eller Auth åbnet uden historik, falder
            // vi tilbage til Tabs i stedet for en død knap.
            headerLeft: () => <CloseHeaderButton onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Tabs'))} />,
          })}
        />
        {/* Indstillinger var en fane indtil 02-10-2026; nu åbnes de fra Profil. */}
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Indstillinger' }} />
        <Stack.Screen name="Feedback" component={FeedbackScreen} options={{ title: 'Feedback' }} />
        <Stack.Screen
          name="Legal"
          component={LegalScreen}
          options={({ route }) => ({
            title:
              route.params.kind === 'terms'
                ? 'Vilkår'
                : route.params.kind === 'privacy'
                  ? 'Privatliv'
                  : 'Om os',
          })}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
