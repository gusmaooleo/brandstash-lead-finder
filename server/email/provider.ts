/**
 * Outbound mail transport. ONE contract (MailProvider), two implementations:
 *
 *  - smtp   — nodemailer over the SMTP settings (unchanged behavior).
 *  - resend — Resend's HTTP API (https://api.resend.com/emails), no SDK
 *             dependency. From identity comes from RESEND_FROM_EMAIL; an
 *             Idempotency-Key derived from (unsubscribe token, follow-up,
 *             recipient) guarantees a retry after a network hiccup can never
 *             double-send the same email.
 *
 * Selection: the delivery mode in Settings (dry_run|smtp|resend) — the single
 * dry_run short-circuits in the sender before any provider is touched. The
 * From/Reply-To identity is the shared FROM_EMAIL / REPLY_TO_EMAIL pair
 * ("Name <email@domain>"). The API key is never logged and never included in
 * thrown errors.
 */

import { createHash } from 'node:crypto'
import nodemailer from 'nodemailer'
import { emailModeReady, settings } from '../settings/settings'

export type OutgoingMail = {
  to: string
  subject: string
  html: string
  /** text/plain alternative — a strong deliverability signal for notes. */
  text?: string | null
  /** Extra RFC-822 headers (List-Unsubscribe, …). */
  headers: Record<string, string>
  /**
   * Stable identity of this logical send (lead token + follow-up number).
   * Providers that support idempotency use it (+ recipient) to dedupe
   * retries; a changed recipient is deliberately a NEW logical send.
   */
  sendKey: string
}

export interface MailProvider {
  readonly name: 'smtp' | 'resend'
  send(mail: OutgoingMail): Promise<{ messageId: string | null }>
}

/* ── SMTP (nodemailer) ──────────────────────────────────────────────────── */

class SmtpMailProvider implements MailProvider {
  readonly name = 'smtp' as const
  private transporter: nodemailer.Transporter | null = null

  private getTransporter(): nodemailer.Transporter {
    if (!this.transporter) {
      // Gmail SMTP silently rewrites the From header to the authenticated
      // account unless the sender address is registered as a "Send mail as"
      // alias in that Google account — warn so the mismatch is visible.
      if (
        /gmail|googlemail/i.test(settings().email.smtpHost) &&
        settings().email.from.email &&
        settings().email.smtpUser &&
        settings().email.from.email !== settings().email.smtpUser.toLowerCase()
      ) {
        console.warn(
          `[email] the sender address (${settings().email.from.email}) differs from the Gmail SMTP login — ` +
            'Gmail will rewrite the From header unless this address is a verified "Send mail as" alias.',
        )
      }
      this.transporter = nodemailer.createTransport({
        host: settings().email.smtpHost,
        port: settings().email.smtpPort,
        secure: settings().email.smtpSecure,
        auth: settings().email.smtpUser
          ? { user: settings().email.smtpUser, pass: settings().email.smtpPass }
          : undefined,
      })
    }
    return this.transporter
  }

  async send(mail: OutgoingMail): Promise<{ messageId: string | null }> {
    const info = await this.getTransporter().sendMail({
      from: { name: settings().email.from.name, address: settings().email.from.email },
      to: mail.to,
      replyTo: settings().email.replyTo.label || undefined,
      subject: mail.subject,
      html: mail.html,
      text: mail.text ?? undefined,
      headers: mail.headers,
    })
    return { messageId: info.messageId ?? null }
  }
}

/* ── Resend (HTTP API) ──────────────────────────────────────────────────── */

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const RESEND_TIMEOUT_MS = 15_000

export class ResendMailProvider implements MailProvider {
  readonly name = 'resend' as const

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  buildRequest(mail: OutgoingMail): { url: string; init: RequestInit } {
    const recipientHash = createHash('sha256').update(mail.to, 'utf8').digest('hex').slice(0, 12)
    const body: Record<string, unknown> = {
      from: settings().email.from.label,
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      headers: mail.headers,
    }
    if (mail.text) body.text = mail.text
    if (settings().email.replyTo.label) body.reply_to = settings().email.replyTo.label
    return {
      url: RESEND_ENDPOINT,
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings().email.resendKey}`,
          'Content-Type': 'application/json',
          // Same logical send retried (crash, network error mid-flight) is
          // replayed by Resend instead of delivered twice.
          'Idempotency-Key': `leadfinder-${mail.sendKey}-${recipientHash}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      },
    }
  }

  async send(mail: OutgoingMail): Promise<{ messageId: string | null }> {
    const { url, init } = this.buildRequest(mail)
    const res = await this.fetchImpl(url, init)
    const payload = (await res.json().catch(() => null)) as
      | { id?: string; message?: string; name?: string; error?: { message?: string; name?: string } }
      | null
    if (!res.ok) {
      const detail = payload?.message ?? payload?.error?.message ?? 'no error detail'
      // Never include the Authorization header/key in the error surface.
      throw new Error(`Resend API ${res.status}: ${detail}`)
    }
    return { messageId: payload?.id ?? null }
  }
}

/* ── Selection & boot validation ────────────────────────────────────────── */

let provider: MailProvider | null = null

export function getMailProvider(): MailProvider {
  if (!provider) {
    provider = settings().email.mode === 'resend' ? new ResendMailProvider() : new SmtpMailProvider()
  }
  return provider
}

/**
 * Boot check for live mode. Credentials now live in Settings, so a missing
 * one is a WARNING, never a crash: the owner has to be able to start the app
 * in order to fix it in the UI. Sends still fail loudly and are recorded as
 * failed deliveries. Secrets themselves are never echoed.
 */
export function warnMailConfig(): void {
  const { ready, reason } = emailModeReady()
  if (settings().email.mode !== 'dry_run' && !ready) {
    console.warn(`[email] live mode (${settings().email.mode}) is not ready: ${reason} — set it in Settings.`)
  }
}

/**
 * Drops the cached transport so the next send uses the settings just saved
 * (switching resend ↔ smtp, rotating a key, changing the SMTP host).
 */
export function resetMailProvider(): void {
  provider = null
}
