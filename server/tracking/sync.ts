/**
 * Reconciliation of email_sends ↔ landing_visit_events.
 *
 * Reads all sends that carry a tracking hash, queries the landing's event
 * collection in $in batches (projection-limited, read-only), groups events
 * in memory and merges each send's landing_visit summary MONOTONICALLY
 * (see reconcile.ts) — so repeated runs never duplicate or shrink metrics,
 * and summaries persisted here outlive the landing's 180-day event TTL.
 *
 * An unreachable Atlas fails the SYNC only: the error is recorded (sanitized)
 * in tracking_state, existing summaries stay untouched, and the dashboard
 * keeps serving persisted data — "no visit" and "sync failed" are distinct
 * states, and a missing event is never treated as a send failure.
 */

import { EmailSend, getTrackingState } from './models'
import { landingVisitEventsCollection } from './landing-db'
import { sanitizeDbError } from './landing-db'
import { backfillUntrackedSends } from './send-log'
import { Approved } from '../leads/models'
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

export type EventFetcher = (
  filter: Record<string, unknown>,
  projection: Record<string, unknown>,
) => Promise<LandingVisitEventLean[]>

const defaultFetcher: EventFetcher = async (filter, projection) => {
  const collection = await landingVisitEventsCollection()
  return collection.find(filter, { projection }).toArray() as unknown as Promise<LandingVisitEventLean[]>
}

/** Counts cold-email visits on the landing, ours and everyone else's. */
export type EventCounter = (filter: Record<string, unknown>) => Promise<number>

const defaultCounter: EventCounter = async (filter) => {
  const collection = await landingVisitEventsCollection()
  return collection.countDocuments(filter)
}

export type SyncResult = {
  ok: boolean
  synced_at: string
  sends_with_tracking: number
  matched_sends: number
  events_seen: number
  /**
   * Cold-email visits on the landing that belong to no send of ours — almost
   * always clicks on a PREVIEW link, or on an email sent by an older install.
   * Reported so "the landing has visits but the dashboard shows none" reads as
   * an explained number instead of a broken sync.
   */
  unattributed_events: number
  backfilled_rows: number
  error: string | null
}

/** Injectable fetcher keeps the orchestration unit-testable without Atlas. */
export async function syncLandingVisits(
  fetchEvents: EventFetcher = defaultFetcher,
  countEvents: EventCounter = defaultCounter,
): Promise<SyncResult> {
  const now = new Date()
  const state = await getTrackingState()

  // Keep legacy (pre-tracking) sends visible before reconciling.
  const legacyCandidates = await Approved.find(
    { $or: [{ 'outreach.count': { $gte: 1 } }, { 'delivery.state': 'failed' }] },
    { place_id: 1, name: 1, language: 1, market_scope: 1, discovery: 1, email_style: 1, approved_at: 1, 'contact.selected_email': 1, delivery: 1, outreach: 1 },
  ).lean()
  const backfilled = await backfillUntrackedSends(legacyCandidates as never)

  const sends = await EmailSend.find(
    { tracking_id_hash: { $type: 'string' } },
    { tracking_id_hash: 1, landing_visit: 1 },
  ).lean()

  let events: LandingVisitEventLean[] = []
  let coldEmailEvents = 0
  try {
    for (const batch of chunk(sends.map((s) => s.tracking_id_hash as string))) {
      const found = await fetchEvents(buildVisitEventFilter(batch), VISIT_EVENT_PROJECTION)
      events = events.concat(found)
    }
    coldEmailEvents = await countEvents(buildColdEmailEventFilter())
  } catch (err) {
    const message = sanitizeDbError(err instanceof Error ? err.message : String(err))
    state.last_sync_ok = false
    state.last_sync_error = message
    await state.save()
    return {
      ok: false,
      synced_at: now.toISOString(),
      sends_with_tracking: sends.length,
      matched_sends: 0,
      events_seen: 0,
      unattributed_events: 0,
      backfilled_rows: backfilled,
      error: message,
    }
  }

  const byHash = groupEventsByHash(events)
  let matched = 0
  const ops = sends.map((send) => {
    const fresh = summarizeEvents(byHash.get(send.tracking_id_hash as string) ?? [])
    const merged = mergeVisitSummary(send.landing_visit, fresh, now)
    if (merged.matched) matched += 1
    return {
      updateOne: {
        filter: { _id: send._id },
        update: { $set: { landing_visit: merged } },
      },
    }
  })
  if (ops.length) {
    await EmailSend.bulkWrite(ops as unknown as Parameters<typeof EmailSend.bulkWrite>[0], { ordered: false })
  }

  // A cold-email visit the landing kept but no send of ours owns: never
  // negative, even if the landing's count moved between the two reads.
  const unattributed = Math.max(0, coldEmailEvents - events.length)

  state.last_synced_at = now
  state.last_sync_ok = true
  state.last_sync_error = null
  state.last_sync_sends = sends.length
  state.last_sync_events = events.length
  state.last_sync_unattributed = unattributed
  await state.save()

  return {
    ok: true,
    synced_at: now.toISOString(),
    sends_with_tracking: sends.length,
    matched_sends: matched,
    events_seen: events.length,
    unattributed_events: unattributed,
    backfilled_rows: backfilled,
    error: null,
  }
}
