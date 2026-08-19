/**
 * Integration test of the cold-email tracking loop — ISOLATED test database
 * (brandstash_leads_tracking_it on the local Mongo), dry-run email mode.
 * Never touches Atlas or the real local data.
 *
 * Run from brandstash-lead-finder/ with `pnpm test:tracking`: the isolated
 * database starts with the default settings (dry run, no credentials, no
 * landing URI), which is exactly what this run needs — asserted before
 * anything is "sent".
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
import { config } from '../server/config'
import { AnalysisData, Approved } from '../server/leads/models'
import { EmailSend, getTrackingState } from '../server/tracking/models'
import { beginTrackedSend, completeTrackedSend } from '../server/tracking/send-log'
import { sendLeadEmail, renderForLead } from '../server/email/sender'
import { syncLandingVisits } from '../server/tracking/sync'
import { overviewMetrics, type SendRow } from '../server/tracking/metrics'
import { analyzePlaceProfile } from '../server/scoring/analyze'
import type { PlaceProfileSummary } from '../server/scoring/types'
import type { LeadDoc } from '../server/leads/models'
import { loadSettings, settings, updateSettings } from '../server/settings/settings'
import { invalidateTemplates, resolveTemplate } from '../server/email/template-store'
import { EmailTemplate } from '../server/email/template-models'

const summary: PlaceProfileSummary = {
  name: 'Padaria IT Central', address: 'Rua Teste, 1', phone: '+55 71 3333-3333',
  website: 'https://padaria-it.example', rating: 4.4, total_ratings: 55, has_hours: false,
  hours_text: null, photos_count: 1, reviews_count: 0, reviews_sample: [], types: ['bakery'],
  editorial_summary: null, business_status: 'OPERATIONAL',
}

async function main() {
  assert.match(config.mongodbUri, /tracking_it/, 'refusing to run outside the isolated test db')
  await mongoose.connect(config.mongodbUri)
  await mongoose.connection.dropDatabase()
  // Settings live in the database now; the fresh isolated one has none, so
  // this loads the defaults (dry run, no credentials) — exactly what the
  // integration run needs, and asserted before anything is "sent".
  await loadSettings()
  assert.equal(settings().email.mode, 'dry_run', 'refusing to run with a live transport')
  // The "landing store" for this run is the isolated database itself — the
  // same local-dev fallback the app uses when no landing URI is configured.
  await updateSettings({
    landing: { db_name: mongoose.connection.name },
    // Tracked links point at the operator's own site; with none configured an
    // email ships without a landing link at all.
    offer: { site_url: 'https://acme.example', brand_name: 'Acme' },
  })
  // A library with one template: this run sends what a real install sends.
  await EmailTemplate.create({
    name: 'IT generic',
    audience: 'business',
    categories: [],
    languages: {
      pt: {
        findings: { no_hours: 'não tem horário cadastrado', few_photos: 'só {{count}} fotos' },
        messages: [0, 1, 2].map((followup) => ({
          followup,
          variants: [
            {
              subject: `passo ${followup} — {{business_name}}`,
              html: `<p>{{finding_1}} <a href="{{landing_url}}">{{brand_name}}</a></p>`,
              text: `{{finding_1}}\n{{landing_url}}`,
            },
          ],
        })),
      },
    },
  })
  invalidateTemplates()
  console.log('[it] connected to isolated db')

  const scoring = analyzePlaceProfile(summary)
  const analysis = await AnalysisData.create({ place_id: 'it-place-1', summary, scoring })
  const lead = (await Approved.create({
    place_id: 'it-place-1', analysis_id: analysis._id, name: 'Padaria IT Central',
    city_label: 'Salvador, Brazil', country: 'BR', language: 'pt', market_scope: 'portuguese',
    score: scoring.overallScore, status: 'approved', approved_at: new Date(),
    contact: { emails: [{ address: 'contato@padaria-it.example', source_url: 'manual', generic: true }], selected_email: 'contato@padaria-it.example' },
    discovery: { query: 'it', city_label: 'Salvador, Brazil', discovered_at: new Date() },
  })) as LeadDoc

  // Legacy lead (pre-tracking) — should be backfilled as "untracked".
  const legacyAnalysis = await AnalysisData.create({ place_id: 'it-legacy-1', summary, scoring })
  await Approved.create({
    place_id: 'it-legacy-1', analysis_id: legacyAnalysis._id, name: 'Legacy Biz',
    city_label: 'Porto, Portugal', country: 'PT', language: 'pt', market_scope: 'portuguese',
    score: 5, status: 'approved', approved_at: new Date('2026-08-01T12:00:00Z'),
    contact: { emails: [], selected_email: 'old@legacy.example' },
    delivery: { state: 'sent', sent_at: new Date('2026-08-01T12:00:00Z'), followup: 0 },
    outreach: { count: 1, last_sent_at: new Date('2026-08-01T12:00:00Z'), variants: [1] },
    discovery: { query: 'it', city_label: 'Porto, Portugal', discovered_at: new Date('2026-07-30T12:00:00Z') },
  })

  /* 1–2: initial tracked send (dry-run) */
  const t1 = await beginTrackedSend({ lead, recipient: 'contato@padaria-it.example', followupNumber: 0 })
  const rendered = renderForLead(lead, scoring, summary, 'pt', 'tok', {
    followupNumber: 0, rid: t1.rid, campaign: t1.campaign, template: t1.template ?? undefined,
  })
  assert.ok(rendered.html.includes(`rid=${t1.rid}`), 'HTML carries the rid')
  assert.ok(rendered.text?.includes(`rid=${t1.rid}`), 'plain text carries the rid')
  assert.ok(rendered.html.includes('utm_source=cold_email') && rendered.html.includes('utm_term=attempt_1'))
  const outcome1 = await sendLeadEmail(lead, scoring, summary, 'contato@padaria-it.example', {
    followupNumber: 0, rid: t1.rid, campaign: t1.campaign, template: t1.template ?? undefined,
  })
  assert.equal(outcome1.state, 'sent_dry_run')
  await completeTrackedSend(t1.sendId, outcome1)

  /* Persisted record: hash only, never the raw rid */
  const doc1 = await EmailSend.findById(t1.sendId).lean()
  assert.ok(doc1, 'send record exists')
  const expectedHash = createHash('sha256').update(t1.rid, 'utf8').digest('hex')
  assert.equal(doc1!.tracking_id_hash, expectedHash, 'stored hash === sha256(rid)')
  assert.ok(!JSON.stringify(doc1).includes(t1.rid), 'raw rid never persisted')
  assert.equal(doc1!.status, 'sent_dry_run')
  console.log('[it] send 1 tracked: hash persisted, rid only in the email ✓')

  /* Second send to the SAME lead (follow-up) — new rid/hash, no visit */
  const t2 = await beginTrackedSend({ lead, recipient: 'contato@padaria-it.example', followupNumber: 1 })
  assert.notEqual(t2.rid, t1.rid)
  const outcome2 = await sendLeadEmail(lead, scoring, summary, 'contato@padaria-it.example', {
    followupNumber: 1, usedVariants: [outcome1.subjectVariant], rid: t2.rid, campaign: t2.campaign,
  })
  await completeTrackedSend(t2.sendId, outcome2)
  const doc2 = await EmailSend.findById(t2.sendId).lean()
  assert.notEqual(doc2!.tracking_id_hash, doc1!.tracking_id_hash, 'follow-up gets its own hash')

  /* 5: simulate the landing writing a consented visit event for send 1 */
  const events = mongoose.connection.db!.collection('landing_visit_events')
  const mkEvent = (key: string, first: string, last: string) => ({
    schemaVersion: 1, eventType: 'landing_visit', eventKey: key,
    trackingIdHash: expectedHash,
    attribution: {
      source: 'cold_email', medium: 'email', campaign: t1.campaign, term: 'attempt_1',
      content: 'note_v1', landingPath: '/pt?utm_source=cold_email', referrer: null,
      capturedAt: first,
    },
    visitorId: 'anon-uuid-1', isNewVisitor: true, lang: 'pt', userAgent: 'it-test',
    windowStartedAt: new Date(first), firstObservedAt: new Date(first), lastObservedAt: new Date(last),
    expiresAt: new Date(Date.now() + 180 * 86_400_000),
  })
  await events.insertOne(mkEvent('evt-1', '2026-08-17T10:00:00.000Z', '2026-08-17T10:12:00.000Z'))

  /* 6: reconcile */
  const sync1 = await syncLandingVisits()
  assert.equal(sync1.ok, true)
  assert.equal(sync1.matched_sends, 1, 'exactly ONE send matched')
  assert.ok(sync1.backfilled_rows >= 1, 'legacy send backfilled as untracked')

  const after1 = await EmailSend.findById(t1.sendId).lean()
  const after2 = await EmailSend.findById(t2.sendId).lean()
  assert.equal(after1!.landing_visit.matched, true)
  assert.equal(after1!.landing_visit.event_count, 1)
  assert.equal(after2!.landing_visit.matched, false, "second send did NOT inherit the first send's visit")
  console.log('[it] sync 1: visit matched to send 1 only ✓')

  /* idempotency + a second session event */
  const syncRepeat = await syncLandingVisits()
  assert.equal(syncRepeat.ok, true)
  assert.equal((await EmailSend.findById(t1.sendId).lean())!.landing_visit.event_count, 1, 're-sync did not duplicate')

  await events.insertOne(mkEvent('evt-2', '2026-08-17T11:30:00.000Z', '2026-08-17T11:40:00.000Z'))
  await syncLandingVisits()
  const after3 = await EmailSend.findById(t1.sendId).lean()
  assert.equal(after3!.landing_visit.event_count, 2, 'second session counted as event, not as new visited send')
  assert.equal(after3!.landing_visit.first_observed_at!.toISOString(), '2026-08-17T10:00:00.000Z')
  assert.equal(after3!.landing_visit.last_observed_at!.toISOString(), '2026-08-17T11:40:00.000Z')

  /* dashboard math on the real rows */
  const rows = (await EmailSend.find().lean()) as unknown as SendRow[]
  const m = overviewMetrics(rows)
  assert.equal(m.emails_sent, 3) // send1 + send2 + backfilled legacy
  assert.equal(m.visited_sends, 1) // one send visited, despite 2 events
  assert.equal(m.consented_sessions, 2)
  assert.equal(m.unique_visited_leads, 1)
  assert.equal(m.untracked_sends, 1)
  console.log('[it] metrics: visited=1, sessions=2, untracked=1 ✓')

  /* Atlas failure ≠ "no visit": inject a failing fetcher */
  const failed = await syncLandingVisits(async () => {
    throw new Error('connection refused mongodb+srv://user:secret@cluster.mongodb.net')
  })
  assert.equal(failed.ok, false)
  assert.ok(!failed.error!.includes('secret'), 'error is sanitized')
  const state = await getTrackingState()
  assert.equal(state.last_sync_ok, false)
  const untouched = await EmailSend.findById(t1.sendId).lean()
  assert.equal(untouched!.landing_visit.event_count, 2, 'failed sync left summaries untouched')
  const recovered = await syncLandingVisits()
  assert.equal(recovered.ok, true)
  assert.equal((await getTrackingState()).last_sync_ok, true)
  console.log('[it] Atlas failure: separate error state, summaries preserved, recovery ok ✓')

  /* a cold-email visit that belongs to no send of ours (e.g. a preview click) */
  await events.insertOne(mkEvent('evt-orphan', '2026-08-18T09:00:00.000Z', '2026-08-18T09:01:00.000Z'))
  await events.updateOne({ eventKey: 'evt-orphan' }, { $set: { trackingIdHash: 'f'.repeat(64) } })
  const withOrphan = await syncLandingVisits()
  assert.equal(withOrphan.ok, true)
  assert.equal(withOrphan.matched_sends, 1, 'an orphan event never matches a send')
  assert.equal(withOrphan.unattributed_events, 1, 'the orphan is reported, not silently dropped')
  assert.equal((await getTrackingState()).last_sync_unattributed, 1)
  console.log('[it] unattributed cold-email visit reported separately ✓')

  /* resolution: a category-bound template beats the generic one */
  const agencyLead = { discovery: { search_category: 'Video production service' } }
  assert.equal((await resolveTemplate(agencyLead, { language: 'pt' }))?.name, 'IT generic', 'generic serves everyone')

  const bound = await EmailTemplate.create({
    name: 'IT agencies',
    audience: 'agency',
    categories: ['Video production service'],
    languages: { pt: { messages: [{ followup: 0, variants: [{ subject: 'agências', html: '<p>oi</p>' }] }] } },
  })
  invalidateTemplates()
  assert.equal((await resolveTemplate(agencyLead, { language: 'pt' }))?.name, 'IT agencies', 'the bound one wins')
  assert.equal(
    (await resolveTemplate({ discovery: { search_category: 'Bakery' } }, { language: 'pt' }))?.name,
    'IT generic',
    'a lead outside the list still gets the generic template',
  )

  // The bound template has no follow-up copy: a step without words is never
  // chosen, so a follow-up can never go out empty.
  assert.equal(
    (await resolveTemplate(agencyLead, { language: 'pt', followupNumber: 1 }))?.name,
    'IT generic',
    'a step with no copy falls through to a template that has it',
  )

  await EmailTemplate.deleteMany({})
  invalidateTemplates()
  assert.equal(await resolveTemplate(agencyLead, { language: 'pt' }), null, 'an empty library resolves to nothing')
  console.log('[it] template resolution: bound beats generic, empty library resolves to nothing ✓')
  void bound

  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  console.log('[it] ALL INTEGRATION CHECKS PASSED — test db dropped')
  process.exit(0)
}

main().catch((err) => {
  console.error('[it] FAILED:', err)
  process.exit(1)
})
