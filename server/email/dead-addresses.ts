/**
 * Permanent dead-address registry (same spirit as the suppression list, kept
 * separate because the meaning differs: suppression = asked not to be
 * contacted; dead = the mailbox provably doesn't accept mail). An address
 * lands here on a hard bounce (SMTP 5xx permanent) or a Resend
 * bounced/complained event, is never offered again as a recipient, and every
 * send is blocked against it right before delivery.
 */

import { DeadAddress } from '../leads/models'

export type DeadReason = 'hard_bounce' | 'provider_bounce' | 'complaint'

/**
 * Permanent-failure classifier for SMTP-style error strings. Deliberately
 * conservative: 4xx (transient), timeouts and provider/config errors must
 * never dead-list an address. 'mailbox full' is also excluded — quota is
 * temporary.
 */
export function isHardBounce(error: string): boolean {
  const e = error.toLowerCase()
  if (/\b4\.\d\.\d\b|\b4[0-9]{2}\b/.test(e)) return false
  if (/mailbox full|over quota|quota exceeded/.test(e)) return false
  const mailboxish = /(mailbox|user|recipient|address|account)/.test(e)
  if (/\b5\.[125]\.\d\b/.test(e) && mailboxish) return true
  if (/\b55[0-9]\b/.test(e) && mailboxish) return true
  return /(no such (user|recipient|mailbox)|user unknown|unknown user|mailbox (unavailable|not found|does not exist)|invalid recipient|recipient address rejected|address does not exist)/.test(
    e,
  )
}

export async function isDeadAddress(email: string): Promise<boolean> {
  return Boolean(await DeadAddress.exists({ email: email.toLowerCase() }))
}

export async function recordDeadAddress(email: string, reason: DeadReason, detail: string): Promise<void> {
  await DeadAddress.updateOne(
    { email: email.toLowerCase() },
    { $setOnInsert: { email: email.toLowerCase(), reason, detail: detail.slice(0, 500) } },
    { upsert: true },
  )
}

export class DeadRecipientError extends Error {
  constructor(readonly recipient: string) {
    super(`Recipient address previously hard-bounced (dead): ${recipient}`)
  }
}
