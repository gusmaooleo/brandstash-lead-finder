/**
 * `email_templates` — WHICH copy a lead receives.
 *
 * Two kinds live side by side:
 *  - `builtin`: the packs written in code (business note, agency note,
 *    dashboard report). The row carries only their metadata — which
 *    categories they serve and whether they are active — so the owner can
 *    retarget or disable them without touching code. Their text is not
 *    editable here: it is localized in 10 languages by hand.
 *  - `custom`: HTML written in Settings → Generate (by Claude or by hand).
 *    Carries its own subject + HTML per message of the sequence, for ONE
 *    language, and is normally bound to specific categories.
 *
 * Routing rule: a template whose `categories` match the lead wins over a
 * generic one (empty `categories` = every category). Ties break toward the
 * most specific list, then the most recently updated. See template-store.ts.
 */

import mongoose, { Schema, type InferSchemaType } from 'mongoose'

/** One message of the sequence: 0 = initial, 1 = bump, 2 = breakup. */
const templateMessageSchema = new Schema(
  {
    followup: { type: Number, required: true, min: 0, max: 2 },
    subject: { type: String, required: true },
    html: { type: String, required: true },
    /** Optional text/plain alternative; derived from the HTML when absent. */
    text: { type: String, default: null },
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
    assets: { type: [String], default: [] },
    at: { type: Date, default: null },
  },
  { _id: false },
)

const emailTemplateSchema = new Schema(
  {
    name: { type: String, required: true },
    kind: { type: String, required: true, enum: ['builtin', 'custom'] },
    /** builtin only: which coded pack renders it. */
    builtin_pack: { type: String, default: null, enum: [null, 'business_note', 'agency_note', 'dashboard'] },
    /** Free-text label shown in the UI ('business', 'agency', 'ecommerce'…). */
    audience: { type: String, default: 'custom' },
    /** Catalog category names ("Marketing agency"). Empty = every category. */
    categories: { type: [String], default: [] },
    /**
     * builtin only: the owner retargeted this pack in Settings, so its list is
     * theirs to keep. While false, the seeder keeps the list in step with the
     * coded rule — otherwise a pack that gains categories in code would go on
     * serving the narrower list frozen into the row on the day it was created.
     */
    categories_customized: { type: Boolean, default: false },
    /** custom only: the language this copy is written in. */
    language: { type: String, default: null },
    active: { type: Boolean, default: true, index: true },
    /** Lower runs first when two templates match equally. */
    priority: { type: Number, default: 0 },
    messages: { type: [templateMessageSchema], default: [] },
    generation: { type: generationSchema, default: null },
    notes: { type: String, default: '' },
  },
  { collection: 'email_templates', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
)
emailTemplateSchema.index({ active: 1, updated_at: -1 })

export type EmailTemplateDoc = mongoose.HydratedDocument<InferSchemaType<typeof emailTemplateSchema>>
export const EmailTemplate = mongoose.model('EmailTemplate', emailTemplateSchema)
