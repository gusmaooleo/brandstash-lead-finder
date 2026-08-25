/**
 * End-to-end (in-memory) proof that a tracked send injects ONE rid into every
 * landing link of an email — HTML and plain text — and that nothing untracked
 * ever points at the landing.
 *
 * The copy comes from a template, as it does in production: these are the
 * guarantees the tracking contract makes regardless of what anyone writes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzePlaceProfile } from '../scoring/analyze'
import type { PlaceProfileSummary } from '../scoring/types'
import { renderForLead, type OutreachOptions } from '../email/sender'
import type { ResolvedTemplate } from '../email/template-store'
import { setSettingsForTests } from '../settings/settings'
import { generateRid } from './rid'
import { campaignFor } from './landing-url'
import { buildSendRecord } from './send-log'

const SITE = 'https://acme.example'

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

/** A template that links to the landing twice, as a real one does. */
const variant = (label: string) => ({
  subject: `${label} — {{business_name}}`,
  html: `<p>{{finding_1}} <a href="{{landing_url}}">site</a></p><p><a href="{{landing_url}}">{{brand_name}}</a></p>`,
  text: `{{finding_1}}\n{{landing_url}}\n{{landing_url}}`,
  preheader: '',
  band: null,
  needs_rating: false,
})

const template: ResolvedTemplate = {
  id: '650000000000000000000001',
  name: 'Test template',
  audience: 'business',
  language: 'pt',
  lowScoreVariants: false,
  findings: { no_hours: 'não tem horário cadastrado', few_photos: 'só {{count}} fotos' },
  strings: {},
  assets: [],
  messages: [
    { followup: 0, variants: [variant('initial')] },
    { followup: 1, variants: [variant('bump')] },
  ],
}

function renderTracked(opts: OutreachOptions) {
  return renderForLead(lead, scoring, summary, 'pt', 'tok', {
    campaign: campaignFor('portuguese'),
    template,
    ...opts,
  })
}

/** All rid values found in landing links of a blob of HTML/text. */
function ridsIn(content: string): string[] {
  const rids: string[] = []
  for (const match of content.matchAll(/https:\/\/acme\.example\/[^\s"<]+/g)) {
    const url = new URL(match[0].replace(/&amp;/g, '&'))
    rids.push(url.searchParams.get('rid') ?? '(missing)')
  }
  return rids
}

describe('tracked landing links in outreach emails', () => {
  let consoleSpies: Array<ReturnType<typeof vi.spyOn>> = []

  beforeEach(() => {
    setSettingsForTests({ offer: { siteUrl: SITE, brandName: 'Acme' } })
    consoleSpies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m))
  })
  afterEach(() => vi.restoreAllMocks())

  it('HTML and plain text carry the SAME tracked URL', () => {
    const rid = generateRid()
    const email = renderTracked({ rid })
    expect(email.text).toBeTruthy()
    const htmlRids = ridsIn(email.html)
    const textRids = ridsIn(email.text!)
    expect(htmlRids.length).toBeGreaterThan(1)
    expect(textRids.length).toBeGreaterThan(1)
    expect(new Set([...htmlRids, ...textRids])).toEqual(new Set([rid]))
    expect(email.html).toContain('utm_source=cold_email')
    expect(email.html).toContain('utm_medium=email')
    expect(email.html).toContain('utm_campaign=leadfinder_portuguese')
    expect(email.html).toContain('utm_term=attempt_1')
  })

  it('every link of one send shares one rid', () => {
    const rid = generateRid()
    const email = renderTracked({ rid })
    const rids = ridsIn(email.html)
    expect(rids.length).toBeGreaterThanOrEqual(2)
    expect(new Set(rids).size).toBe(1)
    expect(email.html).toContain(`utm_content=tpl_${template.id}_v${email.variant + 1}`)
  })

  it('follow-ups carry their own attempt number and template id', () => {
    const rid = generateRid()
    const bump = renderTracked({ followupNumber: 1, rid })
    expect(bump.html).toContain('utm_term=attempt_2')
    expect(bump.html).toContain(`utm_content=tpl_${template.id}_followup_1_v`)
    expect(ridsIn(bump.html)).toEqual(expect.arrayContaining([rid]))
  })

  it('without a rid there is NO landing link at all (never an untracked one)', () => {
    const email = renderTracked({ rid: null })
    expect(email.html).not.toContain('acme.example')
    expect(email.text).not.toContain('acme.example')
  })

  it('a preview keeps the landing link but never a cold-email identity', () => {
    const email = renderTracked({ preview: true })
    // The owner still sees the real link shape…
    expect(email.html).toContain('acme.example')
    expect(ridsIn(email.html).length).toBeGreaterThan(0)
    // …but nothing the landing could attribute to a send: no rid, and a
    // source the cold-email reconciliation filter does not accept.
    expect(ridsIn(email.html)).toEqual(ridsIn(email.html).map(() => '(missing)'))
    expect(email.html).toContain('utm_source=preview')
    expect(email.html).not.toContain('utm_source=cold_email')
  })

  it('a one-off email is tracked exactly like a stored template', () => {
    const rid = generateRid()
    const email = renderTracked({
      rid,
      template: undefined,
      oneOff: { subject: 'hand written', html: '<p>hi <a href="{{landing_url}}">site</a></p>' },
    })
    expect(new Set(ridsIn(email.html))).toEqual(new Set([rid]))
    expect(email.templateId).toBe('one_off')
    expect(email.templateKey).toBe('one_off')
    expect(email.variantFingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('changes the immutable variant fingerprint when the copy changes', () => {
    const original = renderTracked({ rid: generateRid() })
    const changed = renderForLead(lead, scoring, summary, 'pt', 'tok', {
      rid: generateRid(),
      campaign: campaignFor('portuguese'),
      template: {
        ...template,
        messages: [{ followup: 0, variants: [{ ...variant('initial'), subject: 'new subject' }] }],
      },
    })
    expect(changed.variantFingerprint).not.toBe(original.variantFingerprint)
  })

  it('the raw rid never reaches console logs during render or record building', () => {
    const rid = generateRid()
    renderTracked({ rid })
    renderTracked({ followupNumber: 1, rid })
    buildSendRecord({ lead, recipient: 'a@b.co', followupNumber: 0 }, 'f'.repeat(64))
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(rid)
      }
    }
  })
})
