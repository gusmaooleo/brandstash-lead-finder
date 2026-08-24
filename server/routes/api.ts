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
import { followupDueQuery, maxSends } from '../leads/followup'
import { renderForLead, sendLeadEmail, isSuppressed, SuppressedRecipientError, NoTemplateError } from '../email/sender'
import { languagesOf, resolveTemplate, stepsOf, templateById, templateOptionsFor } from '../email/template-store'
import { DeadRecipientError } from '../email/dead-addresses'
import { beginTrackedSend, completeTrackedSend, failTrackedSend } from '../tracking/send-log'
import { campaignFor } from '../tracking/landing-url'
import { catalogCategoryQuery, searchedCategory } from '../email/category-match'
import type { EmailLanguage, MarketScope } from '../../shared/types'
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
  /** Catalog categories — repeatable (?category=A&category=B). */
  category?: string | string[]
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
  // The catalog vocabulary, not the Places primaryType stored in `category`:
  // that field says "service" for an advertising agency, a marketing agency
  // and a marketing consultant alike, which is not a filter anyone can use.
  const categories = catalogCategoryQuery(
    Array.isArray(f.category) ? f.category : f.category ? [f.category] : [],
  )
  if (categories) Object.assign(q, categories)
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
 * Which collection a status tab reads and the query that IS that tab, filters
 * folded in. One place, so the table, its pagination and its category facets
 * can never disagree about what "the Sent tab" means.
 *
 * status filter values: pending | skipped | do_not_contact | archived
 * (approval_list), approved | sent | failed | followup (approved collection —
 * followup = sent leads due for their next touch, oldest send first).
 */
function leadScope(status: string, base: Record<string, unknown>) {
  if (status === 'approved' || status === 'sent' || status === 'failed' || status === 'followup') {
    const q = { ...base }
    if (status === 'sent') q['delivery.state'] = { $in: ['sent', 'sent_dry_run'] }
    if (status === 'failed') q['delivery.state'] = 'failed'
    if (status === 'followup') Object.assign(q, followupDueQuery())
    return {
      model: Approved,
      q,
      source: 'approved' as const,
      defaultSort: (status === 'followup' ? { 'outreach.last_sent_at': 1 } : { created_at: -1 }) as Record<string, 1 | -1>,
    }
  }
  return {
    model: ApprovalList,
    q: { ...base, status },
    source: 'approval_list' as const,
    defaultSort: { created_at: -1 } as Record<string, 1 | -1>,
  }
}

api.get('/leads', async (req, res) => {
  const f = req.query as LeadFilters & { page?: string; page_size?: string }
  const page = Math.max(1, Number.parseInt(f.page ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(f.page_size ?? '50', 10) || 50))

  const { model, q, source, defaultSort } = leadScope(f.status ?? 'pending', buildQuery(f))
  const total = await model.countDocuments(q)
  const docs = await sortedLeadPage(model, q, f, defaultSort, page, pageSize)
  res.json({ source, leads: docs, total, page, page_size: pageSize })
})

/**
 * The category filter's options: the catalog categories that actually exist in
 * this tab, with how many leads each holds — an option that can only ever
 * return an empty page is not an option worth offering.
 *
 * Deliberately NOT narrowed by the other filters: the counts would shift under
 * the owner's cursor every time a country or a score bound moved. The grouping
 * key is the pair `searchedCategory` reads, so one lead is counted once and
 * under exactly the name the filter will match it by.
 */
api.get('/leads/categories', async (req, res) => {
  const { model, q } = leadScope(String(req.query.status ?? 'pending'), {})
  const rows = (await model.aggregate([
    { $match: q },
    {
      $group: {
        _id: { search_category: '$discovery.search_category', query: '$discovery.query' },
        count: { $sum: 1 },
      },
    },
  ])) as Array<{ _id: { search_category?: string | null; query?: string | null }; count: number }>

  const counts = new Map<string, number>()
  for (const row of rows) {
    const name = searchedCategory({ discovery: row._id })
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + row.count)
  }
  res.json({
    categories: [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count })),
  })
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
 *   ?template= — id of the template to render (default: the resolved one)
 *   ?followup= — 0 (initial) | 1..5 (follow-ups)
 * The variant matches exactly what a send would pick (deterministic + skips
 * variants already used on this lead).
 */
/** A one-off body: HTML as written, or plain text wrapped so it renders. */
function oneOffDraft(body: { subject?: string; html?: string; text?: string | null }): { subject: string; html: string; text: string | null } | null {
  const subject = String(body.subject ?? '').trim()
  const html = String(body.html ?? '').trim()
  const text = body.text ? String(body.text) : null
  if (!subject || (!html && !text)) return null
  const escaped = (text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return {
    subject,
    html:
      html ||
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.65;white-space:pre-wrap;">${escaped}</div>`,
    text,
  }
}

/** The template pinned for a step, falling back to the sequence's own. */
function chosenTemplateId(lead: { outreach?: { template_id?: string | null; step_templates?: Array<{ followup: number; template_id: string }> } }, followup: number): string | null {
  const pinned = lead.outreach?.step_templates?.find((s) => s.followup === followup)
  return pinned?.template_id ?? lead.outreach?.template_id ?? null
}

api.get('/leads/:id/email-preview', async (req, res) => {
  const found = await findLeadAnywhere(req.params.id)
  if (!found) return res.status(404).json({ error: 'lead not found' })
  const analysis = await AnalysisData.findById(found.doc.analysis_id).lean()
  if (!analysis) return res.status(404).json({ error: 'analysis not found' })
  const language = (req.query.lang as EmailLanguage) ?? (found.doc.language as EmailLanguage)
  const followup = Math.min(maxSends() - 1, Math.max(0, Number(req.query.followup ?? 0) || 0))
  const token = found.doc.delivery?.unsubscribe_token ?? 'preview'
  const requested = String(req.query.template ?? '').trim()
  const template = requested
    ? await templateById(requested, language)
    : await resolveTemplate(found.doc, {
        language,
        followupNumber: followup,
        preferTemplateId: found.doc.outreach?.template_id ?? null,
      })

  try {
    const rendered = renderForLead(
      found.doc,
      analysis.scoring as RulesAnalysisResult,
      (analysis.summary as PlaceProfileSummary) ?? null,
      language,
      token,
      {
        template: template ?? undefined,
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
      followup: rendered.followupNumber,
      language,
      html: rendered.html,
      text: rendered.text,
      template_id: template?.id ?? null,
      template_name: rendered.templateName,
    })
  } catch (err) {
    if (err instanceof NoTemplateError) return res.status(409).json({ error: err.message, no_template: true })
    throw err
  }
})

/**
 * Preview a ONE-OFF email — copy written for this lead and not saved to the
 * library. Same renderer, same tokens, same compliance as a stored template.
 */
api.post('/leads/:id/email-preview', async (req, res) => {
  const found = await findLeadAnywhere(req.params.id)
  if (!found) return res.status(404).json({ error: 'lead not found' })
  const analysis = await AnalysisData.findById(found.doc.analysis_id).lean()
  if (!analysis) return res.status(404).json({ error: 'analysis not found' })
  const body = (req.body ?? {}) as { subject?: string; html?: string; text?: string | null }
  const draft = oneOffDraft(body)
  if (!draft) return res.status(400).json({ error: 'write a subject and a body first' })

  const language = (found.doc.language as EmailLanguage) ?? 'en'
  // A one-off borrows the finding phrases of the template this lead would have
  // been sent, so {{finding_1}} speaks in the same voice instead of nothing.
  const voice = await resolveTemplate(found.doc, { language, preferTemplateId: chosenTemplateId(found.doc, 0) })
  const rendered = renderForLead(
    found.doc,
    analysis.scoring as RulesAnalysisResult,
    (analysis.summary as PlaceProfileSummary) ?? null,
    language,
    found.doc.delivery?.unsubscribe_token ?? 'preview',
    {
      oneOff: draft,
      template: voice ?? undefined,
      preview: true,
      campaign: campaignFor(String(found.doc.market_scope)),
    },
  )
  res.json({
    subject: rendered.subject,
    subject_variant: 0,
    followup: 0,
    language,
    html: rendered.html,
    text: rendered.text,
    template_id: null,
    template_name: rendered.templateName,
  })
})

/**
 * Every template this lead may be sent with, the resolved one flagged.
 *
 * The lead's language is decided by the country it was found in and is NOT a
 * choice here — it is reported so the screen can name it, and each template
 * declares which of its languages carry which steps, so one that cannot answer
 * this lead shows as unavailable instead of quietly disappearing.
 */
api.get('/leads/:id/templates', async (req, res) => {
  const found = await findLeadAnywhere(req.params.id)
  if (!found) return res.status(404).json({ error: 'lead not found' })
  const followup = Math.min(maxSends() - 1, Math.max(0, Number(req.query.followup ?? 0) || 0))
  const language = String(found.doc.language ?? 'en')
  const { suggestedId, templates } = await templateOptionsFor(found.doc, {
    language,
    followupNumber: followup,
    preferTemplateId: found.doc.outreach?.template_id ?? null,
  })
  res.json({
    suggested_id: suggestedId,
    chosen_id: chosenTemplateId(found.doc, followup),
    max_followups: maxSends() - 1,
    lead_language: language,
    templates: templates.map((t) => ({
      id: String(t._id),
      name: t.name,
      audience: t.audience ?? 'custom',
      categories: t.categories ?? [],
      /** Which steps each language of this template can send. */
      steps_by_language: Object.fromEntries(languagesOf(t).map((l) => [l, stepsOf(t, l)])),
    })),
  })
})

/**
 * Pin the template for one step of this lead's sequence. The resolver only
 * SUGGESTS; any template in the library may be chosen, category restrictions
 * included — the restriction decides what comes up first, not what is allowed.
 */
api.put('/leads/:id/template', async (req, res) => {
  const body = (req.body ?? {}) as { template_id?: string; followup?: number }
  const templateId = String(body.template_id ?? '').trim()
  const followup = Math.min(maxSends() - 1, Math.max(0, Number(body.followup ?? 0) || 0))
  if (!templateId) return res.status(400).json({ error: 'template_id is required' })

  const found = await findLeadAnywhere(req.params.id)
  if (!found) return res.status(404).json({ error: 'lead not found' })
  // Pinning a template that has nothing in this lead's language would arm a
  // send that can only fail at render time — refuse it here, where it shows.
  const language = String(found.doc.language ?? 'en')
  if (!(await templateById(templateId, language))) {
    return res.status(404).json({ error: `no template with that id is written in ${language}` })
  }
  const steps = found.doc.outreach.step_templates ?? []
  const existing = steps.find((s) => s.followup === followup)
  if (existing) existing.template_id = templateId
  else steps.push({ followup, template_id: templateId })
  found.doc.outreach.step_templates = steps
  if (followup === 0) found.doc.outreach.template_id = templateId
  found.doc.audit_trail.push({ at: new Date(), event: 'template_chosen', detail: `step ${followup}: ${templateId}` })
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
  const oneOff = oneOffDraft((req.body ?? {}) as { subject?: string; html?: string; text?: string | null })
  const chosen = chosenTemplateId(approvedDoc, 0)
  const approvedLanguage = String(approvedDoc.language ?? 'en')
  // With a one-off, the template is consulted only for its finding phrases.
  const template = oneOff
    ? await resolveTemplate(approvedDoc, { language: approvedLanguage, preferTemplateId: chosen })
    : chosen
      ? await templateById(chosen, approvedLanguage)
      : null
  let tracked
  try {
    tracked = await beginTrackedSend({
      lead: approvedDoc as LeadDoc,
      recipient,
      followupNumber: 0,
      template: template ?? undefined,
      oneOff: Boolean(oneOff),
    })
  } catch (err) {
    if (err instanceof NoTemplateError) return res.status(409).json({ error: err.message, no_template: true })
    throw err
  }
  // The whole sequence stays in this template's voice unless a step overrides.
  approvedDoc.outreach.template_id = tracked.template?.id ?? null
  let outcome
  try {
    outcome = await sendLeadEmail(
      approvedDoc as LeadDoc,
      analysis.scoring as RulesAnalysisResult,
      (analysis.summary as PlaceProfileSummary) ?? null,
      recipient,
      {
        followupNumber: 0,
        rid: tracked.rid,
        campaign: tracked.campaign,
        template: (tracked.template ?? template) ?? undefined,
        oneOff,
      },
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
  approvedDoc.delivery.followup = outcome.followupNumber
  approvedDoc.delivery.language = lead.language
  approvedDoc.delivery.unsubscribe_token = outcome.unsubscribeToken
  if (outcome.ok) {
    approvedDoc.outreach.count = 1
    approvedDoc.outreach.last_sent_at = new Date()
    approvedDoc.outreach.variants = [outcome.subjectVariant]
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

  const followupNumber = lead.delivery.followup ?? 0
  // A retry is a NEW send attempt: new record, new rid, new hash — the
  // failed record stays for audit.
  const pinned = chosenTemplateId(lead, followupNumber)
  let tracked
  try {
    tracked = await beginTrackedSend({
      lead,
      recipient,
      followupNumber,
      preferTemplateId: pinned,
    })
  } catch (err) {
    if (err instanceof NoTemplateError) return res.status(409).json({ error: err.message, no_template: true })
    throw err
  }
  try {
    const outcome = await sendLeadEmail(
      lead,
      analysis.scoring as RulesAnalysisResult,
      (analysis.summary as PlaceProfileSummary) ?? null,
      recipient,
      {
        followupNumber,
        usedVariants: lead.outreach?.variants ?? [],
        rid: tracked.rid,
        campaign: tracked.campaign,
        template: tracked.template ?? undefined,
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
    lead.delivery.followup = outcome.followupNumber
    lead.delivery.unsubscribe_token = outcome.unsubscribeToken
    if (outcome.ok) {
      lead.outreach.count = followupNumber + 1
      lead.outreach.last_sent_at = new Date()
      if (!lead.outreach.variants.includes(outcome.subjectVariant)) {
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

  const followupNumber = Math.min(lead.outreach.count, maxSends() - 1)
  // Every follow-up is its own tracked send: new record, new rid, new hash.
  let tracked
  try {
    tracked = await beginTrackedSend({
      lead,
      recipient,
      followupNumber,
      preferTemplateId: chosenTemplateId(lead, followupNumber),
    })
  } catch (err) {
    if (err instanceof NoTemplateError) return res.status(409).json({ error: err.message, no_template: true })
    throw err
  }
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
        template: tracked.template ?? undefined,
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
