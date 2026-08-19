import { Router } from 'express'
import { Types } from 'mongoose'
import { settings } from '../settings/settings'
import {
  AnalysisData,
  ApprovalList,
  Approved,
  CategoryUsage,
  Suppression,
  getDiscoveryState,
  type LeadDoc,
} from '../leads/models'
import { discoveryStatus, queueCounts } from '../discovery/engine'
import { ALL_CATEGORIES } from '../discovery/categories'
import { MARKETS, scopedMarket } from '../markets/markets'
import { followupDueQuery, MAX_SENDS } from '../leads/followup'
import { renderForLead, sendLeadEmail, isSuppressed, SuppressedRecipientError } from '../email/sender'
import { DeadRecipientError } from '../email/dead-addresses'
import { beginTrackedSend, completeTrackedSend, failTrackedSend } from '../tracking/send-log'
import { campaignFor } from '../tracking/landing-url'
import type { EmailLanguage, EmailStyle, MarketScope } from '../../shared/types'
import type { PlaceProfileSummary } from '../scoring/types'
import type { RulesAnalysisResult } from '../scoring/analyze'

export const api = Router()

/* ── status & controls ────────────────────────────────────────────────── */

api.get('/status', async (_req, res) => {
  const { state, queueSize } = await discoveryStatus()
  const counts = await queueCounts()
  const categoriesExplored = await CategoryUsage.countDocuments({ uses: { $gte: 1 } })
  const selectedCountries = (state.selected_countries ?? []) as string[]
  const base = MARKETS[state.market_scope as MarketScope]
  // The pool the engine actually draws from — market narrowed to the picked
  // countries, so the header's city count matches what discovery will search.
  const market = base ? scopedMarket(base, selectedCountries) : undefined
  res.json({
    active: state.active,
    market_scope: state.market_scope,
    categories_total: ALL_CATEGORIES.length,
    cities_total: market ? market.countries.reduce((n, cc) => n + cc.cities.length, 0) : 0,
    test_city: state.test_city,
    leads_per_hour: settings().leadsPerHour,
    window_count: state.window.count,
    window_started_at: state.window.started_at,
    next_run_at: state.next_run_at,
    counters: state.counters,
    queue_size: queueSize,
    current_city: state.current_city,
    current_category: state.current_category,
    selected_categories: state.selected_categories ?? [],
    selected_countries: selectedCountries,
    categories_explored: categoriesExplored,
    last_error: state.last_error,
    email_mode: settings().email.mode,
    sender_name: settings().email.from.name,
    sender_email: settings().email.from.email || null,
    followup_after_days: settings().followupAfterDays,
    counts,
  })
})

api.get('/markets', (_req, res) => {
  res.json(
    Object.values(MARKETS).map((m) => ({
      scope: m.scope,
      label: m.label,
      countries: m.countries.map((cc) => ({
        code: cc.code,
        name: cc.name,
        language: cc.language,
        cities: cc.cities.length,
      })),
    })),
  )
})

api.post('/discovery/start', async (_req, res) => {
  const state = await getDiscoveryState()
  state.active = true
  state.last_error = null
  await state.save()
  res.json({ ok: true })
})

api.post('/discovery/stop', async (_req, res) => {
  const state = await getDiscoveryState()
  state.active = false
  await state.save()
  res.json({ ok: true })
})

/** The full searchable category catalog — feeds the header chips picker. */
api.get('/categories', (_req, res) => {
  res.json({ categories: ALL_CATEGORIES })
})

/**
 * Discovery config — market scope, the countries to search within it, the
 * optional fixed test city, and the optional category subset. Empty
 * selection = everything (all the market's countries / the whole catalog);
 * the election (discovery/election.ts) draws randomly within the pool either
 * way.
 */
api.put('/discovery/config', async (req, res) => {
  const { market_scope, test_city, selected_categories, selected_countries } = req.body as {
    market_scope?: MarketScope
    test_city?: string | null
    selected_categories?: string[]
    selected_countries?: string[]
  }
  const state = await getDiscoveryState()
  if (market_scope) {
    if (!MARKETS[market_scope]) return res.status(400).json({ error: 'unknown market_scope' })
    if (market_scope !== state.market_scope) {
      console.log(`[discovery] market scope: ${state.market_scope} → ${market_scope}`)
      state.market_scope = market_scope
      // The ticker must not keep showing the previous market's city. Note: a
      // batch already in flight still finishes its current page under the old
      // market; the very next tick draws from the new one.
      state.current_city = null
      state.current_category = null
      // Country codes belong to the market they were picked in — a new market
      // starts from "all countries" unless this same request picks its own.
      if (selected_countries === undefined) state.selected_countries = []
    }
  }
  if (selected_countries !== undefined) {
    if (!Array.isArray(selected_countries) || selected_countries.some((c) => typeof c !== 'string')) {
      return res.status(400).json({ error: 'selected_countries must be an array of ISO country codes' })
    }
    const codes = selected_countries.map((c) => c.trim().toUpperCase())
    const inMarket = new Set(MARKETS[state.market_scope as MarketScope].countries.map((cc) => cc.code))
    const outside = codes.find((c) => !inMarket.has(c))
    if (outside) return res.status(400).json({ error: `country ${outside} is not part of this market` })
    state.selected_countries = [...new Set(codes)]
  }
  if (test_city !== undefined && (test_city ? String(test_city).trim() : null) !== state.test_city) {
    state.test_city = test_city ? String(test_city).trim() : null
  }
  if (selected_categories !== undefined) {
    if (!Array.isArray(selected_categories) || selected_categories.some((c) => typeof c !== 'string')) {
      return res.status(400).json({ error: 'selected_categories must be an array of category names' })
    }
    const catalog = new Set(ALL_CATEGORIES)
    const unknown = selected_categories.find((c) => !catalog.has(c))
    if (unknown) return res.status(400).json({ error: `unknown category: ${unknown}` })
    state.selected_categories = [...new Set(selected_categories)]
  }
  await state.save()
  res.json({ ok: true })
})

/**
 * Points for the dashboard globe: every discovered lead (yellow) and every
 * sent lead (green). Approved-but-unsent stays 'discovered'. Newest first,
 * capped — at 10k+ scale the globe stays a sample of the freshest points.
 */
api.get('/globe/points', async (_req, res) => {
  const cap = 8000
  const fields = { location: 1, name: 1, score: 1, 'delivery.state': 1 }
  const [pending, approved] = await Promise.all([
    ApprovalList.find({ location: { $ne: null } }, fields).sort({ created_at: -1 }).limit(cap).lean(),
    Approved.find({ location: { $ne: null } }, fields).sort({ created_at: -1 }).limit(cap).lean(),
  ])
  const sentStates = new Set(['sent', 'sent_dry_run'])
  const toPoint = (d: (typeof pending)[number], kind: 'discovered' | 'sent') => ({
    id: String(d._id),
    lat: d.location!.lat,
    lng: d.location!.lng,
    kind,
    name: d.name,
    score: d.score,
  })
  res.json({
    points: [
      ...pending.map((d) => toPoint(d, 'discovered')),
      ...approved.map((d) =>
        toPoint(d, sentStates.has(d.delivery?.state ?? '') ? 'sent' : 'discovered'),
      ),
    ],
  })
})

/* ── leads ────────────────────────────────────────────────────────────── */

type LeadFilters = {
  status?: string
  country?: string
  language?: string
  category?: string
  score_min?: string
  score_max?: string
  rating_min?: string
  rating_max?: string
  has_email?: string
  date_from?: string
  date_to?: string
  q?: string
  sort?: string
  dir?: string
}

/** Sortable columns → stored fields ('emails' sorts by array size, see below). */
const SORT_FIELDS: Record<string, string> = {
  score: 'score',
  name: 'name',
  rating: 'google_rating',
  reviews: 'review_count',
  found: 'discovery.discovered_at',
}

/**
 * One page of leads, sorted in Mongo so the order spans the WHOLE result set,
 * not just the fetched page. 'emails' needs an aggregation ($size has no
 * find().sort() equivalent); 'name' gets a case-insensitive collation.
 */
async function sortedLeadPage(
  model: typeof ApprovalList | typeof Approved,
  q: Record<string, unknown>,
  f: LeadFilters,
  defaultSort: Record<string, 1 | -1>,
  page: number,
  pageSize: number,
): Promise<LeadDoc[]> {
  const dir: 1 | -1 = f.dir === 'asc' ? 1 : -1
  if (f.sort === 'emails') {
    return (await model.aggregate([
      { $match: q },
      { $addFields: { __emails: { $size: { $ifNull: ['$contact.emails', []] } } } },
      { $sort: { __emails: dir, created_at: -1, _id: 1 } },
      { $skip: (page - 1) * pageSize },
      { $limit: pageSize },
      { $project: { __emails: 0 } },
    ])) as unknown as LeadDoc[]
  }
  const field = f.sort ? SORT_FIELDS[f.sort] : undefined
  const query = model
    .find(q)
    .sort(field ? { [field]: dir, _id: 1 } : defaultSort)
    .skip((page - 1) * pageSize)
    .limit(pageSize)
  if (field === 'name') query.collation({ locale: 'en', strength: 2 })
  return (await query.lean()) as unknown as LeadDoc[]
}

function buildQuery(f: LeadFilters): Record<string, unknown> {
  const q: Record<string, unknown> = {}
  if (f.country) q.country = f.country
  if (f.language) q.language = f.language
  if (f.category) q.category = f.category
  if (f.score_min || f.score_max) {
    q.score = {
      ...(f.score_min ? { $gte: Number(f.score_min) } : {}),
      ...(f.score_max ? { $lte: Number(f.score_max) } : {}),
    }
  }
  if (f.rating_min || f.rating_max) {
    q.google_rating = {
      ...(f.rating_min ? { $gte: Number(f.rating_min) } : {}),
      ...(f.rating_max ? { $lte: Number(f.rating_max) } : {}),
    }
  }
  if (f.has_email === 'yes') q['contact.emails.0'] = { $exists: true }
  if (f.has_email === 'no') q['contact.emails.0'] = { $exists: false }
  if (f.date_from || f.date_to) {
    q['discovery.discovered_at'] = {
      ...(f.date_from ? { $gte: new Date(f.date_from) } : {}),
      ...(f.date_to ? { $lte: new Date(`${f.date_to}T23:59:59.999Z`) } : {}),
    }
  }
  if (f.q) q.name = { $regex: f.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
  return q
}

/**
 * status filter values: pending | skipped | do_not_contact | archived
 * (approval_list), approved | sent | failed | followup (approved collection —
 * followup = sent leads due for their next touch, oldest send first).
 */
api.get('/leads', async (req, res) => {
  const f = req.query as LeadFilters & { page?: string; page_size?: string }
  const status = f.status ?? 'pending'
  const base = buildQuery(f)
  const page = Math.max(1, Number.parseInt(f.page ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(f.page_size ?? '50', 10) || 50))

  let docs: LeadDoc[]
  let total: number
  let source: 'approval_list' | 'approved'
  if (status === 'approved' || status === 'sent' || status === 'failed' || status === 'followup') {
    source = 'approved'
    const q = { ...base }
    if (status === 'sent') q['delivery.state'] = { $in: ['sent', 'sent_dry_run'] }
    if (status === 'failed') q['delivery.state'] = 'failed'
    if (status === 'followup') Object.assign(q, followupDueQuery())
    total = await Approved.countDocuments(q)
    docs = await sortedLeadPage(
      Approved,
      q,
      f,
      status === 'followup' ? { 'outreach.last_sent_at': 1 } : { created_at: -1 },
      page,
      pageSize,
    )
  } else {
    source = 'approval_list'
    const q = { ...base, status }
    total = await ApprovalList.countDocuments(q)
    docs = await sortedLeadPage(ApprovalList, q, f, { created_at: -1 }, page, pageSize)
  }
  res.json({ source, leads: docs, total, page, page_size: pageSize })
})

async function findLeadAnywhere(id: string): Promise<{ doc: LeadDoc; source: 'approval_list' | 'approved' } | null> {
  if (!Types.ObjectId.isValid(id)) return null
  const pending = (await ApprovalList.findById(id)) as LeadDoc | null
  if (pending) return { doc: pending, source: 'approval_list' }
  const approved = (await Approved.findById(id)) as LeadDoc | null
  if (approved) return { doc: approved, source: 'approved' }
  return null
}

api.get('/leads/:id', async (req, res) => {
  const found = await findLeadAnywhere(req.params.id)
  if (!found) return res.status(404).json({ error: 'lead not found' })
  const analysis = await AnalysisData.findById(found.doc.analysis_id).lean()
  res.json({ source: found.source, lead: found.doc, analysis })
})

/**
 * Preview any outreach email for a lead:
 *   ?lang=  — language override (default: the lead's market language)
 *   ?style= — note | dashboard (default: the lead's chosen style)
 *   ?followup= — 0 (initial) | 1 (bump) | 2 (breakup); follow-ups are notes
 * The note variant matches exactly what a send would pick (deterministic +
 * skips variants already used on this lead).
 */
api.get('/leads/:id/email-preview', async (req, res) => {
  const found = await findLeadAnywhere(req.params.id)
  if (!found) return res.status(404).json({ error: 'lead not found' })
  const analysis = await AnalysisData.findById(found.doc.analysis_id).lean()
  if (!analysis) return res.status(404).json({ error: 'analysis not found' })
  const language = (req.query.lang as EmailLanguage) ?? (found.doc.language as EmailLanguage)
  const styleParam = req.query.style as EmailStyle | undefined
  const followup = Math.min(2, Math.max(0, Number(req.query.followup ?? 0) || 0)) as 0 | 1 | 2
  const token = found.doc.delivery?.unsubscribe_token ?? 'preview'
  const rendered = renderForLead(
    found.doc,
    analysis.scoring as RulesAnalysisResult,
    (analysis.summary as PlaceProfileSummary) ?? null,
    language,
    token,
    {
      style: styleParam ?? (found.doc.email_style as EmailStyle) ?? 'note',
      followupNumber: followup,
      usedVariants: found.doc.outreach?.variants ?? [],
      // Untracked landing links: a preview is nobody's send, so it must not
      // book a cold-email visit the reconciliation can never match.
      preview: true,
      campaign: campaignFor(String(found.doc.market_scope)),
    },
  )
  res.json({
    subject: rendered.subject,
    subject_variant: rendered.variant,
    band: rendered.band,
    style: rendered.style,
    followup: rendered.followupNumber,
    language,
    html: rendered.html,
    text: rendered.text,
  })
})

/** Choose the outreach format for a lead: personal note (default) or dashboard. */
api.put('/leads/:id/email-style', async (req, res) => {
  const style = String((req.body as { style?: string }).style ?? '')
  if (style !== 'note' && style !== 'dashboard') {
    return res.status(400).json({ error: "style must be 'note' or 'dashboard'" })
  }
  const found = await findLeadAnywhere(req.params.id)
  if (!found) return res.status(404).json({ error: 'lead not found' })
  found.doc.email_style = style
  found.doc.audit_trail.push({ at: new Date(), event: 'email_style_changed', detail: style })
  await found.doc.save()
  res.json({ ok: true })
})

/* ── approval flow ────────────────────────────────────────────────────── */

api.post('/leads/:id/approve', async (req, res) => {
  const lead = (await ApprovalList.findById(req.params.id)) as LeadDoc | null
  if (!lead) return res.status(404).json({ error: 'lead not found in approval list' })
  if (lead.status !== 'pending') return res.status(409).json({ error: `lead is ${lead.status}` })

  const emails = lead.contact.emails.map((e) => e.address)
  if (!emails.length) {
    return res.status(400).json({
      error: 'no recipient available — no public email was found; add one manually before approving',
    })
  }
  const recipient = String((req.body as { recipient?: string }).recipient ?? lead.contact.selected_email ?? '')
    .trim()
    .toLowerCase()
  if (!recipient) {
    return res.status(400).json({ error: 'a recipient must be selected before approval' })
  }
  if (!emails.includes(recipient)) {
    return res.status(400).json({ error: 'recipient must be one of the discovered public emails' })
  }
  if (await isSuppressed(recipient)) {
    return res.status(409).json({ error: 'recipient is on the do-not-contact list' })
  }

  const analysis = await AnalysisData.findById(lead.analysis_id).lean()
  if (!analysis) return res.status(500).json({ error: 'analysis record missing' })

  // Move approval_list → approved (audit preserved), then send immediately.
  const plain = lead.toObject() as Record<string, unknown>
  delete plain._id
  delete plain.created_at
  delete plain.updated_at
  const approvedDoc = await Approved.create({
    ...plain,
    status: 'approved',
    // Explicit approval timestamp — never inferred from the new document's
    // created_at (discovery date stays in discovery.discovered_at).
    approved_at: new Date(),
    contact: { ...(plain.contact as Record<string, unknown>), selected_email: recipient },
    audit_trail: [
      ...lead.audit_trail,
      { at: new Date(), event: 'approved', detail: `recipient: ${recipient}` },
    ],
  })
  await ApprovalList.deleteOne({ _id: lead._id })

  // Tracking contract: rid → sha256 → record persisted BEFORE the provider
  // is called; the raw rid only flows into the email build below and is
  // gone when this handler returns.
  const style = (approvedDoc.email_style as EmailStyle) ?? 'note'
  const tracked = await beginTrackedSend({ lead: approvedDoc as LeadDoc, recipient, style, followupNumber: 0 })
  // The whole 3-touch sequence stays in this template's voice.
  approvedDoc.outreach.template_id = tracked.template.id ?? null
  let outcome
  try {
    outcome = await sendLeadEmail(
      approvedDoc as LeadDoc,
      analysis.scoring as RulesAnalysisResult,
      (analysis.summary as PlaceProfileSummary) ?? null,
      recipient,
      { style, followupNumber: 0, rid: tracked.rid, campaign: tracked.campaign, template: tracked.template },
    )
  } catch (err) {
    if (err instanceof SuppressedRecipientError || err instanceof DeadRecipientError) {
      const blocked = err instanceof SuppressedRecipientError ? 'suppressed' : 'dead_address'
      await failTrackedSend(tracked.sendId, `recipient ${blocked} — blocked before send`)
      approvedDoc.delivery.state = 'not_sent'
      approvedDoc.delivery.last_error = err.message
      approvedDoc.audit_trail.push({ at: new Date(), event: `send_blocked_${blocked}` })
      await approvedDoc.save()
      return res.status(409).json({ error: err.message })
    }
    await failTrackedSend(tracked.sendId, err instanceof Error ? err.message : String(err))
    throw err
  }
  await completeTrackedSend(tracked.sendId, outcome)

  approvedDoc.delivery.state = outcome.state
  approvedDoc.delivery.attempts += 1
  approvedDoc.delivery.last_error = outcome.error
  approvedDoc.delivery.sent_at = outcome.ok ? new Date() : null
  approvedDoc.delivery.message_id = outcome.messageId
  approvedDoc.delivery.subject = outcome.subject
  approvedDoc.delivery.subject_variant = outcome.subjectVariant
  approvedDoc.delivery.style = outcome.style
  approvedDoc.delivery.followup = outcome.followupNumber
  approvedDoc.delivery.language = lead.language
  approvedDoc.delivery.unsubscribe_token = outcome.unsubscribeToken
  if (outcome.ok) {
    approvedDoc.outreach.count = 1
    approvedDoc.outreach.last_sent_at = new Date()
    if (outcome.style === 'note') approvedDoc.outreach.variants = [outcome.subjectVariant]
  }
  approvedDoc.audit_trail.push({
    at: new Date(),
    event: outcome.ok ? (outcome.state === 'sent_dry_run' ? 'sent_dry_run' : 'sent') : 'send_failed',
    detail: outcome.error ?? outcome.subject,
  })
  await approvedDoc.save()

  res.json({ ok: outcome.ok, lead: approvedDoc, delivery: approvedDoc.delivery })
})

api.post('/leads/:id/skip', async (req, res) => {
  const lead = (await ApprovalList.findById(req.params.id)) as LeadDoc | null
  if (!lead) return res.status(404).json({ error: 'lead not found' })
  lead.status = 'skipped'
  lead.audit_trail.push({ at: new Date(), event: 'skipped' })
  await lead.save()
  res.json({ ok: true })
})

api.post('/leads/:id/do-not-contact', async (req, res) => {
  const lead = (await ApprovalList.findById(req.params.id)) as LeadDoc | null
  if (!lead) return res.status(404).json({ error: 'lead not found' })
  lead.status = 'do_not_contact'
  lead.audit_trail.push({ at: new Date(), event: 'do_not_contact' })
  await lead.save()
  // Suppress every discovered address for this business.
  for (const e of lead.contact.emails) {
    await Suppression.updateOne(
      { email: e.address.toLowerCase() },
      { $setOnInsert: { email: e.address.toLowerCase(), reason: 'manual' } },
      { upsert: true },
    )
  }
  res.json({ ok: true })
})

api.post('/leads/:id/reopen', async (req, res) => {
  const lead = (await ApprovalList.findById(req.params.id)) as LeadDoc | null
  if (!lead) return res.status(404).json({ error: 'lead not found' })
  if (lead.status !== 'skipped' && lead.status !== 'archived') {
    return res.status(409).json({ error: `lead is ${lead.status}` })
  }
  lead.status = 'pending'
  lead.archived_at = null
  lead.audit_trail.push({ at: new Date(), event: 'reopened' })
  await lead.save()
  res.json({ ok: true })
})

/**
 * Manually add a recipient email (usable whether or not the site inspection
 * found any). The address joins the candidate list flagged as manual and
 * becomes the selected recipient — the same approve validation then applies.
 */
api.post('/leads/:id/add-email', async (req, res) => {
  const lead = (await ApprovalList.findById(req.params.id)) as LeadDoc | null
  if (!lead) return res.status(404).json({ error: 'lead not found' })
  const email = String((req.body as { email?: string }).email ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'invalid email' })
  if (!lead.contact.emails.some((e) => e.address === email)) {
    lead.contact.emails.push({ address: email, source_url: 'manual', generic: false })
  }
  lead.contact.selected_email = email
  lead.audit_trail.push({ at: new Date(), event: 'manual_email_added', detail: email })
  await lead.save()
  res.json({ ok: true, lead })
})

api.post('/leads/:id/select-email', async (req, res) => {
  const lead = (await ApprovalList.findById(req.params.id)) as LeadDoc | null
  if (!lead) return res.status(404).json({ error: 'lead not found' })
  const email = String((req.body as { email?: string }).email ?? '').trim().toLowerCase()
  if (!lead.contact.emails.some((e) => e.address === email)) {
    return res.status(400).json({ error: 'email must be one of the discovered candidates' })
  }
  lead.contact.selected_email = email
  await lead.save()
  res.json({ ok: true })
})

api.post('/approved/:id/retry', async (req, res) => {
  const lead = (await Approved.findById(req.params.id)) as LeadDoc | null
  if (!lead) return res.status(404).json({ error: 'approved lead not found' })
  if (lead.delivery.state !== 'failed') return res.status(409).json({ error: 'only failed deliveries can be retried' })
  const recipient = lead.contact.selected_email
  if (!recipient) return res.status(400).json({ error: 'no selected recipient' })
  const analysis = await AnalysisData.findById(lead.analysis_id).lean()
  if (!analysis) return res.status(500).json({ error: 'analysis record missing' })

  const followupNumber = (lead.delivery.followup ?? 0) as 0 | 1 | 2
  const retryStyle = (lead.delivery.style as EmailStyle) ?? (lead.email_style as EmailStyle) ?? 'note'
  // A retry is a NEW send attempt: new record, new rid, new hash — the
  // failed record stays for audit.
  const tracked = await beginTrackedSend({
    lead,
    recipient,
    style: retryStyle,
    followupNumber,
    preferTemplateId: lead.outreach?.template_id ?? null,
  })
  try {
    const outcome = await sendLeadEmail(
      lead,
      analysis.scoring as RulesAnalysisResult,
      (analysis.summary as PlaceProfileSummary) ?? null,
      recipient,
      {
        style: retryStyle,
        followupNumber,
        usedVariants: lead.outreach?.variants ?? [],
        rid: tracked.rid,
        campaign: tracked.campaign,
        template: tracked.template,
      },
    )
    await completeTrackedSend(tracked.sendId, outcome)
    lead.delivery.state = outcome.state
    lead.delivery.attempts += 1
    lead.delivery.last_error = outcome.error
    lead.delivery.sent_at = outcome.ok ? new Date() : lead.delivery.sent_at
    lead.delivery.message_id = outcome.messageId ?? lead.delivery.message_id
    lead.delivery.subject = outcome.subject
    lead.delivery.subject_variant = outcome.subjectVariant
    lead.delivery.style = outcome.style
    lead.delivery.followup = outcome.followupNumber
    lead.delivery.unsubscribe_token = outcome.unsubscribeToken
    if (outcome.ok) {
      lead.outreach.count = followupNumber + 1
      lead.outreach.last_sent_at = new Date()
      if (outcome.style === 'note' && !lead.outreach.variants.includes(outcome.subjectVariant)) {
        lead.outreach.variants.push(outcome.subjectVariant)
      }
    }
    lead.audit_trail.push({ at: new Date(), event: outcome.ok ? 'retry_sent' : 'retry_failed', detail: outcome.error ?? undefined })
    await lead.save()
    res.json({ ok: outcome.ok, delivery: lead.delivery })
  } catch (err) {
    if (err instanceof SuppressedRecipientError || err instanceof DeadRecipientError) {
      await failTrackedSend(tracked.sendId, 'recipient blocked before send (suppressed/dead)')
      return res.status(409).json({ error: err.message })
    }
    await failTrackedSend(tracked.sendId, err instanceof Error ? err.message : String(err))
    throw err
  }
})

/* ── follow-up sequence (max 3 sends; human-approved each time) ───────── */

api.post('/approved/:id/followup', async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'lead not found' })
  // Matching the due-query guarantees: 1–2 sends so far, waited long enough,
  // not stopped, last delivery went out.
  const lead = (await Approved.findOne({ _id: req.params.id, ...followupDueQuery() })) as LeadDoc | null
  if (!lead) return res.status(409).json({ error: 'lead is not due for a follow-up' })
  const recipient = lead.contact.selected_email
  if (!recipient) return res.status(400).json({ error: 'no selected recipient' })
  const analysis = await AnalysisData.findById(lead.analysis_id).lean()
  if (!analysis) return res.status(500).json({ error: 'analysis record missing' })

  const followupNumber = Math.min(lead.outreach.count, MAX_SENDS - 1) as 1 | 2
  // Every follow-up is its own tracked send: new record, new rid, new hash.
  const tracked = await beginTrackedSend({
    lead,
    recipient,
    style: 'note',
    followupNumber,
    preferTemplateId: lead.outreach?.template_id ?? null,
  })
  let outcome
  try {
    outcome = await sendLeadEmail(
      lead,
      analysis.scoring as RulesAnalysisResult,
      (analysis.summary as PlaceProfileSummary) ?? null,
      recipient,
      {
        followupNumber,
        usedVariants: lead.outreach.variants,
        rid: tracked.rid,
        campaign: tracked.campaign,
        template: tracked.template,
      },
    )
  } catch (err) {
    if (err instanceof SuppressedRecipientError || err instanceof DeadRecipientError) {
      await failTrackedSend(tracked.sendId, 'recipient blocked before send (suppressed/dead)')
      return res.status(409).json({ error: err.message })
    }
    await failTrackedSend(tracked.sendId, err instanceof Error ? err.message : String(err))
    throw err
  }
  await completeTrackedSend(tracked.sendId, outcome)

  lead.delivery.state = outcome.state
  lead.delivery.attempts += 1
  lead.delivery.last_error = outcome.error
  lead.delivery.sent_at = outcome.ok ? new Date() : lead.delivery.sent_at
  lead.delivery.message_id = outcome.messageId ?? lead.delivery.message_id
  lead.delivery.subject = outcome.subject
  lead.delivery.subject_variant = outcome.subjectVariant
  lead.delivery.style = outcome.style
  lead.delivery.followup = outcome.followupNumber
  lead.delivery.unsubscribe_token = outcome.unsubscribeToken
  if (outcome.ok) {
    lead.outreach.count += 1
    lead.outreach.last_sent_at = new Date()
    if (!lead.outreach.variants.includes(outcome.subjectVariant)) {
      lead.outreach.variants.push(outcome.subjectVariant)
    }
  }
  lead.audit_trail.push({
    at: new Date(),
    event: outcome.ok ? `followup_${followupNumber}_sent` : `followup_${followupNumber}_failed`,
    detail: outcome.error ?? outcome.subject,
  })
  await lead.save()
  res.json({ ok: outcome.ok, lead, delivery: lead.delivery })
})

/** Skip: stop following this lead up (keeps its sent history). */
api.post('/approved/:id/followup-stop', async (req, res) => {
  const lead = (await Approved.findById(req.params.id)) as LeadDoc | null
  if (!lead) return res.status(404).json({ error: 'approved lead not found' })
  lead.outreach.stopped_at = new Date()
  lead.audit_trail.push({ at: new Date(), event: 'followups_stopped' })
  await lead.save()
  res.json({ ok: true })
})

/** Decline: never contact this business again (suppresses every address). */
api.post('/approved/:id/do-not-contact', async (req, res) => {
  const lead = (await Approved.findById(req.params.id)) as LeadDoc | null
  if (!lead) return res.status(404).json({ error: 'approved lead not found' })
  lead.outreach.stopped_at = new Date()
  lead.audit_trail.push({ at: new Date(), event: 'do_not_contact' })
  await lead.save()
  for (const e of lead.contact.emails) {
    await Suppression.updateOne(
      { email: e.address.toLowerCase() },
      { $setOnInsert: { email: e.address.toLowerCase(), reason: 'manual' } },
      { upsert: true },
    )
  }
  res.json({ ok: true })
})

/* ── suppression ──────────────────────────────────────────────────────── */

api.get('/suppression', async (_req, res) => {
  const items = await Suppression.find().sort({ created_at: -1 }).limit(200).lean()
  res.json({ items })
})

api.post('/suppression', async (req, res) => {
  const email = String((req.body as { email?: string }).email ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'invalid email' })
  await Suppression.updateOne(
    { email },
    { $setOnInsert: { email, reason: 'manual' } },
    { upsert: true },
  )
  res.json({ ok: true })
})
