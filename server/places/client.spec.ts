import { describe, expect, it } from 'vitest'
import { DETAILS_FIELD_MASK, buildSummary, type PlaceDetails } from './client'

describe('Places details field mask', () => {
  it('requests location (globe geometry) but still never requests reviews', () => {
    const fields = DETAILS_FIELD_MASK.split(',')
    expect(fields).toContain('location')
    expect(fields).not.toContain('reviews')
    expect(fields).toContain('photos.name')
    expect(fields).not.toContain('photos')
  })
})

describe('buildSummary', () => {
  it('summary stays scoring-parity shaped — geometry is NOT part of it', () => {
    const details: PlaceDetails = {
      id: 'x',
      displayName: { text: 'Padaria Teste' },
      location: { latitude: -12.97, longitude: -38.5 },
      types: ['bakery'],
    }
    const summary = buildSummary(details)
    expect(summary.name).toBe('Padaria Teste')
    expect('location' in summary).toBe(false)
  })
})
