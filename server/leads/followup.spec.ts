import { describe, expect, it } from 'vitest'
import { followupCutoff, followupDueQuery, maxSends } from './followup'
import { setSettingsForTests } from '../settings/settings'

describe('follow-up due query', () => {
  const now = new Date('2026-08-17T12:00:00.000Z')

  it('cutoff honors the configured follow-up delay (default 3)', () => {
    expect(followupCutoff(now).toISOString()).toBe('2026-08-14T12:00:00.000Z')
  })

  it('targets sends that have not used up the sequence, waited out, not stopped', () => {
    expect(maxSends()).toBe(3)
    const q = followupDueQuery(now)
    expect(q['outreach.count']).toEqual({ $gte: 1, $lt: 3 })
    expect(q['outreach.last_sent_at']).toEqual({ $lte: followupCutoff(now) })
    expect(q['outreach.stopped_at']).toBeNull()
    expect(q['delivery.state']).toEqual({ $in: ['sent', 'sent_dry_run'] })
  })

  it('follows the configured number of steps, not a coded cap', () => {
    setSettingsForTests({ followupSteps: 5 })
    expect(maxSends()).toBe(6)
    expect(followupDueQuery(now)['outreach.count']).toEqual({ $gte: 1, $lt: 6 })
    setSettingsForTests({ followupSteps: 1 })
    expect(followupDueQuery(now)['outreach.count']).toEqual({ $gte: 1, $lt: 2 })
    setSettingsForTests({ followupSteps: 2 })
  })
})
