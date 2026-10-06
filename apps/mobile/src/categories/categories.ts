import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Alle hovedkategorier i samme rækkefølge som webbens kategorimenu
 * (templates/base.html). Bruges af kategori-skuffen (CategoriesDrawer),
 * som forsidens "Kategorier"-knap åbner fra venstre. Før 03-10-2026 lå de som en vandret
 * chip-bjælke på forsiden, hvor man skulle swipe for at se de sidste.
 *
 * slug 'sale' er Ugens Tilbud (egen skærm, ikke /api/category/<slug>).
 */
export const CATEGORY_LINKS: Array<{ label: string; slug: string; icon: IconName }> = [
  { label: 'Ugens Tilbud', slug: 'sale', icon: 'pricetag-outline' },
  { label: 'Kolonial', slug: 'Kolonial', icon: 'basket-outline' },
  { label: 'Køl & Mejeri', slug: 'Mejeri', icon: 'egg-outline' },
  { label: 'Kød & Fisk', slug: 'Koed_og_fisk', icon: 'fish-outline' },
  { label: 'Frugt & Grønt', slug: 'Frugt_og_groent', icon: 'nutrition-outline' },
  { label: 'Drikkevarer', slug: 'Drikkevarer', icon: 'wine-outline' },
  { label: 'Frost', slug: 'Frost', icon: 'snow-outline' },
  { label: 'Brød & Kager', slug: 'Broed_og_kager', icon: 'restaurant-outline' },
  { label: 'Slik', slug: 'Slik', icon: 'ice-cream-outline' },
];
