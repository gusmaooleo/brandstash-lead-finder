import { describe, expect, it } from 'vitest'
import {
  breakdown,
  customTemplateIds,
  landingStatusOf,
  median,
  overviewMetrics,
  rate,
  relabelTemplateKeys,
  timeseries,
  type SendRow,
} from './metrics'

const send = (over: Partial<SendRow> = {}): SendRow => ({
  place_id: 'p1',
  status: 'sent',
  sent_at: '2026-08-10T12:00:00.000Z',
  template_id: 'tpl_a_v1',
  variant: 0,
  followup: 0,
  attempt: 1,
  campaign: 'leadfinder_portuguese',
  tracking_id_hash: 'a'.repeat(64),
  landing_visit: { matched: false, event_count: 0, first_observed_at: null, last_observed_at: null, synced_at: null },
  ...over,
})

const visited = (over: Partial<SendRow> = {}): SendRow =>
  send({
    landing_visit: {
      matched: true,
      event_count: 2,
      first_observed_at: '2026-08-10T18:00:00.000Z',
      last_observed_at: '2026-08-11T09:00:00.000Z',
      synced_at: '2026-08-12T00:00:00.000Z',
    },
    ...over,
  })

describe('overview metrics', () => {
  it('a visited send counts ONCE even with many events; sessions sum event_count', () => {
    const rows = [
      visited({ place_id: 'p1', landing_visit: { matched: true, event_count: 5, first_observed_at: '2026-08-10T18:00:00.000Z', last_observed_at: null, synced_at: null } }),
      send({ place_id: 'p2' }),
      visited({ place_id: 'p3' }),
    ]
    const m = overviewMetrics(rows)
    expect(m.emails_sent).toBe(3)
    expect(m.visited_sends).toBe(2) // NOT 7 — sends, not events
    expect(m.consented_sessions).toBe(7)
    expect(m.unique_visited_leads).toBe(2)
    expect(m.landing_visit_rate).toBeCloseTo((2 / 3) * 100)
  })

  it('distinct leads: two visited sends of the same lead = one unique lead', () => {
    const m = overviewMetrics([visited({ place_id: 'same' }), visited({ place_id: 'same', attempt: 2 })])
    expect(m.visited_sends).toBe(2)
    expect(m.unique_visited_leads).toBe(1)
  })

  it('zero sends → 0% rate, never NaN or a division error', () => {
    expect(rate(0, 0)).toBe(0)
    const m = overviewMetrics([])
    expect(m.landing_visit_rate).toBe(0)
    expect(m.emails_sent).toBe(0)
    expect(m.median_hours_to_first_visit).toBeNull()
  })

  it('failed and queued sends never count as emails_sent', () => {
    const m = overviewMetrics([send({ status: 'failed' }), send({ status: 'queued' }), send()])
    expect(m.emails_sent).toBe(1)
    expect(m.failed_sends).toBe(1)
    expect(m.queued_sends).toBe(1)
  })

  it('excludes dry runs, bounces and complaints from performance denominators', () => {
    const m = overviewMetrics([
      send(),
      visited({ status: 'sent_dry_run' }),
      visited({ provider_event: 'bounced' }),
      visited({ provider_event: 'complained' }),
    ])
    expect(m.emails_sent).toBe(1)
    expect(m.visited_sends).toBe(0)
    expect(m.dry_run_sends).toBe(1)
    expect(m.bounced_sends).toBe(1)
    expect(m.complained_sends).toBe(1)
  })

  it('median hours from send to first visit', () => {
    expect(median([1, 5, 100])).toBe(5)
    expect(median([2, 4])).toBe(3)
    const m = overviewMetrics([visited()]) // sent 12:00 → first 18:00 = 6h
    expect(m.median_hours_to_first_visit).toBe(6)
  })
})

describe('untracked & badge classification', () => {
  it('rows without a hash are "untracked" — never invented, never visited', () => {
    const legacy = send({ tracking_id_hash: null, landing_visit: null })
    expect(landingStatusOf(legacy)).toBe('untracked')
    const m = overviewMetrics([legacy, visited()])
    expect(m.untracked_sends).toBe(1)
    expect(m.tracked_sends).toBe(1)
    expect(m.emails_sent).toBe(2) // untracked still counts as sent
    expect(m.visited_sends).toBe(1)
  })

  it('maps every badge state', () => {
    expect(landingStatusOf(visited())).toBe('visited')
    expect(landingStatusOf(send())).toBe('no_visit')
    expect(landingStatusOf(send({ status: 'failed' }))).toBe('failed')
    expect(landingStatusOf(send({ status: 'queued' }))).toBe('queued')
    expect(landingStatusOf(send({ status: 'sent_dry_run' }))).toBe('dry_run')
    expect(landingStatusOf(send({ provider_event: 'bounced' }))).toBe('bounced')
  })
})

describe('timeseries', () => {
  it('buckets sends and visits by UTC day with per-day rates', () => {
    const rows = [
      send({ sent_at: '2026-08-10T01:00:00.000Z' }),
      visited({ sent_at: '2026-08-10T23:00:00.000Z' }),
      visited({ sent_at: '2026-08-11T09:00:00.000Z' }),
    ]
    const points = timeseries(rows, new Date('2026-08-09T00:00:00Z'), new Date('2026-08-11T23:59:59Z'))
    expect(points.map((p) => p.day)).toEqual(['2026-08-09', '2026-08-10', '2026-08-11'])
    expect(points[0]).toEqual({ day: '2026-08-09', sent: 0, visited: 0, rate: 0 })
    expect(points[1]).toEqual({ day: '2026-08-10', sent: 2, visited: 1, rate: 50 })
    expect(points[2]).toEqual({ day: '2026-08-11', sent: 1, visited: 1, rate: 100 })
  })
})

describe('comparative breakdowns (template / campaign / variant / attempt)', () => {
  const rows = [
    visited({ template_id: 'tpl_a_v1' }),
    send({ template_id: 'tpl_a_v1' }),
    send({ template_id: 'tpl_b_v2', campaign: 'leadfinder_france', attempt: 1 }),
    visited({ template_id: 'tpl_a_followup_1_v2', attempt: 2, campaign: 'leadfinder_france' }),
    send({ status: 'failed', template_id: 'tpl_a_v1' }), // never grouped
  ]

  it('groups by template with sent/visited/rate/sessions', () => {
    const byTemplate = breakdown(rows, (r) => r.template_id)
    const note = byTemplate.find((b) => b.key === 'tpl_a_v1')!
    expect(note.sent).toBe(2)
    expect(note.visited).toBe(1)
    expect(note.rate).toBe(50)
    expect(note.sessions).toBe(2)
    const followup = byTemplate.find((b) => b.key === 'tpl_a_followup_1_v2')!
    expect(followup.rate).toBe(100)
    // Sorted by rate desc.
    expect(byTemplate[0].key).toBe('tpl_a_followup_1_v2')
  })

  it('filters by campaign and attempt through the group key', () => {
    const byCampaign = breakdown(rows, (r) => r.campaign)
    expect(byCampaign.find((b) => b.key === 'leadfinder_france')?.sent).toBe(2)
    const byAttempt = breakdown(rows, (r) => `attempt_${r.attempt}`)
    expect(byAttempt.find((b) => b.key === 'attempt_2')?.visited).toBe(1)
    expect(byAttempt.find((b) => b.key === 'attempt_1')?.sent).toBe(3)
  })
})

describe('template labels in the dashboard', () => {
  const rows = breakdown(
    [
      send({ template_id: 'custom_68f0a1b2c3d4e5f607182930_v2' }),
      send({ template_id: 'custom_68f0a1b2c3d4e5f607182930_followup_1_v1' }),
      send({ template_id: 'custom_aaaaaaaaaaaaaaaaaaaaaaaa_v1' }),
      send({ template_id: 'agency_note_v3' }),
    ],
    (r) => r.template_id,
  )

  it('collects the template ids a breakdown refers to', () => {
    expect(customTemplateIds(rows).sort()).toEqual([
      '68f0a1b2c3d4e5f607182930',
      'aaaaaaaaaaaaaaaaaaaaaaaa',
    ])
  })

  it('shows the template name instead of its database id', () => {
    const named = relabelTemplateKeys(rows, new Map([['68f0a1b2c3d4e5f607182930', 'Agencies — Girard v2']]))
    const keys = named.map((r) => r.key)
    expect(keys).toContain('Agencies — Girard v2 · v2')
    expect(keys).toContain('Agencies — Girard v2 · follow-up 1 · v1')
    // A deleted template keeps its raw key — no invented name.
    expect(keys).toContain('custom_aaaaaaaaaaaaaaaaaaaaaaaa_v1')
    // Builtin ids were already readable.
    expect(keys).toContain('agency_note_v3')
  })
})
