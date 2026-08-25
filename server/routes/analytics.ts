/**
 * Cold-email observability API — serves the /email-analytics dashboard.
 *
 * Everything here reads the LEAD FINDER's own MongoDB (email_sends +
 * tracking_state). The landing's Atlas store is touched ONLY by POST /sync;
 * if Atlas is unreachable the sync reports a distinct error state while the
 * dashboard keeps serving the last persisted summaries — "no visit" and
 * "couldn't query MongoDB" are never conflated.
 *
 * Privacy: the raw rid never exists here (it is discarded at send time); the
 * full tracking hash never leaves the server either — rows carry only a
 * masked form for support. This app is a local, single-operator tool with no
 * auth layer; these endpoints ride the same posture as the rest of /api.
 */

import { Router } from 'express'
import { Types } from 'mongoose'
import { EmailSend, getTrackingState } from '../tracking/models'
import { EmailTemplate } from '../email/template-models'
import { syncLandingVisits } from '../tracking/sync'
import { maskTrackingHash } from '../tracking/rid'
import {
  breakdown,
  customTemplateIds,
  relabelTemplateKeys,
  landingStatusOf,
  overviewMetrics,
  timeseries,
  type SendRow,
} from '../tracking/metrics'

export const analytics = Router()

const MAX_PAGE_SIZE = 100
const MAX_RANGE_DAYS = 366
const OVERVIEW_ROW_CAP = 20_000
const CSV_ROW_CAP = 5_000

const DAY_MS = 86_400_000

/** ?days=7|30|90 or ?from=YYYY-MM-DD&to=YYYY-MM-DD (clamped to a year). */
function parseRange(query: Record<string, unknown>): { from: Date; to: Date } {
  const to = query.to && /^\d{4}-\d{2}-\d{2}$/.test(String(query.to))
    ? new Date(`${query.to}T23:59:59.999Z`)
    : new Date()
  let from: Date
  if (query.from && /^\d{4}-\d{2}-\d{2}$/.test(String(query.from))) {
    from = new Date(`${query.from}T00:00:00.000Z`)
  } else {
    const days = [7, 30, 90].includes(Number(query.days)) ? Number(query.days) : 30
    from = new Date(to.getTime() - (days - 1) * DAY_MS)
  }
  if (from > to) from = new Date(to.getTime() - 29 * DAY_MS)
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    from = new Date(to.getTime() - MAX_RANGE_DAYS * DAY_MS)
  }
  return { from, to }
}

/** Sends inside the range: by sent_at when sent, by created_at otherwise. */
function rangeQuery(from: Date, to: Date): Record<string, unknown> {
  return {
    $or: [
      { sent_at: { $gte: from, $lte: to } },
      { sent_at: null, created_at: { $gte: from, $lte: to } },
    ],
  }
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const PERFORMANCE_SEND = { status: 'sent', provider_event: { $nin: ['bounced', 'complained'] } }

function buildSendsQuery(q: Record<string, unknown>): Record<string, unknown> {
  const query: Record<string, unknown> = {}
  const filters: Record<string, unknown>[] = []
  if (q.q) {
    const rx = { $regex: escapeRegex(String(q.q).slice(0, 80)), $options: 'i' }
    filters.push({ $or: [{ lead_name: rx }, { recipient: rx }] })
  }
  if (q.template) query.template_id = { $regex: `^${escapeRegex(String(q.template).slice(0, 60))}` }
  if (q.campaign) query.campaign = String(q.campaign).slice(0, 80)
  if (q.variant !== undefined && q.variant !== '' && Number.isInteger(Number(q.variant))) {
    query.variant = Number(q.variant)
  }
  if ([1, 2, 3].includes(Number(q.attempt))) query.attempt = Number(q.attempt)
  if (typeof q.status === 'string' && ['queued', 'sent', 'sent_dry_run', 'failed'].includes(q.status)) {
    query.status = q.status
  }
  // Landing badge filter — mirrors landingStatusOf().
  switch (q.landing) {
    case 'visited':
      filters.push({ ...PERFORMANCE_SEND, 'landing_visit.matched': true })
      break
    case 'no_visit':
      filters.push({
        ...PERFORMANCE_SEND,
        tracking_id_hash: { $type: 'string' },
        'landing_visit.matched': { $ne: true },
      })
      break
    case 'untracked':
      filters.push({ tracking_id_hash: null })
      break
  }
  if (filters.length) query.$and = filters
  return query
}

const SORTS: Record<string, Record<string, 1 | -1>> = {
  sent_at: { sent_at: -1, created_at: -1 },
  oldest: { sent_at: 1, created_at: 1 },
  lead: { lead_name: 1 },
  first_visit: { 'landing_visit.first_observed_at': -1 },
  sessions: { 'landing_visit.event_count': -1 },
  attempt: { attempt: -1, sent_at: -1 },
}

type LeanSend = SendRow & {
  _id: unknown
  lead_name: string
  recipient: string
  language?: string
  message_id?: string | null
  error?: string | null
  backfilled?: boolean
  created_at?: Date
  updated_at?: Date
}

/** Public row shape — no raw hash, no rid (rid was never stored anyway). */
function serializeSend(row: LeanSend): Record<string, unknown> {
  return {
    id: String(row._id),
    place_id: row.place_id,
    lead_name: row.lead_name,
    recipient: row.recipient,
    language: row.language ?? null,
    campaign: row.campaign ?? null,
    template_id: row.template_id ?? null,
    variant: row.variant ?? null,
    followup: row.followup ?? 0,
    attempt: row.attempt ?? 1,
    status: row.status,
    sent_at: row.sent_at ?? null,
    message_id: row.message_id ?? null,
    error: row.error ?? null,
    backfilled: row.backfilled ?? false,
    created_at: row.created_at ?? null,
    tracked: typeof row.tracking_id_hash === 'string',
    tracking_hash_masked:
      typeof row.tracking_id_hash === 'string' ? maskTrackingHash(row.tracking_id_hash) : null,
    landing_status: landingStatusOf(row),
    landing_visit: {
      matched: row.landing_visit?.matched ?? false,
      event_count: row.landing_visit?.event_count ?? 0,
      first_observed_at: row.landing_visit?.first_observed_at ?? null,
      last_observed_at: row.landing_visit?.last_observed_at ?? null,
      synced_at: row.landing_visit?.synced_at ?? null,
    },
  }
}

/* ── overview: cards + timeseries + comparatives ──────────────────────── */

analytics.get('/overview', async (req, res) => {
  const { from, to } = parseRange(req.query as Record<string, unknown>)
  const rows = (await EmailSend.find(rangeQuery(from, to), {
    place_id: 1, status: 1, sent_at: 1, created_at: 1, template_id: 1,
    variant: 1, followup: 1, attempt: 1, campaign: 1, provider_event: 1, tracking_id_hash: 1, landing_visit: 1,
  })
    .sort({ created_at: -1 })
    .limit(OVERVIEW_ROW_CAP)
    .lean()) as unknown as SendRow[]

  const state = await getTrackingState()
  const templateRows = breakdown(rows, (r) => r.template_id)
  const ids = customTemplateIds(templateRows)
  const names = new Map(
    ids.length
      ? ((await EmailTemplate.find({ _id: { $in: ids } }, { name: 1 }).lean()) as Array<{ _id: unknown; name: string }>)
          .map((t) => [String(t._id), t.name] as const)
      : [],
  )
  res.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    totals: overviewMetrics(rows),
    timeseries: timeseries(rows, from, to),
    breakdowns: {
        template: relabelTemplateKeys(templateRows, names),
      variant: breakdown(rows, (r) => (r.variant == null ? null : `v${r.variant + 1}`)),
      campaign: breakdown(rows, (r) => r.campaign),
      attempt: breakdown(rows, (r) => `attempt_${r.attempt ?? 1}`),
    },
    sync: {
      last_synced_at: state.last_synced_at,
      last_sync_ok: state.last_sync_ok,
      last_sync_error: state.last_sync_error,
      last_sync_sends: state.last_sync_sends,
      last_sync_events: state.last_sync_events,
      last_sync_unattributed: state.last_sync_unattributed,
    },
  })
})

/* ── reconciliation trigger ───────────────────────────────────────────── */

analytics.post('/sync', async (_req, res) => {
  // ok:false = the landing store could not be queried — a state the UI shows
  // as a sync error, never as "no visits".
  res.json(await syncLandingVisits())
})

/* ── sends table (search / filters / sort / pagination) ───────────────── */

analytics.get('/sends', async (req, res) => {
  const q = req.query as Record<string, unknown>
  const { from, to } = parseRange(q)
  const query = { ...buildSendsQuery(q), ...rangeQuery(from, to) }
  const page = Math.max(1, Number.parseInt(String(q.page ?? '1'), 10) || 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(String(q.page_size ?? '25'), 10) || 25))
  const sort = SORTS[String(q.sort ?? 'sent_at')] ?? SORTS.sent_at

  const [total, rows] = await Promise.all([
    EmailSend.countDocuments(query),
    EmailSend.find(query).sort(sort).skip((page - 1) * pageSize).limit(pageSize).lean(),
  ])
  res.json({
    total,
    page,
    page_size: pageSize,
    sends: (rows as unknown as LeanSend[]).map(serializeSend),
  })
})

/* ── CSV export of the current filter ─────────────────────────────────── */

const csvCell = (v: unknown): string => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

analytics.get('/sends.csv', async (req, res) => {
  const q = req.query as Record<string, unknown>
  const { from, to } = parseRange(q)
  const query = { ...buildSendsQuery(q), ...rangeQuery(from, to) }
  const rows = (await EmailSend.find(query)
    .sort(SORTS[String(q.sort ?? 'sent_at')] ?? SORTS.sent_at)
    .limit(CSV_ROW_CAP)
    .lean()) as unknown as LeanSend[]

  const header = [
    'lead', 'recipient', 'language', 'campaign', 'template', 'variant',
    'attempt', 'status', 'sent_at', 'landing_status', 'first_visit', 'last_visit', 'sessions',
  ]
  const lines = rows.map((r) => {
    const s = serializeSend(r)
    const lv = s.landing_visit as Record<string, unknown>
    return [
      s.lead_name, s.recipient, s.language, s.campaign, s.style, s.template_id,
      s.variant == null ? '' : `v${Number(s.variant) + 1}`, s.attempt, s.status,
      s.sent_at ? new Date(String(s.sent_at)).toISOString() : '',
      s.landing_status,
      lv.first_observed_at ? new Date(String(lv.first_observed_at)).toISOString() : '',
      lv.last_observed_at ? new Date(String(lv.last_observed_at)).toISOString() : '',
      lv.event_count,
    ].map(csvCell).join(',')
  })
  res.type('text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="cold-email-sends.csv"')
  res.send([header.join(','), ...lines].join('\n'))
})

/* ── send detail (drawer timeline) ────────────────────────────────────── */

analytics.get('/sends/:id', async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'send not found' })
  const row = (await EmailSend.findById(req.params.id).lean()) as unknown as LeanSend | null
  if (!row) return res.status(404).json({ error: 'send not found' })
  const s = serializeSend(row)
  const lv = s.landing_visit as { first_observed_at: unknown; last_observed_at: unknown; event_count: number }
  const timeline: Array<{ at: unknown; event: string; detail?: string }> = [
    { at: row.created_at ?? null, event: 'record_created' },
  ]
  if (row.status === 'failed') {
    timeline.push({ at: row.updated_at ?? row.created_at ?? null, event: 'send_failed', detail: row.error ?? undefined })
  } else if (row.sent_at) {
    timeline.push({
      at: row.sent_at,
      event: row.status === 'sent_dry_run' ? 'sent_dry_run' : 'provider_accepted',
      detail: row.message_id ?? undefined,
    })
  }
  if (lv.first_observed_at) timeline.push({ at: lv.first_observed_at, event: 'first_landing_visit' })
  if (lv.last_observed_at && lv.last_observed_at !== lv.first_observed_at && lv.event_count > 1) {
    timeline.push({ at: lv.last_observed_at, event: 'last_landing_visit', detail: `${lv.event_count} sessions` })
  }
  res.json({ send: s, timeline })
})
