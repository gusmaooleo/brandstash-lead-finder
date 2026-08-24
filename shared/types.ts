/** Domain types shared between the server and the web UI. */

export type MarketScope =
  | 'world'
  | 'english'
  | 'portuguese'
  | 'spanish'
  | 'france'
  | 'german'
  | 'mandarin_taiwan'
  | 'cantonese_hk_macau'
  | 'korean'
  | 'japanese'

/**
 * Every language outreach can be written in — one per market scope and nothing
 * else. A language no market can reach would be copy that never gets sent, so
 * this list and MARKET_COUNTRIES are held in step by the coverage test suite.
 * Order is the order the UI offers them in.
 */
export const EMAIL_LANGUAGES = ['en', 'pt', 'es', 'fr', 'de', 'zh-TW', 'zh-HK', 'ja', 'ko'] as const

export type EmailLanguage = (typeof EMAIL_LANGUAGES)[number]

export function isEmailLanguage(value: unknown): value is EmailLanguage {
  return typeof value === 'string' && (EMAIL_LANGUAGES as readonly string[]).includes(value)
}

/**
 * The CATALOG category a lead was discovered under ("Marketing agency") — the
 * vocabulary the header picker, the table filter and the templates all speak.
 * It is stored on the lead; leads queued before the field existed carry it
 * only inside their search query ("<category> in <City, Country>"), and no
 * catalog name contains " in ", so the LAST separator is the one that splits.
 *
 * Lives here because the server queries by it and the UI shows it: one rule,
 * or the column and the filter would disagree about what a lead's category is.
 */
export function searchedCategory(lead: {
  discovery?: { query?: string | null; search_category?: string | null } | null
}): string | null {
  const stored = lead.discovery?.search_category
  if (stored) return stored
  const query = lead.discovery?.query
  if (!query) return null
  const cut = query.lastIndexOf(' in ')
  return cut > 0 ? query.slice(0, cut).trim() : null
}

/**
 * Human review state of a lead in `approval_list`. 'archived' = soft-hidden
 * by the retention sweep (LEAD_RETENTION_DAYS); reopenable at any time.
 */
export type LeadStatus = 'pending' | 'approved' | 'skipped' | 'do_not_contact' | 'archived'

/** Outbound delivery state (lives on approved leads). */
export type DeliveryState = 'not_sent' | 'sent' | 'sent_dry_run' | 'failed'

/** Follow-up sequence state (initial send plus the configured follow-ups). */
export type LeadOutreach = {
  count: number
  last_sent_at: string | null
  stopped_at: string | null
  variants: number[]
}

/**
 * own = the business's bought domain; freemail = gmail-style consumer mailbox
 * (first-class — many small businesses have no domain); third_party = someone
 * else's company (agency, platform, group HQ) — ranked last by the recipient
 * election, elected only when nothing better exists, and badged "may be
 * third-party" in the UI. Absent on legacy records and manual entries.
 */
export type EmailDomainKind = 'own' | 'freemail' | 'third_party'

export type ContactEmail = {
  address: string
  /** Page the address was found on (official site only). */
  source_url: string
  /** True when the local part is a generic business inbox (contact@, hello@…). */
  generic: boolean
  kind?: EmailDomainKind | null
  /** MX verification: 'no_mx' = guaranteed bounce; null = unchecked/inconclusive. */
  mx?: 'ok' | 'no_mx' | null
}

export type LeadContact = {
  emails: ContactEmail[]
  selected_email: string | null
  forms: string[]
  phones: string[]
}

export type LeadDelivery = {
  state: DeliveryState
  attempts: number
  last_error: string | null
  sent_at: string | null
  message_id: string | null
  subject: string | null
  subject_variant: number | null
  language: EmailLanguage | null
  unsubscribe_token: string | null
}

export type AuditEvent = {
  at: string
  event: string
  detail?: string
}

/** A lead as served to the UI (from approval_list or approved). */
export type LeadDto = {
  id: string
  place_id: string
  analysis_id: string
  normalized_domain: string | null
  name: string
  address: string | null
  city_label: string
  country: string
  language: EmailLanguage
  market_scope: MarketScope
  website: string | null
  google_rating: number | null
  review_count: number | null
  category: string | null
  types: string[]
  score: number
  location: { lat: number; lng: number } | null
  contact: LeadContact
  status: LeadStatus
  delivery: LeadDelivery
  outreach: LeadOutreach
  discovery: { query: string; city_label: string; discovered_at: string }
  approved_at: string | null
  archived_at: string | null
  audit_trail: AuditEvent[]
  created_at: string
}

/** One dot on the dashboard globe (id/name/score power tooltip + click-through). */
export type GlobePoint = {
  id: string
  lat: number
  lng: number
  kind: 'discovered' | 'sent'
  name: string
  score: number
}

export type DiscoveryCounters = {
  discovered: number
  duplicates_skipped: number
  failures: number
}

export type DiscoveryStatusDto = {
  active: boolean
  market_scope: MarketScope
  /** Size of the full Google Business category catalog being rotated. */
  categories_total: number
  /** GeoNames plan cities in the selected market's weighted random pool. */
  cities_total: number
  test_city: string | null
  leads_per_hour: number
  /** New (non-duplicate) leads queued this hourly window — duplicates never count. */
  window_count: number
  window_started_at: string | null
  next_run_at: string | null
  counters: DiscoveryCounters
  queue_size: number
  current_city: string | null
  current_category: string | null
  /** Owner-picked category subset (empty = whole catalog). */
  selected_categories: string[]
  /** Owner-picked countries within the market (empty = every country of it). */
  selected_countries: string[]
  /** Distinct categories searched at least once anywhere (election coverage). */
  categories_explored: number
  last_error: string | null
  email_mode: 'dry_run' | 'smtp' | 'resend'
}

/** Score visual bands — the same thresholds the scoring engine uses. */
export function scoreBand(score: number): 'good' | 'mid' | 'low' {
  if (score >= 7) return 'good'
  if (score >= 4) return 'mid'
  return 'low'
}

export const SCORE_BAND_COLORS: Record<'good' | 'mid' | 'low', string> = {
  // light-theme chart tokens (src/index.css .light --chart-1/2/3).
  good: '#059669',
  mid: '#d97706',
  low: '#dc2626',
}
