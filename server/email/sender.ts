/**
 * Outbound delivery. Two modes:
 *  - dry_run (default): renders + records everything, sends nothing
 *    (delivery.state = 'sent_dry_run').
 *  - live (delivery mode smtp|resend): delivered by that transport — one shared
 *    contract (see provider.ts).
 *
 * Safety: the suppression list is checked immediately before every send
 * (unsubscribed / do-not-contact addresses are never mailed), states are
 * explicit (not_sent → sent/sent_dry_run/failed), attempts are counted and a
 * failed send never auto-retries — retry is an explicit human action, so a
 * crash can never double-send.
 */

import { randomUUID } from 'node:crypto'
import { settings } from '../settings/settings'
import { getMailProvider } from './provider'
import { DeadRecipientError, isDeadAddress, isHardBounce, recordDeadAddress } from './dead-addresses'
import { checkMx } from '../enrichment/mx'
import { Suppression, type LeadDoc } from '../leads/models'
import { renderLeadEmail, pickSubject } from './render'
import { EMAIL_LOCALES } from './locales'
import { pickNoteVariant, renderNoteEmail } from './notes'
import { AGENCY_NOTE_PACKS } from './notes-agency'
import { audienceForLead, type OutreachAudience } from './audience'
import { resolveTemplate, type ResolvedTemplate } from './template-store'
import { renderCustomMessage } from './template-render'
import { buildFindings, NOTE_PACKS } from './notes'
import { createPreviewLandingUrl, createTrackedLandingUrl, templateIdFor } from '../tracking/landing-url'
import type { EmailLanguage, EmailStyle } from '../../shared/types'
import type { PlaceProfileSummary } from '../scoring/types'
import type { RulesAnalysisResult } from '../scoring/analyze'

export async function isSuppressed(email: string): Promise<boolean> {
  return Boolean(await Suppression.exists({ email: email.toLowerCase() }))
}

export function buildUnsubscribeUrl(token: string): string {
  return `${settings().email.unsubscribeBaseUrl}/unsubscribe?t=${token}`
}

export type OutreachOptions = {
  /** Defaults to the lead's chosen style; follow-ups are always notes. */
  style?: EmailStyle
  /** 0 = initial (default), 1 = bump, 2 = breakup. */
  followupNumber?: 0 | 1 | 2
  /** Note variants already sent to this lead — the pick avoids them. */
  usedVariants?: readonly number[]
  /**
   * Raw per-send tracking token (see server/tracking/rid.ts). When present,
   * every landing link in the rendered email carries it as `rid`. The raw
   * value lives only for the duration of the render/send — callers persist
   * ONLY its sha256 (beginTrackedSend) and never log it.
   */
  rid?: string | null
  /**
   * Rendering for a human to LOOK at, not for a recipient. The landing links
   * keep their shape but carry no rid and no cold_email source, so clicking
   * one in a preview never books a visit the analytics can't reconcile.
   */
  preview?: boolean
  /** Stable utm_campaign slug (campaignFor(lead.market_scope)). */
  campaign?: string
  /** Overrides the audience derived from the lead's category. */
  audience?: OutreachAudience
  /**
   * The template this send must use (email/template-store.ts). Resolved once
   * per send by beginTrackedSend so the tracked template_id and the rendered
   * email can never disagree; absent = fall back to the coded packs.
   */
  template?: ResolvedTemplate
}

export type RenderedOutreach = {
  subject: string
  html: string
  /** text/plain alternative — always present for notes. */
  text: string | null
  style: EmailStyle
  /** Note variant OR dashboard subject variant — recorded per send. */
  variant: number
  band: 'low' | 'high' | null
  followupNumber: number
  /** Which copy was used — recorded so analytics can compare the pitches. */
  audience: OutreachAudience
  /** Analytics id of the template that produced this email. */
  templateId: string
  /** Human-readable template name, for the preview UI. */
  templateName: string
}

export function renderForLead(
  lead: Pick<
    LeadDoc,
    'place_id' | 'name' | 'city_label' | 'google_rating' | 'review_count' | 'score'
  > & {
    /** Places primaryType + the searched catalog category — pick the copy. */
    category?: string | null
    discovery?: { query?: string | null; search_category?: string | null } | null
  },
  scoring: RulesAnalysisResult,
  summary: PlaceProfileSummary | null,
  language: EmailLanguage,
  unsubscribeToken: string,
  opts: OutreachOptions = {},
): RenderedOutreach {
  const sender = { name: settings().email.from.name, email: settings().email.from.email || 'sender@example.invalid' }
  const offer = settings().offer
  const brand = {
    name: offer.brandName,
    logoUrl: offer.logoUrl,
    siteLabel: offer.siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
  }
  const unsubscribeUrl = buildUnsubscribeUrl(unsubscribeToken)
  const followupNumber = opts.followupNumber ?? 0
  // A marketing agency gets the multi-client pitch (notes-agency.ts), never
  // the "your profile is losing customers" one — and always as a note: the
  // dashboard format reports on the LEAD's own profile, which is not what an
  // agency is being sold.
  const template = opts.template
  const audience: OutreachAudience =
    opts.audience ??
    (template
      ? template.kind === 'builtin'
        ? template.audience
        : template.audience === 'agency'
          ? 'agency'
          : 'business'
      : audienceForLead(lead))
  const custom = template?.kind === 'custom' ? template : null
  // Follow-ups are always personal notes, regardless of the lead's style.
  const style: EmailStyle =
    custom || followupNumber > 0 || audience === 'agency'
      ? 'note'
      : template?.kind === 'builtin' && template.pack === 'dashboard'
        ? 'dashboard'
        : (opts.style ?? 'note')

  // The variant must be known BEFORE rendering so the tracked landing URL can
  // carry it in utm_content. Both picks are deterministic — identical to what
  // the renderers themselves compute.
  const variant =
    style === 'dashboard'
      ? pickSubject(EMAIL_LOCALES[language] ?? EMAIL_LOCALES.en, lead.place_id, lead.name, lead.google_rating ?? null).variant
      : pickNoteVariant(lead.place_id, opts.usedVariants ?? [])

  const templateId = custom
    ? `custom_${custom.id}${followupNumber > 0 ? `_followup_${followupNumber}` : ''}`
    : templateIdFor(style, followupNumber, audience)

  // One rid per send: every landing link in this email shares it. A preview
  // gets the same link without the tracking contract (see landing-url.ts).
  const linkInput = {
    language,
    campaign: opts.campaign ?? 'leadfinder_unknown',
    emailType: style,
    templateId,
    variantId: `v${variant + 1}`,
    attemptNumber: followupNumber + 1,
  }
  const landingUrl = opts.rid
    ? createTrackedLandingUrl({ ...linkInput, rid: opts.rid })
    : opts.preview
      ? createPreviewLandingUrl(linkInput)
      : null

  if (custom) {
    const message = custom.messages.find((m) => m.followup === followupNumber) ?? custom.messages[0]
    const pack = NOTE_PACKS[language] ?? NOTE_PACKS.en
    const findings = buildFindings(
      pack,
      summary ?? { photos_count: 0, has_hours: false, editorial_summary: null, total_ratings: lead.review_count ?? null },
    )
    const rendered = renderCustomMessage(
      message,
      {
        businessName: lead.name,
        city: lead.city_label.split(',')[0].trim(),
        rating: lead.google_rating ?? null,
        reviewCount: lead.review_count ?? null,
        score: lead.score,
        finding1: findings[0],
        finding2: findings[1] ?? null,
        senderName: sender.name,
        senderEmail: sender.email,
        unsubscribeUrl,
        landingUrl,
        assets: [offer.logoUrl].filter(Boolean),
      },
      language,
    )
    return {
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      style: 'note',
      variant: 0,
      band: null,
      followupNumber,
      audience,
      templateId,
      templateName: custom.name,
    }
  }

  if (style === 'dashboard') {
    const rendered = renderLeadEmail({
      placeId: lead.place_id,
      name: lead.name,
      cityLabel: lead.city_label,
      rating: lead.google_rating ?? null,
      reviewCount: lead.review_count ?? null,
      score: lead.score,
      categories: scoring.categories,
      language,
      sender,
      brand,
      unsubscribeUrl,
      landingUrl,
    })
    return {
      subject: rendered.subject,
      html: rendered.html,
      text: null,
      style,
      variant: rendered.subjectVariant,
      band: rendered.band,
      followupNumber,
      audience,
      templateId,
      templateName: template?.name ?? 'Business owners — dashboard report',
    }
  }

  const note = renderNoteEmail({
    placeId: lead.place_id,
    name: lead.name,
    cityLabel: lead.city_label,
    rating: lead.google_rating ?? null,
    reviewCount: lead.review_count ?? null,
    score: lead.score,
    summary: summary ?? { photos_count: 0, has_hours: false, editorial_summary: null, total_ratings: lead.review_count ?? null },
    language,
    sender,
    unsubscribeUrl,
    variant,
    followupNumber,
    landingUrl,
    pack: audience === 'agency' ? AGENCY_NOTE_PACKS[language] : undefined,
    brandName: brand.name,
  })
  return {
    subject: note.subject,
    html: note.html,
    text: note.text,
    style,
    variant: note.variant,
    band: null,
    followupNumber,
    audience,
    templateId,
    templateName: template?.name ?? (audience === 'agency' ? 'Marketing agencies — multi-client panel' : 'Business owners — personal note'),
  }
}

export type SendOutcome = {
  ok: boolean
  state: 'sent' | 'sent_dry_run' | 'failed'
  messageId: string | null
  error: string | null
  subject: string
  subjectVariant: number
  style: EmailStyle
  followupNumber: number
  unsubscribeToken: string
  audience: OutreachAudience
  templateId: string
}

/**
 * Renders and delivers one lead email (initial send or follow-up). Caller
 * persists the returned states. Throws only on suppression (callers must
 * surface that as a blocked approval).
 */
export async function sendLeadEmail(
  lead: LeadDoc,
  scoring: RulesAnalysisResult,
  summary: PlaceProfileSummary | null,
  recipient: string,
  opts: OutreachOptions = {},
): Promise<SendOutcome> {
  const to = recipient.trim().toLowerCase()
  if (await isSuppressed(to)) {
    throw new SuppressedRecipientError(to)
  }
  if (await isDeadAddress(to)) {
    throw new DeadRecipientError(to)
  }

  const token = lead.delivery?.unsubscribe_token ?? randomUUID()
  const language = (lead.language as EmailLanguage) ?? 'en'
  const template =
    opts.template ??
    (await resolveTemplate(lead, {
      language,
      style: opts.style ?? ((lead.email_style as EmailStyle) || 'note'),
      followupNumber: opts.followupNumber ?? 0,
    }))
  const rendered = renderForLead(lead, scoring, summary, language, token, { ...opts, template })

  const base = {
    subject: rendered.subject,
    subjectVariant: rendered.variant,
    style: rendered.style,
    followupNumber: rendered.followupNumber,
    unsubscribeToken: token,
    audience: rendered.audience,
    templateId: rendered.templateId,
  }

  if (settings().email.mode === 'dry_run') {
    return { ok: true, state: 'sent_dry_run', messageId: `dry-run-${token}`, error: null, ...base }
  }

  // MX pre-flight (cached DNS): a domain with no MX is a guaranteed bounce —
  // fail before touching the provider. 'unknown' (transient DNS) never blocks.
  const recipientDomain = to.split('@')[1] ?? ''
  if (recipientDomain && (await checkMx(recipientDomain)) === 'no_mx') {
    return {
      ok: false,
      state: 'failed',
      messageId: null,
      error: `recipient domain has no MX records: ${recipientDomain}`,
      ...base,
    }
  }

  try {
    const { messageId } = await getMailProvider().send({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: {
        'List-Unsubscribe': `<${buildUnsubscribeUrl(token)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      sendKey: `${token}-f${rendered.followupNumber}`,
    })
    return { ok: true, state: 'sent', messageId, error: null, ...base }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // SMTP path: a permanent 5xx "no such mailbox" dead-lists the address so
    // it is never offered or mailed again. (Resend bounces arrive async —
    // see bounce-sync.ts.)
    if (isHardBounce(message)) {
      await recordDeadAddress(to, 'hard_bounce', message).catch(() => {})
    }
    return { ok: false, state: 'failed', messageId: null, error: message, ...base }
  }
}

export class SuppressedRecipientError extends Error {
  constructor(readonly recipient: string) {
    super(`Recipient is on the suppression list: ${recipient}`)
  }
}
