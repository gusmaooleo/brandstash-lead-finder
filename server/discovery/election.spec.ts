import { describe, expect, it } from 'vitest'
import { mulberry32 } from './sampler'
import { categoryWeight, eligibleCategories, pickCategoryElection } from './election'

describe('category election', () => {
  it('any category can win a round, but unused ones have higher odds', () => {
    const eligible = ['used_a', 'used_b', 'fresh_a', 'fresh_b']
    const uses = new Map([
      ['used_a', 4],
      ['used_b', 4],
    ])
    const rng = mulberry32(42)
    const wins = new Map<string, number>()
    for (let i = 0; i < 4000; i++) {
      const pick = pickCategoryElection(eligible, uses, rng)!
      wins.set(pick, (wins.get(pick) ?? 0) + 1)
    }
    // Everything got picked at least once…
    for (const c of eligible) expect(wins.get(c) ?? 0, c).toBeGreaterThan(0)
    // …and fresh categories dominate (weight 1 vs 1/5 → 5× odds each).
    expect(wins.get('fresh_a')!).toBeGreaterThan(wins.get('used_a')! * 2)
    expect(wins.get('fresh_b')!).toBeGreaterThan(wins.get('used_b')! * 2)
  })

  it('weights decay with usage: 1, 1/2, 1/3…', () => {
    expect(categoryWeight(0)).toBe(1)
    expect(categoryWeight(1)).toBe(0.5)
    expect(categoryWeight(4)).toBe(0.2)
  })

  it('long-run coverage: every category is eventually explored', () => {
    // Simulate the real loop: a chosen category joins the city's done-list
    // and is excluded from later draws; usage grows globally.
    const catalog = Array.from({ length: 200 }, (_, i) => `cat_${i}`)
    const uses = new Map<string, number>()
    const done: string[] = []
    const rng = mulberry32(7)
    while (done.length < catalog.length) {
      const eligible = eligibleCategories(catalog, [], done)
      const pick = pickCategoryElection(eligible, uses, rng)!
      done.push(pick)
      uses.set(pick, (uses.get(pick) ?? 0) + 1)
    }
    expect(new Set(done).size).toBe(catalog.length)
  })

  it('draws are NOT alphabetical/sequential', () => {
    const catalog = Array.from({ length: 500 }, (_, i) => `cat_${String(i).padStart(3, '0')}`)
    const rng = mulberry32(99)
    const firstTen = Array.from({ length: 10 }, () => pickCategoryElection(catalog, new Map(), rng))
    expect(firstTen).not.toEqual(catalog.slice(0, 10))
  })

  it('owner selection restricts the pool; city-done categories drop out', () => {
    const catalog = ['a', 'b', 'c', 'd']
    expect(eligibleCategories(catalog, ['b', 'd', 'not_in_catalog'], [])).toEqual(['b', 'd'])
    expect(eligibleCategories(catalog, ['b', 'd'], ['d'])).toEqual(['b'])
    expect(eligibleCategories(catalog, [], ['a', 'c'])).toEqual(['b', 'd'])
    expect(eligibleCategories(catalog, ['b'], ['b'])).toEqual([])
    expect(pickCategoryElection([], new Map())).toBeNull()
  })
})
