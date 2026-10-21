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
import { fetchHome, fetchSearch } from '../api/listing';
import type { ListingResponse, Product } from '../api/types';
import { FiltersBar, type FiltersValue } from '../components/FiltersBar';
import { ProductCard } from '../components/ProductCard';
import { TabScreenBody } from '../components/ScreenBody';
import { useStoreCatalog, storesParam } from '../stores/StoreCatalogContext';
import { useTheme } from '../theme/ThemeContext';
import { Pager } from '../components/Pager';
import { setServerStatsEnabled, trackSearch } from '../stats/stats';
import type { RootStackParamList } from '../navigation/types';
import { rememberSearch, useRecentSearches } from '../search/recentSearches';
import { SearchCache, matchRecentSearches } from '../search/searchCache';

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

/**
 * Ventetid efter sidste tastetryk, før der søges. Var 500 ms; 350 ms er stadig
 * længere end pausen mellem to tastetryk for de fleste, så et ord der skrives
 * færdigt giver én søgning, ikke én pr. bogstav.
 */
const TYPE_DEBOUNCE_MS = 350;

/** Søgesvar fra de seneste 10 minutter, se search/searchCache.ts. */
const searchCache = new SearchCache<ListingResponse>();

export function SearchScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  // queryLabels: debouncet butiksvalg (se StoreCatalogContext) - ellers ville
  // hvert butikstryk i filter-arket koste baade en autocomplete og en soegning.
  const { queryLabels, catalog, ready } = useStoreCatalog();
  const [q, setQ] = useState('');
  // Kun opdateret TYPE_DEBOUNCE_MS efter brugeren er holdt op med at skrive
  // (eller med det samme ved søg-knappen/et tryk på en seneste søgning) -
  // selve søgningen (inkl. sideskift) afhænger af DENNE, ikke af q direkte,
  // så et sideskift ikke også skal vente.
  const [committedQuery, setCommittedQuery] = useState('');
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

  // Aktuel søgnings AbortController - annulleres ved næste søgning, så et
  // langsomt, forældet svar ikke kan overskrive et nyere (fx skriver
  // brugeren "mælk" og retter hurtigt til "mælkebøtte": to kald i luften,
  // uden dette vandt det langsomste, uanset hvilket der var nyest).
  const searchControllerRef = useRef<AbortController | null>(null);
  // Sidst talte søgeord til varestatistikken: et sideskift eller filterskift
  // på samme søgning må ikke tælle som en ny søgning (samme regel som webben).
  const countedQueryRef = useRef('');
  const [focused, setFocused] = useState(false);
  // C2: "Seneste søgninger", kun gemt på telefonen. "Køb igen" vises kun
  // nederst i kurven ("Glemt noget?"), ikke i Søg (Kalle 21-10-2026).
  const recentSearches = useRecentSearches();

  // Ny søgning nulstiller advanced filters (web-paritet). Sætter DEFAULT_FILTERS
  // (samme objektreference hver gang) og kun når der faktisk er noget at
  // nulstille - se kommentaren ved DEFAULT_FILTERS.
  useEffect(() => {
    setFilters((prev) => (prev === DEFAULT_FILTERS ? prev : DEFAULT_FILTERS));
  }, [q]);

  // Ingen kald til /api/autocomplete i appen længere (21-10-2026). Det blev
  // sendt 200 ms efter hvert ophold i tastningen, og søgningen 300 ms efter.
  // Serveren regner kun én ting ad gangen pr. isolate (src/worker.py:
  // _render_exclusive), så søgningen stod i kø bag forslagene - og
  // forslagene blev alligevel skjult, så snart varerne kom. I stedet vises de
  // seneste søgninger, der passer til det man skriver, med det samme og uden
  // net (matchRecentSearches).

  // Skriv-debounce: opdaterer KUN committedQuery og nulstiller til side 1.
  // Selve hentningen sker i effekten nedenfor, som også dækker sideskift -
  // et sideskift skal ikke vente som en tastetryk-søgning.
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
    // Ét bogstav søger ikke af sig selv: "m" rammer tusindvis af varer, er
    // den tungeste søgning serveren har, og bliver alligevel aldrig vist,
    // fordi man skriver videre. Søg-knappen søger stadig på ét bogstav.
    if (query.length < 2) return;
    const t = setTimeout(() => {
      setPage(1);
      setCommittedQuery(query);
    }, TYPE_DEBOUNCE_MS);
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
  const hasPersonal = recentSearches.length > 0;

  /** Søg med det samme, uden at vente på skrive-debouncen. */
  const commitNow = (term: string) => {
    const query = term.trim();
    if (!query) return;
    setPage(1);
    setCommittedQuery(query);
  };

  const searchFor = (term: string) => {
    rememberSearch(term);
    setQ(term);
    commitNow(term);
  };

  const typedMatches = q.trim().length >= 1 ? matchRecentSearches(recentSearches, q) : [];

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
    const params = {
      q: committedQuery,
      page,
      stores: storesParam(queryLabels, catalog),
      ...filters,
    };
    const cacheKey = JSON.stringify(params);
    const show = (r: ListingResponse) => {
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
    };
    const cached = searchCache.get(cacheKey);
    if (cached) {
      // Samme søgning for lidt siden: vis den med det samme, ingen netkald.
      setError(null);
      setLoading(false);
      show(cached);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetchSearch(params, controller);
      if (controller.signal.aborted) return;
      // Tomme svar gemmes ikke: et "0 varer" kan være en forbigående fejl på
      // serveren (X-Data-Degraded), og det må ikke hænge ved i 10 minutter.
      if (r.success !== false && (r.total ?? 0) > 0) searchCache.set(cacheKey, r);
      show(r);
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
              if (q.trim()) {
                rememberSearch(q);
                commitNow(q);
              }
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
      {typedMatches.length > 0 && !products.length ? (
        <View style={{ paddingHorizontal: 12 }} accessibilityLabel="Seneste søgninger der passer">
          {typedMatches.map((term) => (
            <Pressable
              key={term}
              onPress={() => searchFor(term)}
              style={styles.sug}
              accessibilityRole="button"
              accessibilityLabel={`Søg efter ${term} igen`}
            >
              <Ionicons name="time-outline" size={16} color={colors.textMuted} />
              <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>
                {term}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {q.trim().length > 0 && products.length > 0 ? (
        <FiltersBar values={filters} onChange={setFilters} />
      ) : null}
      {total > 0 ? (
        <View style={styles.metaRow}>
          <Text style={[styles.meta, { color: colors.textMuted }]}>{total} resultater</Text>
          {/* Der vises stadig varer fra forrige søgning, mens den nye hentes.
              Uden et tegn lignede det, at appen bare stod stille. */}
          {loading ? (
            <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Søger" />
          ) : null}
        </View>
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
          contentContainerStyle={{ padding: 4 }}
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
  sug: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 16, marginBottom: 4 },
  meta: { paddingHorizontal: 16 },
  starterTitle: { fontSize: 17, fontWeight: '800', paddingHorizontal: 12, paddingTop: 22, paddingBottom: 4 },
  pager: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  pageBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
});
