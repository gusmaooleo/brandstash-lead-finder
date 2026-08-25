/**
 * Outbound delivery. Two modes:
 *  - dry_run (default): renders + records everything, sends nothing
 *    (delivery.state = 'sent_dry_run').
 *  - live (delivery mode smtp|resend): delivered by that transport — one shared
 *    contract (see provider.ts).
 *
 * Every email comes from a template in the database (email/template-store.ts).
 * There is no copy in this codebase and no fallback pitch: with an empty
 * library the app refuses to render rather than inventing words, and the UI
 * says so instead of offering a send button that cannot work.
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
import { resolveTemplate, type ResolvedTemplate } from './template-store'
import { renderCustomMessage, type TemplateCategory } from './template-render'
import { resolveFindings } from './findings'
import { pickVariantIndex } from './variants'
import { createPreviewLandingUrl, createTrackedLandingUrl, templateIdFor } from '../tracking/landing-url'
import type { EmailLanguage } from '../../shared/types'
import type { PlaceProfileSummary } from '../scoring/types'
import type { RulesAnalysisResult } from '../scoring/analyze'
import { variantFingerprint } from '../tracking/experiment'

export async function isSuppressed(email: string): Promise<boolean> {
  return Boolean(await Suppression.exists({ email: email.toLowerCase() }))
}

export function buildUnsubscribeUrl(token: string): string {
  return `${settings().email.unsubscribeBaseUrl}/unsubscribe?t=${token}`
}

/** Nothing to send with — never a silent fallback to someone else's words. */
export class NoTemplateError extends Error {
  constructor(readonly language: string) {
    super(`No active email template matches this lead (language: ${language}). Create one in Settings → Templates.`)
  }
}

export type OutreachOptions = {
  /** 0 = initial (default), 1..5 = follow-ups. */
  followupNumber?: number
  /** Variants already sent to this lead — the pick avoids them. */
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
  /**
   * The template this send must use (email/template-store.ts). Resolved once
   * per send by beginTrackedSend so the tracked template_id and the rendered
   * email can never disagree.
   */
  template?: ResolvedTemplate
  /**
   * A one-off email written for THIS lead and not saved to the library. Same
   * tokens, same compliance, no template document.
   */
  oneOff?: { subject: string; html: string; text?: string | null } | null
}

export type RenderedOutreach = {
  subject: string
  html: string
  /** text/plain alternative. */
  text: string | null
  /** Which angle of the message was drawn — recorded per send. */
  variant: number
  followupNumber: number
  /** The template's audience label — recorded so analytics can compare pitches. */
  audience: string
  /** Analytics id of the template that produced this email. */
  templateId: string
  /** Human-readable template name, for the preview UI. */
  templateName: string
  templateKey: string
  variantFingerprint: string
  variantBand: string | null
}

export type RenderableLead = Pick<
  LeadDoc,
  'place_id' | 'name' | 'city_label' | 'google_rating' | 'review_count' | 'score'
> & {
  category?: string | null
  discovery?: { query?: string | null; search_category?: string | null } | null
}

const ONE_OFF_ID = 'one_off'

export function renderForLead(
  lead: RenderableLead,
  scoring: RulesAnalysisResult,
  summary: PlaceProfileSummary | null,
  language: EmailLanguage,
  unsubscribeToken: string,
  opts: OutreachOptions = {},
): RenderedOutreach {
  const sender = { name: settings().email.from.name, email: settings().email.from.email || 'sender@example.invalid' }
  const offer = settings().offer
  const unsubscribeUrl = buildUnsubscribeUrl(unsubscribeToken)
  const followupNumber = opts.followupNumber ?? 0
  const template = opts.template ?? null

  const message = template?.messages.find((m) => m.followup === followupNumber) ?? null
  if (!opts.oneOff && !message?.variants.length) throw new NoTemplateError(language)

  // The angle must be known BEFORE rendering: the tracked landing URL carries
  // it in utm_content, so the link and the copy can never disagree.
  const variants = message?.variants ?? []
  const variant = opts.oneOff
    ? 0
    : Math.max(
        0,
        pickVariantIndex(variants, {
          placeId: lead.place_id,
          rating: lead.google_rating ?? null,
          useBands: Boolean(template?.lowScoreVariants),
          used: opts.usedVariants ?? [],
        }),
      )

  const templateId = opts.oneOff ? ONE_OFF_ID : templateIdFor(template!.id, followupNumber)
  const templateKey = opts.oneOff ? ONE_OFF_ID : template!.id
  const selectedVariant = opts.oneOff
    ? { ...opts.oneOff, preheader: '', band: null, needs_rating: false }
    : variants[variant]

  // One rid per send: every landing link in this email shares it. A preview
  // gets the same link without the tracking contract (see landing-url.ts).
  const linkInput = {
    language,
    campaign: opts.campaign ?? 'leadfinder_unknown',
    templateId,
    variantId: `v${variant + 1}`,
    attemptNumber: followupNumber + 1,
  }
  const landingUrl = opts.rid
    ? createTrackedLandingUrl({ ...linkInput, rid: opts.rid })
    : opts.preview
      ? createPreviewLandingUrl(linkInput)
      : null

  const profileSummary = summary ?? {
    photos_count: 0,
    has_hours: false,
    editorial_summary: null,
    total_ratings: lead.review_count ?? null,
  }
  const findings = resolveFindings(template?.findings, profileSummary, variant)

  const rendered = renderCustomMessage(
    selectedVariant,
    {
      businessName: lead.name,
      city: lead.city_label.split(',')[0].trim(),
      cityLabel: lead.city_label,
      siteLabel: offer.siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      rating: lead.google_rating ?? null,
      reviewCount: lead.review_count ?? null,
      score: lead.score,
      finding1: findings[0] ?? '',
      finding2: findings[1] ?? null,
      senderName: sender.name,
      senderEmail: sender.email,
      brandName: offer.brandName,
      unsubscribeUrl,
      landingUrl,
      assets: [...(template?.assets ?? []), offer.logoUrl].filter(Boolean),
      categories: scoring.categories.map(
        (c): TemplateCategory => ({
          key: c.category,
          label: c.label,
          status: c.status,
          score: c.score,
          recommendation: c.recommendation,
        }),
      ),
      strings: template?.strings ?? {},
      profile: {
        photosCount: summary?.photos_count ?? null,
        hasHours: summary?.has_hours ?? null,
        address: summary?.address ?? null,
        phone: summary?.phone ?? null,
        website: summary?.website ?? null,
        category: lead.category ?? null,
      },
      language,
    },
    { footerHtml: settings().email.footerHtml },
  )

  return {
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    variant,
    followupNumber,
    audience: template?.audience ?? 'custom',
    templateId,
    templateName: opts.oneOff ? 'One-off email' : (template?.name ?? ''),
    templateKey,
    variantFingerprint: variantFingerprint({ templateKey, language, followup: followupNumber, variant: selectedVariant }),
    variantBand: selectedVariant.band ?? null,
  }
}

export type SendOutcome = {
  ok: boolean
  state: 'sent' | 'sent_dry_run' | 'failed'
  messageId: string | null
  error: string | null
  subject: string
  subjectVariant: number
  followupNumber: number
  unsubscribeToken: string
  audience: string
  templateId: string
  templateName: string
  templateKey: string
  variantFingerprint: string
  variantBand: string | null
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
    (opts.oneOff
      ? undefined
      : ((await resolveTemplate(lead, { language, followupNumber: opts.followupNumber ?? 0 })) ?? undefined))
  const rendered = renderForLead(lead, scoring, summary, language, token, { ...opts, template })

  const base = {
    subject: rendered.subject,
    subjectVariant: rendered.variant,
    followupNumber: rendered.followupNumber,
    unsubscribeToken: token,
    audience: rendered.audience,
    templateId: rendered.templateId,
    templateName: rendered.templateName,
    templateKey: rendered.templateKey,
    variantFingerprint: rendered.variantFingerprint,
    variantBand: rendered.variantBand,
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
