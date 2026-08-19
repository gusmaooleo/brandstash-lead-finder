/**
 * Category ELECTION — replaces the alphabetical category walk.
 *
 * Every batch draws its category at random from the eligible pool (the full
 * catalog, or the owner's selected subset, minus what the current city has
 * already searched). The draw is weighted by GLOBAL usage so exploration
 * spreads across the whole catalog instead of grinding the top of the
 * alphabet: any category can win any round, but the less a category has been
 * searched anywhere, the higher its odds — weight = 1 / (1 + uses). Long
 * term this covers (nearly) every category while still allowing repeats of
 * productive ones in other cities.
 */

import type { Rng } from './sampler'

/** weight = 1/(1+uses): never-searched 1.0, once 0.5, twice 0.33 … */
export function categoryWeight(uses: number): number {
  return 1 / (1 + Math.max(0, uses))
}

export function pickCategoryElection(
  eligible: readonly string[],
  globalUses: ReadonlyMap<string, number>,
  rng: Rng = Math.random,
): string | null {
  if (!eligible.length) return null
  let total = 0
  for (const category of eligible) total += categoryWeight(globalUses.get(category) ?? 0)
  let roll = rng() * total
  for (const category of eligible) {
    roll -= categoryWeight(globalUses.get(category) ?? 0)
    if (roll <= 0) return category
  }
  return eligible[eligible.length - 1]
}

/**
 * The eligible pool for a batch: the owner's selection (when any) intersected
 * with the catalog, minus the categories this city has already completed.
 */
export function eligibleCategories(
  catalog: readonly string[],
  selected: readonly string[],
  cityDone: readonly string[],
): string[] {
  const inCatalog = new Set(catalog)
  const base = selected.length ? selected.filter((c) => inCatalog.has(c)) : [...catalog]
  const done = new Set(cityDone)
  return base.filter((c) => !done.has(c))
}
