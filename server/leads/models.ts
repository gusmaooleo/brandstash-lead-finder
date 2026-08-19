/**
 * MongoDB collections + indexes.
 *
 * Dedup guarantees:
 *  - `discovered_places` is the permanent registry: one row per Google Place ID
 *    ever seen (unique index), with the normalized website domain as an
 *    additional dedup signal. Restart-safe — discovery consults it before any
 *    analysis or enrichment, so a business is never processed or emailed twice.
 *  - `approval_list` / `approved` also carry a unique `place_id` as a backstop.
 */

import mongoose, { Schema, type InferSchemaType } from 'mongoose'

const contactEmailSchema = new Schema(
  {
    address: { type: String, required: true },
    source_url: { type: String, required: true },
    generic: { type: Boolean, required: true },
    kind: { type: String, default: null },
    /** MX verification: 'ok' | 'no_mx' | null (unchecked/inconclusive). */
    mx: { type: String, default: null },
  },
  { _id: false },
)

const contactSchema = new Schema(
  {
    emails: { type: [contactEmailSchema], default: [] },
    selected_email: { type: String, default: null },
    forms: { type: [String], default: [] },
    phones: { type: [String], default: [] },
  },
  { _id: false },
)

const deliverySchema = new Schema(
  {
    state: { type: String, default: 'not_sent', index: true },
    attempts: { type: Number, default: 0 },
    last_error: { type: String, default: null },
    sent_at: { type: Date, default: null },
    message_id: { type: String, default: null },
    subject: { type: String, default: null },
    subject_variant: { type: Number, default: null },
    /** 'note' (personal note, default) | 'dashboard' — of the LAST send. */
    style: { type: String, default: null },
    /** 0 = initial send, 1 = bump, 2 = breakup — of the last send. */
    followup: { type: Number, default: null },
    language: { type: String, default: null },
    unsubscribe_token: { type: String, default: null, index: true },
  },
  { _id: false },
)

/**
 * Outreach sequence state (initial send + up to two follow-ups). A lead is
 * DUE for a follow-up when: 1 ≤ count < 3, last_sent_at older than
 * the configured follow-up delay, not stopped, last delivery succeeded.
 */
const outreachSchema = new Schema(
  {
    count: { type: Number, default: 0 },
    last_sent_at: { type: Date, default: null },
    stopped_at: { type: Date, default: null },
    /** Note variants already used — follow-ups must pick a different one. */
    variants: { type: [Number], default: [] },
    /**
     * The template that opened this sequence (email/template-store.ts). Every
     * follow-up reuses it, so a lead never gets message 1 in one voice and the
     * bump in another because the library changed in between.
     */
    template_id: { type: String, default: null },
  },
  { _id: false },
)

const discoveryMetaSchema = new Schema(
  {
    query: { type: String, required: true },
    city_label: { type: String, required: true },
    discovered_at: { type: Date, required: true },
    /**
     * The CATALOG category this lead was searched under ("Marketing agency")
     * — the vocabulary the header picker and the email templates use, which
     * is not always the Places primaryType stored in `category`
     * ("Abarth dealer" → car_dealer). Absent on leads queued before the
     * field existed; recovered from `query` (see email/audience.ts).
     */
    search_category: { type: String, default: null },
  },
  { _id: false },
)

const locationSchema = new Schema(
  { lat: { type: Number, required: true }, lng: { type: Number, required: true } },
  { _id: false },
)

const auditEventSchema = new Schema(
  { at: { type: Date, required: true }, event: { type: String, required: true }, detail: String },
  { _id: false },
)

const leadFields = {
  place_id: { type: String, required: true, unique: true },
  analysis_id: { type: Schema.Types.ObjectId, ref: 'AnalysisData', required: true, index: true },
  normalized_domain: { type: String, default: null, index: true },
  name: { type: String, required: true },
  address: { type: String, default: null },
  city_label: { type: String, required: true },
  country: { type: String, required: true, index: true },
  language: { type: String, required: true, index: true },
  market_scope: { type: String, required: true },
  website: { type: String, default: null },
  google_rating: { type: Number, default: null },
  review_count: { type: Number, default: null },
  category: { type: String, default: null, index: true },
  types: { type: [String], default: [] },
  score: { type: Number, required: true, index: true },
  /** Place geometry (Places `location` field) — feeds the dashboard globe. */
  location: { type: locationSchema, default: null },
  contact: { type: contactSchema, required: true, default: () => ({}) },
  /** Outreach format: 'note' (personal note — default) | 'dashboard'. */
  email_style: { type: String, required: true, default: 'note' },
  status: { type: String, required: true, default: 'pending', index: true },
  delivery: { type: deliverySchema, required: true, default: () => ({}) },
  outreach: { type: outreachSchema, required: true, default: () => ({}) },
  discovery: { type: discoveryMetaSchema, required: true },
  /** Set exactly once when the lead moves approval_list → approved. */
  approved_at: { type: Date, default: null, index: true },
  /** Retention sweep: when a stale pending lead was hidden. */
  archived_at: { type: Date, default: null },
  audit_trail: { type: [auditEventSchema], default: [] },
} as const

const approvalListSchema = new Schema(leadFields, {
  collection: 'approval_list',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
approvalListSchema.index({ created_at: -1 })

/** Approved leads are MOVED here from approval_list (same shape, audit preserved). */
const approvedSchema = new Schema(leadFields, {
  collection: 'approved',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
approvedSchema.index({ created_at: -1 })

const analysisDataSchema = new Schema(
  {
    place_id: { type: String, required: true, unique: true },
    summary: { type: Schema.Types.Mixed, required: true },
    scoring: { type: Schema.Types.Mixed, required: true },
    website_audit: { type: Schema.Types.Mixed, default: null },
    briefing_industry: { type: String, default: null },
  },
  { collection: 'analysis_data', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
)

const discoveredPlaceSchema = new Schema(
  {
    place_id: { type: String, required: true, unique: true },
    normalized_domain: { type: String, default: null, index: true },
    name: { type: String, required: true },
    outcome: {
      type: String,
      required: true,
      // queued        → became a lead in approval_list
      // duplicate_domain → same normalized domain already seen
      // no_website / closed / enrich_failed → inspected and discarded
      // blocked_type  → public body/infrastructure/worship (primaryType blocklist)
      enum: ['queued', 'duplicate_domain', 'no_website', 'closed', 'enrich_failed', 'blocked_type'],
    },
    first_seen_at: { type: Date, required: true },
  },
  { collection: 'discovered_places' },
)

/**
 * Per-city search progress: which categories this city has already completed
 * (random ELECTION picks the next one — see discovery/election.ts; there is
 * no alphabetical rotation anymore), the pending Text Search page token with
 * the category it belongs to, and whether the city exhausted the FULL
 * catalog (drops out of the draw until the whole market wraps).
 * Restart-safe by construction — one row per (country, city).
 */
const cityProgressSchema = new Schema(
  {
    country: { type: String, required: true },
    city: { type: String, required: true },
    /** US state name; empty string elsewhere (part of the unique key). */
    admin1: { type: String, default: '' },
    /** Category the pending page_token belongs to (null = no batch open). */
    current_category: { type: String, default: null },
    page_token: { type: String, default: null },
    /** Categories fully searched in this city — never re-queried here. */
    categories_done: { type: [String], default: [] },
    exhausted_at: { type: Date, default: null },
  },
  { collection: 'city_progress', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
)
cityProgressSchema.index({ country: 1, admin1: 1, city: 1 }, { unique: true })
cityProgressSchema.index({ country: 1, exhausted_at: 1 })

/**
 * Global per-category usage counter — the election's weights. Incremented
 * every time a (city, category) page chain completes anywhere; categories
 * with fewer uses get proportionally higher odds (1 / (1 + uses)).
 */
const categoryUsageSchema = new Schema(
  {
    category: { type: String, required: true, unique: true },
    uses: { type: Number, required: true, default: 0 },
    last_used_at: { type: Date, default: null },
  },
  { collection: 'category_usage', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
)

const suppressionSchema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    reason: { type: String, required: true, enum: ['unsubscribed', 'manual', 'complaint'] },
  },
  { collection: 'suppression_list', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
)

/**
 * Addresses that provably don't accept mail (hard bounce / provider bounce /
 * complaint). Permanent — never offered as a recipient, every send blocked
 * against it. Separate from suppression: dead ≠ asked-to-stop.
 */
const deadAddressSchema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    reason: { type: String, required: true, enum: ['hard_bounce', 'provider_bounce', 'complaint'] },
    detail: { type: String, default: null },
  },
  { collection: 'dead_addresses', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
)

const windowSchema = new Schema(
  {
    started_at: { type: Date, default: null },
    count: { type: Number, default: 0 },
  },
  { _id: false },
)

const countersSchema = new Schema(
  {
    discovered: { type: Number, default: 0 },
    duplicates_skipped: { type: Number, default: 0 },
    failures: { type: Number, default: 0 },
  },
  { _id: false },
)

const discoveryStateSchema = new Schema(
  {
    _id: { type: String, default: 'state' },
    active: { type: Boolean, default: false },
    market_scope: { type: String, default: 'portuguese' },
    /** MVP validation: fixed city override. null = use the market city rotation. */
    test_city: { type: String, default: null },
    /**
     * Owner-picked category subset (header chips picker). Empty = the whole
     * catalog. The election draws only from this pool.
     */
    selected_categories: { type: [String], default: [] },
    /**
     * Owner-picked countries WITHIN the market (ISO codes) — "English, but
     * only US + AU". Empty = every country the market covers. Cleared when
     * the market changes, since the codes belong to that market.
     */
    selected_countries: { type: [String], default: [] },
    window: { type: windowSchema, required: true, default: () => ({}) },
    next_run_at: { type: Date, default: null },
    counters: { type: countersSchema, required: true, default: () => ({}) },
    current_city: { type: String, default: null },
    current_category: { type: String, default: null },
    last_error: { type: String, default: null },
  },
  { collection: 'discovery_state', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
)

export type LeadDoc = mongoose.HydratedDocument<InferSchemaType<typeof approvalListSchema>>
export type AnalysisDoc = mongoose.HydratedDocument<InferSchemaType<typeof analysisDataSchema>>
export type DiscoveryStateDoc = mongoose.HydratedDocument<InferSchemaType<typeof discoveryStateSchema>>

export type CityProgressDoc = mongoose.HydratedDocument<InferSchemaType<typeof cityProgressSchema>>

export const ApprovalList = mongoose.model('ApprovalList', approvalListSchema)
export const Approved = mongoose.model('Approved', approvedSchema)
export const AnalysisData = mongoose.model('AnalysisData', analysisDataSchema)
export const DiscoveredPlace = mongoose.model('DiscoveredPlace', discoveredPlaceSchema)
export const CityProgress = mongoose.model('CityProgress', cityProgressSchema)
export const CategoryUsage = mongoose.model('CategoryUsage', categoryUsageSchema)
export const Suppression = mongoose.model('Suppression', suppressionSchema)
export const DeadAddress = mongoose.model('DeadAddress', deadAddressSchema)
export const DiscoveryState = mongoose.model('DiscoveryState', discoveryStateSchema)

export async function getDiscoveryState(): Promise<DiscoveryStateDoc> {
  return DiscoveryState.findByIdAndUpdate(
    'state',
    { $setOnInsert: {} },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ) as Promise<DiscoveryStateDoc>
}
