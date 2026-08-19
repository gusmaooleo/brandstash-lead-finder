/**
 * Environment configuration — deliberately three values.
 *
 * Everything else (offer profile, email transport + credentials, Google
 * Places key, Anthropic key, rate/retention knobs, landing database) lives
 * ENCRYPTED in MongoDB and is edited in the app: see server/settings/. These
 * three cannot:
 *  - APP_PORT           — needed before anything is read;
 *  - MONGODB_URI        — you cannot read the database to learn where it is;
 *  - APP_ENCRYPTION_KEY — the key that unlocks every stored credential.
 */

import 'dotenv/config'

function int(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const config = {
  appPort: int('APP_PORT', 4000),
  mongodbUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27018/brandstash_leads',
} as const
