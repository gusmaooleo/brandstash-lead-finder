import { describe, expect, it } from 'vitest'
import { rankCategories, rankVariants, wilsonLowerBound } from './learning'
import type { SendRow } from './metrics'

const NOW = new Date('2026-09-01T00:00:00Z')

function rows(input: { variant: number; count: number; replies: number; visits: number; category?: string }): SendRow[] {
  return Array.from({ length: input.count }, (_, index) => ({
    place_id: `p-${input.variant}-${index}`,
    status: 'sent',
    sent_at: '2026-08-10T00:00:00Z',
    language: 'pt',
    template_key: 'template-a',
    template_name: 'Template A',
    variant: input.variant,
    variant_fingerprint: `${input.variant}`.repeat(64),
    variant_subject: `Subject ${input.variant + 1}`,
    variant_band: null,
    followup: 0,
    search_category: input.category ?? 'Bakery',
    landing_visit: index < input.visits ? { first_observed_at: '2026-08-11T00:00:00Z' } : null,
    reply_summary: index < input.replies ? { first_observed_at: '2026-08-12T00:00:00Z' } : null,
  }))
}

describe('confidence-aware learning', () => {
  it('does not let a tiny perfect sample beat a supported result', () => {
    expect(wilsonLowerBound(1, 1)).toBeLessThan(wilsonLowerBound(12, 20))
  })

  it('ranks comparable variants with replies weighted above visits', () => {
    const ranked = rankVariants([
      ...rows({ variant: 0, count: 20, replies: 8, visits: 10 }),
      ...rows({ variant: 1, count: 20, replies: 1, visits: 18 }),
    ], NOW)
    expect(ranked).toHaveLength(2)
    expect(ranked[0].variant).toBe(0)
    expect(ranked[0].winner).toBe(true)
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score!)
  })

  it('keeps samples below twenty in collecting-data state', () => {
    const [row] = rankVariants(rows({ variant: 0, count: 19, replies: 19, visits: 19 }), NOW)
    expect(row.eligible).toBe(false)
    expect(row.score).toBeNull()
    expect(row.winner).toBe(false)
  })

  it('ignores conversions after seven days and sends that have not matured', () => {
    const mature = rows({ variant: 0, count: 20, replies: 0, visits: 0 })
    mature[0].reply_summary = { first_observed_at: '2026-08-20T00:00:00Z' }
    const recent = { ...mature[1], place_id: 'recent', sent_at: '2026-08-30T00:00:00Z' }
    const [row] = rankVariants([...mature, recent], NOW)
    expect(row.sent).toBe(20)
    expect(row.replied).toBe(0)
  })

  it('learns which category has the strongest supported outcome', () => {
    const ranked = rankCategories([
      ...rows({ variant: 0, category: 'Bakery', count: 20, replies: 10, visits: 12 }),
      ...rows({ variant: 1, category: 'Dentist', count: 20, replies: 2, visits: 5 }),
    ], NOW)
    expect(ranked[0].key).toBe('Bakery')
    expect(ranked[0].winner).toBe(true)
  })
})
