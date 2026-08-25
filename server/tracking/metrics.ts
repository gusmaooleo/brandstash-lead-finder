/**
 * Pure analytics math over email_sends rows (no I/O — fully unit-tested).
 *
 * Vocabulary matters here: the loop measures CONSENTED LANDING VISITS, not
 * email opens — there is no open pixel. A recipient who clicks but rejects
 * the cookie banner is never counted.
 *
 * Core formulas (per the tracking spec):
 *  - emails_sent          = sends whose status is a sent state
 *  - visited_sends        = sent sends with landing_visit.matched — each send
 *                           counts AT MOST ONCE no matter how many events
 *  - landing_visit_rate   = emails_sent === 0 ? 0 : visited/sent × 100
 *  - unique_visited_leads = distinct place_id among visited sends
 *  - consented_sessions   = Σ landing_visit.event_count of visited sends
 */

export const NON_DELIVERY_EVENTS = new Set(['bounced', 'complained'])

/** The lean shape the analytics endpoints read (projection of EmailSend). */
export type SendRow = {
  place_id: string
  status: string
  sent_at: Date | string | null
  created_at?: Date | string
  template_id?: string
  variant?: number | null
  followup?: number
  attempt?: number
  campaign?: string
  provider_event?: string | null
  tracking_id_hash?: string | null
  landing_visit?: {
    matched?: boolean
    event_count?: number
    first_observed_at?: Date | string | null
    last_observed_at?: Date | string | null
    synced_at?: Date | string | null
  } | null
}

export const isSent = (r: SendRow): boolean =>
  r.status === 'sent' && !NON_DELIVERY_EVENTS.has(r.provider_event ?? '')
export const isVisited = (r: SendRow): boolean => isSent(r) && r.landing_visit?.matched === true
export const isTracked = (r: SendRow): boolean => typeof r.tracking_id_hash === 'string'

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Hours from send to first landing visit; null when either side is missing. */
export function hoursToFirstVisit(r: SendRow): number | null {
  const sent = toDate(r.sent_at)
  const first = toDate(r.landing_visit?.first_observed_at ?? null)
  if (!sent || !first) return null
  const h = (first.getTime() - sent.getTime()) / 3_600_000
  return h >= 0 ? h : null
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function rate(visited: number, sent: number): number {
  return sent === 0 ? 0 : (visited / sent) * 100
}

export type OverviewMetrics = {
  emails_sent: number
  visited_sends: number
  landing_visit_rate: number
  unique_visited_leads: number
  consented_sessions: number
  median_hours_to_first_visit: number | null
  tracked_sends: number
  untracked_sends: number
  failed_sends: number
  queued_sends: number
  dry_run_sends: number
  bounced_sends: number
  complained_sends: number
}

export function overviewMetrics(rows: readonly SendRow[]): OverviewMetrics {
  const sent = rows.filter(isSent)
  const visited = sent.filter(isVisited)
  const leadIds = new Set(visited.map((r) => r.place_id))
  const sessions = visited.reduce((n, r) => n + (r.landing_visit?.event_count ?? 0), 0)
  const hours = visited
    .map(hoursToFirstVisit)
    .filter((h): h is number => h != null)
  return {
    emails_sent: sent.length,
    visited_sends: visited.length,
    landing_visit_rate: rate(visited.length, sent.length),
    unique_visited_leads: leadIds.size,
    consented_sessions: sessions,
    median_hours_to_first_visit: median(hours),
    tracked_sends: rows.filter(isTracked).length,
    untracked_sends: rows.filter((r) => !isTracked(r)).length,
    failed_sends: rows.filter((r) => r.status === 'failed').length,
    queued_sends: rows.filter((r) => r.status === 'queued').length,
    dry_run_sends: rows.filter((r) => r.status === 'sent_dry_run').length,
    bounced_sends: rows.filter((r) => r.provider_event === 'bounced').length,
    complained_sends: rows.filter((r) => r.provider_event === 'complained').length,
  }
}

/** UTC day key (YYYY-MM-DD). */
export function dayKey(v: Date | string): string {
  return new Date(v).toISOString().slice(0, 10)
}

export type TimeseriesPoint = { day: string; sent: number; visited: number; rate: number }

/** Daily buckets over [from, to] — visits attributed to the SEND's day. */
export function timeseries(rows: readonly SendRow[], from: Date, to: Date): TimeseriesPoint[] {
  const buckets = new Map<string, { sent: number; visited: number }>()
  for (let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); t <= to.getTime(); t += 86_400_000) {
    buckets.set(new Date(t).toISOString().slice(0, 10), { sent: 0, visited: 0 })
  }
  for (const r of rows) {
    if (!isSent(r)) continue
    const at = toDate(r.sent_at) ?? toDate(r.created_at ?? null)
    if (!at) continue
    const key = dayKey(at)
    const bucket = buckets.get(key)
    if (!bucket) continue
    bucket.sent += 1
    if (isVisited(r)) bucket.visited += 1
  }
  return [...buckets.entries()].map(([day, b]) => ({ day, ...b, rate: rate(b.visited, b.sent) }))
}

export type BreakdownRow = {
  key: string
  sent: number
  visited: number
  rate: number
  sessions: number
  median_hours_to_first_visit: number | null
}

/**
 * Group sent sends by an arbitrary key. Sorted by visit rate desc, but with
 * volume as tiebreaker — the UI additionally flags tiny samples.
 */
/**
 * A send made by a template from the library records its database id
 * (`custom_<id>_v2`). The dashboard is read by a human, so the id is swapped
 * back for the template's name; an id with no template left (deleted) keeps
 * its raw key rather than pretending to know what it was.
 */
export function relabelTemplateKeys(
  rows: readonly BreakdownRow[],
  names: ReadonlyMap<string, string>,
): BreakdownRow[] {
  return rows.map((row) => {
    const m = /^custom_([0-9a-f]{24})(?:_followup_(\d))?(?:_v(\d+))?$/.exec(row.key)
    const name = m ? names.get(m[1]) : undefined
    if (!m || !name) return row
    const parts = [name]
    if (m[2]) parts.push(`follow-up ${m[2]}`)
    if (m[3]) parts.push(`v${m[3]}`)
    return { ...row, key: parts.join(' · ') }
  })
}

/** Template database ids referenced by a set of breakdown keys. */
export function customTemplateIds(rows: readonly BreakdownRow[]): string[] {
  const ids = new Set<string>()
  for (const row of rows) {
    const m = /^custom_([0-9a-f]{24})/.exec(row.key)
    if (m) ids.add(m[1])
  }
  return [...ids]
}

export function breakdown(
  rows: readonly SendRow[],
  keyOf: (r: SendRow) => string | null | undefined,
): BreakdownRow[] {
  const groups = new Map<string, SendRow[]>()
  for (const r of rows) {
    if (!isSent(r)) continue
    const key = keyOf(r) ?? '—'
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const visited = list.filter(isVisited)
      const hours = visited.map(hoursToFirstVisit).filter((h): h is number => h != null)
      return {
        key,
        sent: list.length,
        visited: visited.length,
        rate: rate(visited.length, list.length),
        sessions: visited.reduce((n, r) => n + (r.landing_visit?.event_count ?? 0), 0),
        median_hours_to_first_visit: median(hours),
      }
    })
    .sort((a, b) => b.rate - a.rate || b.sent - a.sent)
}

/** Landing status of one row, as shown by the dashboard badges. */
export type LandingStatus = 'visited' | 'no_visit' | 'untracked' | 'failed' | 'queued' | 'dry_run' | 'bounced'

export function landingStatusOf(r: SendRow): LandingStatus {
  if (r.status === 'failed') return 'failed'
  if (r.status === 'queued') return 'queued'
  if (r.status === 'sent_dry_run') return 'dry_run'
  if (NON_DELIVERY_EVENTS.has(r.provider_event ?? '')) return 'bounced'
  if (!isTracked(r)) return 'untracked'
  return isVisited(r) ? 'visited' : 'no_visit'
}
