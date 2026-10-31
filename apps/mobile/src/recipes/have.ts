/**
 * "Har jeg" på opskriften (C2, Kalle 31-10-2026): man trykker på en
 * ingrediens, man har i forvejen. Den trækkes fra prisen og lægges ikke i
 * kurven. Ren logik her (testes i have.test.ts); gemmes i haveStore.ts.
 */
export type HaveRow = {
  /** Ingrediensens id (RecipeIngredient.id). */
  id: number;
  /** Prisen for linjen (pakke × antal), eller null hvis varen ikke er fundet. */
  lineCost: number | null;
};

export type HaveSummary = {
  /** Linjer man ikke har i forvejen. */
  needed: number;
  /** Af dem: fundet i prissammenligningen (= varer der lægges i kurven). */
  found: number;
  /** Summen af de fundne linjer, man ikke har. */
  foundCost: number;
  /** Summen af de linjer, man har (trækkes fra totalen). */
  haveCost: number;
};

export function haveSummary(rows: HaveRow[], have: ReadonlySet<number>): HaveSummary {
  let needed = 0;
  let found = 0;
  let foundCost = 0;
  let haveCost = 0;
  for (const r of rows) {
    if (have.has(r.id)) {
      if (r.lineCost != null) haveCost += r.lineCost;
      continue;
    }
    needed += 1;
    if (r.lineCost != null) {
      found += 1;
      foundCost += r.lineCost;
    }
  }
  return {
    needed,
    found,
    foundCost: Math.round(foundCost * 100) / 100,
    haveCost: Math.round(haveCost * 100) / 100,
  };
}

/**
 * Totalen der vises i pris-kortet. Uden "Har jeg" og ved udgangspunktet
 * bruges serverens pris (snapshot), som før. Har man noget, vises summen af
 * de varer, man mangler, så tallet passer med det, der lægges i kurven.
 */
export function displayTotal(
  base: number | null,
  summary: HaveSummary,
  anyHave: boolean,
): number | null {
  if (!anyHave) return base;
  return summary.found > 0 ? summary.foundCost : null;
}

/** Skift én ingrediens til eller fra. */
export function toggleHave(have: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(have);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
