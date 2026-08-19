/**
 * `email_templates` — WHICH copy a lead receives.
 *
 * ONE DOCUMENT PER TEMPLATE. A template is a pitch ("agencies — multi-client
 * panel"), and a pitch is the same pitch in every language: who it targets
 * (`categories`, `audience`), how it picks angles and how it is switched off
 * are decided once, at the top level. Only the WORDS differ per language, so
 * every language lives as one entry of `languages` — subject, HTML, findings
 * and the template's own dictionary, all of it copy.
 *
 * That shape is what makes the UI honest: the lead screen offers templates and
 * then a language, never a flat list of the same pitch repeated ten times, and
 * adding a language to a template is adding a key here, not cloning a document
 * whose targeting can silently drift from its siblings'.
 *
 * Every template lives HERE, in the database — no copy of any kind exists in
 * the code, and a fresh install starts with an empty library and says so.
 *
 * A message carries VARIANTS: different angles on the same step, picked
 * deterministically per lead (same lead ⇒ same angle, and a follow-up never
 * repeats an angle already sent). With `low_score_variants` on, the pick is
 * narrowed by the lead's score band, so a well-rated business and a neglected
 * one can be approached differently.
 *
 * `findings` are the phrases the {{finding_1}} / {{finding_2}} tokens resolve
 * to. WHICH finding applies is a rule (photos missing, few reviews, no hours…)
 * and lives in code; HOW it is phrased is copy and lives here, per language.
 *
 * Routing rule: a template whose `categories` match the lead wins over a
 * generic one (empty `categories` = every category), among those carrying the
 * lead's language. Ties break toward the most specific list, then the most
 * recently updated. See template-store.ts.
 */

import mongoose, { Schema, type InferSchemaType } from 'mongoose'
import { EMAIL_LANGUAGES } from '../../shared/types'

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
    /** This angle names the lead's rating, so an unrated lead can't get it. */
    needs_rating: { type: Boolean, default: false },
    /**
     * The hidden line mail clients show next to the subject. Tokens are
     * resolved and the result is trimmed to the preview length, which is why
     * it is a field and not markup: only the renderer knows the final text.
     */
    preheader: { type: String, default: '' },
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
    /** The owner's brief — kept so a version can be regenerated/iterated. */
    brief: { type: String, default: null },
    at: { type: Date, default: null },
  },
  { _id: false },
)

/**
 * One language of a template: everything about it that is WORDS. Written by
 * hand or generated, one language at a time — a template with a single
 * language is complete and sends to the leads that speak it.
 */
const templateLanguageSchema = new Schema(
  {
    messages: { type: [templateMessageSchema], default: [] },
    findings: { type: templateFindingsSchema, default: () => ({}) },
    /**
     * This language's own dictionary: how it names each analysis category
     * ('fotos' → "Photos") and how it phrases each opportunity
     * ('fotos_ausente' → "Add photos…"). Keeps every word out of the code.
     */
    strings: { type: Map, of: String, default: () => new Map() },
    /** How this language version was produced, when Claude wrote it. */
    generation: { type: generationSchema, default: null },
  },
  { _id: false },
)

const emailTemplateSchema = new Schema(
  {
    /** The pitch's name — language-neutral: it names the angle, not a locale. */
    name: { type: String, required: true },
    /** Free-text label shown in the UI ('business', 'agency', 'ecommerce'…). */
    audience: { type: String, default: 'custom' },
    /** Catalog category names ("Marketing agency"). Empty = every category. */
    categories: { type: [String], default: [] },
    active: { type: Boolean, default: true, index: true },
    /** Lower runs first when two templates match equally. */
    priority: { type: Number, default: 0 },
    /** Opt-in: pick the variant by the lead's score band, not just by hash. */
    low_score_variants: { type: Boolean, default: false },
    /** Image URLs this template may place — {{logo_url}}, {{asset_1}}…. */
    assets: { type: [String], default: [] },
    /** The copy, keyed by email language. See templateLanguageSchema. */
    languages: { type: Map, of: templateLanguageSchema, default: () => new Map() },
    notes: { type: String, default: '' },
  },
  { collection: 'email_templates', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
)
emailTemplateSchema.index({ active: 1, updated_at: -1 })

/** Languages a stored template carries, in the UI's fixed order. */
export function languagesOf(doc: Pick<EmailTemplateDoc, 'languages'>): string[] {
  const present = doc.languages instanceof Map ? [...doc.languages.keys()] : Object.keys(doc.languages ?? {})
  const known = new Set(present)
  return EMAIL_LANGUAGES.filter((l) => known.has(l))
}

export type EmailTemplateDoc = mongoose.HydratedDocument<InferSchemaType<typeof emailTemplateSchema>>
export type TemplateLanguageDoc = InferSchemaType<typeof templateLanguageSchema>
export const EmailTemplate = mongoose.model('EmailTemplate', emailTemplateSchema)
