import { describe, expect, it } from 'vitest'
import { CITY_PLANS, citiesOf } from './city-plans'
import { COUNTRIES, COUNTRY_BLACKLIST, MARKET_COUNTRIES, blacklistedCodes } from './coverage'
import { MARKETS, scopedMarket } from './markets'
import { EMAIL_LANGUAGES, isEmailLanguage } from '../../shared/types'

describe('GeoNames city plans seed', () => {
  it('covers every country coverage.ts declares — and nothing else', () => {
    expect(Object.keys(CITY_PLANS).sort()).toEqual(Object.keys(COUNTRIES).sort())
  })

  it('US plan: the 50 states, top cities per state (≤20, ≥10 each)', () => {
    const us = citiesOf('US')
    const perState = new Map<string, number>()
    for (const city of us) {
      expect(city.admin1, `US city ${city.name} must carry its state`).toBeTruthy()
      perState.set(city.admin1!, (perState.get(city.admin1!) ?? 0) + 1)
    }
    expect(perState.size).toBe(50)
    for (const [state, count] of perState) {
      expect(count, `${state} city count`).toBeLessThanOrEqual(20)
      // ND/SD/VT/WY have fewer than 20 places above 5k population — that's
      // the whole dump for them, not a build bug.
      expect(count, `${state} city count`).toBeGreaterThanOrEqual(10)
    }
    expect(us.length).toBeGreaterThan(900)
  })

  it('non-US plans respect their coverage cityCount and are sorted by population', () => {
    for (const [code, def] of Object.entries(COUNTRIES)) {
      if (def.perStateCities) continue
      const cities = citiesOf(code)
      expect(cities.length, code).toBeGreaterThan(0)
      expect(cities.length, code).toBeLessThanOrEqual(def.cityCount)
      for (let i = 1; i < cities.length; i++) {
        expect(cities[i - 1].population, `${code} sort order`).toBeGreaterThanOrEqual(cities[i].population)
      }
    }
  })

  it('every city has valid coordinates and a positive population', () => {
    for (const [code, plan] of Object.entries(CITY_PLANS)) {
      const seen = new Set<string>()
      for (const city of plan.cities) {
        expect(city.lat, `${code}/${city.name}`).toBeGreaterThanOrEqual(-90)
        expect(city.lat, `${code}/${city.name}`).toBeLessThanOrEqual(90)
        expect(city.lng, `${code}/${city.name}`).toBeGreaterThanOrEqual(-180)
        expect(city.lng, `${code}/${city.name}`).toBeLessThanOrEqual(180)
        expect(city.population, `${code}/${city.name}`).toBeGreaterThan(0)
        const key = `${city.admin1 ?? ''}|${city.name}`
        expect(seen.has(key), `duplicate city ${code}/${key}`).toBe(false)
        seen.add(key)
      }
    }
  })

  it('anchors: the expected majors lead their plans', () => {
    expect(citiesOf('BR')[0].name).toBe('São Paulo')
    expect(citiesOf('PT')[0].name).toBe('Lisbon')
    expect(citiesOf('FR')[0].name).toBe('Paris')
    expect(citiesOf('JP')[0].name).toBe('Tokyo')
  })
})

describe('coverage allowlists vs the language blacklist', () => {
  it('every market country exists in COUNTRIES with the market language', () => {
    for (const [scope, codes] of Object.entries(MARKET_COUNTRIES)) {
      for (const code of codes) {
        expect(COUNTRIES[code], `${scope}: ${code}`).toBeDefined()
      }
    }
  })

  it('owner rules: French → France only; German → DE/CH/AT; single-country east-asian markets', () => {
    expect([...MARKET_COUNTRIES.france]).toEqual(['FR'])
    expect([...MARKET_COUNTRIES.german].sort()).toEqual(['AT', 'CH', 'DE'])
    expect([...MARKET_COUNTRIES.mandarin_taiwan]).toEqual(['TW'])
    expect([...MARKET_COUNTRIES.cantonese_hk_macau].sort()).toEqual(['HK', 'MO'])
    expect([...MARKET_COUNTRIES.korean]).toEqual(['KR'])
    expect([...MARKET_COUNTRIES.japanese]).toEqual(['JP'])
    expect([...MARKET_COUNTRIES.portuguese].sort()).toEqual(['BR', 'PT'])
    expect(MARKET_COUNTRIES.spanish).not.toContain('ES')
  })

  it('World is exactly the union of the language markets — no orphan country', () => {
    const union = new Set(
      Object.entries(MARKET_COUNTRIES)
        .filter(([scope]) => scope !== 'world')
        .flatMap(([, codes]) => codes),
    )
    expect([...MARKET_COUNTRIES.world].sort()).toEqual([...union].sort())
  })

  /**
   * The copy library offers one language per market. A language no market can
   * reach would be copy nothing is ever sent in; a country whose language is
   * not offered would be a lead with no template to answer it.
   */
  it('every email language has a market, and every market country an email language', () => {
    const spoken = new Set(Object.values(COUNTRIES).map((cc) => cc.language))
    expect([...spoken].sort()).toEqual([...EMAIL_LANGUAGES].sort())
    for (const country of Object.values(COUNTRIES)) {
      expect(isEmailLanguage(country.language), `${country.code}: ${country.language}`).toBe(true)
    }
  })

  it('no allowlist contains a country its language blacklists', () => {
    for (const [scope, codes] of Object.entries(MARKET_COUNTRIES)) {
      for (const code of codes) {
        const language = COUNTRIES[code].language
        expect(
          blacklistedCodes(language).has(code),
          `${scope}: ${code} is blacklisted for ${language}`,
        ).toBe(false)
      }
    }
  })

  it('blacklist rules document a reason', () => {
    for (const rules of Object.values(COUNTRY_BLACKLIST)) {
      for (const rule of rules ?? []) {
        expect(rule.reason.length).toBeGreaterThan(10)
        expect(rule.values.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('MARKETS runtime join', () => {
  it('every market country carries a non-empty GeoNames city plan', () => {
    for (const market of Object.values(MARKETS)) {
      for (const country of market.countries) {
        expect(country.cities.length, `${market.scope}/${country.code}`).toBeGreaterThan(0)
        expect(country.cities[0].population).toBeGreaterThan(0)
      }
    }
  })
})

describe('country selection within a market', () => {
  const codesOf = (market: { countries: readonly { code: string }[] }) =>
    market.countries.map((cc) => cc.code)

  it('narrows the draw to the picked countries — the rest of the market drops out', () => {
    expect(codesOf(scopedMarket(MARKETS.english, ['US', 'AU']))).toEqual(['US', 'AU'])
    expect(codesOf(MARKETS.english)).toContain('SE') // untouched original
  })

  it('an empty selection is the whole market', () => {
    expect(codesOf(scopedMarket(MARKETS.english, []))).toEqual(codesOf(MARKETS.english))
  })

  it('a selection from another market never empties the pool', () => {
    // 'BR' isn't in the English market: falling back to every country beats
    // a market with no city to draw, which would look like a stuck engine.
    expect(codesOf(scopedMarket(MARKETS.english, ['BR']))).toEqual(codesOf(MARKETS.english))
    expect(codesOf(scopedMarket(MARKETS.english, ['BR', 'GB']))).toEqual(['GB'])
  })

  it('keeps the market label and scope', () => {
    const only = scopedMarket(MARKETS.portuguese, ['PT'])
    expect(only.scope).toBe(MARKETS.portuguese.scope)
    expect(only.label).toBe(MARKETS.portuguese.label)
    expect(only.countries[0].cities.length).toBeGreaterThan(0)
  })
})
