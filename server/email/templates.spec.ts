import { beforeEach, describe, expect, it } from 'vitest'
import { BUILTIN_DEFINITIONS, resolveTemplate, setTemplatesForTests } from './template-store'
import { applyPlaceholders, htmlToText, renderCustomMessage, stripScripts } from './template-render'
import { buildSystemPrompt, parseGeneratedTemplate } from './template-prompts'
import type { EmailTemplateDoc } from './template-models'
import { AGENCY_CATEGORIES, audienceForLead } from './audience'

/** Plain objects standing in for documents — the resolver only reads fields. */
const template = (over: Record<string, unknown> & { name: string; kind: string }) =>
  ({ active: true, priority: 0, categories: [], messages: [], ...over }) as unknown as EmailTemplateDoc

const BUILTINS = [
  template({ _id: 'b1', name: 'Business owners — personal note', kind: 'builtin', builtin_pack: 'business_note', audience: 'business', priority: 100 }),
  template({ _id: 'b2', name: 'Business owners — dashboard report', kind: 'builtin', builtin_pack: 'dashboard', audience: 'business', priority: 110 }),
  template({
    _id: 'b3',
    name: 'Marketing agencies — multi-client panel',
    kind: 'builtin',
    builtin_pack: 'agency_note',
    audience: 'agency',
    categories: ['Marketing agency', 'Advertising agency'],
    priority: 10,
  }),
]

const customAgency = template({
  _id: 'c1',
  name: 'Agencies — Girard v2',
  kind: 'custom',
  audience: 'agency',
  language: 'en',
  categories: ['Marketing agency'],
  messages: [{ followup: 0, subject: 'hi {{business_name}}', html: '<p>hello {{city}}</p>', text: null }],
})

describe('template resolution', () => {
  beforeEach(() => setTemplatesForTests(BUILTINS))

  it('the seeded agency pack targets every category the audience rule calls an agency', async () => {
    const seeded = BUILTIN_DEFINITIONS.map((b, i) =>
      template({ _id: `s${i}`, name: b.name, kind: 'builtin', builtin_pack: b.builtin_pack, audience: b.audience, categories: [...b.categories], priority: b.priority }),
    )
    setTemplatesForTests(seeded)
    // The row's list and the coded rule are ONE rule: a category that makes a
    // lead an agency must also route it to the agency copy.
    for (const category of AGENCY_CATEGORIES) {
      const lead = { discovery: { search_category: category } }
      expect(audienceForLead(lead), category).toBe('agency')
      expect((await resolveTemplate(lead, { language: 'en' })).audience, category).toBe('agency')
    }
  })

  it('falls back to the generic business note when no category matches', async () => {
    const r = await resolveTemplate({ category: 'car_dealer' }, { language: 'en' })
    expect(r).toMatchObject({ kind: 'builtin', pack: 'business_note', audience: 'business' })
  })

  it('honours the lead style for the generic case', async () => {
    const r = await resolveTemplate({ category: 'car_dealer' }, { language: 'en', style: 'dashboard' })
    expect(r).toMatchObject({ kind: 'builtin', pack: 'dashboard' })
    // …but never for a follow-up, which is always a note.
    const f = await resolveTemplate({ category: 'car_dealer' }, { language: 'en', style: 'dashboard', followupNumber: 1 })
    expect(f).toMatchObject({ kind: 'builtin', pack: 'business_note' })
  })

  it('routes a category-bound template ahead of the generic one', async () => {
    const r = await resolveTemplate({ category: 'marketing_agency' }, { language: 'en' })
    expect(r).toMatchObject({ kind: 'builtin', pack: 'agency_note', audience: 'agency' })
  })

  it('matches the searched catalog category, not only the Places type', async () => {
    const r = await resolveTemplate(
      { category: 'point_of_interest', discovery: { query: 'Advertising agency in Austin, Texas, United States' } },
      { language: 'en' },
    )
    expect(r).toMatchObject({ pack: 'agency_note' })
  })

  it('the most specific template wins — a custom one beats a broader builtin', async () => {
    setTemplatesForTests([...BUILTINS, customAgency])
    const r = await resolveTemplate({ category: 'marketing_agency' }, { language: 'en' })
    expect(r).toMatchObject({ kind: 'custom', id: 'c1', name: 'Agencies — Girard v2' })
    // A category it does NOT target keeps the builtin agency pack.
    const other = await resolveTemplate({ category: 'advertising_agency' }, { language: 'en' })
    expect(other).toMatchObject({ kind: 'builtin', pack: 'agency_note' })
  })

  it('a custom template only applies to the language it was written in', async () => {
    setTemplatesForTests([...BUILTINS, customAgency])
    const pt = await resolveTemplate({ category: 'marketing_agency' }, { language: 'pt' })
    expect(pt).toMatchObject({ kind: 'builtin', pack: 'agency_note' })
  })

  it('a disabled template drops out of the routing', async () => {
    setTemplatesForTests([...BUILTINS, { ...customAgency, active: false } as unknown as EmailTemplateDoc])
    const r = await resolveTemplate({ category: 'marketing_agency' }, { language: 'en' })
    expect(r).toMatchObject({ kind: 'builtin', pack: 'agency_note' })
  })

  it('keeps a started sequence on its own template, even after retargeting', async () => {
    // The library changed between message 1 and the bump: the custom template
    // no longer targets this category. The lead must NOT switch voices.
    setTemplatesForTests([
      ...BUILTINS,
      { ...customAgency, categories: ['Design agency'], messages: [
        { followup: 0, subject: 'a', html: '<p>a</p>', text: null },
        { followup: 1, subject: 'b', html: '<p>b</p>', text: null },
      ] } as unknown as EmailTemplateDoc,
    ])
    const drifted = await resolveTemplate({ category: 'marketing_agency' }, { language: 'en', followupNumber: 1 })
    expect(drifted).toMatchObject({ kind: 'builtin', pack: 'agency_note' })

    const sticky = await resolveTemplate(
      { category: 'marketing_agency' },
      { language: 'en', followupNumber: 1, preferTemplateId: 'c1' },
    )
    expect(sticky).toMatchObject({ kind: 'custom', id: 'c1' })
  })

  it('drops the sticky template once it is disabled or deleted', async () => {
    setTemplatesForTests(BUILTINS)
    const r = await resolveTemplate(
      { category: 'marketing_agency' },
      { language: 'en', followupNumber: 1, preferTemplateId: 'gone' },
    )
    expect(r).toMatchObject({ kind: 'builtin', pack: 'agency_note' })
  })

  it('hands a follow-up back to the coded pack when the custom copy has none', async () => {
    setTemplatesForTests([...BUILTINS, customAgency])
    const r = await resolveTemplate({ category: 'marketing_agency' }, { language: 'en', followupNumber: 1 })
    expect(r).toMatchObject({ kind: 'builtin', pack: 'agency_note', audience: 'agency' })
  })
})

describe('custom template rendering', () => {
  const ctx = {
    businessName: 'Padaria Central',
    city: 'Salvador',
    rating: 4.6,
    reviewCount: 12,
    score: 6.4,
    finding1: 'só tem 2 fotos',
    finding2: null,
    senderName: 'Leonardo Silva',
    senderEmail: 'get@brandstash.ai',
    unsubscribeUrl: 'https://app.example/unsubscribe?t=tok',
    landingUrl: 'https://www.brandstash.ai/pt?rid=x',
    assets: ['https://cdn.example/logo.svg'],
  }

  it('substitutes every placeholder and drops unknown ones', () => {
    const out = applyPlaceholders(
      '{{business_name}} · {{city}} · {{rating}} · {{score}} · {{sender_first_name}} · {{logo_url}} · {{finding_2}} · {{nope}}',
      ctx,
    )
    expect(out).toBe(
      'Padaria Central · Salvador · 4.6 · 6.4 · Leonardo · https://cdn.example/logo.svg ·  · ',
    )
  })

  it('appends the compliance footer when the copy forgot the unsubscribe link', () => {
    const r = renderCustomMessage(
      { followup: 0, subject: 'oi {{business_name}}', html: '<p>tudo bem?</p>', text: null },
      ctx,
      'pt',
    )
    expect(r.subject).toBe('oi Padaria Central')
    expect(r.html).toContain(ctx.unsubscribeUrl)
    expect(r.text).toContain(ctx.unsubscribeUrl)
    // …and does not add a second one when the template already has it.
    const withLink = renderCustomMessage(
      { followup: 0, subject: 's', html: `<p><a href="{{unsubscribe_url}}">sair</a></p>`, text: null },
      ctx,
      'pt',
    )
    expect(withLink.html.split(ctx.unsubscribeUrl).length - 1).toBe(1)
  })

  it('never stores or renders scripts and inline handlers', () => {
    expect(stripScripts('<p>ok</p><script>steal()</script>')).toBe('<p>ok</p>')
    expect(stripScripts('<img src="x" onerror="steal()">')).toBe('<img src="x">')
    const r = renderCustomMessage(
      { followup: 0, subject: 's', html: '<p>hi</p><script>alert(1)</script>', text: null },
      ctx,
      'en',
    )
    expect(r.html).not.toContain('<script')
  })

  it('always ships a plain-text alternative', () => {
    const r = renderCustomMessage(
      { followup: 0, subject: 's', html: '<p>Olá {{business_name}},</p><p>tudo bem?</p>', text: null },
      ctx,
      'pt',
    )
    expect(r.text).toContain('Olá Padaria Central,')
    expect(r.text).not.toContain('<p>')
    expect(htmlToText('<a href="https://x">link</a>')).toBe('link (https://x)')
  })
})

describe('the offer profile drives the copy, not a hardcoded company', () => {
  it('names the sender and quotes their offer in the system prompt', () => {
    const prompt = buildSystemPrompt('joe_girard_note', {
      brandName: 'Acme Ops',
      whatWeSell: 'We install rooftop solar for restaurants.',
      useAnalysis: true,
    })
    expect(prompt).toContain('Acme Ops')
    expect(prompt).toContain('rooftop solar')
    expect(prompt).not.toContain('Brandstash')
  })

  it('forbids the profile analysis when the sender turns it off', () => {
    const on = buildSystemPrompt('joe_girard_note', { brandName: 'X', whatWeSell: 'y', useAnalysis: true })
    const off = buildSystemPrompt('joe_girard_note', { brandName: 'X', whatWeSell: 'y', useAnalysis: false })
    expect(on).toContain('THE PROFILE ANALYSIS IS AVAILABLE')
    expect(off).toContain('DO NOT USE THE PROFILE ANALYSIS')
    expect(off).toContain('{{finding_1}}')
  })
})

describe('generated template parsing', () => {
  const payload = `{"messages":[{"followup":0,"subject":"a","html":"<p>a</p>"},{"followup":1,"subject":"b","html":"<p>b</p>"}]}`

  it('reads a plain JSON answer', () => {
    expect(parseGeneratedTemplate(payload)).toHaveLength(2)
  })

  it('survives a code fence or a sentence around the JSON', () => {
    expect(parseGeneratedTemplate('```json\n' + payload + '\n```')).toHaveLength(2)
    expect(parseGeneratedTemplate(`Here you go:\n${payload}\nHope it helps!`)).toHaveLength(2)
  })

  it('clamps the follow-up index and drops incomplete messages', () => {
    const messy = `{"messages":[{"followup":9,"subject":"a","html":"<p>a</p>"},{"subject":"","html":"<p>x</p>"}]}`
    expect(parseGeneratedTemplate(messy)).toEqual([{ followup: 2, subject: 'a', html: '<p>a</p>' }])
  })

  it('fails loudly when there is nothing usable', () => {
    expect(() => parseGeneratedTemplate('I cannot do that')).toThrow(/JSON/)
    expect(() => parseGeneratedTemplate('{"messages":[]}')).toThrow(/no usable message/)
  })
})
