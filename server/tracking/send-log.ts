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

import type { LeadDoc } from '../leads/models'
import type { SendOutcome } from '../email/sender'
import { EmailSend } from './models'
import { generateRid, hashRid } from './rid'
import { campaignFor, templateIdFor } from './landing-url'
import { NoTemplateError } from '../email/sender'
import { resolveTemplate, type ResolvedTemplate } from '../email/template-store'
import { searchedCategory } from '../../shared/types'

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
  /** A one-off email: nothing in the library owns this send. */
  oneOff?: boolean
  recipient: string
  /** 0 = initial send, 1..5 = follow-ups. */
  followupNumber: number
}

/**
 * Pure record builder — exists so tests can prove the persisted document
 * contains ONLY the hash, never the raw rid.
 */
export function buildSendRecord(
  input: BeginTrackedSendInput,
  trackingIdHash: string,
  templateId?: string,
  template?: ResolvedTemplate | null,
): Record<string, unknown> {
  return {
    place_id: input.lead.place_id,
    lead_name: input.lead.name,
    recipient: input.recipient,
    language: input.lead.language,
    market_scope: input.lead.market_scope,
    campaign: campaignFor(String(input.lead.market_scope)),
    search_category: searchedCategory(input.lead),
    template_id: templateId ?? 'unresolved',
    template_key: template?.id ?? (input.oneOff ? 'one_off' : null),
    template_name: template?.name ?? (input.oneOff ? 'One-off email' : null),
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
  template: ResolvedTemplate | null
}

/**
 * Steps 1–3: rid → hash → persisted `queued` record (hash only). The template
 * is resolved HERE, once, so the recorded template_id and the email the lead
 * receives can never be two different templates.
 */
export async function beginTrackedSend(input: BeginTrackedSendInput): Promise<TrackedSend> {
  const rid = generateRid()
  const template = input.oneOff
    ? null
    : (input.template ??
      (await resolveTemplate(input.lead, {
        language: String(input.lead.language ?? 'en'),
        followupNumber: input.followupNumber,
        preferTemplateId: input.preferTemplateId ?? null,
      })))
  if (!template && !input.oneOff) throw new NoTemplateError(String(input.lead.language ?? 'en'))
  const templateId = template ? templateIdFor(template.id, input.followupNumber) : 'one_off'
  const record = buildSendRecord(input, hashRid(rid), templateId, template)
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
        template_key: outcome.templateKey,
        template_name: outcome.templateName,
        variant_fingerprint: outcome.variantFingerprint,
        variant_subject: outcome.subject,
        variant_band: outcome.variantBand,
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
    discovery?: { query?: string | null; search_category?: string | null } | null
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
      search_category: searchedCategory(lead),
      template_key: 'legacy',
      template_name: 'Legacy',
      backfilled: true,
      tracking_id_hash: null,
    }
    const rows: Array<Record<string, unknown>> = []
    for (let i = 0; i < count; i++) {
      const isLast = i === count - 1
      rows.push({
        ...base,
        // Sent before templates were tracked: there is no id to attribute to.
        template_id: 'legacy',
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
      const followup = Math.min(5, Math.max(0, lead.delivery?.followup ?? 0))
      rows.push({
        ...base,
        template_id: 'legacy',
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
