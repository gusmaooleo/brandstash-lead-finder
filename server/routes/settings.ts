/**
 * Settings API — the credentials and knobs that used to live in .env.
 *
 * Secrets go OUT masked (never their value) and come IN either as a new value
 * or as the mask, which is ignored so an untouched field keeps what is
 * stored. Every write re-loads the runtime snapshot and drops the caches that
 * hold credentials (mail transport, landing connection), so a change takes
 * effect on the very next send without a restart.
 */

import { Router } from 'express'
import { resetMailProvider } from '../email/provider'
import { resetLandingConnection } from '../tracking/landing-db'
import { AnthropicError, listModels } from '../settings/anthropic'
import { hasEncryptionKey } from '../settings/crypto'
import { emailModeReady, replyTrackingReady, settings, settingsView, updateSettings, type SettingsPatch } from '../settings/settings'

export const settingsRouter = Router()

settingsRouter.get('/', (_req, res) => {
  const { ready, reason } = emailModeReady()
  const replies = replyTrackingReady()
  res.json({ ...settingsView(), email_ready: ready, email_not_ready_reason: reason, reply_tracking_ready: replies.ready })
})

settingsRouter.put('/', async (req, res) => {
  if (!hasEncryptionKey()) {
    return res.status(503).json({
      error:
        'APP_ENCRYPTION_KEY is not set on the server, so credentials cannot be stored. ' +
        'Generate one with `openssl rand -base64 32`, put it in .env and restart.',
    })
  }
  try {
    await updateSettings((req.body ?? {}) as SettingsPatch)
    resetMailProvider()
    resetLandingConnection()
    const { ready, reason } = emailModeReady()
    const replies = replyTrackingReady()
    res.json({ ...settingsView(), email_ready: ready, email_not_ready_reason: reason, reply_tracking_ready: replies.ready })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

/**
 * The models this key may use. Accepts a key in the body so the owner can
 * validate one before saving it; falls back to the stored key.
 */
settingsRouter.post('/anthropic/models', async (req, res) => {
  const provided = String((req.body as { api_key?: string })?.api_key ?? '').trim()
  const apiKey = provided && !provided.startsWith('•') ? provided : settings().ai.anthropicKey
  try {
    res.json({ models: await listModels(apiKey) })
  } catch (err) {
    const status = err instanceof AnthropicError ? err.status : 502
    res.status(status === 401 || status === 403 ? 400 : status).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})
