/**
 * `email_templates` — WHICH copy a lead receives.
 *
 * Every template lives HERE, in the database: subject + HTML per message of
 * the sequence, written by hand or generated, for one language, optionally
 * bound to categories. No copy of any kind exists in the code — a fresh
 * install starts with an empty library and the app says so.
 *
 * A message carries VARIANTS: different angles on the same step, picked
 * deterministically per lead (same lead ⇒ same angle, and a follow-up never
 * repeats an angle already sent). With `low_score_variants` on, the pick is
 * narrowed by the lead's score band, so a well-rated business and a neglected
 * one can be approached differently.
 *
 * `findings` are the phrases the {{finding_1}} / {{finding_2}} tokens resolve
 * to. WHICH finding applies is a rule (photos missing, few reviews, no hours…)
 * and lives in code; HOW it is phrased is copy and lives here, per template.
 *
 * Routing rule: a template whose `categories` match the lead wins over a
 * generic one (empty `categories` = every category). Ties break toward the
 * most specific list, then the most recently updated. See template-store.ts.
 */

import mongoose, { Schema, type InferSchemaType } from 'mongoose'

/** Which score band a variant is written for. null = any lead. */
export const VARIANT_BANDS = [null, 'low', 'high'] as const

/** One angle of one message. Variant 0 is the one a simple template has. */
const templateVariantSchema = new Schema(
  {
    subject: { type: String, required: true },
    html: { type: String, required: true },
    /** Optional text/plain alternative; derived from the HTML when absent. */
    text: { type: String, default: null },
    /**
     * Only consulted when the template has `low_score_variants` on: 'low' is
     * written for a lead whose profile scores poorly, 'high' for a strong one.
     * null = fits any band.
     */
    band: { type: String, default: null, enum: VARIANT_BANDS },
  },
  { _id: false },
)

/** One step of the sequence: 0 = initial send, 1..5 = follow-ups. */
const templateMessageSchema = new Schema(
  {
    followup: { type: Number, required: true, min: 0, max: 5 },
    variants: { type: [templateVariantSchema], default: [] },
  },
  { _id: false },
)

/**
 * The phrasing of each finding the rules engine can raise about a lead's
 * public profile. Empty string = this template says nothing about it, and the
 * token resolves to nothing rather than to someone else's words.
 */
const templateFindingsSchema = new Schema(
  {
    no_photos: { type: String, default: '' },
    /** May use {{count}} — the number of photos found. */
    few_photos: { type: String, default: '' },
    no_reviews: { type: String, default: '' },
    /** May use {{count}} — the number of reviews found. */
    few_reviews: { type: String, default: '' },
    no_hours: { type: String, default: '' },
    no_description: { type: String, default: '' },
    /** Fallback when the profile has no real gap. */
    clean: { type: String, default: '' },
  },
  { _id: false },
)

const generationSchema = new Schema(
  {
    model: { type: String, default: null },
    /** Prompt preset used ('joe_girard_note', 'free'…). */
    preset: { type: String, default: null },
    /** The owner's brief — kept so a template can be regenerated/iterated. */
    brief: { type: String, default: null },
    at: { type: Date, default: null },
  },
  { _id: false },
)

const emailTemplateSchema = new Schema(
  {
    name: { type: String, required: true },
    /** Free-text label shown in the UI ('business', 'agency', 'ecommerce'…). */
    audience: { type: String, default: 'custom' },
    /** Catalog category names ("Marketing agency"). Empty = every category. */
    categories: { type: [String], default: [] },
    /** The language this copy is written in. */
    language: { type: String, default: null },
    active: { type: Boolean, default: true, index: true },
    /** Lower runs first when two templates match equally. */
    priority: { type: Number, default: 0 },
    messages: { type: [templateMessageSchema], default: [] },
    findings: { type: templateFindingsSchema, default: () => ({}) },
    /** Opt-in: pick the variant by the lead's score band, not just by hash. */
    low_score_variants: { type: Boolean, default: false },
    /** Image URLs this template may place — {{logo_url}}, {{asset_1}}…. */
    assets: { type: [String], default: [] },
    generation: { type: generationSchema, default: null },
    notes: { type: String, default: '' },
  },
  { collection: 'email_templates', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
)
emailTemplateSchema.index({ active: 1, updated_at: -1 })

export type EmailTemplateDoc = mongoose.HydratedDocument<InferSchemaType<typeof emailTemplateSchema>>
export const EmailTemplate = mongoose.model('EmailTemplate', emailTemplateSchema)
