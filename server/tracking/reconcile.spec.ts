import { describe, expect, it } from 'vitest'
import { hashRid } from './rid'
import {
  buildColdEmailEventFilter,
  buildVisitEventFilter,
  chunk,
  groupEventsByHash,
  mergeVisitSummary,
  summarizeEvents,
  VISIT_EVENT_PROJECTION,
  type LandingVisitEventLean,
} from './reconcile'

const event = (hash: string, first: string, last: string): LandingVisitEventLean => ({
  trackingIdHash: hash,
  eventKey: `key-${hash}-${first}`,
  attribution: { source: 'cold_email', campaign: 'leadfinder_portuguese', capturedAt: first },
  firstObservedAt: first,
  lastObservedAt: last,
  isNewVisitor: true,
  lang: 'pt',
})

describe('landing event query', () => {
  it('filters by trackingIdHash and attribution.source = cold_email (contract-exact)', () => {
    const hashes = [hashRid('a'.repeat(24)), hashRid('b'.repeat(24))]
    expect(buildVisitEventFilter(hashes)).toEqual({
      schemaVersion: 1,
      eventType: 'landing_visit',
      trackingIdHash: { $in: hashes },
      'attribution.source': 'cold_email',
    })
  })

  it('counts every cold-email visit with the same contract, hashes aside', () => {
    const all = buildColdEmailEventFilter()
    expect(all).toEqual({
      schemaVersion: 1,
      eventType: 'landing_visit',
      'attribution.source': 'cold_email',
    })
    // The two filters must never drift: ours is the same query, narrowed.
    expect(buildVisitEventFilter(['x'])).toMatchObject(all)
  })

  it('projects only the fields the reconciliation needs', () => {
    expect(Object.keys(VISIT_EVENT_PROJECTION)).toEqual([
      '_id', 'trackingIdHash', 'eventKey', 'attribution',
      'firstObservedAt', 'lastObservedAt', 'windowStartedAt', 'isNewVisitor', 'lang',
    ])
    expect(VISIT_EVENT_PROJECTION._id).toBe(0)
  })

  it('chunks hash batches at 500 per query', () => {
    const hashes = Array.from({ length: 1201 }, (_, i) => `h${i}`)
    const batches = chunk(hashes)
    expect(batches.map((b) => b.length)).toEqual([500, 500, 201])
    expect(batches.flat()).toEqual(hashes)
  })
})

describe('event grouping & summary', () => {
  it('several events of the same hash summarize into ONE visited send', () => {
    const h = hashRid('same-send-token-123456')
    const events = [
      event(h, '2026-08-10T10:00:00.000Z', '2026-08-10T10:20:00.000Z'),
      event(h, '2026-08-11T08:00:00.000Z', '2026-08-11T08:05:00.000Z'),
      event(h, '2026-08-09T23:00:00.000Z', '2026-08-09T23:01:00.000Z'),
    ]
    const grouped = groupEventsByHash(events)
    expect(grouped.size).toBe(1)
    const summary = summarizeEvents(grouped.get(h)!)
    expect(summary.matched).toBe(true)
    expect(summary.event_count).toBe(3)
    expect(summary.first_observed_at?.toISOString()).toBe('2026-08-09T23:00:00.000Z')
    expect(summary.last_observed_at?.toISOString()).toBe('2026-08-11T08:05:00.000Z')
  })

  it('no events → unmatched summary (never an error)', () => {
    expect(summarizeEvents([])).toEqual({
      matched: false,
      event_count: 0,
      first_observed_at: null,
      last_observed_at: null,
    })
  })
})

describe('idempotent merge', () => {
  const syncedAt = new Date('2026-08-17T12:00:00.000Z')

  it('repeating the sync does not duplicate metrics', () => {
    const fresh = summarizeEvents([
      event('h1', '2026-08-10T10:00:00.000Z', '2026-08-10T10:20:00.000Z'),
      event('h1', '2026-08-11T09:00:00.000Z', '2026-08-11T09:30:00.000Z'),
    ])
    const once = mergeVisitSummary(null, fresh, syncedAt)
    const twice = mergeVisitSummary(once, fresh, syncedAt)
    const thrice = mergeVisitSummary(twice, fresh, syncedAt)
    expect(thrice.event_count).toBe(2)
    expect(thrice.matched).toBe(true)
    expect(thrice.first_observed_at).toEqual(once.first_observed_at)
    expect(thrice.last_observed_at).toEqual(once.last_observed_at)
  })

  it('never shrinks after landing events expire (180-day TTL)', () => {
    const before = mergeVisitSummary(
      null,
      summarizeEvents([
        event('h1', '2026-02-01T10:00:00.000Z', '2026-02-01T10:20:00.000Z'),
        event('h1', '2026-02-02T10:00:00.000Z', '2026-02-02T10:20:00.000Z'),
      ]),
      syncedAt,
    )
    // TTL wiped the events — a later sync sees nothing for this hash.
    const after = mergeVisitSummary(before, summarizeEvents([]), new Date('2026-09-01T00:00:00.000Z'))
    expect(after.matched).toBe(true)
    expect(after.event_count).toBe(2)
    expect(after.first_observed_at).toEqual(before.first_observed_at)
    expect(after.last_observed_at).toEqual(before.last_observed_at)
    expect(after.synced_at?.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('widens the window when new events arrive', () => {
    const first = mergeVisitSummary(
      null,
      summarizeEvents([event('h1', '2026-08-10T10:00:00.000Z', '2026-08-10T10:20:00.000Z')]),
      syncedAt,
    )
    const second = mergeVisitSummary(
      first,
      summarizeEvents([
        event('h1', '2026-08-10T10:00:00.000Z', '2026-08-10T10:20:00.000Z'),
        event('h1', '2026-08-12T18:00:00.000Z', '2026-08-12T18:40:00.000Z'),
      ]),
      syncedAt,
    )
    expect(second.event_count).toBe(2)
    expect(second.first_observed_at?.toISOString()).toBe('2026-08-10T10:00:00.000Z')
    expect(second.last_observed_at?.toISOString()).toBe('2026-08-12T18:40:00.000Z')
  })
})
