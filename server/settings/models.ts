/**
 * `app_settings` — ONE document (_id: 'settings') holding every runtime knob
 * that used to live in .env. Secrets are stored only as ciphertext (fields
 * ending in `_enc`, see crypto.ts); everything else is plain configuration.
 *
 * The environment keeps exactly three things: APP_PORT, MONGODB_URI and
 * APP_ENCRYPTION_KEY. On first boot the document is seeded from whatever the
 * environment still carries (settings.ts), after which the database is the
 * single source of truth and env values are ignored.
 */

import mongoose, { Schema, type InferSchemaType } from 'mongoose'

const appSettingsSchema = new Schema(
  {
    _id: { type: String, default: 'settings' },

    /** Outbound email: identity, transport choice, transport credentials. */
    email: {
      /** dry_run renders + records but sends nothing. */
      mode: { type: String, enum: ['dry_run', 'smtp', 'resend'], default: 'dry_run' },
      from_name: { type: String, default: '' },
      from_email: { type: String, default: '' },
      reply_to_name: { type: String, default: '' },
      reply_to_email: { type: String, default: '' },
      resend_key_enc: { type: String, default: null },
      smtp_host: { type: String, default: '' },
      smtp_port: { type: Number, default: 587 },
      smtp_secure: { type: Boolean, default: false },
      smtp_user: { type: String, default: '' },
      smtp_pass_enc: { type: String, default: null },
      /** Disclosure block appended when a template carries no unsubscribe link. */
      footer_html: { type: String, default: '' },
      unsubscribe_base_url: { type: String, default: 'http://localhost:4000' },
    },

    /**
     * WHO is sending and WHAT they sell. Feeds the copy generator, the brand
     * tokens a template may use and the tracked landing link. Empty on a fresh
     * install: this is the operator's own identity, entered in Settings →
     * Offer, and nothing in the code names a company.
     */
    offer: {
      brand_name: { type: String, default: '' },
      what_we_sell: { type: String, default: '' },
      site_url: { type: String, default: '' },
      logo_url: { type: String, default: '' },
      /**
       * The profile analysis is always computed (it scores and ranks the
       * leads). This decides whether generated copy may USE it.
       */
      use_analysis_in_copy: { type: Boolean, default: true },
    },

    /** The model that writes email templates in Settings → Generate. */
    ai: {
      anthropic_key_enc: { type: String, default: null },
      model: { type: String, default: '' },
    },

    places: {
      api_key_enc: { type: String, default: null },
    },

    discovery: {
      leads_per_hour: { type: Number, default: 10 },
      lead_retention_days: { type: Number, default: 45 },
      followup_after_days: { type: Number, default: 3 },
      /** How many follow-ups a sequence may send after the initial email. */
      followup_steps: { type: Number, default: 2, min: 1, max: 5 },
    },

    /** Read-only connection to the landing's consented visit events. */
    landing: {
      mongodb_uri_enc: { type: String, default: null },
      db_name: { type: String, default: 'brandstash_leads' },
    },
  },
  { collection: 'app_settings', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, minimize: false },
)

export type AppSettingsDoc = mongoose.HydratedDocument<InferSchemaType<typeof appSettingsSchema>>
export const AppSettings = mongoose.model('AppSettings', appSettingsSchema)
