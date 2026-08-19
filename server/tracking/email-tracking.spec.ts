/**
 * End-to-end (in-memory) proof that a tracked send injects ONE rid into
 * every landing link of both email formats — HTML and plain text — and that
 * nothing untracked ever points at the landing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzePlaceProfile } from '../scoring/analyze'
import type { PlaceProfileSummary } from '../scoring/types'
import { renderForLead, type OutreachOptions } from '../email/sender'
import { generateRid } from './rid'
import { campaignFor } from './landing-url'
import { buildSendRecord } from './send-log'

const summary: PlaceProfileSummary = {
  name: 'Padaria Central',
  address: 'Rua A, 1',
  phone: '+55 71 3333-3333',
  website: 'https://padaria-central.example',
  rating: 4.3,
  total_ratings: 80,
  has_hours: false,
  hours_text: null,
  photos_count: 2,
  reviews_count: 0,
  reviews_sample: [],
  types: ['bakery'],
  editorial_summary: null,
  business_status: 'OPERATIONAL',
}

const lead = {
  place_id: 'ChIJtracked123',
  name: 'Padaria Central',
  city_label: 'Salvador, Brazil',
  google_rating: 4.3,
  review_count: 80,
  score: 6.1,
  language: 'pt',
  market_scope: 'portuguese',
} as never

const scoring = analyzePlaceProfile(summary)

function renderTracked(opts: OutreachOptions) {
  return renderForLead(lead, scoring, summary, 'pt', 'tok', {
    campaign: campaignFor('portuguese'),
    ...opts,
  })
}

/** All rid values found in landing links of a blob of HTML/text. */
function ridsIn(content: string): string[] {
  const rids: string[] = []
  for (const match of content.matchAll(/https:\/\/www\.brandstash\.ai\/[^\s"<]+/g)) {
    const url = new URL(match[0].replace(/&amp;/g, '&'))
    const rid = url.searchParams.get('rid')
    if (rid) rids.push(rid)
    else rids.push('(missing)')
  }
  return rids
}

describe('tracked landing links in outreach emails', () => {
  let consoleSpies: Array<ReturnType<typeof vi.spyOn>> = []

  beforeEach(() => {
    consoleSpies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m))
  })
  afterEach(() => vi.restoreAllMocks())

  it('personal note: HTML and plain text carry the SAME tracked URL', () => {
    const rid = generateRid()
    const note = renderTracked({ style: 'note', rid })
    expect(note.text).toBeTruthy()
    const htmlRids = ridsIn(note.html)
    const textRids = ridsIn(note.text!)
    expect(htmlRids.length).toBeGreaterThan(0)
    expect(textRids.length).toBeGreaterThan(0)
    expect(new Set([...htmlRids, ...textRids])).toEqual(new Set([rid]))
    // utm contract present in the embedded URL
    expect(note.html).toContain('utm_source=cold_email')
    expect(note.html).toContain('utm_medium=email')
    expect(note.html).toContain('utm_campaign=leadfinder_portuguese')
    expect(note.html).toContain('utm_term=attempt_1')
  })

  it('dashboard: every landing link (header + footer) shares the send rid', () => {
    const rid = generateRid()
    const email = renderTracked({ style: 'dashboard', rid })
    const rids = ridsIn(email.html)
    expect(rids.length).toBeGreaterThanOrEqual(2)
    expect(new Set(rids)).toEqual(new Set([rid]))
    expect(email.html).toContain(`utm_content=dashboard_v${email.variant + 1}`)
  })

  it('follow-ups carry their own attempt number and template id', () => {
    const rid = generateRid()
    const bump = renderTracked({ followupNumber: 1, rid })
    expect(bump.html).toContain('utm_term=attempt_2')
    expect(bump.html).toContain('utm_content=note_followup_1_v')
    expect(ridsIn(bump.html)).toEqual(expect.arrayContaining([rid]))
  })

  it('without a rid there is NO landing link at all (never an untracked one)', () => {
    const note = renderTracked({ style: 'note', rid: null })
    const dash = renderTracked({ style: 'dashboard', rid: null })
    expect(note.html).not.toContain('www.brandstash.ai')
    expect(note.text).not.toContain('www.brandstash.ai')
    expect(dash.html).not.toContain('www.brandstash.ai')
    // mailto CTA and unsubscribe are untouched
    expect(dash.html).toContain('mailto:')
  })

  it('a preview keeps the landing link but never a cold-email identity', () => {
    const note = renderTracked({ style: 'note', preview: true })
    const dash = renderTracked({ style: 'dashboard', preview: true })
    for (const email of [note, dash]) {
      // The owner still sees the real link shape…
      expect(email.html).toContain('www.brandstash.ai')
      expect(ridsIn(email.html).length).toBeGreaterThan(0)
      // …but nothing the landing could attribute to a send: no rid, and a
      // source the cold-email reconciliation filter does not accept.
      expect(ridsIn(email.html)).toEqual(ridsIn(email.html).map(() => '(missing)'))
      expect(email.html).toContain('utm_source=preview')
      expect(email.html).not.toContain('utm_source=cold_email')
    }
  })

  it('the raw rid never reaches console logs during render or record building', () => {
    const rid = generateRid()
    renderTracked({ style: 'note', rid })
    renderTracked({ style: 'dashboard', rid })
    buildSendRecord({ lead, recipient: 'a@b.co', style: 'note', followupNumber: 0 }, 'f'.repeat(64))
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(rid)
      }
    }
  })
})
