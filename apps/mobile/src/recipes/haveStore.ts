/** "Har jeg" gemt på telefonen pr. opskrift (AsyncStorage). Ingen tabel/RPC. */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'ms_recipe_have_v1';
// Højst så mange opskrifter huskes; de ældste glemmes først.
const MAX_RECIPES = 60;

type Stored = Record<string, number[]>;

async function readAll(): Promise<Stored> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? (v as Stored) : {};
  } catch {
    return {};
  }
}

export async function loadHave(recipeId: number): Promise<Set<number>> {
  const all = await readAll();
  const ids = all[String(recipeId)];
  return new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === 'number') : []);
}

export async function saveHave(recipeId: number, have: ReadonlySet<number>): Promise<void> {
  const all = await readAll();
  delete all[String(recipeId)];
  if (have.size) all[String(recipeId)] = [...have];
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_RECIPES))) delete all[k];
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // stille: valget er kun en hjælp
  }
}
