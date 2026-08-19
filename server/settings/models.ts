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
      unsubscribe_base_url: { type: String, default: 'http://localhost:4000' },
    },

    /**
     * WHO is sending and WHAT they sell. Feeds the copy generator, the brand
     * marks in the built-in report email and the tracked landing link, so the
     * app is not wired to one company. Shipped with Brandstash's values.
     */
    offer: {
      brand_name: { type: String, default: 'Brandstash' },
      /** One paragraph the generator uses as "what we sell". */
      what_we_sell: {
        type: String,
        default:
          "Brandstash keeps a business's Google Business Profile alive automatically: fresh photos, correct hours, posts, review replies — the recurring work that decides who shows up first in local search. For agencies, the same thing at scale: every client's profile kept updated from one dashboard, so they can offer it without hiring for it.",
      },
      /** Base of every tracked landing link in an outreach email. */
      site_url: { type: String, default: 'https://www.brandstash.ai' },
      logo_url: {
        type: String,
        default: 'https://pub-62b9434b63214cb4b5b74cebb8d4c261.r2.dev/content/brandstash-icon-black.svg',
      },
      /**
       * The built-in Google-profile analysis is always computed (it scores and
       * ranks the leads). This decides whether generated copy may USE it —
       * the findings, the score — as the hook, or must sell without it.
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
