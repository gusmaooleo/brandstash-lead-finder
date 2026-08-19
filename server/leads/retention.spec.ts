import { describe, expect, it } from 'vitest'
import { buildRetentionQuery, retentionCutoff } from './retention'

describe('retention sweep query', () => {
  const now = new Date('2026-08-16T12:00:00.000Z')

  it('cutoff is exactly N days back', () => {
    expect(retentionCutoff(now, 45).toISOString()).toBe('2026-07-02T12:00:00.000Z')
    expect(retentionCutoff(now, 1).toISOString()).toBe('2026-08-15T12:00:00.000Z')
  })

  it('only stale PENDING leads are targeted — soft archive, nothing deleted', () => {
    const { filter, update } = buildRetentionQuery(now, 45)
    expect(filter).toEqual({ status: 'pending', created_at: { $lt: retentionCutoff(now, 45) } })
    expect(update.$set).toEqual({ status: 'archived', archived_at: now })
    expect(update.$push.audit_trail).toMatchObject({ at: now, event: 'archived' })
  })

  it('never touches the dedup registry or the suppression list', () => {
    // The sweep is a single ApprovalList.updateMany — this pins the query to
    // fields that only exist on approval_list leads, as a tripwire against a
    // future refactor pointing it at another collection.
    const { filter } = buildRetentionQuery(now, 30)
    expect(Object.keys(filter)).toEqual(['status', 'created_at'])
  })
})
