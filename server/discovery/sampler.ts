/**
 * Population-weighted random city selection — replaces the sequential
 * country→city cursor.
 *
 * Two-stage draw per batch, both stages weighted by √population:
 *   1. country ∝ √(Σ population of its non-exhausted plan cities)
 *   2. city within the country ∝ √(city population)
 *
 * √ keeps the owner's proportion rule ("portuguese: of 10 picks ~7 Brazil,
 * Portugal at most its top ~3"): linear weights would hand Brazil ~95% of the
 * draws and starve Portugal; √ lands Brazil ≈80% / Portugal ≈20% while still
 * letting big cities dominate inside each country. Exhausted cities (full
 * category rotation consumed, tracked in `city_progress`) drop out of the
 * draw; when every city in the market is exhausted the pick returns null and
 * the engine backs off to the next hourly window.
 */

import type { CountryPlan, Market, PlanCity } from '../markets/markets'

export type Rng = () => number

/** Deterministic RNG for tests (engine uses Math.random). */
export function mulberry32(seedValue: number): Rng {
  let a = seedValue >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function cityKey(countryCode: string, city: PlanCity): string {
  return `${countryCode}|${city.admin1 ?? ''}|${city.name}`
}

export type CityPick = { country: CountryPlan; city: PlanCity }

function pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number, rng: Rng): T | null {
  let total = 0
  for (const item of items) total += weightOf(item)
  if (total <= 0) return null
  let roll = rng() * total
  for (const item of items) {
    roll -= weightOf(item)
    if (roll <= 0) return item
  }
  return items[items.length - 1] ?? null
}

export function pickCityWeighted(
  market: Market,
  isExhausted: (key: string) => boolean,
  rng: Rng = Math.random,
): CityPick | null {
  const eligible = market.countries
    .map((country) => ({
      country,
      cities: country.cities.filter((city) => !isExhausted(cityKey(country.code, city))),
    }))
    .filter((entry) => entry.cities.length > 0)

  const countryPick = pickWeighted(
    eligible,
    (entry) => Math.sqrt(entry.cities.reduce((sum, city) => sum + city.population, 0)),
    rng,
  )
  if (!countryPick) return null

  const city = pickWeighted(countryPick.cities, (c) => Math.sqrt(c.population), rng)
  if (!city) return null
  return { country: countryPick.country, city }
}
