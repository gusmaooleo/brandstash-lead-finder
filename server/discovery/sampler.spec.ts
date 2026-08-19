import { describe, expect, it } from 'vitest'
import { MARKETS } from '../markets/markets'
import { cityKey, mulberry32, pickCityWeighted } from './sampler'

describe('population-weighted random city sampling', () => {
  it('portuguese: Brazil dominates but Portugal stays in the draw (owner rule ≈ 7–8 BR / 2–3 PT of 10)', () => {
    const rng = mulberry32(42)
    const market = MARKETS.portuguese
    const draws = 10_000
    let br = 0
    let pt = 0
    for (let i = 0; i < draws; i++) {
      const pick = pickCityWeighted(market, () => false, rng)
      if (pick?.country.code === 'BR') br++
      if (pick?.country.code === 'PT') pt++
    }
    expect(br + pt).toBe(draws)
    // √-weighted country stage: Brazil ≈ 80%, Portugal ≈ 20%.
    expect(br / draws).toBeGreaterThan(0.65)
    expect(br / draws).toBeLessThan(0.95)
    expect(pt / draws).toBeGreaterThan(0.05)
    // Never anywhere near a 5/5 split.
    expect(br).toBeGreaterThan(pt * 2)
  })

  it('within a country, the most populous city is the modal pick', () => {
    const rng = mulberry32(7)
    const market = MARKETS.portuguese
    const counts = new Map<string, number>()
    for (let i = 0; i < 5_000; i++) {
      const pick = pickCityWeighted(market, () => false, rng)
      if (pick?.country.code !== 'PT') continue
      counts.set(pick.city.name, (counts.get(pick.city.name) ?? 0) + 1)
    }
    const [modal] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    expect(modal).toBe('Lisbon')
  })

  it('exhausted cities drop out of the draw', () => {
    const rng = mulberry32(3)
    const market = MARKETS.portuguese
    const brKeys = new Set(market.countries[0].cities.map((c) => cityKey('BR', c)))
    for (let i = 0; i < 200; i++) {
      const pick = pickCityWeighted(market, (key) => brKeys.has(key), rng)
      expect(pick?.country.code).toBe('PT')
    }
  })

  it('returns null when every city in the market is exhausted', () => {
    expect(pickCityWeighted(MARKETS.portuguese, () => true, mulberry32(1))).toBeNull()
  })

  it('world market only ever picks covered countries', () => {
    const rng = mulberry32(99)
    const covered = new Set(MARKETS.world.countries.map((c) => c.code))
    for (let i = 0; i < 1_000; i++) {
      const pick = pickCityWeighted(MARKETS.world, () => false, rng)
      expect(pick).not.toBeNull()
      expect(covered.has(pick!.country.code)).toBe(true)
    }
  })

  it('mulberry32 is deterministic', () => {
    const a = mulberry32(123)
    const b = mulberry32(123)
    for (let i = 0; i < 10; i++) expect(a()).toBe(b())
  })
})
