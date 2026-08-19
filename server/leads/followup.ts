/**
 * Follow-up queue semantics. A sent lead becomes DUE for a follow-up when:
 *  - it has 1 or 2 successful sends (initial + optional bump; hard cap 3),
 *  - the last send is at least the configured follow-up delay old,
 *  - follow-ups were not stopped (skip button / do-not-contact),
 *  - the last delivery actually went out (sent / sent_dry_run).
 * Due leads surface in the Follow-up tab where a human approves each resend.
 */

import { settings } from '../settings/settings'
import { MAX_SENDS } from '../email/notes'

export { MAX_SENDS }

const DAY_MS = 86_400_000

export function followupCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - settings().followupAfterDays * DAY_MS)
}

export function followupDueQuery(now: Date = new Date()): Record<string, unknown> {
  return {
    'outreach.count': { $gte: 1, $lt: MAX_SENDS },
    'outreach.last_sent_at': { $lte: followupCutoff(now) },
    'outreach.stopped_at': null,
    'delivery.state': { $in: ['sent', 'sent_dry_run'] },
  }
}
