/**
 * Per-send tracking records.
 *
 * `email_sends` holds ONE document per individual email send (initial send,
 * every follow-up, every retry) — unlike `approved.delivery`, which only
 * mirrors the LAST send of a lead. Each tracked send stores the SHA-256 of
 * its rid (`tracking_id_hash`, unique partial index) — the raw rid is NEVER
 * a field here — plus a `landing_visit` summary that is reconciled against
 * the landing's `landing_visit_events` and persisted locally, so metrics
 * survive the landing's 180-day event TTL.
 *
 * Historical sends made before tracking existed are backfilled with
 * `tracking_id_hash: null` (+ `backfilled: true`) and surface in the
 * dashboard as "untracked" — hashes are never invented retroactively.
 */

import mongoose, { Schema, type InferSchemaType } from 'mongoose'

const landingVisitSummarySchema = new Schema(
  {
    /** At least one consented landing visit matched this send's hash. */
    matched: { type: Boolean, required: true, default: false },
    /** Total matching event documents (consented sessions). */
    event_count: { type: Number, required: true, default: 0 },
    first_observed_at: { type: Date, default: null },
    last_observed_at: { type: Date, default: null },
    /** Last reconciliation that looked at this send (null = never synced). */
    synced_at: { type: Date, default: null },
  },
  { _id: false },
)

const emailSendSchema = new Schema(
  {
    /** Stable lead key (leads move approval_list → approved; place_id survives). */
    place_id: { type: String, required: true, index: true },
    lead_name: { type: String, required: true },
    recipient: { type: String, required: true },
    language: { type: String, required: true },
    market_scope: { type: String, required: true },
    campaign: { type: String, required: true, index: true },

    /** Email type: 'note' | 'dashboard'. */
    /** note / note_followup_1 / note_followup_2 / dashboard (± _vN suffix set on completion). */
    template_id: { type: String, required: true, index: true },
    /** Note variant or dashboard subject variant (0-based); null until rendered. */
    variant: { type: Number, default: null },
    /** 0 = initial, 1 = bump, 2 = breakup. */
    followup: { type: Number, required: true, default: 0 },
    /** 1-based sequence step (followup + 1). */
    attempt: { type: Number, required: true, default: 1, index: true },

    /** queued → sent | sent_dry_run | failed. Failed stays, for audit. */
    status: { type: String, required: true, default: 'queued', index: true },
    sent_at: { type: Date, default: null, index: true },
    message_id: { type: String, default: null },
    error: { type: String, default: null },

    /**
     * Terminal delivery event polled from the provider (Resend last_event:
     * delivered | bounced | complained). Null until known; smtp-era sends
     * stay null forever.
     */
    provider_event: { type: String, default: null },

    /** True for legacy sends reconstructed without tracking. */
    backfilled: { type: Boolean, required: true, default: false },

    tracking_schema_version: { type: Number, required: true, default: 1 },
    /** sha256(rid) hex — the raw rid is never persisted anywhere. */
    tracking_id_hash: { type: String, default: null },

    landing_visit: { type: landingVisitSummarySchema, required: true, default: () => ({}) },
  },
  { collection: 'email_sends', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
)
// Unique only where a hash exists — untracked/backfilled rows all carry null.
emailSendSchema.index(
  { tracking_id_hash: 1 },
  { unique: true, partialFilterExpression: { tracking_id_hash: { $type: 'string' } } },
)
emailSendSchema.index({ created_at: -1 })

/** Singleton with the last reconciliation outcome (shown in the dashboard). */
const trackingStateSchema = new Schema(
  {
    _id: { type: String, default: 'state' },
    last_synced_at: { type: Date, default: null },
    last_sync_ok: { type: Boolean, default: null },
    /** Sanitized error (never contains the connection URI or credentials). */
    last_sync_error: { type: String, default: null },
    last_sync_sends: { type: Number, default: 0 },
    last_sync_events: { type: Number, default: 0 },
    /** Cold-email visits on the landing that matched no send of ours. */
    last_sync_unattributed: { type: Number, default: 0 },
  },
  { collection: 'tracking_state', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
)

export type EmailSendDoc = mongoose.HydratedDocument<InferSchemaType<typeof emailSendSchema>>
export type TrackingStateDoc = mongoose.HydratedDocument<InferSchemaType<typeof trackingStateSchema>>
export type LandingVisitSummary = InferSchemaType<typeof landingVisitSummarySchema>

export const EmailSend = mongoose.model('EmailSend', emailSendSchema)
export const TrackingState = mongoose.model('TrackingState', trackingStateSchema)

export async function getTrackingState(): Promise<TrackingStateDoc> {
  return TrackingState.findByIdAndUpdate(
    'state',
    { $setOnInsert: {} },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ) as Promise<TrackingStateDoc>
}
