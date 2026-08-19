import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { config } from './config'
import { connectDb } from './db'
import { api } from './routes/api'
import { settingsRouter } from './routes/settings'
import { templatesRouter } from './routes/templates'
import { analytics } from './routes/analytics'
import { unsubscribe } from './routes/unsubscribe'
import { startEngineLoop } from './discovery/engine'
import { startRetentionLoop } from './leads/retention'
import { warnMailConfig } from './email/provider'
import { loadSettings, settingsSummary } from './settings/settings'
import { hasEncryptionKey } from './settings/crypto'
import { seedBuiltinTemplates } from './email/template-store'
import { startBounceSyncLoop } from './email/bounce-sync'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webDist = path.resolve(__dirname, '../dist/web')

async function main(): Promise<void> {
  await connectDb()
  // Credentials live encrypted in the database (server/settings): load them
  // before anything reads a key. First boot migrates whatever .env still has.
  if (!hasEncryptionKey()) {
    console.warn(
      '[settings] APP_ENCRYPTION_KEY is not set — stored credentials cannot be read or written. ' +
        'Generate one with: openssl rand -base64 32',
    )
  }
  await loadSettings()
  warnMailConfig()
  // The coded packs get a row each so they can be retargeted from Settings.
  await seedBuiltinTemplates()

  const app = express()
  app.use(express.json())
  app.use('/api/analytics', analytics)
  app.use('/api/settings', settingsRouter)
  app.use('/api/templates', templatesRouter)
  app.use('/api', api)
  app.use(unsubscribe)

  // Built frontend (docker / pnpm start after build). In dev, Vite serves the
  // UI on :4001 and proxies /api here.
  app.use(express.static(webDist))
  app.get(/^\/(?!api|unsubscribe).*/, (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'), (err) => {
      if (err) res.status(200).send('Brandstash Lead Finder API is running. UI dev server: http://localhost:4001')
    })
  })

  // Surface unexpected route errors as JSON instead of hanging the request.
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[api]', err)
    res.status(500).json({ error: err.message })
  })

  app.listen(config.appPort, () => {
    console.log(`[app] listening on http://localhost:${config.appPort} — ${settingsSummary()}`)
  })

  startEngineLoop()
  startRetentionLoop()
  startBounceSyncLoop()
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
