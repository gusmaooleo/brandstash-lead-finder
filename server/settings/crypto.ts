/**
 * Secret encryption for credentials stored in MongoDB.
 *
 * Everything sensitive the app needs (Anthropic key, Google Places key,
 * Resend key, SMTP password, the landing database URI) lives in the
 * `app_settings` document — never in plaintext. AES-256-GCM with a random IV
 * per value and the tag verified on read, so a tampered ciphertext fails
 * loudly instead of decrypting to garbage.
 *
 * The ONLY secret left in the environment is APP_ENCRYPTION_KEY (plus
 * MONGODB_URI, which necessarily comes first — you cannot read the database
 * to learn where the database is). Losing the key does not lose leads: the
 * credentials simply have to be entered again in Settings.
 *
 * Ciphertext format: v1:<iv b64>:<tag b64>:<ciphertext b64>
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12

export class EncryptionKeyError extends Error {
  constructor(detail: string) {
    super(
      `APP_ENCRYPTION_KEY ${detail}. Generate one with: openssl rand -base64 32 — ` +
        `then set it in .env (it never leaves this machine).`,
    )
  }
}

/** 32 raw bytes, accepted as base64 (44 chars) or hex (64 chars). */
function encryptionKey(): Buffer {
  const raw = (process.env.APP_ENCRYPTION_KEY ?? '').trim()
  if (!raw) throw new EncryptionKeyError('is missing')
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new EncryptionKeyError('must decode to exactly 32 bytes')
  return buf
}

export function hasEncryptionKey(): boolean {
  try {
    encryptionKey()
    return true
  } catch {
    return false
  }
}

export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}:`) && value.split(':').length === 4
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(
    ':',
  )
}

export function decryptSecret(value: string): string {
  if (!isEncrypted(value)) throw new Error('value is not an encrypted secret')
  const [, ivB64, tagB64, dataB64] = value.split(':')
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}

/**
 * Decrypts, or returns null when the value is absent / was written under a
 * different key. A credential we cannot read is treated as "not configured"
 * — the UI then asks for it again instead of the app crashing on boot.
 */
export function tryDecrypt(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return decryptSecret(value)
  } catch {
    return null
  }
}

/** What the UI is allowed to see of a stored secret: its shape, never its value. */
export function maskSecret(plain: string | null): string | null {
  if (!plain) return null
  const tail = plain.slice(-4)
  return `${'•'.repeat(Math.min(20, Math.max(4, plain.length - 4)))}${tail}`
}
