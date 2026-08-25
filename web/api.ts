/** Typed fetch helpers for the local API. */

import type { AuditEvent, DiscoveryCounters, EmailLanguage, GlobePoint, LeadContact, LeadDelivery, LeadOutreach, LeadStatus, MarketScope } from '../shared/types'

export type Lead = {
  _id: string
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
  delivery: LeadDelivery & { followup?: number | null }
  outreach: LeadOutreach
  discovery: { query: string; city_label: string; discovered_at: string; search_category?: string | null }
  approved_at: string | null
  archived_at: string | null
  audit_trail: AuditEvent[]
  created_at: string
}

export type Analysis = {
  _id: string
  place_id: string
  summary: Record<string, unknown> & {
    editorial_summary: string | null
    hours_text: string[] | null
    photos_count: number
  }
  scoring: {
    rules_version: string
    overallScore: number
    priorityActions: string[]
    warnings: string[]
    categories: Array<{
      category: string
      label: string
      status: 'bom' | 'precisa_melhorar' | 'ausente'
      value: string | null
      recommendation: string
      score: number
    }>
  }
  website_audit: {
    pages_checked: Array<{ url: string; status: number | null; emails_found: number; note?: string }>
    robots_blocked: string[]
    forms: string[]
    phones: string[]
  } | null
}

export type Status = {
  active: boolean
  market_scope: MarketScope
  categories_total: number
  cities_total: number
  test_city: string | null
  leads_per_hour: number
  window_count: number
  window_started_at: string | null
  next_run_at: string | null
  counters: DiscoveryCounters
  queue_size: number
  current_city: string | null
  current_category: string | null
  selected_categories: string[]
  selected_countries: string[]
  categories_explored: number
  last_error: string | null
  email_mode: 'dry_run' | 'smtp' | 'resend'
  sender_name: string
  sender_email: string | null
  followup_after_days: number
  /** Follow-ups after the initial email (1–5). Step numbers run 0..this. */
  followup_steps: number
  counts: { pending: number; approved: number; sent: number; failed: number; archived: number; followup: number }
}

export type MarketInfo = {
  scope: MarketScope
  label: string
  countries: Array<{ code: string; name: string; language: EmailLanguage; cities: number }>
}

export type EmailPreview = {
  subject: string
  subject_variant: number
  followup: number
  language: string
  html: string
  text: string | null
  template_id: string | null
  template_name: string
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  return body
}

export const getStatus = () => request<Status>('/api/status')
export const getMarkets = () => request<MarketInfo[]>('/api/markets')
export const getGlobePoints = () => request<{ points: GlobePoint[] }>('/api/globe/points')
export const startDiscovery = () => request<{ ok: true }>('/api/discovery/start', { method: 'POST' })
export const stopDiscovery = () => request<{ ok: true }>('/api/discovery/stop', { method: 'POST' })
export const saveConfig = (config: {
  market_scope?: MarketScope
  test_city?: string | null
  selected_categories?: string[]
  selected_countries?: string[]
}) => request<{ ok: true }>('/api/discovery/config', { method: 'PUT', body: JSON.stringify(config) })
export const getCategories = () => request<{ categories: string[] }>('/api/categories')

/* ── settings (credentials live encrypted on the server) ─────────────────── */

export type AppSettings = {
  email: {
    mode: 'dry_run' | 'smtp' | 'resend'
    from_name: string
    from_email: string
    from_label: string
    reply_to_name: string
    reply_to_email: string
    reply_to_label: string
    resend_key_masked: string | null
    smtp_host: string
    smtp_port: number
    smtp_secure: boolean
    smtp_user: string
    smtp_pass_masked: string | null
    unsubscribe_base_url: string
  }
  offer: {
    brand_name: string
    what_we_sell: string
    site_url: string
    logo_url: string
    use_analysis_in_copy: boolean
  }
  ai: { anthropic_key_masked: string | null; model: string }
  places: { api_key_masked: string | null }
  discovery: { leads_per_hour: number; lead_retention_days: number; followup_after_days: number }
  landing: { mongodb_uri_masked: string | null; db_name: string }
  replies: {
    enabled: boolean
    receiving_domain: string
    local_part: string
    resend_key_masked: string | null
    ready: boolean
    not_ready_reason: string | null
  }
  encryption_ready: boolean
  email_ready: boolean
  email_not_ready_reason: string | null
  reply_tracking_ready: boolean
}

/** A secret field: omit to keep what is stored, '' to clear it. */
export type AppSettingsPatch = {
  email?: Partial<{
    mode: 'dry_run' | 'smtp' | 'resend'
    from_name: string
    from_email: string
    reply_to_name: string
    reply_to_email: string
    resend_key: string
    smtp_host: string
    smtp_port: number
    smtp_secure: boolean
    smtp_user: string
    smtp_pass: string
    unsubscribe_base_url: string
  }>
  offer?: Partial<{
    brand_name: string
    what_we_sell: string
    site_url: string
    logo_url: string
    use_analysis_in_copy: boolean
  }>
  ai?: Partial<{ anthropic_key: string; model: string }>
  places?: Partial<{ api_key: string }>
  discovery?: Partial<{ leads_per_hour: number; lead_retention_days: number; followup_after_days: number }>
  landing?: Partial<{ mongodb_uri: string; db_name: string }>
  replies?: Partial<{ enabled: boolean; receiving_domain: string; local_part: string; resend_key: string }>
}

export type AnthropicModel = { id: string; display_name: string; created_at: string | null }

export const getSettings = () => request<AppSettings>('/api/settings')
export const saveSettings = (patch: AppSettingsPatch) =>
  request<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) })
/* ── email templates ─────────────────────────────────────────────────────── */

export type TemplateVariant = {
  subject: string
  html: string
  text?: string | null
  preheader?: string | null
  band?: 'low' | 'high' | null
  needs_rating?: boolean
}

export type TemplateMessage = { followup: number; variants: TemplateVariant[] }

/** One language of a template — everything about it that is words. */
export type TemplateLanguage = {
  messages: TemplateMessage[]
  findings: Record<string, string>
  strings: Record<string, string>
  generation: { model: string | null; preset: string | null; brief: string | null; at: string | null } | null
}

/**
 * A template is a pitch, and the same pitch in every language it was written
 * in: targeting at the top level, words under `languages`.
 */
export type EmailTemplate = {
  _id: string
  name: string
  audience: string
  categories: string[]
  active: boolean
  priority: number
  low_score_variants: boolean
  assets: string[]
  notes: string
  /** The languages it carries, in the UI's fixed order. */
  language_codes: string[]
  languages: Record<string, TemplateLanguage>
  updated_at: string
}

export type TemplateLibrary = {
  templates: EmailTemplate[]
  placeholders: Array<{ token: string; description: string; group: string }>
  presets: Array<{ id: string; label: string; description: string }>
  languages: string[]
  max_followups: number
  model: string
  ai_ready: boolean
}

export const getTemplates = () => request<TemplateLibrary>('/api/templates')

/** The words of one language, as the editor sends them. */
export type TemplateLanguageInput = {
  messages: TemplateMessage[]
  findings?: Record<string, string>
  strings?: Record<string, string>
  generation?: { model?: string; preset?: string; brief?: string } | null
}

/** A new template starts with the one language it was written in. */
export const createTemplate = (
  body: {
    name: string
    audience?: string
    categories?: string[]
    language: string
    assets?: string[]
    low_score_variants?: boolean
    notes?: string
  } & TemplateLanguageInput,
) => request<{ template: EmailTemplate }>('/api/templates', { method: 'POST', body: JSON.stringify(body) })

/** The pitch: who it targets and how it behaves — never its words. */
export type TemplateSettingsPatch = Partial<
  Pick<EmailTemplate, 'name' | 'audience' | 'categories' | 'active' | 'priority' | 'notes' | 'assets' | 'low_score_variants'>
>
export const updateTemplate = (id: string, body: TemplateSettingsPatch) =>
  request<{ template: EmailTemplate }>(`/api/templates/${id}`, { method: 'PUT', body: JSON.stringify(body) })

/** Write (or rewrite) one language of a template. */
export const saveTemplateLanguage = (id: string, lang: string, body: TemplateLanguageInput) =>
  request<{ template: EmailTemplate }>(`/api/templates/${id}/languages/${encodeURIComponent(lang)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
export const deleteTemplateLanguage = (id: string, lang: string) =>
  request<{ template: EmailTemplate }>(`/api/templates/${id}/languages/${encodeURIComponent(lang)}`, { method: 'DELETE' })

export const deleteTemplate = (id: string) =>
  request<{ ok: true }>(`/api/templates/${id}`, { method: 'DELETE' })
export const previewTemplate = (body: {
  subject: string
  html?: string
  text?: string | null
  preheader?: string | null
  language?: string
  assets?: string[]
  findings?: Record<string, string>
  strings?: Record<string, string>
}) =>
  request<{ subject: string; html: string; text: string }>('/api/templates/preview', {
    method: 'POST',
    body: JSON.stringify(body),
  })
export const generateTemplate = (body: {
  preset: string
  brief: string
  language: string
  audience: string
  categories: string[]
  assets: string[]
  steps?: number
  variants_per_step?: number
  bands?: boolean
}) =>
  request<{
    messages: Array<{ followup: number; variants: Array<{ subject: string; html: string; preheader: string; band: 'low' | 'high' | null }> }>
    model: string
    preset: string
    language: string
  }>(
    '/api/templates/generate',
    { method: 'POST', body: JSON.stringify(body) },
  )

export const listAnthropicModels = (apiKey?: string) =>
  request<{ models: AnthropicModel[] }>('/api/settings/anthropic/models', {
    method: 'POST',
    body: JSON.stringify({ api_key: apiKey ?? '' }),
  })

export const getLeads = (params: Record<string, string | string[]>) => {
  const qs = new URLSearchParams()
  // A multi-select filter repeats its key — ?category=A&category=B — which is
  // what Express parses back into an array.
  for (const [key, value] of Object.entries(params)) {
    for (const one of Array.isArray(value) ? value : [value]) qs.append(key, one)
  }
  return request<{ source: string; leads: Lead[]; total: number; page: number; page_size: number }>(
    `/api/leads?${qs}`,
  )
}

/** The category filter's options: what this tab actually holds, with counts. */
export const getLeadCategories = (status: string) =>
  request<{ categories: Array<{ name: string; count: number }> }>(
    `/api/leads/categories?status=${encodeURIComponent(status)}`,
  )
export const getLead = (id: string) => request<{ source: string; lead: Lead; analysis: Analysis | null }>(`/api/leads/${id}`)
export const getEmailPreview = (id: string, opts: { lang?: string; template?: string; followup?: number } = {}) => {
  const params = new URLSearchParams()
  if (opts.lang) params.set('lang', opts.lang)
  if (opts.template) params.set('template', opts.template)
  if (opts.followup) params.set('followup', String(opts.followup))
  const qs = params.toString()
  return request<EmailPreview>(`/api/leads/${id}/email-preview${qs ? `?${qs}` : ''}`)
}

/** Preview a one-off email against THIS lead, without saving anything. */
export const previewOneOff = (id: string, body: { subject: string; html?: string; text?: string }) =>
  request<EmailPreview>(`/api/leads/${id}/email-preview`, { method: 'POST', body: JSON.stringify(body) })

/** Every template this lead may be sent with — the resolved one flagged. */
export type LeadTemplateOptions = {
  suggested_id: string | null
  chosen_id: string | null
  /** Decided by the country the lead was found in — not a choice on this screen. */
  lead_language: string
  templates: Array<{
    id: string
    name: string
    audience: string
    categories: string[]
    /** Which steps each language of this template can send. */
    steps_by_language: Record<string, number[]>
  }>
}
export const getLeadTemplates = (id: string, followup = 0) =>
  request<LeadTemplateOptions>(`/api/leads/${id}/templates?followup=${followup}`)
export const chooseLeadTemplate = (id: string, templateId: string, followup = 0) =>
  request<{ ok: true }>(`/api/leads/${id}/template`, {
    method: 'PUT',
    body: JSON.stringify({ template_id: templateId, followup }),
  })
export const sendFollowup = (id: string) =>
  request<{ ok: boolean; delivery: LeadDelivery }>(`/api/approved/${id}/followup`, { method: 'POST' })
export const stopFollowups = (id: string) =>
  request<{ ok: true }>(`/api/approved/${id}/followup-stop`, { method: 'POST' })
export const doNotContactApproved = (id: string) =>
  request<{ ok: true }>(`/api/approved/${id}/do-not-contact`, { method: 'POST' })

export const approveLead = (id: string, recipient: string) =>
  request<{ ok: boolean; lead: Lead; delivery: LeadDelivery }>(`/api/leads/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ recipient }),
  })
export const skipLead = (id: string) => request<{ ok: true }>(`/api/leads/${id}/skip`, { method: 'POST' })
export const reopenLead = (id: string) => request<{ ok: true }>(`/api/leads/${id}/reopen`, { method: 'POST' })
export const doNotContactLead = (id: string) => request<{ ok: true }>(`/api/leads/${id}/do-not-contact`, { method: 'POST' })
export const selectEmail = (id: string, email: string) =>
  request<{ ok: true }>(`/api/leads/${id}/select-email`, { method: 'POST', body: JSON.stringify({ email }) })
export const addEmail = (id: string, email: string) =>
  request<{ ok: true }>(`/api/leads/${id}/add-email`, { method: 'POST', body: JSON.stringify({ email }) })
export const retryDelivery = (id: string) =>
  request<{ ok: boolean; delivery: LeadDelivery }>(`/api/approved/${id}/retry`, { method: 'POST' })

/* ── cold-email analytics (/email-analytics) ─────────────────────────────
   Measures CONSENTED LANDING VISITS — never "email opens" (no pixel). */

export type SendLandingStatus = 'visited' | 'no_visit' | 'untracked' | 'failed' | 'queued' | 'dry_run' | 'bounced'
export type SendReplyStatus = 'replied' | 'no_reply' | 'untracked' | 'automatic' | 'failed' | 'queued' | 'dry_run' | 'bounced'

export type EmailSendRow = {
  id: string
  place_id: string
  lead_name: string
  recipient: string
  language: string | null
  campaign: string | null
  search_category: string | null
  template_id: string | null
  template_key: string | null
  template_name: string | null
  variant: number | null
  variant_fingerprint: string | null
  variant_subject: string | null
  variant_band: string | null
  followup: number
  attempt: number
  status: 'queued' | 'sent' | 'sent_dry_run' | 'failed'
  sent_at: string | null
  message_id: string | null
  error: string | null
  backfilled: boolean
  created_at: string | null
  tracked: boolean
  /** Masked (never the full hash, never the raw rid). */
  tracking_hash_masked: string | null
  landing_status: SendLandingStatus
  reply_status: SendReplyStatus
  landing_visit: {
    matched: boolean
    event_count: number
    first_observed_at: string | null
    last_observed_at: string | null
    synced_at: string | null
  }
  reply_summary: {
    matched: boolean
    event_count: number
    automatic_count: number
    first_observed_at: string | null
    last_observed_at: string | null
    unread_count: number
    synced_at: string | null
  }
}

export type BreakdownRow = {
  key: string
  sent: number
  visited: number
  rate: number
  replied: number
  reply_rate: number
  human_replies: number
  sessions: number
  median_hours_to_first_visit: number | null
  median_hours_to_first_reply: number | null
}

export type AnalyticsOverview = {
  range: { from: string; to: string }
  totals: {
    emails_sent: number
    visited_sends: number
    landing_visit_rate: number
    replied_sends: number
    reply_rate: number
    unique_replied_leads: number
    human_replies: number
    median_hours_to_first_reply: number | null
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
  timeseries: Array<{ day: string; sent: number; visited: number; replied: number; rate: number; reply_rate: number }>
  breakdowns: Record<'template' | 'variant' | 'campaign' | 'attempt' | 'category', BreakdownRow[]>
  sync: {
    last_synced_at: string | null
    last_sync_ok: boolean | null
    last_sync_error: string | null
    last_sync_sends: number
    last_sync_events: number
    /** Cold-email visits on the landing that belong to no send of ours. */
    last_sync_unattributed: number
  }
}

export type SyncResult = {
  ok: boolean
  synced_at: string
  sends_with_tracking: number
  matched_sends: number
  events_seen: number
  unattributed_events: number
  backfilled_rows: number
  error: string | null
}

export type SendTimelineEntry = { at: string | null; event: string; detail?: string }

const toQuery = (params: Record<string, string>) => {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== ''))
  const qs = new URLSearchParams(clean).toString()
  return qs ? `?${qs}` : ''
}

export const getAnalyticsOverview = (params: Record<string, string>) =>
  request<AnalyticsOverview>(`/api/analytics/overview${toQuery(params)}`)
export const getAnalyticsSends = (params: Record<string, string>) =>
  request<{ total: number; page: number; page_size: number; sends: EmailSendRow[] }>(
    `/api/analytics/sends${toQuery(params)}`,
  )
export const getSendDetail = (id: string) =>
  request<{ send: EmailSendRow; timeline: SendTimelineEntry[] }>(`/api/analytics/sends/${id}`)
export const runAnalyticsSync = () =>
  request<SyncResult>('/api/analytics/sync', { method: 'POST' })
export const sendsCsvUrl = (params: Record<string, string>) => `/api/analytics/sends.csv${toQuery(params)}`
