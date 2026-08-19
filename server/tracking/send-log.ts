/**
 * Per-send tracking lifecycle around the email sender:
 *
 *   1. generate rid                (random, unique per SEND — never reused)
 *   2. hash it                     (sha256 hex)
 *   3. persist the send record     (hash only — BEFORE the provider is called)
 *   4. build + send the email      (raw rid goes into the landing URLs)
 *   5. update the record           (status, sent_at, provider message id)
 *   6. drop the raw rid            (function scope ends; it is never stored
 *                                   or logged anywhere)
 *
 * A provider failure keeps the record as `failed` for audit. Every retry and
 * every follow-up goes through begin() again → new record, new rid, new hash.
 */

import type { EmailStyle } from '../../shared/types'
import type { LeadDoc } from '../leads/models'
import type { SendOutcome } from '../email/sender'
import { EmailSend } from './models'
import { generateRid, hashRid } from './rid'
import { campaignFor, templateIdFor } from './landing-url'
import { audienceForLead } from '../email/audience'
import { resolveTemplate, type ResolvedTemplate } from '../email/template-store'

export type BeginTrackedSendInput = {
  lead: Pick<LeadDoc, 'place_id' | 'name' | 'language' | 'market_scope'> & {
    /** Category signals — decide which copy (audience) this send used. */
    category?: string | null
    discovery?: { query?: string | null; search_category?: string | null } | null
  }
  /** Resolved by begin() when absent; pass it to render the very same one. */
  template?: ResolvedTemplate
  /** Keeps a follow-up on the template that opened the sequence. */
  preferTemplateId?: string | null
  recipient: string
  style: EmailStyle
  followupNumber: 0 | 1 | 2
}

/**
 * Pure record builder — exists so tests can prove the persisted document
 * contains ONLY the hash, never the raw rid.
 */
export function buildSendRecord(
  input: BeginTrackedSendInput,
  trackingIdHash: string,
  templateId?: string,
): Record<string, unknown> {
  return {
    place_id: input.lead.place_id,
    lead_name: input.lead.name,
    recipient: input.recipient,
    language: input.lead.language,
    market_scope: input.lead.market_scope,
    campaign: campaignFor(String(input.lead.market_scope)),
    style: input.style,
    template_id: templateId ?? templateIdFor(input.style, input.followupNumber, audienceForLead(input.lead)),
    variant: null,
    followup: input.followupNumber,
    attempt: input.followupNumber + 1,
    status: 'queued',
    tracking_schema_version: 1,
    tracking_id_hash: trackingIdHash,
  }
}

export type TrackedSend = {
  /** Raw token — use it to build the email, then let it go out of scope. */
  rid: string
  sendId: string
  campaign: string
  /** The template this send is committed to — hand it to sendLeadEmail. */
  template: ResolvedTemplate
}

/**
 * Steps 1–3: rid → hash → persisted `queued` record (hash only). The template
 * is resolved HERE, once, so the recorded template_id and the email the lead
 * receives can never be two different templates.
 */
export async function beginTrackedSend(input: BeginTrackedSendInput): Promise<TrackedSend> {
  const rid = generateRid()
  const template =
    input.template ??
    (await resolveTemplate(input.lead, {
      language: String(input.lead.language ?? 'en'),
      style: input.style,
      followupNumber: input.followupNumber,
      preferTemplateId: input.preferTemplateId ?? null,
    }))
  const templateId =
    template.kind === 'custom'
      ? `custom_${template.id}${input.followupNumber > 0 ? `_followup_${input.followupNumber}` : ''}`
      : templateIdFor(input.style, input.followupNumber, template.audience)
  const record = buildSendRecord(input, hashRid(rid), templateId)
  const doc = await EmailSend.create(record)
  return { rid, sendId: String(doc._id), campaign: String(record.campaign), template }
}

/** Steps 5–6: reflect the provider outcome on the persisted record. */
export async function completeTrackedSend(sendId: string, outcome: SendOutcome): Promise<void> {
  const variantSuffix = `_v${outcome.subjectVariant + 1}`
  await EmailSend.updateOne(
    { _id: sendId },
    {
      $set: {
        status: outcome.state,
        sent_at: outcome.ok ? new Date() : null,
        message_id: outcome.messageId,
        error: outcome.error,
        variant: outcome.subjectVariant,
        template_id: outcome.templateId + variantSuffix,
      },
    },
  )
}

/** Send never reached the provider (e.g. suppressed recipient) — audit trail. */
export async function failTrackedSend(sendId: string, error: string): Promise<void> {
  await EmailSend.updateOne({ _id: sendId }, { $set: { status: 'failed', error } })
}

/**
 * One-time reconstruction of sends that happened BEFORE tracking existed, so
 * they stay visible in the dashboard (as "untracked" — hashes are never
 * invented retroactively). Uses what the lead docs actually know:
 * outreach.count successful sends (variant list, approval date for the first,
 * delivery.sent_at for the last) plus one failed row when the last delivery
 * failed. Idempotent: only leads with zero email_sends rows are considered.
 */
export async function backfillUntrackedSends(
  approvedLeans: ReadonlyArray<{
    place_id: string
    name: string
    language: string
    market_scope: string
    email_style?: string | null
    approved_at?: Date | null
    contact?: { selected_email?: string | null } | null
    delivery?: {
      state?: string | null
      sent_at?: Date | null
      style?: string | null
      followup?: number | null
      subject_variant?: number | null
      last_error?: string | null
    } | null
    outreach?: { count?: number; variants?: number[]; last_sent_at?: Date | null } | null
  }>,
): Promise<number> {
  let created = 0
  for (const lead of approvedLeans) {
    const count = lead.outreach?.count ?? 0
    const failed = lead.delivery?.state === 'failed'
    if (count === 0 && !failed) continue
    const already = await EmailSend.exists({ place_id: lead.place_id })
    if (already) continue

    const recipient = lead.contact?.selected_email ?? '—'
    const base = {
      place_id: lead.place_id,
      lead_name: lead.name,
      recipient,
      language: lead.language,
      market_scope: lead.market_scope,
      campaign: campaignFor(String(lead.market_scope)),
      backfilled: true,
      tracking_id_hash: null,
    }
    const rows: Array<Record<string, unknown>> = []
    for (let i = 0; i < count; i++) {
      const isLast = i === count - 1
      const style: EmailStyle = i > 0 ? 'note' : ((lead.delivery?.style as EmailStyle) ?? (lead.email_style as EmailStyle) ?? 'note')
      rows.push({
        ...base,
        style,
        template_id: templateIdFor(style, i),
        variant: lead.outreach?.variants?.[i] ?? null,
        followup: i,
        attempt: i + 1,
        // outreach.count only ever increments on successful sends.
        status: isLast && lead.delivery?.state === 'sent_dry_run' ? 'sent_dry_run' : 'sent',
        sent_at:
          i === 0
            ? (count === 1 ? (lead.delivery?.sent_at ?? lead.approved_at ?? null) : (lead.approved_at ?? null))
            : isLast
              ? (lead.outreach?.last_sent_at ?? lead.delivery?.sent_at ?? null)
              : null,
      })
    }
    if (failed) {
      const followup = Math.min(2, Math.max(0, lead.delivery?.followup ?? 0)) as 0 | 1 | 2
      const style: EmailStyle = (lead.delivery?.style as EmailStyle) ?? 'note'
      rows.push({
        ...base,
        style,
        template_id: templateIdFor(style, followup),
        variant: lead.delivery?.subject_variant ?? null,
        followup,
        attempt: followup + 1,
        status: 'failed',
        sent_at: null,
        error: lead.delivery?.last_error ?? null,
      })
    }
    if (rows.length) {
      await EmailSend.insertMany(rows)
      created += rows.length
    }
  }
  return created
}
