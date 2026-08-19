/**
 * Pure reconciliation core (no I/O — fully unit-tested):
 * filter/projection builders for `landing_visit_events`, hash-batch
 * chunking, in-memory grouping, and the idempotent visit-summary merge.
 *
 * Merge semantics are MONOTONIC on purpose: landing events expire after 180
 * days (TTL), so a re-sync after expiry sees fewer events than before. The
 * persisted summary must never lose history — matched stays true, counts
 * never decrease, the observed window only widens. Running the sync any
 * number of times therefore never duplicates or shrinks metrics.
 */

import type { LandingVisitSummary } from './models'

/** Only the fields the reconciliation needs — enforced via projection. */
export type LandingVisitEventLean = {
  trackingIdHash: string
  eventKey: string
  attribution?: {
    source?: string | null
    campaign?: string | null
    content?: string | null
    term?: string | null
    landingPath?: string
    capturedAt?: string
  } | null
  firstObservedAt: Date | string
  lastObservedAt: Date | string
  windowStartedAt?: Date | string
  isNewVisitor?: boolean
  lang?: string
}

/** Hashes per $in query — bounded so a query never grows unbounded. */
export const HASH_BATCH_SIZE = 500

export const VISIT_EVENT_PROJECTION = {
  _id: 0,
  trackingIdHash: 1,
  eventKey: 1,
  attribution: 1,
  firstObservedAt: 1,
  lastObservedAt: 1,
  windowStartedAt: 1,
  isNewVisitor: 1,
  lang: 1,
} as const

/** Every cold-email visit the landing has recorded, ours or not. */
export function buildColdEmailEventFilter(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    eventType: 'landing_visit',
    'attribution.source': 'cold_email',
  }
}

/** The exact cold-email event filter from the landing contract. */
export function buildVisitEventFilter(trackingHashes: readonly string[]): Record<string, unknown> {
  return {
    ...buildColdEmailEventFilter(),
    trackingIdHash: { $in: [...trackingHashes] },
  }
}

export function chunk<T>(items: readonly T[], size: number = HASH_BATCH_SIZE): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function groupEventsByHash(
  events: readonly LandingVisitEventLean[],
): Map<string, LandingVisitEventLean[]> {
  const map = new Map<string, LandingVisitEventLean[]>()
  for (const ev of events) {
    if (!ev.trackingIdHash) continue
    const list = map.get(ev.trackingIdHash)
    if (list) list.push(ev)
    else map.set(ev.trackingIdHash, [ev])
  }
  return map
}

export type FreshVisitSummary = {
  matched: boolean
  event_count: number
  first_observed_at: Date | null
  last_observed_at: Date | null
}

/**
 * Collapse one hash's events (a hash can have several: new session after the
 * 30-minute idempotency window, or different UTM contents) into one summary.
 */
export function summarizeEvents(events: readonly LandingVisitEventLean[]): FreshVisitSummary {
  if (!events.length) {
    return { matched: false, event_count: 0, first_observed_at: null, last_observed_at: null }
  }
  let first: Date | null = null
  let last: Date | null = null
  for (const ev of events) {
    const f = new Date(ev.firstObservedAt)
    const l = new Date(ev.lastObservedAt)
    if (!Number.isNaN(f.getTime()) && (!first || f < first)) first = f
    if (!Number.isNaN(l.getTime()) && (!last || l > last)) last = l
  }
  return { matched: true, event_count: events.length, first_observed_at: first, last_observed_at: last }
}

/** Monotonic, idempotent merge of the persisted summary with a fresh read. */
export function mergeVisitSummary(
  existing: LandingVisitSummary | null | undefined,
  fresh: FreshVisitSummary,
  syncedAt: Date,
): LandingVisitSummary {
  const prev = existing ?? {
    matched: false,
    event_count: 0,
    first_observed_at: null,
    last_observed_at: null,
    synced_at: null,
  }
  const minDate = (a: Date | null, b: Date | null): Date | null =>
    a && b ? (a < b ? a : b) : (a ?? b)
  const maxDate = (a: Date | null, b: Date | null): Date | null =>
    a && b ? (a > b ? a : b) : (a ?? b)
  return {
    matched: prev.matched || fresh.matched,
    event_count: Math.max(prev.event_count ?? 0, fresh.event_count),
    first_observed_at: minDate(prev.first_observed_at ?? null, fresh.first_observed_at),
    last_observed_at: maxDate(prev.last_observed_at ?? null, fresh.last_observed_at),
    synced_at: syncedAt,
  }
}
