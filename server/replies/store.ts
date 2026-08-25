import { Types } from 'mongoose'
import { EmailSend } from '../tracking/models'
import { InboundReply } from './models'
import type { InboundReplyKind } from './classify'

export type ReplySummaryRow = {
  kind: InboundReplyKind
  received_at: Date
  read_at?: Date | null
}

export function buildReplySummary(rows: readonly ReplySummaryRow[], syncedAt: Date) {
  const human = rows.filter((row) => row.kind === 'human')
  const dates = human.map((row) => new Date(row.received_at)).sort((a, b) => a.getTime() - b.getTime())
  return {
    matched: human.length > 0,
    event_count: human.length,
    automatic_count: rows.filter((row) => row.kind === 'automatic').length,
    first_observed_at: dates[0] ?? null,
    last_observed_at: dates.at(-1) ?? null,
    unread_count: human.filter((row) => !row.read_at).length,
    synced_at: syncedAt,
  }
}

export type PersistInboundReplyInput = {
  providerEmailId: string
  messageId?: string | null
  emailSendId?: string | null
  placeId?: string | null
  fromEmail: string
  fromName?: string | null
  toEmail: string
  subject: string
  preview: string
  kind: InboundReplyKind
  classificationReason?: string | null
  receivedAt: Date
}

export async function refreshReplySummary(emailSendId: string, syncedAt = new Date()): Promise<void> {
  if (!Types.ObjectId.isValid(emailSendId)) return
  const rows = await InboundReply.find(
    { email_send_id: emailSendId },
    { kind: 1, received_at: 1, read_at: 1 },
  ).lean()
  await EmailSend.updateOne(
    { _id: emailSendId },
    { $set: { reply_summary: buildReplySummary(rows as ReplySummaryRow[], syncedAt) } },
  )
}

export async function persistInboundReply(input: PersistInboundReplyInput): Promise<{ created: boolean }> {
  const result = await InboundReply.updateOne(
    { provider_email_id: input.providerEmailId },
    {
      $setOnInsert: {
        provider: 'resend',
        provider_email_id: input.providerEmailId,
        message_id: input.messageId ?? null,
        email_send_id: input.emailSendId && Types.ObjectId.isValid(input.emailSendId) ? input.emailSendId : null,
        place_id: input.placeId ?? null,
        from_email: input.fromEmail.toLowerCase(),
        from_name: input.fromName ?? null,
        to_email: input.toEmail.toLowerCase(),
        subject: input.subject,
        preview: input.preview,
        kind: input.kind,
        classification_reason: input.classificationReason ?? null,
        correlation: input.emailSendId ? 'exact' : 'unattributed',
        received_at: input.receivedAt,
      },
    },
    { upsert: true },
  )
  const created = result.upsertedCount > 0
  if (created && input.emailSendId) await refreshReplySummary(input.emailSendId)
  return { created }
}
