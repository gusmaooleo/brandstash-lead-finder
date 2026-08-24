import { beforeEach, describe, expect, it } from 'vitest'
import { languagesOf, resolveTemplate, setTemplatesForTests, stepsOf } from './template-store'
import { catalogCategoryQuery, categorySlug, leadCategoryKeys, searchedCategory } from './category-match'
import { pickVariantIndex, scoreBand } from './variants'
import { resolveFindings } from './findings'
import { applyPlaceholders, renderCustomMessage, type TemplateContext } from './template-render'
import { buildSystemPrompt, buildUserPrompt, parseGeneratedTemplate } from './template-prompts'

const variant = (subject: string, extra: Record<string, unknown> = {}) => ({
  subject,
  html: `<p>${subject}</p>`,
  text: null,
  band: null as string | null,
  needs_rating: false,
  ...extra,
})

/**
 * A stored template as the resolver sees it: the pitch at the top level, the
 * words under `languages`. `language`/`messages` are shorthand for the common
 * single-language case; pass `languages` directly to write several.
 */
const doc = (over: Record<string, unknown> = {}) => {
  const {
    language = 'en',
    messages = [{ followup: 0, variants: [variant('hello')] }],
    languages,
    ...rest
  } = over as { language?: string; messages?: unknown[]; languages?: Record<string, unknown> }
  return {
    _id: '000000000000000000000001',
    name: 'T',
    audience: 'custom',
    categories: [],
    active: true,
    priority: 0,
    low_score_variants: false,
    assets: [],
    languages: languages ?? { [language]: { messages, findings: {}, strings: {} } },
    ...rest,
  }
}

describe('template resolution', () => {
  beforeEach(() => setTemplatesForTests([]))

  it('an empty library resolves to nothing — never to invented copy', async () => {
    expect(await resolveTemplate({ category: 'bakery' }, { language: 'en' })).toBeNull()
  })

  it('a category-bound template beats the generic one', async () => {
    setTemplatesForTests([
      doc({ _id: 'generic', name: 'Generic', categories: [] }) as never,
      doc({ _id: 'bound', name: 'Bakeries', categories: ['Bakery'] }) as never,
    ])
    const chosen = await resolveTemplate({ category: 'bakery' }, { language: 'en' })
    expect(chosen?.name).toBe('Bakeries')
  })

  it('the most specific list wins, then priority', async () => {
    setTemplatesForTests([
      doc({ _id: 'wide', name: 'Wide', categories: ['Bakery', 'Cafe', 'Bar'] }) as never,
      doc({ _id: 'narrow', name: 'Narrow', categories: ['Bakery'] }) as never,
    ])
    expect((await resolveTemplate({ category: 'bakery' }, { language: 'en' }))?.name).toBe('Narrow')
  })

  it('falls back to the generic template when no category matches', async () => {
    setTemplatesForTests([
      doc({ _id: 'generic', name: 'Generic', categories: [] }) as never,
      doc({ _id: 'bound', name: 'Bakeries', categories: ['Bakery'] }) as never,
    ])
    expect((await resolveTemplate({ category: 'dentist' }, { language: 'en' }))?.name).toBe('Generic')
  })

  it("only offers templates written in the lead's language", async () => {
    setTemplatesForTests([doc({ language: 'pt', name: 'Portuguese' }) as never])
    expect(await resolveTemplate({ category: 'bakery' }, { language: 'en' })).toBeNull()
    expect((await resolveTemplate({ category: 'bakery' }, { language: 'pt' }))?.name).toBe('Portuguese')
  })

  /**
   * One template, many languages: the pitch is chosen once by the same rules,
   * and the lead's language only decides which words come back — never which
   * template, and never a second entry in the library.
   */
  it('one template serves every language it was written in', async () => {
    setTemplatesForTests([
      doc({
        name: 'Agencies',
        categories: ['Bakery'],
        languages: {
          en: { messages: [{ followup: 0, variants: [variant('english')] }] },
          pt: { messages: [{ followup: 0, variants: [variant('portuguese')] }] },
        },
      }) as never,
    ])
    const english = await resolveTemplate({ category: 'bakery' }, { language: 'en' })
    const portuguese = await resolveTemplate({ category: 'bakery' }, { language: 'pt' })
    expect(english?.id).toBe(portuguese?.id)
    expect(english?.name).toBe(portuguese?.name)
    expect(english?.language).toBe('en')
    expect(english?.messages[0].variants[0].subject).toBe('english')
    expect(portuguese?.messages[0].variants[0].subject).toBe('portuguese')
  })

  it('a language the template was never written in resolves to nothing', async () => {
    setTemplatesForTests([doc({ languages: { en: { messages: [{ followup: 0, variants: [variant('a')] }] } } }) as never])
    expect(await resolveTemplate({}, { language: 'ja' })).toBeNull()
  })

  /** Sticking to the opening template must not stick to its language too. */
  it('a follow-up keeps the template but follows the lead into its own language', async () => {
    setTemplatesForTests([
      doc({
        _id: 'aaa',
        name: 'A',
        languages: {
          en: { messages: [{ followup: 1, variants: [variant('en bump')] }] },
          de: { messages: [{ followup: 1, variants: [variant('de bump')] }] },
        },
      }) as never,
    ])
    const chosen = await resolveTemplate({}, { language: 'de', followupNumber: 1, preferTemplateId: 'aaa' })
    expect(chosen?.messages[0].variants[0].subject).toBe('de bump')
  })

  /** A sticky template with nothing in this language must not win by pinning. */
  it('a pinned template that cannot speak the language yields to one that can', async () => {
    setTemplatesForTests([
      doc({ _id: 'pinned', name: 'Pinned', languages: { en: { messages: [{ followup: 0, variants: [variant('a')] }] } } }) as never,
      doc({ _id: 'speaks', name: 'Speaks', languages: { ja: { messages: [{ followup: 0, variants: [variant('b')] }] } } }) as never,
    ])
    expect((await resolveTemplate({}, { language: 'ja', preferTemplateId: 'pinned' }))?.name).toBe('Speaks')
  })

  it('a step with no copy is never chosen — a follow-up must have words', async () => {
    setTemplatesForTests([
      doc({ _id: 'initial', name: 'Initial only' }) as never,
      doc({
        _id: 'full',
        name: 'Full sequence',
        messages: [
          { followup: 0, variants: [variant('a')] },
          { followup: 1, variants: [variant('b')] },
        ],
      }) as never,
    ])
    expect((await resolveTemplate({}, { language: 'en', followupNumber: 1 }))?.name).toBe('Full sequence')
  })

  it('a follow-up sticks to the template that opened the sequence', async () => {
    setTemplatesForTests([
      doc({ _id: 'aaa', name: 'A', messages: [{ followup: 1, variants: [variant('a')] }] }) as never,
      doc({ _id: 'bbb', name: 'B', messages: [{ followup: 1, variants: [variant('b')] }] }) as never,
    ])
    const chosen = await resolveTemplate({}, { language: 'en', followupNumber: 1, preferTemplateId: 'bbb' })
    expect(chosen?.name).toBe('B')
  })

  it('a disabled template is never resolved', async () => {
    setTemplatesForTests([doc({ active: false }) as never])
    expect(await resolveTemplate({}, { language: 'en' })).toBeNull()
  })

  /** The language bar must not reshuffle because of insertion order. */
  it('languages are reported in the fixed UI order, unknown ones ignored', () => {
    const t = doc({ languages: { ko: {}, en: {}, xx: {}, pt: {} } }) as never
    expect(languagesOf(t)).toEqual(['en', 'pt', 'ko'])
  })

  it('a step is only offered where that language actually has variants', () => {
    const t = doc({
      languages: {
        en: { messages: [{ followup: 0, variants: [variant('a')] }, { followup: 1, variants: [] }] },
        pt: { messages: [{ followup: 0, variants: [variant('b')] }, { followup: 1, variants: [variant('c')] }] },
      },
    }) as never
    expect(stepsOf(t, 'en')).toEqual([0])
    expect(stepsOf(t, 'pt')).toEqual([0, 1])
    expect(stepsOf(t, 'ja')).toEqual([])
  })
})

describe('category matching', () => {
  it('matches the catalog name and the Places primaryType alike', () => {
    expect(categorySlug('Marketing agency')).toBe(categorySlug('marketing_agency'))
    expect(categorySlug('Café & Bar')).toBe('cafe_bar')
  })

  it('recovers the searched category from a legacy query', () => {
    expect(searchedCategory({ discovery: { query: 'Bakery in Salvador, Brazil' } })).toBe('Bakery')
    expect(searchedCategory({ discovery: { search_category: 'Cafe', query: 'x in y' } })).toBe('Cafe')
  })

  it('offers both vocabularies as keys', () => {
    expect(leadCategoryKeys({ category: 'marketing_agency', discovery: { search_category: 'Design agency' } })).toEqual(
      expect.arrayContaining(['marketing_agency', 'design_agency']),
    )
  })
})

/**
 * The lead-list filter. Its condition must select exactly the leads
 * `searchedCategory` names — including the legacy ones, which carry the
 * category only inside their query.
 */
describe('filtering leads by catalog category', () => {
  /** Does the condition accept this lead? Mirrors what Mongo would answer. */
  const matches = (
    query: Record<string, unknown>,
    lead: { discovery: { search_category?: string | null; query: string } },
  ) => {
    const branches = query.$or as Array<Record<string, any>>
    const stored = lead.discovery.search_category ?? null
    return branches.some((b) => {
      if (b['discovery.search_category']?.$in) return b['discovery.search_category'].$in.includes(stored)
      if (b['discovery.search_category'] === null && stored !== null) return false
      return (b['discovery.query'].$in as RegExp[]).some((re) => re.test(lead.discovery.query))
    })
  }

  it('an empty selection is no condition at all — never a clause matching nothing', () => {
    expect(catalogCategoryQuery([])).toBeNull()
    expect(catalogCategoryQuery(['  ', ''])).toBeNull()
  })

  it('selects on the stored field and on the legacy query alike', () => {
    const q = catalogCategoryQuery(['Bakery'])!
    expect(matches(q, { discovery: { search_category: 'Bakery', query: 'Bakery in Lisbon, Portugal' } })).toBe(true)
    expect(matches(q, { discovery: { query: 'Bakery in Lisbon, Portugal' } })).toBe(true)
    expect(matches(q, { discovery: { query: 'Bakery equipment supplier in Lisbon, Portugal' } })).toBe(false)
    expect(matches(q, { discovery: { search_category: 'Cafe', query: 'Cafe in Lisbon, Portugal' } })).toBe(false)
  })

  it('accepts every picked category and drops duplicates', () => {
    const q = catalogCategoryQuery(['Bakery', 'Cafe', 'Bakery'])!
    expect((q.$or as any[])[0]['discovery.search_category'].$in).toEqual(['Bakery', 'Cafe'])
    expect(matches(q, { discovery: { query: 'Cafe in Porto, Portugal' } })).toBe(true)
  })

  it('a catalog name is matched literally, never as a pattern', () => {
    const q = catalogCategoryQuery(['Bar & grill'])!
    expect(matches(q, { discovery: { query: 'Bar & grill in Austin, United States' } })).toBe(true)
    expect(matches(q, { discovery: { query: 'Bar X grill in Austin, United States' } })).toBe(false)
  })

  it('round-trips whatever searchedCategory reported — the facet list and the filter agree', () => {
    const lead = { discovery: { query: 'Marketing agency in Salvador, Brazil' } }
    const q = catalogCategoryQuery([searchedCategory(lead)!])!
    expect(matches(q, lead)).toBe(true)
  })
})

describe('variant picking', () => {
  const three = [variant('a'), variant('b'), variant('c')]

  it('is deterministic: the same lead always draws the same angle', () => {
    const first = pickVariantIndex(three, { placeId: 'ChIJabc' })
    expect(pickVariantIndex(three, { placeId: 'ChIJabc' })).toBe(first)
  })

  it('never repeats an angle already sent in the sequence', () => {
    const first = pickVariantIndex(three, { placeId: 'ChIJabc' })
    const second = pickVariantIndex(three, { placeId: 'ChIJabc', used: [first] })
    expect(second).not.toBe(first)
  })

  it('skips a variant that names a rating the lead does not have', () => {
    const variants = [variant('rated', { needs_rating: true }), variant('plain')]
    expect(pickVariantIndex(variants, { placeId: 'x', rating: null })).toBe(1)
  })

  it('honours the score band only when the template opted in', () => {
    const variants = [variant('low', { band: 'low' }), variant('high', { band: 'high' })]
    expect(scoreBand(4.5)).toBe('high')
    expect(scoreBand(3.2)).toBe('low')
    expect(scoreBand(null)).toBe('low')
    expect(pickVariantIndex(variants, { placeId: 'x', rating: 4.8, useBands: true })).toBe(1)
    expect(pickVariantIndex(variants, { placeId: 'x', rating: 2.1, useBands: true })).toBe(0)
  })

  it('a template with one angle still sends it, whatever the filters say', () => {
    expect(pickVariantIndex([variant('only', { needs_rating: true })], { placeId: 'x', rating: null })).toBe(0)
  })
})

describe('findings — the rule is code, the words are the template’s', () => {
  const phrases = {
    no_photos: 'no photos at all',
    few_photos: 'only {{count}} photos',
    no_reviews: 'no reviews yet',
    few_reviews: 'only {{count}} reviews',
    no_hours: 'no opening hours',
    no_description: 'no description',
    clean: 'nothing to fix',
  }

  it('orders by weight: photos and reviews before hours and description', () => {
    const found = resolveFindings(phrases, {
      photos_count: 0,
      has_hours: false,
      editorial_summary: null,
      total_ratings: 0,
    })
    expect(found.slice(0, 2)).toEqual(['no photos at all', 'no reviews yet'])
  })

  it('fills {{count}} from the profile', () => {
    const found = resolveFindings(phrases, {
      photos_count: 2,
      has_hours: true,
      editorial_summary: 'x',
      total_ratings: 12,
    })
    expect(found).toEqual(['only 2 photos', 'only 12 reviews'])
  })

  it('falls back to the "nothing to fix" line when the profile is complete', () => {
    expect(
      resolveFindings(phrases, { photos_count: 9, has_hours: true, editorial_summary: 'x', total_ratings: 90 }),
    ).toEqual(['nothing to fix'])
  })

  it('says nothing at all when the template has no words for it', () => {
    expect(
      resolveFindings({}, { photos_count: 0, has_hours: false, editorial_summary: null, total_ratings: 0 }),
    ).toEqual([])
  })

  it('rotates by variant so a follow-up leads with a different gap', () => {
    const summary = { photos_count: 0, has_hours: false, editorial_summary: null, total_ratings: 0 }
    expect(resolveFindings(phrases, summary, 0)[0]).not.toBe(resolveFindings(phrases, summary, 1)[0])
  })
})

const ctx: TemplateContext = {
  businessName: 'Tom & Jerry',
  city: 'Austin',
  rating: 4.6,
  reviewCount: 12,
  score: 6.4,
  finding1: 'only 2 photos',
  finding2: null,
  senderName: 'Ana Lima',
  senderEmail: 'ana@example.com',
  brandName: 'Acme',
  unsubscribeUrl: 'https://app.example/unsubscribe?t=tok',
  landingUrl: 'https://acme.example/en?rid=x',
  assets: [],
}

describe('the placeholder compiler', () => {
  it('escapes values it puts into HTML', () => {
    const out = applyPlaceholders('<p>{{business_name}}</p>', ctx, { escape: true })
    expect(out).toBe('<p>Tom &amp; Jerry</p>')
  })

  it('leaves plain text unescaped', () => {
    expect(applyPlaceholders('{{business_name}}', ctx)).toBe('Tom & Jerry')
  })

  it('removes tokens it does not know, never leaving them visible', () => {
    expect(applyPlaceholders('a{{nope}}b', ctx)).toBe('ab')
  })

  it('keeps a section only when the value is there', () => {
    const copy = '{{#rating}}rated {{rating}}{{/rating}}{{^rating}}not rated yet{{/rating}}'
    expect(applyPlaceholders(copy, ctx)).toBe('rated 4.6')
    expect(applyPlaceholders(copy, { ...ctx, rating: null })).toBe('not rated yet')
  })

  it('a dropped section takes its own line with it', () => {
    const copy = 'one\n{{#finding_2}}two{{/finding_2}}\nthree'
    expect(applyPlaceholders(copy, ctx)).toBe('one\nthree')
  })
})

describe('what every rendered email carries', () => {
  it('adds the configured footer when the copy has no way out', () => {
    const out = renderCustomMessage({ subject: 's', html: '<p>hi</p>' }, ctx, {
      footerHtml: 'No more mail: <a href="{{unsubscribe_url}}">stop</a>',
    })
    expect(out.html).toContain(ctx.unsubscribeUrl.replace('?', '?'))
    expect(out.html).toContain('No more mail')
  })

  it('sends the bare link when no footer is configured — never nothing', () => {
    const out = renderCustomMessage({ subject: 's', html: '<p>hi</p>' }, ctx, {})
    expect(out.html).toContain(ctx.unsubscribeUrl)
  })

  it('does not add a second footer when the copy already links out', () => {
    const html = `<p>bye <a href="{{unsubscribe_url}}">unsubscribe</a></p>`
    const out = renderCustomMessage({ subject: 's', html }, ctx, { footerHtml: 'SHOULD NOT APPEAR' })
    expect(out.html).not.toContain('SHOULD NOT APPEAR')
  })

  it('strips scripts and inline handlers, whoever wrote them', () => {
    const out = renderCustomMessage(
      { subject: 's', html: '<p onclick="steal()">hi</p><script>evil()</script>' },
      ctx,
      {},
    )
    expect(out.html).not.toContain('<script')
    expect(out.html).not.toContain('onclick')
  })

  it('always ships a text/plain alternative', () => {
    const out = renderCustomMessage({ subject: 's', html: '<p>hello</p><p>world</p>' }, ctx, {})
    expect(out.text).toContain('hello')
    expect(out.text).not.toContain('<p>')
  })

  it('resolves the preheader, then trims it to the preview length', () => {
    const out = renderCustomMessage(
      { subject: 's', html: '<body><p>hi</p></body>', preheader: '{{business_name}} — '.repeat(20) },
      ctx,
      {},
    )
    const preview = out.html.match(/mso-hide:all;">([\s\S]*?)<\/div>/)?.[1] ?? ''
    expect(preview).toContain('Tom &amp; Jerry')
    // 120 characters of TEXT — escaping happens after the cut, so the markup
    // may be longer while the words a client shows are not.
    expect(preview.replace(/&amp;/g, '&').length).toBe(120)
  })
})

describe('what the generator is asked for, and what comes back', () => {
  it('asks for the configured steps, the angles, and the bands when wanted', () => {
    const base = { preset: 'joe_girard_note' as const, brief: 'b', language: 'pt', audience: 'padarias', categories: [], assets: [] }
    const many = buildUserPrompt({ ...base, steps: 4, variantsPerStep: 3 })
    expect(many).toContain('Write 4 steps')
    expect(many).toContain('then 1..3')
    expect(many).toContain('ANGLES PER STEP: 3')

    const banded = buildUserPrompt({ ...base, steps: 2, bands: true })
    expect(banded).toContain('WRITE FOR THE SCORE BANDS')
    expect(banded).not.toContain('ANGLES PER STEP')

    const single = buildUserPrompt({ ...base, steps: 1 })
    expect(single).toContain('Write 1 step ')
    expect(single).not.toContain('then 1..')
  })

  it('documents the variables AND the conditional blocks to the model', () => {
    const system = buildSystemPrompt('joe_girard_note', { brandName: 'Acme', whatWeSell: 'x', useAnalysis: true })
    expect(system).toContain('{{business_name}}')
    expect(system).toContain('{{top_1_label}}')
    expect(system).toContain('{{#rating}}…{{/rating}}')
    expect(system).toContain('"variants"')
    expect(system).toContain('"band"')
    expect(system).toContain('"preheader"')
  })

  it('reads back a sequence of steps, each with its angles', () => {
    const messages = parseGeneratedTemplate(
      JSON.stringify({
        messages: [
          {
            followup: 0,
            variants: [
              { subject: 'a', html: '<p>a</p>', preheader: 'pa', band: 'low' },
              { subject: 'b', html: '<p>b</p>', band: 'high' },
            ],
          },
          { followup: 1, variants: [{ subject: 'c', html: '<p>c</p>' }] },
        ],
      }),
    )
    expect(messages).toHaveLength(2)
    expect(messages[0].variants.map((v) => v.band)).toEqual(['low', 'high'])
    expect(messages[0].variants[0].preheader).toBe('pa')
    expect(messages[1].variants[0].band).toBeNull()
  })

  it('still understands a model that returns one flat message per step', () => {
    const messages = parseGeneratedTemplate(
      '```json\n' + JSON.stringify({ messages: [{ followup: 0, subject: 's', html: '<p>h</p>' }] }) + '\n```',
    )
    expect(messages[0].variants).toHaveLength(1)
    expect(messages[0].variants[0].subject).toBe('s')
  })

  it('clamps a step the sequence does not have, and drops empty angles', () => {
    const messages = parseGeneratedTemplate(
      JSON.stringify({
        messages: [
          { followup: 9, variants: [{ subject: 'x', html: '<p>x</p>' }] },
          { followup: 1, variants: [{ subject: '', html: '' }] },
        ],
      }),
      2,
    )
    expect(messages).toHaveLength(1)
    expect(messages[0].followup).toBe(2)
  })

  it('refuses an answer with nothing usable in it', () => {
    expect(() => parseGeneratedTemplate('sorry, I cannot help with that')).toThrow()
    expect(() => parseGeneratedTemplate(JSON.stringify({ messages: [] }))).toThrow()
  })
})
