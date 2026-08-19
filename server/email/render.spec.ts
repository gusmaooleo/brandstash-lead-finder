import { describe, expect, it } from 'vitest'
import { analyzePlaceProfile } from '../scoring/analyze'
import type { PlaceProfileSummary } from '../scoring/types'
import type { EmailLanguage } from '../../shared/types'
import { EMAIL_LOCALES } from './locales'
import { pickSubject, renderLeadEmail, BRANDSTASH_LOGO_URL } from './render'

const summary: PlaceProfileSummary = {
  name: 'Padaria Central',
  address: 'Rua A, 1',
  phone: '+55 71 3333-3333',
  website: 'https://padaria-central.example',
  rating: 3.6,
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

function render(lang: EmailLanguage, rating: number | null = 3.6) {
  const scoring = analyzePlaceProfile({ ...summary, rating })
  return renderLeadEmail({
    placeId: 'ChIJtest123',
    name: 'Padaria Central',
    cityLabel: 'Salvador, Brazil',
    rating,
    reviewCount: 80,
    score: scoring.overallScore,
    categories: scoring.categories,
    language: lang,
    sender: { name: 'Leo', email: 'leo@example.com' },
    unsubscribeUrl: 'http://localhost:4000/unsubscribe?t=tok',
  })
}

describe('subject bands', () => {
  it('rating < 4 → improvement band; ≥ 4 → retention band; deterministic pick', () => {
    const low = pickSubject(EMAIL_LOCALES.en, 'pid-1', 'Biz', 3.2)
    const high = pickSubject(EMAIL_LOCALES.en, 'pid-1', 'Biz', 4.4)
    expect(low.band).toBe('low')
    expect(high.band).toBe('high')
    expect(pickSubject(EMAIL_LOCALES.en, 'pid-1', 'Biz', 3.2)).toEqual(low)
  })

  it('null rating stays in the low band and never picks a rating-dependent variant', () => {
    for (let i = 0; i < 20; i++) {
      const pick = pickSubject(EMAIL_LOCALES.pt, `pid-${i}`, 'Biz', null)
      expect(pick.band).toBe('low')
      expect(pick.subject).not.toContain('null')
      expect(pick.subject).not.toMatch(/\bnota\s+—?\s*no Google/)
    }
  })
})

describe('renderLeadEmail', () => {
  it('renders every locale with the business name, score, autopilot pitch and unsubscribe link', () => {
    for (const lang of Object.keys(EMAIL_LOCALES) as EmailLanguage[]) {
      const email = render(lang)
      expect(email.html).toContain('Padaria Central')
      expect(email.html).toContain(BRANDSTASH_LOGO_URL)
      expect(email.html).toContain('/unsubscribe?t=tok')
      // the commercial autopilot emphasis: Brandstash does the work for the user
      expect(email.html).toContain(EMAIL_LOCALES[lang].labels.autopilotLine)
      expect(email.subject.length).toBeGreaterThan(8)
      // table-based + inline CSS, no scripts, no remote fonts
      expect(email.html).toContain('<table')
      expect(email.html).not.toContain('<script')
      expect(email.html).not.toContain('@font-face')
    }
  })

  it('shows the actual Google rating and uses the amber/red palette for low scores', () => {
    const email = render('en', 3.6)
    expect(email.html).toContain('★ 3.6')
    expect(email.band).toBe('low')
  })

  it('escapes HTML in business names', () => {
    const scoring = analyzePlaceProfile(summary)
    const email = renderLeadEmail({
      placeId: 'x',
      name: 'Bar <script>alert(1)</script>',
      cityLabel: 'X',
      rating: 4.5,
      reviewCount: 2,
      score: scoring.overallScore,
      categories: scoring.categories,
      language: 'en',
      sender: { name: 'L', email: 'l@example.com' },
      unsubscribeUrl: 'http://x/unsubscribe?t=1',
    })
    expect(email.html).not.toContain('<script>alert')
    expect(email.html).toContain('&lt;script&gt;')
  })

  it('lists at most two opportunities, worst weighted deficits first', () => {
    const email = render('en')
    // Deficits here: horarios 10×1, descricao 10×1, fotos 4×2 — top two win.
    const opportunities = EMAIL_LOCALES.en.opportunities
    expect(email.html).toContain(opportunities.horarios.ausente!)
    expect(email.html).toContain(opportunities.descricao.ausente!)
    expect(email.html).not.toContain(opportunities.fotos.precisa_melhorar!)
  })
})

describe('report branding follows the offer profile', () => {
  const base = {
    placeId: 'ChIJbrand',
    name: 'Padaria Central',
    cityLabel: 'Salvador, Brazil',
    rating: 4.6,
    reviewCount: 12,
    score: 6.4,
    categories: [],
    language: 'pt' as const,
    sender: { name: 'Leonardo', email: 'get@brandstash.ai' },
    unsubscribeUrl: 'https://x/unsubscribe?t=t',
  }

  it('defaults to Brandstash — the shipped offer — when no brand is passed', () => {
    const html = renderLeadEmail(base).html
    expect(html).toContain('Brandstash')
    expect(html).toContain('brandstash-icon-black.svg')
  })

  it('wears the offer’s brand, logo and site label when one is set', () => {
    const html = renderLeadEmail({
      ...base,
      brand: { name: 'Acme Ops', logoUrl: 'https://cdn.acme/logo.svg', siteLabel: 'acme.example' },
      landingUrl: 'https://acme.example/en?rid=x',
    }).html
    expect(html).toContain('Acme Ops')
    expect(html).toContain('https://cdn.acme/logo.svg')
    expect(html).toContain('acme.example')
    expect(html).not.toContain('brandstash-icon-black.svg')
  })
})
