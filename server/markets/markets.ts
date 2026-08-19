/**
 * Market scopes → countries → email language + GeoNames city plans.
 *
 * Country membership per market is governed by coverage.ts (allowlist +
 * documented blacklist — French is France only, German is DE/CH/AT only,
 * etc.). City lists come from the committed GeoNames seed
 * (server/seed/city-plans.json) with population + coordinates; the discovery
 * engine picks cities at random per batch, weighted by population (see
 * discovery/sampler.ts) — there is no sequential country/city cursor anymore.
 */

import type { EmailLanguage, MarketScope } from '../../shared/types'
import { COUNTRIES, MARKET_COUNTRIES } from './coverage'
import { citiesOf, type PlanCity } from './city-plans'

export type { PlanCity }

export type CountryPlan = {
  /** ISO 3166-1 alpha-2 (PR listed separately for its Spanish-language market). */
  code: string
  name: string
  language: EmailLanguage
  /** Places API regionCode. */
  region: string
  /** GeoNames-derived, sorted by population within each state/country. */
  cities: readonly PlanCity[]
}

export type Market = {
  scope: MarketScope
  label: string
  countries: CountryPlan[]
}

const MARKET_LABELS: Record<MarketScope, string> = {
  english: 'English-speaking markets',
  portuguese: 'Portuguese-speaking markets',
  spanish: 'Spanish-speaking markets',
  france: 'France',
  german: 'German-speaking markets',
  mandarin_taiwan: 'Taiwan (Mandarin)',
  cantonese_hk_macau: 'Hong Kong & Macau (Cantonese)',
  korean: 'South Korea',
  japanese: 'Japan',
  world: 'World',
}

function toPlan(code: string): CountryPlan {
  const def = COUNTRIES[code]
  if (!def) throw new Error(`coverage.ts has no country definition for ${code}`)
  return {
    code: def.code,
    name: def.name,
    language: def.language,
    region: def.region,
    cities: citiesOf(code),
  }
}

export const MARKETS: Record<MarketScope, Market> = Object.fromEntries(
  (Object.keys(MARKET_COUNTRIES) as MarketScope[]).map((scope) => [
    scope,
    { scope, label: MARKET_LABELS[scope], countries: MARKET_COUNTRIES[scope].map(toPlan) },
  ]),
) as Record<MarketScope, Market>

/** Places API languageCode per email language. */
export const PLACES_LANGUAGE: Record<EmailLanguage, string> = {
  en: 'en',
  pt: 'pt-BR',
  es: 'es',
  fr: 'fr',
  de: 'de',
  it: 'it',
  'zh-TW': 'zh-TW',
  'zh-HK': 'zh-HK',
  ja: 'ja',
  ko: 'ko',
}

export function findCountry(scope: MarketScope, code: string): CountryPlan | undefined {
  return MARKETS[scope].countries.find((cc) => cc.code === code)
}

/**
 * The market restricted to the owner's country selection — "English-speaking
 * markets, but only the US and Australia". An empty selection means the whole
 * market, and so does a selection that matches nothing in it (a leftover from
 * another market never silently empties the pool: discovery would have no
 * city to draw and would look stuck).
 */
export function scopedMarket(market: Market, selected: readonly string[]): Market {
  if (!selected.length) return market
  const wanted = new Set(selected)
  const countries = market.countries.filter((cc) => wanted.has(cc.code))
  return countries.length ? { ...market, countries } : market
}
