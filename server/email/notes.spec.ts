import { describe, expect, it } from 'vitest'
import type { EmailLanguage } from '../../shared/types'
import { EMAIL_LOCALES } from './locales'
import {
  buildFindings,
  MAX_SENDS,
  NOTE_PACKS,
  NOTE_VARIANT_COUNT,
  pickNoteVariant,
  renderNoteEmail,
  type NoteInput,
} from './notes'

const LANGS = Object.keys(NOTE_PACKS) as EmailLanguage[]

const baseInput = (overrides: Partial<NoteInput> = {}): NoteInput => ({
  placeId: 'ChIJnote123',
  name: 'Padaria Central',
  cityLabel: 'Salvador, Brazil',
  rating: 4.6,
  reviewCount: 12,
  score: 6.4,
  summary: { photos_count: 2, has_hours: false, editorial_summary: null, total_ratings: 12 },
  language: 'pt',
  sender: { name: 'Leonardo Silva', email: 'get@brandstash.ai' },
  unsubscribeUrl: 'http://localhost:4000/unsubscribe?t=tok',
  variant: 0,
  followupNumber: 0,
  ...overrides,
})

describe('personal-note packs', () => {
  it('every language ships 3 variants + bump + breakup', () => {
    expect(LANGS.length).toBe(10)
    for (const lang of LANGS) {
      expect(NOTE_PACKS[lang].variants.length).toBe(NOTE_VARIANT_COUNT)
      expect(NOTE_PACKS[lang].followups.length).toBe(MAX_SENDS - 1)
    }
  })

  it('renders every language × every variant × every follow-up with name, unsubscribe and disclaimer footer', () => {
    for (const lang of LANGS) {
      for (let variant = 0; variant < NOTE_VARIANT_COUNT; variant++) {
        for (const followupNumber of [0, 1, 2] as const) {
          const note = renderNoteEmail(baseInput({ language: lang, variant, followupNumber }))
          expect(note.subject.length, `${lang} v${variant} f${followupNumber}`).toBeGreaterThan(4)
          expect(note.html).toContain('Padaria Central')
          expect(note.html).toContain('/unsubscribe?t=tok')
          // the owner-requested footer: same public-info disclaimer as the dashboard email
          expect(note.html).toContain(
            EMAIL_LOCALES[lang].labels.assessmentNote.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
          )
          // multipart: a real text/plain version rides along
          expect(note.text).toContain('Padaria Central')
          expect(note.text).toContain('/unsubscribe?t=tok')
          expect(note.html).not.toContain('<img')
          expect(note.html).not.toContain('<script')
        }
      }
    }
  })

  it('the 3 variants of a language produce different subjects and bodies', () => {
    for (const lang of LANGS) {
      const rendered = [0, 1, 2].map((variant) => renderNoteEmail(baseInput({ language: lang, variant })))
      const bodies = new Set(rendered.map((r) => r.html))
      const subjects = new Set(rendered.map((r) => r.subject))
      expect(bodies.size, lang).toBe(3)
      expect(subjects.size, lang).toBeGreaterThanOrEqual(2)
    }
  })

  it('follow-ups differ from the initial note (bump + breakup tone)', () => {
    for (const lang of LANGS) {
      const initial = renderNoteEmail(baseInput({ language: lang, followupNumber: 0 }))
      const bump = renderNoteEmail(baseInput({ language: lang, followupNumber: 1 }))
      const breakup = renderNoteEmail(baseInput({ language: lang, followupNumber: 2 }))
      expect(bump.html, lang).not.toBe(initial.html)
      expect(breakup.html, lang).not.toBe(initial.html)
      expect(breakup.html, lang).not.toBe(bump.html)
    }
  })

  it('never contains the AI-tell em/en dash in any language, variant, follow-up or findings shape', () => {
    const summaries = [
      { photos_count: 0, has_hours: false, editorial_summary: null, total_ratings: 0 },
      { photos_count: 2, has_hours: false, editorial_summary: null, total_ratings: 12 },
      { photos_count: 10, has_hours: true, editorial_summary: 'A bakery.', total_ratings: 120 },
    ]
    for (const lang of LANGS) {
      for (let variant = 0; variant < NOTE_VARIANT_COUNT; variant++) {
        for (const followupNumber of [0, 1, 2] as const) {
          for (const summary of summaries) {
            const note = renderNoteEmail(baseInput({ language: lang, variant, followupNumber, summary }))
            const label = `${lang} v${variant} f${followupNumber}`
            expect(note.subject, label).not.toMatch(/[—–]/)
            expect(note.html, label).not.toMatch(/[—–]/)
            expect(note.text, label).not.toMatch(/[—–]/)
          }
        }
      }
    }
  })

  it('escapes HTML in business names', () => {
    const note = renderNoteEmail(baseInput({ name: 'Bar <script>alert(1)</script>' }))
    expect(note.html).not.toContain('<script>alert')
    expect(note.html).toContain('&lt;script&gt;')
  })
})

describe('findings derivation', () => {
  it('orders by scoring weight and localizes', () => {
    const found = buildFindings(NOTE_PACKS.pt, {
      photos_count: 0,
      has_hours: false,
      editorial_summary: null,
      total_ratings: 0,
    })
    expect(found.length).toBe(4)
    expect(found[0]).toBe(NOTE_PACKS.pt.findings.noPhotos)
    expect(found[1]).toBe(NOTE_PACKS.pt.findings.noReviews)
  })

  it('falls back to the clean-profile hook when nothing is missing', () => {
    const found = buildFindings(NOTE_PACKS.en, {
      photos_count: 10,
      has_hours: true,
      editorial_summary: 'A bakery.',
      total_ratings: 120,
    })
    expect(found).toEqual([NOTE_PACKS.en.findings.clean])
  })
})

describe('variant selection', () => {
  it('is deterministic per lead and never repeats a used variant', () => {
    const first = pickNoteVariant('pid-x', [])
    expect(pickNoteVariant('pid-x', [])).toBe(first)
    const second = pickNoteVariant('pid-x', [first])
    expect(second).not.toBe(first)
    const third = pickNoteVariant('pid-x', [first, second])
    expect([first, second]).not.toContain(third)
    expect(new Set([first, second, third]).size).toBe(3)
  })
})
