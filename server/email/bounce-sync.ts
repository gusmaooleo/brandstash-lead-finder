/**
 * Bounce feedback for the Resend transport. Resend's send API answers before
 * delivery is attempted, so the outcome (delivered / bounced / complained)
 * only exists later — webhooks need a public URL this app doesn't have, so a
 * background loop polls GET /emails/{id} for recent live sends instead.
 *
 * bounced   → address joins the dead registry (never offered/sent again)
 * complained → dead registry + suppression list (they told the provider to
 *              make it stop — treat exactly like an unsubscribe)
 *
 * Each send is polled until a terminal event or the lookback window expires.
 * The API key is never logged.
 */

import { settings } from '../settings/settings'
import { EmailSend } from '../tracking/models'
import { Suppression } from '../leads/models'
import { recordDeadAddress } from './dead-addresses'

const POLL_INTERVAL_MS = 30 * 60_000
const FIRST_RUN_DELAY_MS = 2 * 60_000
const LOOKBACK_DAYS = 7
const BATCH = 50
const REQUEST_TIMEOUT_MS = 10_000

export type ProviderOutcome = 'ok' | 'dead' | 'pending'

/** Terminal-event mapping — anything unrecognized keeps polling. */
export function classifyProviderEvent(lastEvent: string): ProviderOutcome {
  if (lastEvent === 'bounced' || lastEvent === 'complained') return 'dead'
  if (lastEvent === 'delivered') return 'ok'
  return 'pending'
}

export async function syncResendOutcomes(
  fetchImpl: typeof fetch = fetch,
): Promise<{ checked: number; bounced: number; complained: number }> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)
  const sends = await EmailSend.find({
    status: 'sent',
    message_id: { $ne: null },
    provider_event: null,
    created_at: { $gte: since },
  })
    .sort({ created_at: -1 })
    .limit(BATCH)

  let checked = 0
  let bounced = 0
  let complained = 0
  for (const send of sends) {
    try {
      const res = await fetchImpl(`https://api.resend.com/emails/${send.message_id}`, {
        headers: { Authorization: `Bearer ${settings().email.resendKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!res.ok) continue // 404 = not a Resend id (smtp-era send); 5xx = retry next cycle
      const payload = (await res.json()) as { last_event?: string }
      const lastEvent = payload.last_event ?? ''
      checked++
      if (classifyProviderEvent(lastEvent) === 'pending') continue

      send.provider_event = lastEvent
      await send.save()
      if (lastEvent === 'bounced') {
        bounced++
        await recordDeadAddress(send.recipient, 'provider_bounce', `resend last_event=bounced`)
      } else if (lastEvent === 'complained') {
        complained++
        await recordDeadAddress(send.recipient, 'complaint', `resend last_event=complained`)
        await Suppression.updateOne(
          { email: send.recipient.toLowerCase() },
          { $setOnInsert: { email: send.recipient.toLowerCase(), reason: 'complaint' } },
          { upsert: true },
        )
      }
    } catch {
      /* network hiccup — this send stays pending for the next cycle */
    }
  }
  if (bounced || complained) {
    console.warn(`[bounce-sync] terminal events: ${bounced} bounced, ${complained} complained`)
  }
  return { checked, bounced, complained }
}

export function startBounceSyncLoop(): void {
  if (settings().email.mode !== 'resend' || !settings().email.resendKey) return
  setTimeout(() => {
    void syncResendOutcomes().catch((err) => console.error('[bounce-sync]', err))
    setInterval(
      () => void syncResendOutcomes().catch((err) => console.error('[bounce-sync]', err)),
      POLL_INTERVAL_MS,
    )
  }, FIRST_RUN_DELAY_MS)
}
