import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, TextInput } from '../theme/Typography';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { fetchAutocomplete, fetchHome, fetchSearch } from '../api/listing';
import type { Product } from '../api/types';
import { FiltersBar, type FiltersValue } from '../components/FiltersBar';
import { ProductCard } from '../components/ProductCard';
import { TabScreenBody } from '../components/ScreenBody';
import { useStoreCatalog, storesParam } from '../stores/StoreCatalogContext';
import { useTheme } from '../theme/ThemeContext';
import { useTabBarOverlap } from '../components/GlassTabBar';
import { Pager } from '../components/Pager';
import { spokenKr } from '../a11y/speech';
import { setServerStatsEnabled, trackSearch } from '../stats/stats';
import type { RootStackParamList } from '../navigation/types';
import { BuyAgainCard } from '../components/BuyAgain';
import { useBuyAgain } from '../cart/recentItems';
import { rememberSearch, useRecentSearches } from '../search/recentSearches';

/**
 * Stabil reference til "ingen filtre valgt".
 *
 * Ligger UDEN FOR komponenten med vilje: `setFilters({ sort: 'relevance' })`
 * lavede et NYT objekt hver gang søgeordet skiftede, og fordi `filters` indgår
 * i `load`s dependency-array, skiftede `load` identitet, og hente-effekten
 * fyrede - én gang PR. TASTETRYK, stik imod den 500 ms debounce der er bygget
 * netop for at undgå det. Kaldene blev aborteret klientsiden, men var allerede
 * sendt afsted.
 */
const DEFAULT_FILTERS: FiltersValue = { sort: 'relevance' };

export function SearchScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const tabOverlap = useTabBarOverlap();
  // queryLabels: debouncet butiksvalg (se StoreCatalogContext) - ellers ville
  // hvert butikstryk i filter-arket koste baade en autocomplete og en soegning.
  const { queryLabels, catalog, ready } = useStoreCatalog();
  const [q, setQ] = useState('');
  // Kun opdateret 500 ms efter brugeren er holdt op med at skrive - selve
  // søgningen (inkl. sideskift) afhænger af DENNE, ikke af q direkte, så et
  // sideskift ikke også skal vente 500 ms.
  const [committedQuery, setCommittedQuery] = useState('');
  const [suggestions, setSuggestions] = useState<
    Array<{ name: string; brand: string; price: number }>
  >([]);
  /** Serverens stavekorrektion, fx "mlæk" → "mælk". Web-paritet. */
  const [querySuggestion, setQuerySuggestion] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<FiltersValue>(DEFAULT_FILTERS);
  // Forslag før brugeren har skrevet noget, så skærmen ikke er tom fra start.
  // Hentes fra /api/home med samme parametre som forsiden (kun butikker), så
  // det er samme URL og typisk et edge-cache-hit fra KV-puljen home_data_v1 -
  // ingen D1-søgning og intet ekstra rows_read.
  const [starter, setStarter] = useState<{ title: string; products: Product[] } | null>(null);

  // Delt mellem de to debounce-effects nedenfor, så søge-kaldet kan annullere
  // en ventende/igangværende autocomplete FØR det selv sendes af sted - uden
  // det kan begge ramme samme Cloudflare Workers-isolate næsten samtidig, som
  // ikke tillader overlappende request-tasks (samme fejlklasse som blev
  // rettet for web i static/js/script.js, closeAutocomplete()).
  const acTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acControllerRef = useRef<AbortController | null>(null);
  // Aktuel søgnings AbortController - annulleres ved næste søgning, så et
  // langsomt, forældet svar ikke kan overskrive et nyere (fx skriver
  // brugeren "mælk" og retter hurtigt til "mælkebøtte": to kald i luften,
  // uden dette vandt det langsomste, uanset hvilket der var nyest).
  const searchControllerRef = useRef<AbortController | null>(null);
  // Sidst talte søgeord til varestatistikken: et sideskift eller filterskift
  // på samme søgning må ikke tælle som en ny søgning (samme regel som webben).
  const countedQueryRef = useRef('');
  const [focused, setFocused] = useState(false);
  // C2: "Seneste søgninger" og "Køb igen" (de 5 varer man oftest har lagt i
  // kurven), begge kun gemt på telefonen.
  const recentSearches = useRecentSearches();
  const buyAgain = useBuyAgain(5);

  function cancelAutocomplete() {
    if (acTimeoutRef.current) {
      clearTimeout(acTimeoutRef.current);
      acTimeoutRef.current = null;
    }
    if (acControllerRef.current) {
      acControllerRef.current.abort();
      acControllerRef.current = null;
    }
  }

  // Ny søgning nulstiller advanced filters (web-paritet). Sætter DEFAULT_FILTERS
  // (samme objektreference hver gang) og kun når der faktisk er noget at
  // nulstille - se kommentaren ved DEFAULT_FILTERS.
  useEffect(() => {
    setFilters((prev) => (prev === DEFAULT_FILTERS ? prev : DEFAULT_FILTERS));
  }, [q]);

  // Autocomplete debounce 200 ms
  useEffect(() => {
    if (q.trim().length < 2) {
      setSuggestions([]);
      cancelAutocomplete();
      return;
    }
    acTimeoutRef.current = setTimeout(() => {
      const controller = new AbortController();
      acControllerRef.current = controller;
      void fetchAutocomplete(q.trim(), storesParam(queryLabels, catalog), controller)
        .then((r) => {
          setSuggestions(r.suggestions || []);
          // Serverens stavekorrektion. Webben har altid brugt den
          // (`data.query_suggestion || query` i script.js), mens appen kun
          // læste `suggestions` - så en bruger der skrev "mlæk" fik forslaget
          // på web, men ikke i appen.
          setQuerySuggestion(r.query_suggestion || null);
        })
        .catch(() => {
          setSuggestions([]);
          setQuerySuggestion(null);
        });
    }, 200);
    return () => {
      if (acTimeoutRef.current) clearTimeout(acTimeoutRef.current);
    };
  }, [q, queryLabels, catalog]);

  // Skriv-debounce 500 ms: opdaterer KUN committedQuery og nulstiller til
  // side 1. Selve hentningen sker i effekten nedenfor, som også dækker
  // sideskift - et sideskift skal ikke vente 500 ms som en tastetryk-søgning.
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setCommittedQuery('');
      setProducts([]);
      setTotal(0);
      setTotalPages(1);
      setError(null);
      return;
    }
    const t = setTimeout(() => {
      cancelAutocomplete();
      setPage(1);
      setCommittedQuery(query);
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Filterskift/butiksskift skal ramme side 1, ikke blive på en side der
  // måske ikke findes i det nye resultatsæt.
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, queryLabels, catalog]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void fetchHome({ stores: storesParam(queryLabels, catalog) })
      .then((data) => {
        if (cancelled || !data.success) return;
        setServerStatsEnabled(data.stats_enabled);
        // "Populære varer" passer bedst til en søgeskærm; ellers første
        // sektion med varer (fx "Ugens Tilbud").
        const withProducts = (data.sections || []).filter((s) => s.products?.length);
        const first =
          withProducts.find((s) => s.key === 'Populære varer') || withProducts[0];
        setStarter(first ? { title: first.title, products: first.products.slice(0, 20) } : null);
      })
      .catch(() => {
        // Forslagene er pynt. Fejler de, viser vi bare hjælpeteksten.
        if (!cancelled) setStarter(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, queryLabels, catalog]);

  const showStarter = q.trim().length === 0 && !!starter?.products.length;
  const isEmptyQuery = q.trim().length === 0;
  const hasPersonal = recentSearches.length > 0 || buyAgain.length > 0;

  const searchFor = (term: string) => {
    rememberSearch(term);
    setQ(term);
  };

  const cancel = () => {
    setQ('');
    Keyboard.dismiss();
    navigation.navigate('Tabs', { screen: 'Home' });
  };

  const emptyHeader = isEmptyQuery ? (
    <View>
      {recentSearches.length ? (
        <>
          <Text style={[styles.recentTitle, { color: colors.textMuted }]} accessibilityRole="header">
            Seneste søgninger
          </Text>
          <View style={styles.recentWrap}>
            {recentSearches.map((term) => (
              <Pressable
                key={term}
                onPress={() => searchFor(term)}
                accessibilityRole="button"
                accessibilityLabel={`Søg efter ${term} igen`}
                style={({ pressed }) => [
                  styles.recentPill,
                  { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                <Text style={[styles.recentText, { color: colors.text }]} numberOfLines={1}>
                  {term}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      {buyAgain.length ? (
        <>
          <View style={styles.buyAgainHead}>
            <Text style={[styles.buyAgainTitle, { color: colors.text }]} accessibilityRole="header">
              Køb igen
            </Text>
            <Text style={[styles.buyAgainSub, { color: colors.textMuted }]}>Det du plejer at købe</Text>
          </View>
          <View style={styles.buyAgainCard}>
            <BuyAgainCard items={buyAgain} />
          </View>
        </>
      ) : null}
      {showStarter ? (
        <Text style={[styles.starterTitle, { color: colors.text }]} accessibilityRole="header">
          {starter!.title}
        </Text>
      ) : null}
    </View>
  ) : null;

  const load = useCallback(async () => {
    if (!committedQuery) return;
    if (searchControllerRef.current) searchControllerRef.current.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchSearch(
        {
          q: committedQuery,
          page,
          stores: storesParam(queryLabels, catalog),
          ...filters,
        },
        controller,
      );
      if (controller.signal.aborted) return;
      if (countedQueryRef.current !== committedQuery) {
        countedQueryRef.current = committedQuery;
        trackSearch(committedQuery);
      }
      setProducts(r.products || []);
      setTotal(r.total ?? 0);
      setTotalPages(r.total_pages || 1);
      // Antallet står kun som tekst over listen. Seende ser det skifte;
      // skærmlæseren skal have det sagt, ellers ved man ikke at søgningen kom.
      AccessibilityInfo.announceForAccessibility(
        r.total ? `${r.total} resultater` : 'Ingen varer matcher din søgning',
      );
    } catch (e) {
      if (controller.signal.aborted) return;
      // Uden denne gren var offline/en serverfejl lig med en tom skærm, ikke
      // til at skelne fra "0 resultater" - client.ts har pæne fejltekster,
      // de nåede bare aldrig frem.
      setError(e instanceof Error ? e.message : 'Kunne ikke søge. Prøv igen.');
      setProducts([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [committedQuery, page, queryLabels, catalog, filters]);

  useEffect(() => {
    void load();
    return () => {
      if (searchControllerRef.current) searchControllerRef.current.abort();
    };
  }, [load]);

  return (
    <TabScreenBody style={{ backgroundColor: colors.bg }}>
      <View style={styles.inputRow}>
        <View
          style={[
            styles.inputWrap,
            {
              backgroundColor: colors.surface,
              borderColor: focused ? colors.primary : colors.border,
            },
          ]}
        >
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={`Søg i ${catalog.length || 14} butikker`}
            placeholderTextColor={colors.textMuted}
            autoFocus
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={() => {
              if (q.trim()) rememberSearch(q);
            }}
            accessibilityLabel="Søg efter varer"
            returnKeyType="search"
            style={[styles.input, { color: colors.text }]}
          />
        </View>
        <Pressable
          onPress={cancel}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Annullér søgning"
          style={styles.cancel}
        >
          <Text style={[styles.cancelText, { color: colors.primaryDark }]}>Annullér</Text>
        </Pressable>
      </View>
      {q.trim().length >= 2 && suggestions.length > 0 && !products.length ? (
        <View style={{ paddingHorizontal: 12 }} accessibilityLabel="Forslag">
          <Pressable
            onPress={() => searchFor(querySuggestion || q.trim())}
            accessibilityRole="button"
          >
            <Text style={{ color: colors.primary, paddingVertical: 8 }}>
              Søg efter {querySuggestion || q.trim()}
            </Text>
          </Pressable>
          {suggestions.map((s) => (
            <Pressable
              key={s.name}
              onPress={() => searchFor(s.name)}
              style={styles.sug}
              accessibilityRole="button"
              accessibilityLabel={`${s.name}, ${spokenKr(s.price)}`}
              accessibilityHint="Søger efter varen"
            >
              <Text style={{ color: colors.text }}>{s.name}</Text>
              <Text style={{ color: colors.textMuted }}>{s.price.toFixed(2)} kr</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {q.trim().length > 0 && products.length > 0 ? (
        <FiltersBar values={filters} onChange={setFilters} />
      ) : null}
      {total > 0 ? (
        <Text style={[styles.meta, { color: colors.textMuted }]}>{total} resultater</Text>
      ) : null}
      {error && !loading ? (
        <View style={{ padding: 24, alignItems: 'center', gap: 10 }}>
          <Text
            style={{ color: colors.text, fontWeight: '600', textAlign: 'center' }}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {error}
          </Text>
          <Pressable
            onPress={() => void load()}
            accessibilityRole="button"
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 8,
              paddingHorizontal: 14,
              paddingVertical: 8,
            }}
          >
            <Text style={{ color: colors.primary, fontWeight: '600' }}>Prøv igen</Text>
          </Pressable>
        </View>
      ) : loading && !products.length ? (
        <ActivityIndicator
          color={colors.primary}
          style={{ marginTop: 20 }}
          accessibilityLabel="Søger"
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={showStarter ? starter!.products : products}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={{ paddingHorizontal: 2 }}
          contentContainerStyle={{ padding: 4, paddingBottom: 4 + tabOverlap }}
          scrollIndicatorInsets={{ bottom: tabOverlap }}
          keyboardShouldPersistTaps="handled"
          // Tastaturet åbner selv (autoFocus) og dækker halvdelen af
          // forslagene. Et træk i listen lukker det, så varerne kan ses.
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator
          ListHeaderComponent={emptyHeader}
          renderItem={({ item }) => (
            <ProductCard
              product={item}
              onPress={(p) => {
                // At åbne en vare fra resultaterne tæller som en rigtig søgning.
                if (committedQuery) rememberSearch(committedQuery);
                navigation.navigate('ProductDetail', { product: p });
              }}
            />
          )}
          ListEmptyComponent={
            // Samme hjælpetekst som kategorilisten - en blank skærm forklarer
            // ikke om søgningen fandt nul, eller om noget gik galt. Men uden
            // et tastet søgeord er "ingen varer matcher" vildledende - det
            // ser ud som et resultat af en søgning, der aldrig blev lavet.
            // Web-parallelen er app.py's '/search': tomt input giver
            // "Indtast søgeord", aldrig "Ingen resultater fundet".
            !loading ? (
              q.trim().length === 0 ? (
                hasPersonal ? null : <View style={{ padding: 32, alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: colors.text, fontWeight: '600', textAlign: 'center' }}>
                    Søg efter produkter
                  </Text>
                  <Text style={{ color: colors.textMuted, textAlign: 'center' }}>
                    Skriv et ord ovenfor for at komme i gang.
                  </Text>
                </View>
              ) : (
                <View style={{ padding: 32, alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: colors.text, fontWeight: '600', textAlign: 'center' }}>
                    Ingen varer matcher din søgning.
                  </Text>
                  <Text style={{ color: colors.textMuted, textAlign: 'center' }}>
                    Prøv et andet ord, fjern et filter, eller vælg flere butikker.
                  </Text>
                </View>
              )
            ) : null
          }
          ListFooterComponent={
            showStarter ? null : (
              <Pager page={page} totalPages={totalPages} onPage={(p) => setPage(p)} />
            )
          }
        />
      )}
    </TabScreenBody>
  );
}

const styles = StyleSheet.create({
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  inputWrap: {
    flex: 1,
    height: 48,
    borderRadius: 999,
    borderWidth: 2,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 0, height: '100%' },
  cancel: { minHeight: 44, justifyContent: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600' },
  recentTitle: { fontSize: 13, fontWeight: '700', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  recentWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12 },
  recentPill: {
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
  },
  recentText: { fontSize: 14, fontWeight: '500', flexShrink: 1 },
  buyAgainHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 22,
    paddingBottom: 10,
  },
  buyAgainTitle: { fontSize: 17, fontWeight: '800' },
  buyAgainSub: { fontSize: 13 },
  buyAgainCard: { paddingHorizontal: 12 },
  sug: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  meta: { paddingHorizontal: 16, marginBottom: 4 },
  starterTitle: { fontSize: 17, fontWeight: '800', paddingHorizontal: 12, paddingTop: 22, paddingBottom: 4 },
  pager: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  pageBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
});
