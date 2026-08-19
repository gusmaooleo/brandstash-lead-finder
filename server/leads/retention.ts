/**
 * Retention sweep — keeps the pending queue reviewable at 10k+ scale.
 *
 * Pending leads older than the configured retention are soft-archived (status
 * 'archived' + archived_at), which hides them from the default queue view;
 * the Archived tab can still browse and reopen them. Nothing is deleted, and
 * the sweep NEVER touches the `discovered_places` dedup registry or the
 * suppression list — dedup and do-not-contact survive forever. Approved/sent
 * history is likewise untouched (it's the audit trail).
 */

import { settings } from '../settings/settings'
import { ApprovalList } from './models'

const DAY_MS = 86_400_000
const SWEEP_INTERVAL_MS = 6 * 3_600_000

export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS)
}

/** The exact updateMany the sweep issues — pure, unit-testable. */
export function buildRetentionQuery(now: Date, days: number) {
  const cutoff = retentionCutoff(now, days)
  return {
    filter: { status: 'pending', created_at: { $lt: cutoff } },
    update: {
      $set: { status: 'archived', archived_at: now },
      $push: { audit_trail: { at: now, event: 'archived', detail: `retention: pending > ${days}d` } },
    },
  }
}

export async function runRetentionSweep(now = new Date()): Promise<number> {
  const days = settings().leadRetentionDays
  if (days <= 0) return 0
  const { filter, update } = buildRetentionQuery(now, days)
  const result = await ApprovalList.updateMany(filter, update)
  if (result.modifiedCount > 0) {
    console.log(`[retention] archived ${result.modifiedCount} pending lead(s) older than ${days}d`)
  }
  return result.modifiedCount
}

export function startRetentionLoop(): void {
  void runRetentionSweep().catch((err) => console.error('[retention]', err))
  setInterval(() => {
    void runRetentionSweep().catch((err) => console.error('[retention]', err))
  }, SWEEP_INTERVAL_MS).unref()
}
