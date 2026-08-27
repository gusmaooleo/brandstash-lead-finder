import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import mongoose from 'mongoose'
import { config } from '../server/config'
import { EmailSend, TrackingState } from '../server/tracking/models'
import { hashRid } from '../server/tracking/rid'
import { InboundReply } from '../server/replies/models'
import { buildReplySummary, type ReplySummaryRow } from '../server/replies/store'

const LEADS = [
  ['Padaria Central', 'contato@padaria-central.example', 'Bakery'],
  ['Pão Dourado', 'ola@pao-dourado.example', 'Bakery'],
  ['Clínica Sorriso', 'recepcao@clinica-sorriso.example', 'Dentist'],
  ['Odonto Bahia', 'contato@odontobahia.example', 'Dentist'],
  ['Belcar Automóveis', 'atendimento@belcar.example', 'Car dealer'],
  ['Auto Prime', 'vendas@autoprime.example', 'Car dealer'],
] as const

const SUBJECTS = [
  'uma ideia rápida para {{business_name}}',
  'notei algo no perfil da {{business_name}}',
  '{{business_name}} no Google',
] as const

const CATEGORY_REPLY_LIFT = [0.06, 0, -0.03]
const CATEGORY_VISIT_LIFT = [0.08, 0, -0.07]
const VARIANT_REPLY_RATE = [0.28, 0.15, 0.07]
const VARIANT_VISIT_RATE = [0.42, 0.55, 0.64]
const DAY = 86_400_000

const unit = (seed: number, salt: number) => ((seed * salt + salt * 13) % 997) / 997

async function main() {
  assert.match(config.mongodbUri, /_demo/, 'refusing: demo seeder only runs on a *_demo database')
  await mongoose.connect(config.mongodbUri)
  await mongoose.connection.dropDatabase()

  const now = Date.now()
  const syncedAt = new Date(now - 12 * 60_000)
  const sends: Array<Record<string, unknown>> = []
  const replies: Array<Record<string, unknown>> = []
  let seq = 0

  for (let day = 44; day >= 0; day--) {
    for (let slot = 0; slot < 4; slot++) {
      const [name, email, category] = LEADS[seq % LEADS.length]
      const categoryIndex = ['Bakery', 'Dentist', 'Car dealer'].indexOf(category)
      const variant = seq % 3
      const sentAt = new Date(now - day * DAY - (slot + 5) * 3_600_000)
      const failed = seq % 41 === 0
      const visited = !failed && unit(seq, 47) < VARIANT_VISIT_RATE[variant] + CATEGORY_VISIT_LIFT[categoryIndex]
      const replied = !failed && unit(seq, 83) < VARIANT_REPLY_RATE[variant] + CATEGORY_REPLY_LIFT[categoryIndex]
      const automatic = !failed && seq % 29 === 0
      const sessions = visited ? 1 + (seq % 9 === 0 ? 2 : seq % 4 === 0 ? 1 : 0) : 0
      const sendId = new mongoose.Types.ObjectId()
      const replyEvents: ReplySummaryRow[] = []
      const subject = SUBJECTS[variant].replace('{{business_name}}', name)

      if (replied) {
        const receivedAt = new Date(sentAt.getTime() + (2 + (seq % 7)) * 3_600_000)
        const readAt = day <= 4 ? null : new Date(receivedAt.getTime() + 35 * 60_000)
        replyEvents.push({ kind: 'human', received_at: receivedAt, read_at: readAt })
        replies.push({
          provider: 'resend',
          provider_email_id: `demo-human-${seq}-1`,
          message_id: `<demo-human-${seq}-1@reply.example>`,
          email_send_id: sendId,
          place_id: `demo-${seq}`,
          from_email: email,
          from_name: name,
          to_email: `inbox-${seq}@replies.brandstash.example`,
          subject: `Re: ${subject}`,
          preview: seq % 2 === 0
            ? 'Oi! Gostei da análise. Você pode me explicar como funcionaria e quais seriam os próximos passos?'
            : 'Obrigado pelo contato. Faz sentido para a gente — pode enviar mais detalhes e uma estimativa?',
          kind: 'human',
          classification_reason: null,
          correlation: 'exact',
          received_at: receivedAt,
          read_at: readAt,
        })
        if (seq % 53 === 0) {
          const followupAt = new Date(receivedAt.getTime() + 5 * 3_600_000)
          replyEvents.push({ kind: 'human', received_at: followupAt, read_at: readAt })
          replies.push({
            provider: 'resend',
            provider_email_id: `demo-human-${seq}-2`,
            message_id: `<demo-human-${seq}-2@reply.example>`,
            email_send_id: sendId,
            place_id: `demo-${seq}`,
            from_email: email,
            from_name: name,
            to_email: `inbox-${seq}@replies.brandstash.example`,
            subject: `Re: ${subject}`,
            preview: 'Pode ser amanhã às 10h? Se estiver bom para você, já deixo reservado aqui.',
            kind: 'human',
            classification_reason: null,
            correlation: 'exact',
            received_at: followupAt,
            read_at: readAt,
          })
        }
      }

      if (automatic) {
        const receivedAt = new Date(sentAt.getTime() + 5 * 60_000)
        replyEvents.push({ kind: 'automatic', received_at: receivedAt, read_at: null })
        replies.push({
          provider: 'resend',
          provider_email_id: `demo-automatic-${seq}`,
          message_id: `<demo-automatic-${seq}@reply.example>`,
          email_send_id: sendId,
          place_id: `demo-${seq}`,
          from_email: email,
          from_name: name,
          to_email: `inbox-${seq}@replies.brandstash.example`,
          subject: `Resposta automática: ${subject}`,
          preview: 'Recebemos sua mensagem e retornaremos assim que possível.',
          kind: 'automatic',
          classification_reason: 'auto-submitted',
          correlation: 'exact',
          received_at: receivedAt,
          read_at: null,
        })
      }

      sends.push({
        _id: sendId,
        place_id: `demo-${seq}`,
        lead_name: name,
        recipient: email,
        language: 'pt',
        market_scope: 'portuguese',
        campaign: 'leadfinder_portuguese',
        search_category: category,
        template_id: `note_v${variant + 1}`,
        template_key: 'note',
        template_name: 'Profile opportunity',
        variant,
        variant_fingerprint: createHash('sha256').update(`note:pt:0:${variant}:${SUBJECTS[variant]}`).digest('hex'),
        variant_subject: subject,
        variant_band: null,
        followup: 0,
        attempt: 1,
        status: failed ? 'failed' : 'sent',
        sent_at: failed ? null : sentAt,
        message_id: failed ? null : `<demo-${seq}@mail.example>`,
        error: failed ? 'SMTP 421 service unavailable (demo)' : null,
        provider_event: null,
        backfilled: false,
        tracking_schema_version: 1,
        tracking_id_hash: hashRid(randomBytes(24).toString('base64url')),
        reply_id_hash: hashRid(randomBytes(24).toString('base64url')),
        created_at: sentAt,
        landing_visit: {
          matched: visited,
          event_count: sessions,
          first_observed_at: visited ? new Date(sentAt.getTime() + (1 + (seq % 9)) * 3_600_000) : null,
          last_observed_at: visited ? new Date(sentAt.getTime() + (3 + (seq % 12)) * 3_600_000) : null,
          synced_at: syncedAt,
        },
        reply_summary: buildReplySummary(replyEvents, syncedAt),
      })
      seq++
    }
  }

  sends.push({
    place_id: 'demo-legacy',
    lead_name: 'Legacy Barbearia',
    recipient: 'oi@legacy.example',
    language: 'pt',
    market_scope: 'portuguese',
    campaign: 'leadfinder_portuguese',
    search_category: 'Barber shop',
    template_id: 'note',
    variant: null,
    followup: 0,
    attempt: 1,
    status: 'sent',
    sent_at: new Date(now - 18 * DAY),
    backfilled: true,
    tracking_schema_version: 1,
    tracking_id_hash: null,
    reply_id_hash: null,
    landing_visit: { matched: false, event_count: 0, first_observed_at: null, last_observed_at: null, synced_at: null },
    reply_summary: { matched: false, event_count: 0, automatic_count: 0, first_observed_at: null, last_observed_at: null, unread_count: 0, synced_at: null },
  })

  await EmailSend.insertMany(sends)
  await InboundReply.insertMany(replies)
  await TrackingState.create({
    _id: 'state',
    last_synced_at: syncedAt,
    last_sync_ok: true,
    last_sync_error: null,
    last_sync_sends: sends.length - 1,
    last_sync_events: sends.reduce((count, send) => count + Number((send.landing_visit as { event_count: number }).event_count), 0),
    last_sync_unattributed: 0,
    last_reply_synced_at: syncedAt,
    last_reply_sync_ok: true,
    last_reply_sync_error: null,
    last_reply_sync_checked: replies.length,
    last_reply_sync_created: replies.length,
    last_reply_sync_unattributed: 0,
  })
  console.log(`[demo] seeded ${sends.length} sends and ${replies.length} replies into ${mongoose.connection.name}`)
  await mongoose.disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
