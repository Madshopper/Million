/**
 * Madplan i Opskrift-fanen (Feature 'recipes', del "Madplan").
 *
 * Samme regler som webbens static/js/madplan.js - ret begge steder.
 * Mærkerne pr. opskrift kommer fra serveren (app.py::_recipe_plan_profile,
 * feltet `plan` i /api/recipes); selve planen laves her på telefonen.
 * Svarene gemmes kun på telefonen (AsyncStorage).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Recipe } from '../api/recipes';

const STORAGE_KEY = 'ms_recipe_prefs_v1';

export const DAYS = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag'];
export const BUDGET_MIN = 200;
export const BUDGET_MAX = 1500;
export const BUDGET_STEP = 50;
export const MAX_PEOPLE = 8;

export type Choice = { key: string; label: string; icon: string };

export const MOODS: Choice[] = [
  { key: 'hurtig', label: 'Hurtige retter', icon: '⏱️' },
  { key: 'let', label: 'Lav kalorie', icon: '🥗' },
  { key: 'familie', label: 'Familievenlig', icon: '👨‍👩‍👧' },
  { key: 'sund', label: 'Sund og mættende', icon: '🥦' },
  { key: 'takeaway', label: 'Hjemmelavet takeaway', icon: '🍕' },
  { key: 'protein', label: 'Proteinrig', icon: '💪' },
];

export const DIETS: Choice[] = [
  { key: 'vegansk', label: 'Vegansk', icon: '🥑' },
  { key: 'vegetar', label: 'Vegetar', icon: '🥕' },
  { key: 'pescetar', label: 'Pescetar', icon: '🐟' },
  { key: 'glutenfri', label: 'Glutenfri', icon: '🌾' },
  { key: 'maelkefri', label: 'Mælkefri', icon: '🥛' },
];

export const POPULAR: [string, string][] = [
  ['Hvidløg', '🧄'], ['Æg', '🥚'], ['Løg', '🧅'], ['Soja', '🍶'],
  ['Mælk', '🥛'], ['Citron', '🍋'], ['Ingefær', '🫚'], ['Gulerod', '🥕'],
  ['Tomat', '🍅'], ['Svampe', '🍄'], ['Græsk yoghurt', '🥣'], ['Peanuts', '🥜'],
  ['Kylling', '🍗'], ['Kartoffel', '🥔'], ['Fløde', '🧈'], ['Agurk', '🥒'],
  ['Koriander', '🌿'], ['Fisk', '🐟'], ['Chili', '🌶️'], ['Ost', '🧀'],
];

export const KITCHEN: Choice[] = [
  { key: 'ovn', label: 'Ovn', icon: '♨️' },
  { key: 'kogeplade', label: 'Kogeplade', icon: '🍳' },
  { key: 'airfryer', label: 'Airfryer', icon: '🍟' },
  { key: 'mikroovn', label: 'Mikroovn', icon: '📟' },
  { key: 'blender', label: 'Blender eller foodprocessor', icon: '🥤' },
  { key: 'roeremaskine', label: 'Røremaskine', icon: '🎂' },
  { key: 'elkedel', label: 'Elkedel', icon: '🫖' },
  { key: 'broedrister', label: 'Brødrister', icon: '🍞' },
];

export type MealPrefs = {
  v: 1;
  done: boolean;
  people: number;
  budget: number;
  moods: string[];
  diets: string[];
  blocked: string[];
  kitchen: string[];
  pinned: number[];
  seed: number;
};

export function defaultPrefs(): MealPrefs {
  return {
    v: 1, done: false, people: 2, budget: 500, moods: [], diets: [],
    blocked: [], kitchen: ['ovn', 'kogeplade'], pinned: [], seed: 1,
  };
}

export async function loadPrefs(): Promise<MealPrefs | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && p.v === 1 ? { ...defaultPrefs(), ...p } : null;
  } catch {
    return null;
  }
}

export function savePrefs(p: MealPrefs): void {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(p)).catch(() => {});
}

const fold = (s: string | null | undefined) => String(s || '').toLowerCase().trim();

/** Prisen er for hele pakker til hele opskriften. Portioner 2-8 tages for
 * gode varer, alt andet regnes som 4. Færre personer gør det ikke billigere
 * (hele pakker), flere skalerer op i forhold til antallet. */
export function priceFor(r: Recipe, people: number): number | null {
  if (r.cheapest_total_price == null) return null;
  const s = r.servings;
  const eff = s && s >= 2 && s <= 8 ? s : 4;
  return Math.round(r.cheapest_total_price * Math.max(1, people / eff) * 100) / 100;
}

/** Deterministisk tilfældighed: samme svar + samme seed = samme plan. */
function jitter(seed: number, id: number): number {
  const x = Math.sin(seed * 9301 + id * 49297) * 233280;
  return x - Math.floor(x);
}

function isBlocked(r: Recipe, blocked: string[]): boolean {
  if (!blocked.length) return false;
  const names = (r.plan?.ingredient_names || []).map(fold);
  const title = fold(r.title);
  return blocked.some((b) => {
    const t = fold(b);
    return !!t && (title.includes(t) || names.some((n) => n.includes(t)));
  });
}

function fits(r: Recipe, p: MealPrefs): boolean {
  const plan = r.plan;
  if (!plan || !plan.meal || r.cheapest_total_price == null) return false;
  if (!p.diets.every((d) => plan.diet.includes(d))) return false;
  if (!plan.needs.every((n) => p.kitchen.includes(n))) return false;
  return !isBlocked(r, p.blocked);
}

export type PlannedMeal = { recipe: Recipe; price: number };
export type MealPlan = { meals: PlannedMeal[]; total: number; eligible: number };

export function makePlan(recipes: Recipe[], p: MealPrefs): MealPlan {
  const eligible = recipes.filter((r) => fits(r, p));
  const scored = eligible.map((r) => {
    const hits = r.plan!.moods.filter((m) => p.moods.includes(m)).length;
    return {
      recipe: r,
      price: priceFor(r, p.people) as number,
      score: hits * 10 + (r.sale_ratio || 0) * 5 + jitter(p.seed, r.id) * 6,
    };
  });
  const pinned = scored.filter((x) => p.pinned.includes(x.recipe.id));
  const rest = scored
    .filter((x) => !p.pinned.includes(x.recipe.id))
    .sort((a, b) => b.score - a.score);
  const meals: PlannedMeal[] = [];
  let total = 0;
  for (const x of [...pinned, ...rest]) {
    if (meals.length >= DAYS.length) break;
    if (!p.pinned.includes(x.recipe.id) && total + x.price > p.budget) continue;
    meals.push({ recipe: x.recipe, price: x.price });
    total += x.price;
  }
  return { meals, total: Math.round(total * 100) / 100, eligible: eligible.length };
}

/** Korte ingrediensnavne til søgningen i "Er der noget du vil undgå?". */
export function allIngredientNames(recipes: Recipe[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of recipes) {
    for (const n of r.plan?.ingredient_names || []) {
      const short = String(n).split(/[(,]/)[0].replace(/[½¼¾\d]+/g, '').trim();
      const k = fold(short);
      if (k.length > 1 && !seen.has(k)) {
        seen.add(k);
        out.push(short);
      }
    }
  }
  return out;
}

export const krText = (n: number) => `${n.toFixed(2).replace('.', ',')} kr`;
export const krRound = (n: number) =>
  `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} kr`;
