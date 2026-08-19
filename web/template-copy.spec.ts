/**
 * The editor round-trip. Opening a stored template, changing nothing and
 * saving must give back exactly what was there — otherwise editing one step
 * silently rewrites the others, and plain-text copy loses the text/plain part
 * that keeps it out of spam folders.
 */

import { describe, expect, it } from 'vitest'
import { canonicalMessages, messagesFromSteps, stepsFromMessages, textOrHtml, emptyDraft } from './template-copy'
import type { TemplateMessage } from './api'

const plain = textOrHtml({ ...emptyDraft(), subject: 'hello {{business_name}}', body: 'Hi there,\n\nA & B < C' })
const markup = textOrHtml({ ...emptyDraft(), subject: 'rich', body: '<p>Hi <b>there</b></p>', html: true, needsRating: true })

const stored: TemplateMessage[] = [
  { followup: 0, variants: [plain, markup] },
  { followup: 2, variants: [{ ...plain, subject: 'last touch', band: 'low' }] },
]

describe('stored messages ↔ editable steps', () => {
  it('round-trips untouched copy byte for byte', () => {
    const steps = stepsFromMessages(stored, 3, false)
    expect(messagesFromSteps(steps)).toEqual(stored)
  })

  it('plain text comes back as plain text, and keeps its text/plain twin', () => {
    const [step] = stepsFromMessages(stored, 3, false)
    expect(step.variants[0].html).toBe(false)
    expect(step.variants[0].body).toBe('Hi there,\n\nA & B < C')
    expect(messagesFromSteps([step])[0].variants[0].text).toBe('Hi there,\n\nA & B < C')
  })

  it('HTML copy stays HTML — never re-escaped into visible tags', () => {
    const [step] = stepsFromMessages(stored, 3, false)
    expect(step.variants[1].html).toBe(true)
    expect(step.variants[1].body).toBe('<p>Hi <b>there</b></p>')
    expect(messagesFromSteps([step])[0].variants[1].html).toBe('<p>Hi <b>there</b></p>')
  })

  it('HTML that merely looks like the plain wrapper is not unwrapped', () => {
    const lookalike: TemplateMessage[] = [
      { followup: 0, variants: [{ subject: 's', html: '<div style="font-family:Arial">x</div>', text: 'x', preheader: '', band: null }] },
    ]
    expect(stepsFromMessages(lookalike, 1, false)[0].variants[0].html).toBe(true)
  })

  it('a step the template never had is offered empty, and saved only if written', () => {
    const steps = stepsFromMessages(stored, 3, false)
    expect(steps).toHaveLength(3)
    expect(steps[1].variants[0].subject).toBe('')
    expect(messagesFromSteps(steps).map((m) => m.followup)).toEqual([0, 2])
  })

  /**
   * 18 of the stored angles name the lead's rating. Losing that flag on edit
   * would start sending them to unrated leads, where the number renders empty.
   */
  it("keeps the 'names the rating' flag, which decides who may receive an angle", () => {
    const [step] = stepsFromMessages(stored, 3, false)
    expect(step.variants[1].needsRating).toBe(true)
    expect(step.variants[0].needsRating).toBe(false)
    expect(messagesFromSteps([step])[0].variants[1].needs_rating).toBe(true)
  })

  /**
   * Opening a template must not look like editing it: a stored document has
   * its own key order and defaults, and comparing it raw would mark every
   * language dirty and rewrite copy nobody touched.
   */
  it('an untouched template compares equal to what the editor would save', () => {
    const asStoredByTheApi = stored.map((m) => ({
      followup: m.followup,
      variants: m.variants.map((v) => ({
        subject: v.subject,
        html: v.html,
        text: v.text ?? null,
        preheader: v.preheader ?? '',
        band: v.band ?? null,
        needs_rating: Boolean(v.needs_rating),
      })),
    }))
    expect(canonicalMessages(asStoredByTheApi, 3)).toBe(JSON.stringify(messagesFromSteps(stepsFromMessages(stored, 3, false))))
  })

  it('score bands survive the trip, and an empty angle is dropped on save', () => {
    const steps = stepsFromMessages(stored, 3, false)
    steps[0].variants.push(emptyDraft('high'))
    const saved = messagesFromSteps(steps)
    expect(saved[0].variants).toHaveLength(2)
    expect(saved[1].variants[0].band).toBe('low')
  })
})
