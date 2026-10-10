/** Produkt-JSON som returneret af listing-API'erne (docs/native-app.md §3). */

export type StoreMatch = {
  name: string;
  price: number | null;
  normal_price: number | null;
  is_sale: boolean;
  image: string;
  brand: string;
  description: string;
  weight: string;
  kg_price: number | null;
  multi_deal: string;
  ean: string;
  Kategori: string;
};

export type Product = {
  id: string;
  name: string;
  brand: string;
  description: string;
  image: string;
  main_image: string;
  rema_image: string;
  category: string;
  subcategory: string;
  store: string;
  price: number;
  normal_price: number;
  is_sale: boolean;
  is_any_sale: boolean;
  sale_end_date: string | null;
  unit_measure: string;
  weight_g: number | null;
  stk_count: number | null;
  kg_price: number | null;
  multi_deal: string;
  is_organic: boolean;
  is_lactose_free: boolean;
  has_match: boolean;
  has_match_rema: boolean;
  cheapest_at: string | null;
  cheaper_at: string | null;
  rema_price: number | null;
  rema_is_sale: boolean;
  lowest_price_30d: number | null;
  store_matches: Record<string, StoreMatch>;
};

export type StoreInfo = {
  key: string;
  label: string;
  logo: string;
};

/** En butik i forsidens tilbudsaviser (Feature-panelet 'butiksaviser'). */
export type OfferStore = {
  key: string;
  label: string;
  logo: string;
  /** Butikkens egen avis; vi viser kun et link til den. */
  avis_url: string;
  /** Avisens farver (baggrund og tekst). */
  color?: string;
  text_color?: string;
  /** Antal tilbud denne uge, når serveren kender det. */
  count?: number;
};

/** /api/store-avis/<butik>: butikkens tilbudsavis bygget af vores egne priser. */
export type StoreAvisResponse = {
  success: boolean;
  store: string;
  label: string;
  logo: string;
  /** Flise med butikkens logo, gentages svagt i avisens baggrund. */
  watermark?: string;
  avis_url: string;
  color: string;
  text_color: string;
  week: number;
  total: number;
  best: Product[];
  sections: Array<{ slug: string; title: string; count: number; products: Product[] }>;
  error?: string;
};

export type HomeSection = {
  key: string;
  title: string;
  href: string | null;
  products: Product[];
};

export type HomeResponse = {
  success: boolean;
  sections: HomeSection[];
  /** Samme forudberegnede top-10-pulje som web-forsidens "Lækre opskrifter"
   * (home_data_v1-KV, klik-pointsum) - se api/recipes.ts for den fulde type. */
  recipes: import('./recipes').Recipe[];
  /** Om opskrift-kortene reelt fører nogen steder hen (app.py::_recipes_enabled).
   * Falsk i produktion: sektionen vises stadig som ikke-klikbar teaser, præcis
   * som webforsiden - se recipe_card(clickable=...) i templates/macros/. */
  recipes_clickable?: boolean;
  /** Er "Beskeder på telefonen" udgivet i Feature-panelet (src/push/push.ts)? */
  push_enabled?: boolean;
  /** Er Varestatistik udgivet i Feature-panelet (src/stats/stats.ts)? */
  stats_enabled?: boolean;
  swipe_enabled?: boolean;
  mejeri_navn_enabled?: boolean;
  /** Er "Tilbudsavis pr. butik" udgivet i Feature-panelet? */
  butiksaviser_enabled?: boolean;
  offer_stores?: OfferStore[];
  /** Stub — reel data hentes client-side via get_personal_savings (JWT). */
  personal_savings: { available: boolean; message: string };
  error?: string;
};

export type ListingResponse = {
  success: boolean;
  products: Product[];
  page: number;
  per_page: number;
  total_pages: number;
  total?: number;
  category?: string;
  slug?: string;
  available_subcategories?: string[];
  current_subcategory?: string | null;
  query?: string;
  /** /api/store-offers/<butik>: butikkens navn og egen avis. */
  label?: string;
  avis_url?: string;
  error?: string;
};

export type ListingParams = {
  stores?: string[];
  sort?: 'relevance' | 'price-asc' | 'price-desc' | 'kg-price-asc' | 'name-asc';
  min_price?: number;
  max_price?: number;
  sale?: boolean;
  organic?: boolean;
  lactose?: boolean;
  min_weight?: number;
  max_weight?: number;
  page?: number;
  subcategory?: string;
  q?: string;
  /** Ét afsnit i en butiks tilbudsavis (/api/store-offers/<butik>). */
  kategori?: string;
};
