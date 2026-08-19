import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutgoingMail } from './provider'
import { ResendMailProvider, getMailProvider, resetMailProvider, warnMailConfig } from './provider'
import { addressLabel, emailModeReady, setSettingsForTests, settings } from '../settings/settings'

/** Credentials live in the settings document now — tests set that snapshot. */
function liveResendSettings() {
  setSettingsForTests({
    email: {
      mode: 'resend',
      resendKey: 're_test_123',
      from: { name: 'Acme', email: 'hello@acme.example', label: addressLabel('Acme', 'hello@acme.example') },
      replyTo: {
        name: '',
        email: 'ana@acme.example',
        label: addressLabel('Acme', 'ana@acme.example'),
      },
    },
  })
  resetMailProvider()
}

beforeEach(liveResendSettings)

const mail = (overrides: Partial<OutgoingMail> = {}): OutgoingMail => ({
  to: 'dono@padaria.com.br',
  subject: 'olá',
  html: '<p>oi</p>',
  text: 'oi',
  headers: { 'List-Unsubscribe': '<http://localhost:4000/unsubscribe?t=tok>' },
  sendKey: 'tok-f0',
  ...overrides,
})

describe('ResendMailProvider', () => {
  it('builds the documented POST /emails request', () => {
    const { url, init } = new ResendMailProvider().buildRequest(mail())
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer re_test_123')
    expect(headers['Content-Type']).toBe('application/json')
    // idempotency: stable per (sendKey, recipient) so a retry never double-sends
    expect(headers['Idempotency-Key']).toMatch(/^leadfinder-tok-f0-[0-9a-f]{12}$/)
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      from: 'Acme <hello@acme.example>',
      to: ['dono@padaria.com.br'],
      subject: 'olá',
      html: '<p>oi</p>',
      text: 'oi',
      reply_to: 'Acme <ana@acme.example>',
      headers: { 'List-Unsubscribe': '<http://localhost:4000/unsubscribe?t=tok>' },
    })
  })

  it('name + email are concatenated into ONE identity both transports send', () => {
    expect(settings().email.from.label).toBe('Acme <hello@acme.example>')
    expect(addressLabel('Ana', 'HELLO@acme.example')).toBe('Ana <hello@acme.example>')
    // A bare address stays bare; an empty address has no label at all.
    expect(addressLabel('', 'hello@acme.example')).toBe('hello@acme.example')
    expect(addressLabel('Ana', '')).toBe('')
  })

  it('a different recipient is a different idempotency key; same recipient repeats it', () => {
    const p = new ResendMailProvider()
    const a = (p.buildRequest(mail()).init.headers as Record<string, string>)['Idempotency-Key']
    const b = (p.buildRequest(mail()).init.headers as Record<string, string>)['Idempotency-Key']
    const c = (p.buildRequest(mail({ to: 'outro@padaria.com.br' })).init.headers as Record<string, string>)[
      'Idempotency-Key'
    ]
    expect(a).toBe(b)
    expect(c).not.toBe(a)
  })

  it('omits the text field when the render has no plain-text part', () => {
    const { init } = new ResendMailProvider().buildRequest(mail({ text: null }))
    expect(JSON.parse(init.body as string)).not.toHaveProperty('text')
  })

  it('returns the Resend id as messageId on success', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 'abc-123' }), { status: 200 }))
    const out = await new ResendMailProvider(fetchImpl as unknown as typeof fetch).send(mail())
    expect(out.messageId).toBe('abc-123')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('throws the API error detail on failure — never the key', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ statusCode: 422, name: 'validation_error', message: 'Invalid `from`' }), { status: 422 }),
    )
    const err = await new ResendMailProvider(fetchImpl as unknown as typeof fetch)
      .send(mail())
      .then(() => null, (e: Error) => e)
    expect(err?.message).toBe('Resend API 422: Invalid `from`')
    expect(err?.message).not.toContain('re_test_123')
  })
})

describe('provider selection & readiness', () => {
  it('the stored mode selects the implementation, and a change swaps it', () => {
    expect(getMailProvider().name).toBe('resend')
    setSettingsForTests({ email: { mode: 'smtp', smtpHost: 'smtp.gmail.com', smtpUser: 'u', smtpPass: 'p' } })
    // Without the reset the cached transport would keep sending via Resend.
    resetMailProvider()
    expect(getMailProvider().name).toBe('smtp')
  })

  it('reports what live mode is missing instead of crashing the app', () => {
    expect(emailModeReady().ready).toBe(true)

    setSettingsForTests({ email: { mode: 'resend', resendKey: '' } })
    expect(emailModeReady()).toEqual({ ready: false, reason: 'Resend API key is not set' })
    // Boot must survive it — the owner needs the app up to fix it in Settings.
    expect(() => warnMailConfig()).not.toThrow()

    setSettingsForTests({ email: { mode: 'dry_run' } })
    expect(emailModeReady().ready).toBe(true)

    setSettingsForTests({ email: { mode: 'smtp', smtpHost: 'smtp.gmail.com', smtpUser: 'u', smtpPass: '' } })
    expect(emailModeReady()).toEqual({ ready: false, reason: 'SMTP host, user or password is missing' })

    setSettingsForTests({ email: { mode: 'resend', resendKey: 'k', from: { name: 'B', email: '', label: '' } } })
    expect(emailModeReady()).toEqual({ ready: false, reason: 'sender email is not set' })
  })
})
