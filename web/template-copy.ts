/**
 * The shape the copy editor works in, and the mapping to what is stored.
 *
 * A stored message is what a lead receives: HTML, plus a text/plain twin when
 * the copy was written as plain text. The editor works in what the author
 * typed. These two functions are the ONLY translation between them, so a
 * template can be opened, edited and saved without quietly turning plain text
 * into markup or losing its text/plain part.
 */

import type { TemplateMessage } from './api'

/** One angle of one step: what the author is actually editing. */
export type Draft = {
  subject: string
  preheader: string
  body: string
  /** The author is writing markup; otherwise the body is plain text. */
  html: boolean
  band: 'low' | 'high' | null
  /** This angle names the lead's rating, so an unrated lead can't get it. */
  needsRating: boolean
}

/** A step of the sequence carries one or more angles. */
export type Step = { variants: Draft[] }

export const emptyDraft = (band: 'low' | 'high' | null = null): Draft => ({
  subject: '',
  preheader: '',
  body: '',
  html: false,
  band,
  needsRating: false,
})

export const emptyStep = (bands: boolean): Step => ({
  variants: bands ? [emptyDraft('low'), emptyDraft('high')] : [emptyDraft()],
})

/** A step sends nothing without both a subject and a body. */
export const filled = (d: Draft): boolean => Boolean(d.subject.trim() && d.body.trim())

export const bandLabel = (band: 'low' | 'high' | null): string =>
  band === 'low' ? 'poor score' : band === 'high' ? 'strong profile' : 'any lead'

export function stepLabel(followup: number, total: number): string {
  if (followup === 0) return 'Initial email'
  if (followup === total - 1 && total > 2) return `Follow-up ${followup} · last`
  return `Follow-up ${followup}`
}

/** The wrapper plain-text copy is stored in — and recognised by on the way back. */
const PLAIN_STYLE = 'font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.65;white-space:pre-wrap;'
const PLAIN_WRAPPER = new RegExp(`^<div style="${PLAIN_STYLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">([\\s\\S]*)</div>$`)

/** Copy written as plain text is stored as text; HTML is stored as HTML. */
export function textOrHtml(draft: Draft) {
  const common = {
    subject: draft.subject.trim(),
    preheader: draft.preheader.trim(),
    band: draft.band,
    needs_rating: draft.needsRating,
  }
  if (draft.html) return { ...common, html: draft.body, text: null }
  const escaped = draft.body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return { ...common, html: `<div style="${PLAIN_STYLE}">${escaped}</div>`, text: draft.body }
}

/**
 * Stored messages → editable steps. Always `stepCount` entries, so a template
 * that stops at the initial email can grow a follow-up without a special case.
 */
export function stepsFromMessages(messages: TemplateMessage[], stepCount: number, bands: boolean): Step[] {
  return Array.from({ length: stepCount }, (_, followup) => {
    const message = messages.find((m) => m.followup === followup)
    if (!message?.variants.length) return emptyStep(bands)
    return {
      variants: message.variants.map((v) => {
        // Plain text is recognised by the wrapper it was stored in, and only
        // when its own text/plain twin is there to edit.
        const plain = typeof v.text === 'string' && PLAIN_WRAPPER.test(v.html)
        return {
          subject: v.subject,
          preheader: v.preheader ?? '',
          body: plain ? (v.text as string) : v.html,
          html: !plain,
          band: v.band ?? null,
          needsRating: Boolean(v.needs_rating),
        }
      }),
    }
  })
}

/** Editable steps → stored messages. A step with no words sends nothing. */
export function messagesFromSteps(steps: Step[]): TemplateMessage[] {
  return steps
    .map((s, followup) => ({ followup, variants: s.variants.filter(filled).map(textOrHtml) }))
    .filter((m) => m.variants.length)
}

/**
 * Stored messages in the shape the editor would save them back as — the only
 * fair way to ask "did anything change?". Comparing raw documents would flag
 * every language as edited the moment a template is opened, and saving would
 * then rewrite copy nobody touched.
 */
export function canonicalMessages(messages: TemplateMessage[], stepCount: number): string {
  return JSON.stringify(messagesFromSteps(stepsFromMessages(messages, stepCount, false)))
}
