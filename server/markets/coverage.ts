/**
 * Country coverage — the single auditable source of WHICH countries each
 * language market may search and HOW MANY cities the GeoNames seed keeps per
 * country. `scripts/build-city-plans.ts` consumes this file to generate
 * `server/seed/city-plans.json`; `markets.ts` joins both at runtime.
 *
 * Language restrictions are enforced by allowlist: a market can only ever
 * search countries listed in MARKET_COUNTRIES. COUNTRY_BLACKLIST documents
 * the deliberate exclusions (owner rules, 2026-08-16) so a future edit can't
 * silently re-add them — the coverage test suite asserts every allowlist
 * against its language's blacklist.
 */

import type { EmailLanguage, MarketScope } from '../../shared/types'

export type CoverageCountry = {
  /** ISO 3166-1 alpha-2 (PR listed separately for its Spanish-language market). */
  code: string
  name: string
  language: EmailLanguage
  /** Places API regionCode. */
  region: string
  /** Top-N most populous cities the GeoNames seed keeps for this country. */
  cityCount: number
  /** US only: keep the top-N cities of EACH state instead of a national top-N. */
  perStateCities?: number
}

const cc = (
  code: string,
  name: string,
  language: EmailLanguage,
  cityCount: number,
  extra: Partial<CoverageCountry> = {},
): CoverageCountry => ({ code, name, language, region: code, cityCount, ...extra })

/** Every country any market is allowed to touch, keyed by ISO code. */
export const COUNTRIES: Record<string, CoverageCountry> = Object.fromEntries(
  [
    // english rotation
    cc('US', 'United States', 'en', 0, { perStateCities: 20 }),
    cc('GB', 'United Kingdom', 'en', 30),
    cc('AU', 'Australia', 'en', 20),
    cc('CA', 'Canada', 'en', 25),
    cc('NL', 'Netherlands', 'en', 15),
    cc('SE', 'Sweden', 'en', 12),
    cc('NO', 'Norway', 'en', 10),
    cc('FI', 'Finland', 'en', 10),
    // portuguese
    cc('BR', 'Brazil', 'pt', 40),
    cc('PT', 'Portugal', 'pt', 12),
    // spanish-speaking Americas
    cc('MX', 'Mexico', 'es', 30),
    cc('AR', 'Argentina', 'es', 25),
    cc('CO', 'Colombia', 'es', 25),
    cc('PE', 'Peru', 'es', 20),
    cc('VE', 'Venezuela', 'es', 20),
    cc('CL', 'Chile', 'es', 20),
    cc('EC', 'Ecuador', 'es', 15),
    cc('GT', 'Guatemala', 'es', 12),
    cc('BO', 'Bolivia', 'es', 12),
    cc('DO', 'Dominican Republic', 'es', 12),
    cc('CU', 'Cuba', 'es', 12),
    cc('HN', 'Honduras', 'es', 10),
    cc('PY', 'Paraguay', 'es', 10),
    cc('PR', 'Puerto Rico', 'es', 10),
    cc('NI', 'Nicaragua', 'es', 8),
    cc('SV', 'El Salvador', 'es', 8),
    cc('CR', 'Costa Rica', 'es', 8),
    cc('PA', 'Panama', 'es', 8),
    cc('UY', 'Uruguay', 'es', 8),
    // french — France ONLY (see COUNTRY_BLACKLIST.fr)
    cc('FR', 'France', 'fr', 30),
    // german — DE/CH/AT ONLY (see COUNTRY_BLACKLIST.de)
    cc('DE', 'Germany', 'de', 30),
    cc('CH', 'Switzerland', 'de', 12),
    cc('AT', 'Austria', 'de', 10),
    // italian — included via the World market only
    cc('IT', 'Italy', 'it', 30),
    // east asia
    cc('TW', 'Taiwan', 'zh-TW', 15),
    cc('HK', 'Hong Kong', 'zh-HK', 10),
    cc('MO', 'Macau', 'zh-HK', 3),
    cc('KR', 'South Korea', 'ko', 25),
    cc('JP', 'Japan', 'ja', 40),
  ].map((entry) => [entry.code, entry]),
)

const ENGLISH = ['US', 'GB', 'AU', 'CA', 'NL', 'SE', 'NO', 'FI']
const PORTUGUESE = ['BR', 'PT']
const SPANISH = ['MX', 'AR', 'CO', 'PE', 'VE', 'CL', 'EC', 'GT', 'BO', 'DO', 'CU', 'HN', 'PY', 'PR', 'NI', 'SV', 'CR', 'PA', 'UY']
const FRENCH = ['FR']
const GERMAN = ['DE', 'CH', 'AT']
const MANDARIN = ['TW']
const CANTONESE = ['HK', 'MO']
const KOREAN = ['KR']
const JAPANESE = ['JP']

export const MARKET_COUNTRIES: Record<MarketScope, readonly string[]> = {
  english: ENGLISH,
  portuguese: PORTUGUESE,
  spanish: SPANISH,
  france: FRENCH,
  german: GERMAN,
  mandarin_taiwan: MANDARIN,
  cantonese_hk_macau: CANTONESE,
  korean: KOREAN,
  japanese: JAPANESE,
  // Italy is included in World so the Italian email version has a market.
  world: [...ENGLISH, ...PORTUGUESE, ...SPANISH, ...FRENCH, ...GERMAN, 'IT', ...MANDARIN, ...CANTONESE, ...KOREAN, ...JAPANESE],
}

export type BlacklistRule = {
  /** 'continent' uses GeoNames continent names; 'country' uses ISO codes. */
  scope: 'continent' | 'country'
  values: readonly string[]
  reason: string
}

/**
 * Deliberate exclusions per email language. These countries/continents speak
 * the language but must NEVER enter its market rotation.
 */
export const COUNTRY_BLACKLIST: Partial<Record<EmailLanguage, readonly BlacklistRule[]>> = {
  fr: [
    {
      scope: 'continent',
      values: ['Africa'],
      reason: 'Owner rule: French outreach targets France only — all of Francophone Africa (SN, CI, CM, CD, MA, DZ, TN…) is excluded.',
    },
    {
      scope: 'country',
      values: ['BE', 'LU', 'MC', 'CH', 'CA', 'HT'],
      reason: 'French-speaking countries outside France are excluded (CH/CA appear only in their German/English markets).',
    },
  ],
  de: [
    {
      scope: 'country',
      values: ['LI', 'LU', 'BE', 'IT'],
      reason: 'Owner rule: German market is Germany, Switzerland and Austria only.',
    },
  ],
  pt: [
    {
      scope: 'continent',
      values: ['Africa'],
      reason: 'Lusophone Africa (AO, MZ, CV, GW, ST) is excluded — Portuguese outreach targets Brazil + Portugal only.',
    },
    {
      scope: 'country',
      values: ['TL', 'MO'],
      reason: 'Timor-Leste and Macau are excluded from the Portuguese market (MO belongs to the Cantonese market).',
    },
  ],
  es: [
    {
      scope: 'country',
      values: ['ES', 'GQ'],
      reason: 'Spec: Spanish market is the Spanish-speaking Americas — Spain and Equatorial Guinea are excluded.',
    },
  ],
  'zh-TW': [
    {
      scope: 'country',
      values: ['CN', 'SG', 'MY'],
      reason: 'Owner rule: Mandarin outreach targets Taiwan only.',
    },
  ],
  'zh-HK': [
    {
      scope: 'country',
      values: ['CN'],
      reason: 'Owner rule: Cantonese outreach targets Hong Kong + Macau only.',
    },
  ],
  en: [
    {
      scope: 'country',
      values: ['IE', 'NZ', 'ZA', 'IN', 'SG', 'PH', 'NG', 'KE'],
      reason: 'English rotation is a fixed 8-country list (US, GB, AU, CA + NL/SE/NO/FI); other anglophone markets are out of scope for now.',
    },
  ],
}

/** Every ISO code any blacklist rule names — no allowlist may contain one. */
export function blacklistedCodes(language: EmailLanguage): ReadonlySet<string> {
  return new Set(
    (COUNTRY_BLACKLIST[language] ?? [])
      .filter((rule) => rule.scope === 'country')
      .flatMap((rule) => rule.values),
  )
}
