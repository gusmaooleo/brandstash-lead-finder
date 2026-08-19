import { describe, expect, it } from 'vitest'
import { ALL_CATEGORIES, categoryAt } from './categories'

describe('category catalog', () => {
  it('loads the pruned Google Business category catalog', () => {
    expect(ALL_CATEGORIES.length).toBeGreaterThan(3500)
    expect(ALL_CATEGORIES).toContain('Restaurant')
    expect(ALL_CATEGORIES).toContain('Barber shop')
  })

  it('categoryAt wraps deterministically past the end of the list', () => {
    expect(categoryAt(0)).toBe(ALL_CATEGORIES[0])
    expect(categoryAt(ALL_CATEGORIES.length)).toBe(ALL_CATEGORIES[0])
    expect(categoryAt(ALL_CATEGORIES.length + 3)).toBe(ALL_CATEGORIES[3])
  })

  it('applies the owner-approved prune (2026-08-16): 354 non-convertible categories removed', () => {
    expect(ALL_CATEGORIES.length).toBe(3691)
    for (const gone of ['Aadhaar center', 'ATM', 'Baptist church', 'City or town hall', 'National park']) {
      expect(ALL_CATEGORIES).not.toContain(gone)
    }
    for (const kept of ['Restaurant', 'Barber shop', 'Wedding chapel', 'Amusement park', 'Preschool']) {
      expect(ALL_CATEGORIES).toContain(kept)
    }
  })
})

describe('primaryType result blocklist (layer 2)', () => {
  it('blocks public bodies and keeps legitimate business types', async () => {
    const { isBlockedPlaceType } = await import('./type-blocklist')
    expect(isBlockedPlaceType('local_government_office')).toBe(true)
    expect(isBlockedPlaceType('church')).toBe(true)
    expect(isBlockedPlaceType(null, ['transit_station', 'point_of_interest'])).toBe(true)
    expect(isBlockedPlaceType('restaurant')).toBe(false)
    expect(isBlockedPlaceType('corporate_office')).toBe(false)
    expect(isBlockedPlaceType('school')).toBe(false)
    expect(isBlockedPlaceType(null, [])).toBe(false)
  })
})
