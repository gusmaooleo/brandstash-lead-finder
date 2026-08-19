import { describe, expect, it } from 'vitest'
import { followupCutoff, followupDueQuery, MAX_SENDS } from './followup'

describe('follow-up due query', () => {
  const now = new Date('2026-08-17T12:00:00.000Z')

  it('cutoff honors the configured follow-up delay (default 3)', () => {
    expect(followupCutoff(now).toISOString()).toBe('2026-08-14T12:00:00.000Z')
  })

  it('targets 1–2 successful sends, waited out, not stopped — hard cap of 3', () => {
    expect(MAX_SENDS).toBe(3)
    const q = followupDueQuery(now)
    expect(q['outreach.count']).toEqual({ $gte: 1, $lt: 3 })
    expect(q['outreach.last_sent_at']).toEqual({ $lte: followupCutoff(now) })
    expect(q['outreach.stopped_at']).toBeNull()
    expect(q['delivery.state']).toEqual({ $in: ['sent', 'sent_dry_run'] })
  })
})
