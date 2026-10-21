import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Image,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text, AnimatedText } from '../theme/Typography';
import type { Product } from '../api/types';
import { useTheme } from '../theme/ThemeContext';
import { useCart } from '../cart/CartContext';
import { buildStorePrices } from '../cart/buildStorePrices';
import { showCartToast } from '../cart/CartToast';
import { useStoreCatalog } from '../stores/StoreCatalogContext';
import { StoreDot } from './StoreChip';
import { StoreLogo } from '../stores/storeLogos';
import { cardShadow } from '../theme/Typography';
import { ShelfPrice } from './ShelfPrice';
import { QuantityStepper } from './QuantityStepper';
import { joinLabel, spokenKr } from '../a11y/speech';

type Props = {
  product: Product;
  onPress: (product: Product) => void;
  /** `rail` = horisontal forside-række (fast bredde, ingen 48%-max).
   *  `avis` = felt i tilbudsavisen (StoreAvisScreen): ingen kant eller
   *  baggrund, rødt SPAR-mærke og gult prisskilt, som .avis-paper på web. */
  variant?: 'grid' | 'rail' | 'avis';
};

/** Byg kurv-varen ud fra et produkt (samme felter som før version C). */
function cartItemFrom(product: Product, catalog: ReturnType<typeof useStoreCatalog>['catalog']) {
  const { storePrices, storeMultiDeals } = buildStorePrices(product, catalog);
  return {
    id: `product${product.id}`,
    name: product.name,
    description: product.description || '',
    store: product.store,
    price: product.price,
    storePrices,
    storeMultiDeals,
    image: product.image,
    category: product.category || 'Andre varer',
    unitMeasure: product.unit_measure,
    kgPrice: product.kg_price != null ? `${product.kg_price.toFixed(2)} kr/kg` : '',
    multiDeal: product.multi_deal || undefined,
  };
}

export function ProductCard(props: Props) {
  if (props.variant === 'avis') return <AvisProductCard {...props} />;
  return <GridProductCard {...props} />;
}

/**
 * Produktkortet i version C2 (19-10-2026): hvidt, rundt kort uden kant,
 * butikslogo i billedet, lille gul "Spar 49%"-pille, pris som hyldeskilt og en
 * "+" der bliver til "− 1 +" koblet direkte til kurven.
 */
function GridProductCard({ product, onPress, variant = 'grid' }: Props) {
  const { colors } = useTheme();
  const { items, addItem, updateQuantity } = useCart();
  const { catalog } = useStoreCatalog();
  const cartId = `product${product.id}`;
  const quantity = items.find((i) => i.id === cartId)?.quantity ?? 0;

  const onSale = product.is_sale || product.is_any_sale;
  const hasBefore = product.is_sale && product.normal_price > product.price;
  const discountPct = hasBefore
    ? Math.round((1 - product.price / product.normal_price) * 100)
    : null;
  const onlyHere = Object.keys(product.store_matches || {}).length === 0;
  const kgPrice =
    product.kg_price != null && product.kg_price > 0
      ? `${product.kg_price.toFixed(2).replace('.', ',')} kr/kg`
      : null;

  const add = () => {
    if (quantity > 0) {
      updateQuantity(cartId, quantity + 1);
      showCartToast();
      AccessibilityInfo.announceForAccessibility(`${quantity + 1} ${product.name} i kurven`);
      return;
    }
    addItem(cartItemFrom(product, catalog));
    AccessibilityInfo.announceForAccessibility(`${product.name} lagt i kurven`);
  };
  const remove = () => {
    updateQuantity(cartId, quantity - 1);
    AccessibilityInfo.announceForAccessibility(
      quantity - 1 > 0 ? `${quantity - 1} ${product.name} i kurven` : `${product.name} fjernet fra kurven`,
    );
  };

  // Hele kortet er ét element for VoiceOver (det samler sine børn), så
  // kurv-knapperne ligger også som handlinger på kortet.
  const a11yLabel = joinLabel([
    product.name,
    product.brand,
    product.description,
    product.stk_count ? `${product.stk_count} stk` : null,
    onSale ? (discountPct ? `Tilbud, spar ${discountPct} procent` : 'Tilbud') : null,
    spokenKr(product.price),
    hasBefore ? `før ${spokenKr(product.normal_price)}` : null,
    kgPrice ? `${spokenKr(product.kg_price)} pr. kilo` : null,
    onlyHere ? `kun hos ${product.store}` : `hos ${product.store}`,
    quantity > 0 ? `${quantity} i kurven` : null,
  ]);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      delayPressIn={80}
      onPress={() => onPress(product)}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint="Åbner varen"
      accessibilityActions={
        quantity > 0
          ? [
              { name: 'add', label: 'Tilføj en' },
              { name: 'remove', label: 'Fjern en' },
            ]
          : [{ name: 'add', label: `Læg ${product.name} i kurv` }]
      }
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'add') add();
        else if (e.nativeEvent.actionName === 'remove') remove();
      }}
      style={[
        cStyles.card,
        variant === 'rail' ? cStyles.cardRail : cStyles.cardGrid,
        { backgroundColor: colors.surface },
        cardShadow(colors.shadow),
      ]}
    >
      <View style={[cStyles.imageWrap, { backgroundColor: colors.logoBg }]}>
        {product.image ? (
          <Image source={{ uri: product.image }} style={cStyles.image} resizeMode="contain" />
        ) : (
          <View style={[cStyles.imagePlaceholder, { backgroundColor: colors.border }]} />
        )}
        <View
          style={[cStyles.logoPill, { backgroundColor: colors.logoBg, borderColor: colors.border }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <StoreLogo store={product.store} maxWidth={56} />
        </View>
      </View>

      {onSale ? (
        // C2: lille, rolig gul pille øverst til venstre i billedfeltet (14 fra
        // kortets kant), ikke drejet og inden for kortet.
        <View
          style={[cStyles.salePill, { backgroundColor: colors.deal }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={[cStyles.salePillText, { color: colors.dealText }]}>
            {discountPct ? `Spar ${discountPct}%` : 'Tilbud'}
          </Text>
        </View>
      ) : null}

      <View style={cStyles.body}>
        <Text style={[cStyles.name, { color: colors.text }]} numberOfLines={2}>
          {product.name}
        </Text>
        {/* C2: kun kg-prisen under navnet (ingen ekstra prislinjer). Uden
            kg-pris vises vægten, så man stadig kan se hvor meget man får. */}
        {kgPrice || product.description ? (
          <Text style={[cStyles.meta, { color: colors.textMuted }]} numberOfLines={1}>
            {kgPrice || product.description}
          </Text>
        ) : null}

        <View style={cStyles.footer}>
          <View style={cStyles.priceCol}>
            {hasBefore ? (
              <Text style={[cStyles.before, { color: colors.textMuted }]}>
                {product.normal_price.toFixed(2).replace('.', ',')}
              </Text>
            ) : null}
            <ShelfPrice value={product.price} color={colors.text} size={quantity > 0 && product.price >= 100 ? 22 : 26} />
          </View>
          <QuantityStepper quantity={quantity} name={product.name} onAdd={add} onRemove={remove} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const cStyles = StyleSheet.create({
  card: {
    borderRadius: 22,
    marginHorizontal: 6,
    marginVertical: 7,
    paddingBottom: 12,
    position: 'relative',
  },
  cardGrid: { flex: 1, width: '100%', alignSelf: 'stretch' },
  cardRail: { width: '100%' },
  imageWrap: {
    margin: 8,
    marginBottom: 0,
    height: 120,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: 104, height: 104, maxWidth: '100%' },
  imagePlaceholder: { width: 72, height: 72, borderRadius: 16 },
  logoPill: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    height: 24,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '80%',
  },
  salePill: {
    position: 'absolute',
    top: 14,
    left: 14,
    zIndex: 2,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  salePillText: { fontSize: 12, fontWeight: '800', letterSpacing: -0.1 },
  body: { paddingHorizontal: 12, paddingTop: 8 },
  name: { fontSize: 14, fontWeight: '600', lineHeight: 18, minHeight: 36 },
  meta: { fontSize: 12, marginTop: 2 },
  footer: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 6,
  },
  priceCol: { flexShrink: 1 },
  before: { fontSize: 12, textDecorationLine: 'line-through' },
});

/** Tilbudsavisens felt (StoreAvisScreen) - uændret af version C. */
function AvisProductCard({ product, onPress, variant = 'grid' }: Props) {
  const { colors, isDark } = useTheme();
  const avis = variant === 'avis';
  const { addItem } = useCart();
  const { catalog } = useStoreCatalog();
  const [added, setAdded] = useState(false);
  const addScale = useRef(new Animated.Value(1)).current;
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    };
  }, []);

  const onSale = product.is_sale || product.is_any_sale;
  // Tilbud uden førpris (fx multikøb): butikken på kortet har tilbud, men
  // oplyser ikke normalprisen. Prisen skal stadig være gul. Samme regel i
  // webbens produktkort-makro.
  const shownStore = product.cheapest_at || '';
  const shownOnSale =
    product.store_matches?.[shownStore]?.is_sale ??
    (shownStore === 'rema' && !!product.rema_is_sale);
  const addToCart = () => {
    const { storePrices, storeMultiDeals } = buildStorePrices(product, catalog);
    addItem({
      id: `product${product.id}`,
      name: product.name,
      description: product.description || '',
      store: product.store,
      price: product.price,
      storePrices,
      storeMultiDeals,
      image: product.image,
      category: product.category || 'Andre varer',
      unitMeasure: product.unit_measure,
      kgPrice: product.kg_price != null ? `${product.kg_price.toFixed(2)} kr/kg` : '',
      multiDeal: product.multi_deal || undefined,
    });
    setAdded(true);
    addScale.setValue(0.8);
    Animated.spring(addScale, {
      toValue: 1,
      friction: 4,
      tension: 140,
      useNativeDriver: true,
    }).start();
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setAdded(false), 900);
    // Fluebenet er kun synligt; skærmlæseren skal også høre at det lykkedes.
    AccessibilityInfo.announceForAccessibility(`${product.name} lagt i kurven`);
  };

  const discountPct =
    product.is_sale && product.normal_price > product.price
      ? Math.round((1 - product.price / product.normal_price) * 100)
      : null;

  // Hele kortet er ét element for VoiceOver: en knap der åbner varen, med alt
  // det vigtige i én sætning. Kurv-knappen inde i kortet kan VoiceOver ikke
  // fokusere på (kortet samler sine børn), så den ligger også som handling
  // på kortet: stryg op eller ned og vælg "Tilføj til kurv".
  const a11yLabel = joinLabel([
    product.name,
    product.brand,
    product.description,
    product.stk_count ? `${product.stk_count} stk` : null,
    onSale ? (discountPct ? `Tilbud, spar ${discountPct} procent` : 'Tilbud') : null,
    spokenKr(product.price),
    product.is_sale && product.normal_price > product.price
      ? `før ${spokenKr(product.normal_price)}`
      : null,
    product.kg_price != null && product.kg_price > 0
      ? `${spokenKr(product.kg_price)} pr. kilo`
      : null,
    Object.keys(product.store_matches || {}).length === 0
      ? `kun hos ${product.store}`
      : `hos ${product.store}`,
  ]);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      delayPressIn={80}
      onPress={() => onPress(product)}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint="Åbner varen"
      accessibilityActions={[{ name: 'addToCart', label: 'Tilføj til kurv' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'addToCart') addToCart();
      }}
      style={[
        styles.card,
        variant === 'rail' ? styles.cardRail : styles.cardGrid,
        { backgroundColor: colors.surface, borderColor: colors.border },
        avis && [styles.cardAvis, { borderColor: colors.border }],
      ]}
    >
      <View
        style={[
          styles.imageWrap,
          {
            backgroundColor: avis ? 'transparent' : isDark ? '#252825' : '#F3F5F0',
          },
          avis && styles.imageWrapAvis,
        ]}
      >
        {onSale ? (
          <View style={[styles.saleBadge, avis && styles.saleBadgeAvis]}>
            <Text style={[styles.saleText, avis && styles.saleTextAvis]}>{discountPct ? `SPAR ${discountPct}%` : 'TILBUD'}</Text>
          </View>
        ) : null}
        {/* Neutral flade med en grøn prik: grøn er primærfarven, gul er
            forbeholdt tilbud (theme/colors.ts). */}
        {avis ? null : (
          <View style={[styles.storeBadge, { backgroundColor: colors.surface }]}>
            <StoreDot store={product.store} size={7} />
            <Text style={[styles.storeText, { color: colors.text }]} numberOfLines={1}>
              {product.store}
            </Text>
          </View>
        )}
        {product.image ? (
          <Image source={{ uri: product.image }} style={styles.image} resizeMode="contain" />
        ) : (
          <View style={[styles.imagePlaceholder, { backgroundColor: colors.border }]} />
        )}
      </View>
      <Text style={[styles.brand, { color: colors.textMuted }]} numberOfLines={1}>
        {product.brand}
      </Text>
      <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
        {product.name}
      </Text>
      {/* Vægt/beskrivelse, antal og kg-pris - præcis de tre linjer webbens
          produktkort altid har haft (.product-weight × 2 + .product-kg-price i
          templates/macros/product_card.html), i samme rækkefølge og med samme
          betingelser. Felterne har ligget klar i listing-JSON'en hele tiden
          (app_support.py::product_to_api_dict: description / stk_count /
          kg_price) - kortet rendrede dem bare ikke, så app-brugeren kunne se
          en pris uden at kunne se hvor meget man fik for den. I en
          pris-sammenligning er kg-prisen selve sammenligningsgrundlaget. */}
      {product.description ? (
        <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
          {product.description}
        </Text>
      ) : null}
      {product.stk_count ? (
        <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
          {product.stk_count} stk
        </Text>
      ) : null}
      {product.kg_price != null && product.kg_price > 0 ? (
        <Text style={[styles.kgPrice, { color: colors.textMuted }]} numberOfLines={1}>
          {product.kg_price.toFixed(2)} kr/kg
        </Text>
      ) : null}
      {/* Samme betingelse som webben: `{% if not product.store_matches %}`.
          `has_match` er `bool(store_matches) or rema_price > 0`
          (app_support.py::product_to_api_dict), så et Rema-kort UDEN
          krydsmatch har has_match=true - webben viste badget, appen gjorde
          ikke, selvom varen faktisk kun findes ét sted. */}
      {!avis && Object.keys(product.store_matches || {}).length === 0 ? (
        <Text style={[styles.only, { color: colors.textMuted }]}>
          Kun hos {product.store}
        </Text>
      ) : null}
      <View style={styles.footer}>
        <View style={styles.priceCol}>
          {avis ? (
            <>
              {product.is_sale && product.normal_price > product.price ? (
                <Text style={[styles.original, { color: colors.textMuted }]}>
                  Før {product.normal_price.toFixed(2)} kr
                </Text>
              ) : null}
              <View style={styles.priceTag}>
                <Text style={styles.priceTagText}>{product.price.toFixed(2)} kr</Text>
              </View>
            </>
          ) : product.is_sale ? (
            <>
              <Text style={[styles.original, { color: colors.textMuted }]}>
                {product.normal_price.toFixed(2)} kr
              </Text>
              <Text
                style={[styles.price, styles.dealPrice, { color: colors.dealInk }]}
              >
                {product.price.toFixed(2)} kr
              </Text>
            </>
          ) : shownOnSale ? (
            <Text style={[styles.price, styles.dealPrice, { color: colors.dealInk }]}>
              {product.price.toFixed(2)} kr
            </Text>
          ) : (
            <Text style={[styles.price, { color: colors.text }]}>
              {product.price.toFixed(2)} kr
            </Text>
          )}
        </View>
      </View>
      {/* Varenavnet SKAL med i etiketten: i et gitter med 60 kort hoerer
          VoiceOver ellers 60 identiske "Tilføj til kurv". Samme rettelse er
          lavet i webbens produktkort-makro. På iOS samler kortet sine børn,
          så her bruges handlingen på kortet; TalkBack kan nå knappen selv. */}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Tilføj ${product.name} til kurv`}
        activeOpacity={0.8}
        onPress={addToCart}
        style={[styles.addBtn, { backgroundColor: colors.primary }]}
      >
        <AnimatedText
          style={[styles.addBtnText, { transform: [{ scale: addScale }] }]}
        >
          {added ? '✓' : '+'}
        </AnimatedText>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    paddingTop: 10,
    paddingHorizontal: 10,
    paddingBottom: 12,
    marginHorizontal: 3,
    marginVertical: 4,
    position: 'relative',
    overflow: 'hidden',
  },
  cardGrid: {
    flex: 1,
    width: '100%',
    alignSelf: 'stretch',
  },
  cardAvis: {
    borderWidth: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 0,
    marginHorizontal: 0,
    marginVertical: 0,
    backgroundColor: 'transparent',
  },
  cardRail: {
    width: '100%',
    marginHorizontal: 2,
  },
  imageWrap: {
    height: 118,
    marginBottom: 8,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    overflow: 'hidden',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  imageWrapAvis: { height: 132, paddingHorizontal: 0 },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  imagePlaceholder: {
    width: '70%',
    height: '70%',
    borderRadius: 10,
    alignSelf: 'center',
  },
  saleBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 2,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#DFA300',
  },
  saleText: { color: '#1A1C19', fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
  // Avis: rødt, skråt mærke nederst til højre på billedet, som på web.
  saleBadgeAvis: {
    top: undefined,
    left: undefined,
    bottom: 6,
    right: 4,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: '#C8102E',
    transform: [{ rotate: '-8deg' }],
  },
  saleTextAvis: { color: '#FFFFFF' },
  storeBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 2,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: '55%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  storeText: { fontSize: 10, fontWeight: '600' },
  brand: { fontSize: 11, marginBottom: 2 },
  name: { fontSize: 14, fontWeight: '600', minHeight: 36 },
  meta: { fontSize: 11, marginTop: 2 },
  kgPrice: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  only: { fontSize: 11, marginTop: 4 },
  footer: {
    marginTop: 8,
    paddingRight: 44,
    minHeight: 36,
    justifyContent: 'flex-end',
  },
  priceCol: {
    alignSelf: 'flex-start',
  },
  original: { fontSize: 12, textDecorationLine: 'line-through' },
  price: { fontSize: 16, fontWeight: '700' },
  // Tilbudspris: gul tekst på kortets egen baggrund. Kun SPAR-mærkatet har
  // gul flade (Kalle 04-10-2026).
  dealPrice: { fontWeight: '800' },
  priceTag: {
    marginTop: 2,
    paddingHorizontal: 7,
    paddingTop: 1,
    paddingBottom: 3,
    borderRadius: 6,
    backgroundColor: '#FFD84D',
    transform: [{ rotate: '-2deg' }],
  },
  priceTagText: { color: '#1A1C19', fontSize: 19, fontWeight: '900', letterSpacing: -0.3 },
  addBtn: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: { color: '#fff', fontSize: 22, fontWeight: '600', marginTop: -2 },
});
