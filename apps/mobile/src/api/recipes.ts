/** Opskrifter — spejler app.py /api/recipes + /api/recipes/<id> (web-paritet). */
import { apiGet, apiPost } from './client';
import type { Product } from './types';
import { recipesPreviewKey } from '../config/env';
import { getSupabase } from '../auth/supabase';

// MadShopper Test henter de skjulte opskrifter via testnøglen; alle andre
// builds bruger den almindelige sti (app.py::get_recipes_preview).
const BASE = recipesPreviewKey
  ? `/api/recipes-preview/${encodeURIComponent(recipesPreviewKey)}`
  : '/api/recipes';

export type Recipe = {
  id: number;
  title: string;
  image_url: string;
  servings: number | null;
  total_time_minutes: number | null;
  source_name: string;
  source_url: string;
  cheapest_total_price: number | null;
  matched_ingredient_count: number;
  total_ingredient_count: number;
  ingredients_on_sale_count: number;
  sale_ratio: number;
  /** Mærker til madplanen (app.py::_recipe_plan_profile). Mangler i svar fra
   * en ældre server, og så kommer opskriften ikke med i planen. */
  plan?: RecipePlanProfile;
};

export type RecipePlanProfile = {
  /** Kostbehov opskriften passer til: vegansk, vegetar, pescetar, glutenfri, maelkefri. */
  diet: string[];
  /** hurtig, let, familie, sund, takeaway, protein */
  moods: string[];
  /** Køkkenudstyr den kræver: ovn, kogeplade, blender, roeremaskine, airfryer, mikroovn. */
  needs: string[];
  /** Falsk for bagværk (boller, brød, kage), som ikke kommer med i aftensmadsplanen. */
  meal: boolean;
  ingredient_names: string[];
};

export type RecipeListResponse = {
  success: boolean;
  recipes: Recipe[];
};

export type MatchedProduct = {
  id: string;
  name: string;
  image: string;
  price: number;
  is_sale: boolean;
  store: string;
  category: string;
  unit_measure: string;
  weight_g: number | null;
  stk_count: number | null;
  kg_price: number | null;
  multi_deal: string;
  store_prices: Record<string, number>;
  /** Fuldt Product-objekt til "åbn produkt" (ProductDetail-skærmen) - samme
   * form som /api/home o.l. leverer (product_to_api_dict, app.py). Findes på
   * BÅDE matched_product og hver candidate, så navigationen følger med når
   * personer-skalering client-side skifter til en anden kandidat-pakke. */
  api: Product | null;
};

/** Kildens egen schema.org NutritionInformation (recipe_importer.py) -
 * autoritativ, vises i stedet for vores eget estimat når den findes. */
export type NutritionSource = {
  serving_size?: string;
  calories?: string;
  protein?: string;
  fat?: string;
  carbohydrate?: string;
  fiber?: string;
};

/** Vores eget estimat (app.py::_recipe_nutrition_estimate) - kun summeret
 * over ingredienser med både en vægt-/volumenenhed OG næringsdata, se
 * contributing_ingredient_count. Skaleres LINEÆRT med personer client-side
 * (samme princip som RecipeDetailScreen's scale-beregning for pris). */
export type NutritionEstimate = {
  kcal: number;
  protein: number;
  fedt: number;
  kulhydrat: number;
  contributing_ingredient_count: number;
  total_ingredient_count: number;
};

export type RecipeIngredient = {
  id: number;
  position: number;
  raw_text: string;
  quantity: number | null;
  unit: string;
  ingredient_name: string;
  matched_product_id: string | null;
  match_confidence: number | null;
  matched_product: MatchedProduct | null;
  candidates: MatchedProduct[];
};

export type RecipeDetail = {
  id: number;
  title: string;
  image_url: string;
  servings: number | null;
  total_time_minutes: number | null;
  instructions: string[];
  source_name: string;
  source_url: string;
  nutrition_source: NutritionSource | null;
  nutrition_estimate: NutritionEstimate | null;
};

export type RecipeSnapshot = {
  recipe_id: number;
  cheapest_total_price: number | null;
  matched_ingredient_count: number;
  total_ingredient_count: number;
  ingredients_on_sale_count: number;
};

export type RecipeDetailResponse = {
  success: boolean;
  recipe: RecipeDetail | null;
  ingredients: RecipeIngredient[];
  snapshot: RecipeSnapshot | null;
};

export async function fetchRecipes(): Promise<RecipeListResponse> {
  return apiGet(BASE);
}

/** Selve opskriften kræver betaling (app.py::get_recipe): uden adgang svarer
 * serveren 403 med locked=true, så login-tokenen sendes med. */
export async function fetchRecipeDetail(id: number): Promise<RecipeDetailResponse> {
  const { data } = (await getSupabase()?.auth.getSession()) ?? { data: null };
  const token = data?.session?.access_token;
  return apiGet(`${BASE}/${id}`, undefined, undefined, token ? { Authorization: `Bearer ${token}` } : undefined);
}

export async function recordRecipeClick(id: number): Promise<void> {
  // Fire-and-forget, samme fail-safe som web (templates/opskrift.html) - en
  // fejlet klik-registrering må aldrig blokere eller fejle skærmen.
  // Testappens klik må ikke tælle med i produktionens tal.
  if (recipesPreviewKey) return;
  try {
    await apiPost('/api/recipe-click', { recipe_id: id });
  } catch {
    // stille fail-safe
  }
}
