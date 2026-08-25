import { describe, expect, it, vi } from 'vitest'
import { ResendReceivingClient, mailbox, replyPreview } from './resend'

describe('Resend Receiving client', () => {
  it('lists with documented cursor pagination and retrieves content', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/mail-1')) return new Response(JSON.stringify({ id: 'mail-1', text: 'Tenho interesse' }))
      return new Response(JSON.stringify({ data: [{ id: 'mail-1', to: ['reply@acme.example'], from: 'Owner <owner@example.com>', created_at: '2026-08-25T10:00:00Z' }], has_more: false }))
    })
    const client = new ResendReceivingClient('re_secret', fetchImpl as unknown as typeof fetch)
    await client.list('cursor-1')
    await client.get('mail-1')
    const first = new URL(String(fetchImpl.mock.calls[0][0]))
    expect(first.pathname).toBe('/emails/receiving')
    expect(first.searchParams.get('limit')).toBe('100')
    expect(first.searchParams.get('after')).toBe('cursor-1')
    expect(String(fetchImpl.mock.calls[1][0])).toBe('https://api.resend.com/emails/receiving/mail-1')
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer re_secret' })
  })

  it('never includes the API key in provider errors', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }))
    const error = await new ResendReceivingClient('re_secret', fetchImpl as unknown as typeof fetch).list().then(() => null, (reason: Error) => reason)
    expect(error?.message).toBe('Resend Receiving API 401: Unauthorized')
    expect(error?.message).not.toContain('re_secret')
  })
})

describe('received email presentation', () => {
  it('parses mailbox identities and produces a short reply-only preview', () => {
    expect(mailbox('Bakery Owner <OWNER@Bakery.Example>')).toEqual({ name: 'Bakery Owner', email: 'owner@bakery.example' })
    expect(replyPreview('Tenho interesse.\nOn Monday someone wrote:\n> old message', null)).toBe('Tenho interesse.')
    expect(replyPreview(null, '<p>Podemos conversar?</p><blockquote>old</blockquote>')).toContain('Podemos conversar?')
  })
})
