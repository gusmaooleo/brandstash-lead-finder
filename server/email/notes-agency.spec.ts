import { describe, expect, it } from 'vitest'
import type { EmailLanguage } from '../../shared/types'
import { AGENCY_NOTE_PACKS } from './notes-agency'
import { MAX_SENDS, NOTE_PACKS, NOTE_VARIANT_COUNT, renderNoteEmail, type NoteInput } from './notes'
import { audienceForLead, categorySlug, searchedCategory } from './audience'
import { templateIdFor } from '../tracking/landing-url'

const LANGS = Object.keys(AGENCY_NOTE_PACKS) as EmailLanguage[]

const agencyInput = (overrides: Partial<NoteInput> = {}): NoteInput => ({
  placeId: 'ChIJagency123',
  name: 'Studio Norte',
  cityLabel: 'Porto Alegre, Brazil',
  rating: 4.8,
  reviewCount: 31,
  score: 7.2,
  summary: { photos_count: 1, has_hours: true, editorial_summary: null, total_ratings: 31 },
  language: 'pt',
  sender: { name: 'Leonardo Silva', email: 'get@brandstash.ai' },
  unsubscribeUrl: 'http://localhost:4000/unsubscribe?t=tok',
  variant: 0,
  followupNumber: 0,
  pack: AGENCY_NOTE_PACKS.pt,
  ...overrides,
})

describe('agency note packs', () => {
  it('ships all 10 languages with 3 angles + bump + breakup', () => {
    expect(LANGS.length).toBe(10)
    for (const lang of LANGS) {
      expect(AGENCY_NOTE_PACKS[lang].variants.length, lang).toBe(NOTE_VARIANT_COUNT)
      expect(AGENCY_NOTE_PACKS[lang].followups.length, lang).toBe(MAX_SENDS - 1)
    }
  })

  it('renders every language × angle × follow-up, with no unresolved interpolation', () => {
    for (const lang of LANGS) {
      for (let variant = 0; variant < NOTE_VARIANT_COUNT; variant++) {
        for (const followupNumber of [0, 1, 2] as const) {
          const note = renderNoteEmail(
            agencyInput({ language: lang, variant, followupNumber, pack: AGENCY_NOTE_PACKS[lang] }),
          )
          const where = `${lang} v${variant} f${followupNumber}`
          expect(note.subject.length, where).toBeGreaterThan(4)
          expect(note.html, where).toContain('Studio Norte')
          expect(note.html, where).toContain('/unsubscribe?t=tok')
          expect(note.text, where).toContain('Studio Norte')
          expect(note.html, where).not.toContain('undefined')
          expect(note.html, where).not.toContain('NaN')
          // A note is hand-typed: no images, no scripts, ever.
          expect(note.html, where).not.toContain('<img')
          expect(note.html, where).not.toContain('<script')
        }
      }
    }
  })

  it('pitches the multi-client dashboard, never the lead’s own profile', () => {
    const audit = renderNoteEmail(agencyInput({ language: 'en', variant: 0, pack: AGENCY_NOTE_PACKS.en }))
    const demo = renderNoteEmail(agencyInput({ language: 'en', variant: 1, pack: AGENCY_NOTE_PACKS.en }))
    const partner = renderNoteEmail(agencyInput({ language: 'en', variant: 2, pack: AGENCY_NOTE_PACKS.en }))
    expect(audit.html).toContain('audit')
    expect(demo.html.toLowerCase()).toContain('dashboard')
    expect(partner.html.toLowerCase()).toContain('partner')
    for (const note of [audit, demo, partner]) expect(note.html.toLowerCase()).toContain('client')
  })

  it('keeps the language’s own findings and signoff', () => {
    for (const lang of LANGS) {
      expect(AGENCY_NOTE_PACKS[lang].signoff).toBe(NOTE_PACKS[lang].signoff)
      expect(AGENCY_NOTE_PACKS[lang].findings).toBe(NOTE_PACKS[lang].findings)
    }
  })

  it('reads a rating-less lead without printing an empty star', () => {
    const note = renderNoteEmail(
      agencyInput({ language: 'en', variant: 2, rating: null, reviewCount: null, pack: AGENCY_NOTE_PACKS.en }),
    )
    expect(note.html).not.toContain('★')
    expect(note.html).toContain('Studio Norte')
  })
})

describe('audience resolution', () => {
  it('routes agency categories to the agency copy, everything else to the business copy', () => {
    expect(audienceForLead({ category: 'marketing_agency' })).toBe('agency')
    expect(audienceForLead({ category: 'advertising_agency' })).toBe('agency')
    expect(audienceForLead({ category: 'car_dealer' })).toBe('business')
    expect(audienceForLead({ category: 'travel_agency' })).toBe('business')
    expect(audienceForLead({ category: 'insurance_agency' })).toBe('business')
  })

  it('matches the CATALOG category discovery searched, not only the Places type', () => {
    // Places often reports a broader primaryType than the searched category.
    const lead = {
      category: 'point_of_interest',
      discovery: { query: 'Branding agency in Austin, Texas, United States' },
    }
    expect(searchedCategory(lead)).toBe('Branding agency')
    expect(audienceForLead(lead)).toBe('agency')
  })

  it('prefers the stored search category over the parsed query', () => {
    const lead = {
      category: 'store',
      discovery: { query: 'Gift shop in Lisbon, Portugal', search_category: 'Public relations firm' },
    }
    expect(audienceForLead(lead)).toBe('agency')
  })

  it('normalizes both vocabularies to the same slug', () => {
    expect(categorySlug('E commerce agency')).toBe('e_commerce_agency')
    expect(categorySlug('Farmers’ market')).toBe('farmers_market')
  })

  it('tags the tracked template so the two pitches never average together', () => {
    expect(templateIdFor('note', 0, 'agency')).toBe('agency_note')
    expect(templateIdFor('note', 2, 'agency')).toBe('agency_note_followup_2')
    expect(templateIdFor('note', 0)).toBe('note')
  })
})
