import { describe, expect, it } from 'vitest'
import { classifyInboundReply, normalizeHeaders } from './classify'
import { buildReplySummary } from './store'

describe('inbound reply classification', () => {
  it('keeps a regular response as human', () => {
    expect(classifyInboundReply({ from: 'owner@bakery.example', subject: 'Re: seu perfil', headers: {} })).toEqual({
      kind: 'human',
      reason: null,
    })
  })

  it('detects automatic replies and bounces without counting them as human', () => {
    expect(classifyInboundReply({ from: 'owner@bakery.example', subject: 'Re: hello', headers: { 'Auto-Submitted': 'auto-replied' } }).kind).toBe('automatic')
    expect(classifyInboundReply({ from: 'MAILER-DAEMON@example.com', subject: 'Delivery failed' }).kind).toBe('bounce')
    expect(classifyInboundReply({ from: 'owner@example.com', subject: 'Resposta automática: férias' }).kind).toBe('automatic')
  })

  it('normalizes object and list-shaped headers', () => {
    expect(normalizeHeaders({ 'Auto-Submitted': 'auto-replied' })).toEqual({ 'auto-submitted': 'auto-replied' })
    expect(normalizeHeaders([{ name: 'In-Reply-To', value: '<id>' }])).toEqual({ 'in-reply-to': '<id>' })
  })
})

describe('reply summary', () => {
  it('counts only human replies as conversions and preserves unread state', () => {
    const syncedAt = new Date('2026-08-25T12:00:00Z')
    const summary = buildReplySummary([
      { kind: 'human', received_at: new Date('2026-08-22T10:00:00Z'), read_at: null },
      { kind: 'automatic', received_at: new Date('2026-08-22T11:00:00Z'), read_at: null },
      { kind: 'human', received_at: new Date('2026-08-23T10:00:00Z'), read_at: new Date() },
    ], syncedAt)
    expect(summary.matched).toBe(true)
    expect(summary.event_count).toBe(2)
    expect(summary.automatic_count).toBe(1)
    expect(summary.unread_count).toBe(1)
    expect(summary.first_observed_at?.toISOString()).toBe('2026-08-22T10:00:00.000Z')
    expect(summary.last_observed_at?.toISOString()).toBe('2026-08-23T10:00:00.000Z')
  })
})
