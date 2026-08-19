/**
 * Read-only connection to the store where the LANDING writes its consented
 * visit events (MongoDB Atlas in production; the collection is
 * `landing_visit_events` in the `brandstash_leads` database).
 *
 * Strictly server-side:
 *  - configured only in Settings → Landing database, where the URI is stored
 *    encrypted (never any VITE_/client-exposed variable);
 *  - the URI is validated at startup and NEVER logged;
 *  - one lazy connection Promise per process, small pool, short timeouts —
 *    an unreachable Atlas degrades the analytics sync, never the app;
 *  - autoIndex/autoCreate are off: this side never touches the landing's
 *    collection or its indexes, and only ever reads from it.
 *
 * Local dev fallback: with no landing URI configured, events are read from
 * the lead finder's own MongoDB — which lets the full loop be exercised
 * against fake events without Atlas.
 */

import mongoose from 'mongoose'
import { config } from '../config'
import { settings } from '../settings/settings'

export const LANDING_VISIT_COLLECTION = 'landing_visit_events'

/** Strip anything that could leak credentials/hosts from driver errors. */
export function sanitizeDbError(message: string): string {
  return message
    .replace(/mongodb(\+srv)?:\/\/\S+/gi, '[mongodb-uri]')
    .replace(/\/\/[^@\s]+@/g, '//[credentials]@')
}

/** Malformed configuration — thrown when a connection is actually opened. */
export function validateLandingDbConfig(): void {
  const uri = settings().landing.mongodbUri
  if (uri && !/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw new Error('The landing MongoDB URI must start with mongodb:// or mongodb+srv://')
  }
  if (!settings().landing.dbName.trim()) {
    throw new Error('The landing database name must not be empty')
  }
}

let connPromise: Promise<mongoose.Connection> | null = null

/** Settings changed — the next sync opens a connection with the new URI. */
export function resetLandingConnection(): void {
  const pending = connPromise
  connPromise = null
  void pending?.then((conn) => conn.close()).catch(() => {})
}

function landingConnection(): Promise<mongoose.Connection> {
  if (!connPromise) {
    validateLandingDbConfig()
    const uri = settings().landing.mongodbUri || config.mongodbUri
    const promise = mongoose
      .createConnection(uri, {
        dbName: settings().landing.dbName,
        maxPoolSize: 3,
        serverSelectionTimeoutMS: 6000,
        socketTimeoutMS: 20_000,
        bufferCommands: false,
        autoIndex: false,
        autoCreate: false,
      })
      .asPromise()
    // A failed attempt must not poison the singleton — allow the next sync
    // to retry once Atlas is reachable again.
    connPromise = promise.catch((err) => {
      connPromise = null
      throw new Error(`landing events store unreachable: ${sanitizeDbError(String(err?.message ?? err))}`)
    })
  }
  return connPromise
}

export async function landingVisitEventsCollection(): Promise<mongoose.mongo.Collection> {
  const conn = await landingConnection()
  return conn.db!.collection(LANDING_VISIT_COLLECTION)
}
