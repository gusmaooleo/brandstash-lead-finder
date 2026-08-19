/**
 * Seeds a DEMO database with realistic fake email_sends + sync state so the
 * /email-analytics dashboard can be previewed without sending anything.
 * Guarded: refuses to run unless the target database name contains "_demo".
 *
 *   MONGODB_URI=mongodb://localhost:27018/brandstash_leads_demo \
 *   pnpm exec tsx scripts/seed-demo-analytics.ts
 */

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import mongoose from 'mongoose'
import { config } from '../server/config'
import { EmailSend, TrackingState } from '../server/tracking/models'
import { hashRid } from '../server/tracking/rid'

const NAMES = [
  ['Padaria Central', 'contato@padaria-central.example', 'pt', 'portuguese'],
  ['Belcar Automóveis', 'atendimento@belcar.example', 'pt', 'portuguese'],
  ['Ótica Vista Alegre', 'contato@otica-vista-alegre.example', 'pt', 'portuguese'],
  ['Boulangerie du Marais', 'bonjour@boulangerie-marais.example', 'fr', 'france'],
  ['Le Petit Bistro', 'contact@petit-bistro.example', 'fr', 'france'],
  ['Clínica Sorriso', 'recepcao@clinica-sorriso.example', 'pt', 'portuguese'],
  ['Auto Escola Rota 66', 'faleconosco@auto-escola.example', 'pt', 'portuguese'],
  ['Fleuriste Belleville', 'info@fleuriste-belleville.example', 'fr', 'france'],
] as const

async function main() {
  assert.match(config.mongodbUri, /_demo/, 'refusing: demo seeder only runs on a *_demo database')
  await mongoose.connect(config.mongodbUri)
  await mongoose.connection.dropDatabase()

  const now = Date.now()
  const DAY = 86_400_000
  const rows: Array<Record<string, unknown>> = []
  let seq = 0
  for (let day = 20; day >= 0; day--) {
    const sendsToday = 1 + ((day * 7) % 3)
    for (let k = 0; k < sendsToday; k++) {
      const [name, email, lang, market] = NAMES[seq % NAMES.length]
      const attempt = 1 + (seq % 7 === 0 ? 1 : 0) + (seq % 11 === 0 ? 1 : 0)
      const style = seq % 6 === 5 && attempt === 1 ? 'dashboard' : 'note'
      const variant = seq % 3
      const failed = seq % 13 === 12
      const visited = !failed && seq % 3 === 0
      const sentAt = new Date(now - day * DAY - (k * 3 + 9) * 3_600_000)
      const sessions = visited ? 1 + (seq % 7 === 0 ? 2 : seq % 2) : 0
      rows.push({
        place_id: `demo-${seq}`,
        lead_name: name,
        recipient: email,
        language: lang,
        market_scope: market,
        campaign: `leadfinder_${market}`,
        style,
        template_id:
          style === 'dashboard'
            ? `dashboard_v${variant + 1}`
            : attempt > 1
              ? `note_followup_${attempt - 1}_v${variant + 1}`
              : `note_v${variant + 1}`,
        variant,
        followup: attempt - 1,
        attempt,
        status: failed ? 'failed' : 'sent',
        sent_at: failed ? null : sentAt,
        message_id: failed ? null : `<demo-${seq}@mail.gmail.com>`,
        error: failed ? 'SMTP 421 service unavailable (demo)' : null,
        tracking_schema_version: 1,
        tracking_id_hash: hashRid(randomBytes(24).toString('base64url')),
        created_at: sentAt,
        landing_visit: {
          matched: visited,
          event_count: sessions,
          first_observed_at: visited ? new Date(sentAt.getTime() + (2 + (seq % 20)) * 3_600_000) : null,
          last_observed_at: visited ? new Date(sentAt.getTime() + (5 + (seq % 30)) * 3_600_000) : null,
          synced_at: new Date(now - 15 * 60_000),
        },
      })
      seq++
    }
  }
  // A couple of legacy untracked sends + one queued.
  rows.push({
    place_id: 'demo-legacy', lead_name: 'Legacy Barbearia', recipient: 'oi@legacy.com.br',
    language: 'pt', market_scope: 'portuguese', campaign: 'leadfinder_portuguese',
    style: 'note', template_id: 'note', variant: null, followup: 0, attempt: 1,
    status: 'sent', sent_at: new Date(now - 18 * DAY), backfilled: true,
    tracking_schema_version: 1, tracking_id_hash: null,
    landing_visit: { matched: false, event_count: 0, first_observed_at: null, last_observed_at: null, synced_at: null },
  })
  await EmailSend.insertMany(rows)
  await TrackingState.create({
    _id: 'state', last_synced_at: new Date(now - 15 * 60_000), last_sync_ok: true,
    last_sync_error: null, last_sync_sends: rows.length - 1, last_sync_events: 40,
  })
  console.log(`[demo] seeded ${rows.length} sends into ${mongoose.connection.name}`)
  await mongoose.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
