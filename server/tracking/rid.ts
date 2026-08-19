/**
 * Per-send tracking identifier (`rid`) — the compatibility core of the
 * cold-email → landing attribution loop:
 *
 *   rid (raw, unique per SEND)  ──sha256──▶  trackingIdHash
 *   trackingIdHash on the email_sends record
 *        ===  trackingIdHash on landing_visit_events (written by the landing)
 *
 * Contract (docs/cold-email-visit-contract.md in the landing repo):
 *  - rid: 20–128 chars, URL-safe alphabet [A-Za-z0-9_-], no PII, no
 *    sequential ids. We generate 24 random bytes → 32 base64url chars.
 *  - hash: sha256 over the raw rid in UTF-8, hex digest — EXACTLY 64
 *    lowercase hex chars. No salt, no HMAC, no prefixes, no re-hashing,
 *    no case changes: both sides must produce byte-identical strings.
 *
 * The raw rid exists only while the outgoing email is being built: it is
 * hashed immediately, the hash is persisted, the raw value goes into the
 * email URLs, and nothing else ever stores or logs it.
 */

import { createHash, randomBytes } from 'node:crypto'

export const RID_MIN_LENGTH = 20
export const RID_MAX_LENGTH = 128
const RID_CHARSET = /^[A-Za-z0-9_-]+$/

export const TRACKING_HASH_PATTERN = /^[a-f0-9]{64}$/

/** 24 random bytes → 32 URL-safe base64url characters. */
export function generateRid(): string {
  return randomBytes(24).toString('base64url')
}

export function isValidRid(rid: string): boolean {
  return (
    typeof rid === 'string' &&
    rid.length >= RID_MIN_LENGTH &&
    rid.length <= RID_MAX_LENGTH &&
    RID_CHARSET.test(rid)
  )
}

/** sha256(rid, utf8) hex — the ONLY transformation allowed by the contract. */
export function hashRid(rid: string): string {
  return createHash('sha256').update(rid, 'utf8').digest('hex')
}

/** Support-friendly display form — the full hash never leaves the server. */
export function maskTrackingHash(hash: string): string {
  if (hash.length < 16) return '…'
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}
