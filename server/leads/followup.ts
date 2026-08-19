/**
 * Follow-up queue semantics. A sent lead becomes DUE for a follow-up when:
 *  - it has at least one successful send and has not used up the sequence,
 *  - the last send is at least the configured follow-up delay old,
 *  - follow-ups were not stopped (skip button / do-not-contact),
 *  - the last delivery actually went out (sent / sent_dry_run).
 * Due leads surface in the Follow-up tab where a human approves each resend.
 *
 * How long the sequence runs is a setting (Settings → Discovery): 1 to 5
 * follow-ups after the initial email.
 */

import { settings } from '../settings/settings'

const DAY_MS = 86_400_000

/** Initial email + the configured follow-ups. */
export function maxSends(): number {
  return 1 + settings().followupSteps
}

export function followupCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - settings().followupAfterDays * DAY_MS)
}

export function followupDueQuery(now: Date = new Date()): Record<string, unknown> {
  return {
    'outreach.count': { $gte: 1, $lt: maxSends() },
    'outreach.last_sent_at': { $lte: followupCutoff(now) },
    'outreach.stopped_at': null,
    'delivery.state': { $in: ['sent', 'sent_dry_run'] },
  }
}
