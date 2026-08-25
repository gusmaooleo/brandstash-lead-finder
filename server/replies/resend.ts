import { settings, replyTrackingReady } from '../settings/settings'
import { EmailSend, getTrackingState } from '../tracking/models'
import { hashRid } from '../tracking/rid'
import { ridFromReplyAddress } from '../email/reply-address'
import { classifyInboundReply, type HeaderInput } from './classify'
import { InboundReply } from './models'
import { persistInboundReply } from './store'

const ENDPOINT = 'https://api.resend.com/emails/receiving'
const PAGE_SIZE = 100
const MAX_PAGES = 100
const OVERLAP_MS = 24 * 60 * 60_000
const FIRST_RUN_DELAY_MS = 30_000
const POLL_INTERVAL_MS = 5 * 60_000

export type ReceivedEmailListItem = {
  id: string
  to: string[]
  from: string
  created_at: string
  subject?: string
  message_id?: string | null
}

export type ReceivedEmailDetail = ReceivedEmailListItem & {
  text?: string | null
  html?: string | null
  headers?: HeaderInput
}

export type ReplySyncResult = {
  ok: boolean
  enabled: boolean
  synced_at: string
  checked: number
  created: number
  human: number
  automatic: number
  bounced: number
  unattributed: number
  error: string | null
}

function apiError(status: number, payload: unknown): Error {
  const detail = typeof payload === 'object' && payload
    ? String((payload as { message?: unknown; error?: { message?: unknown } }).message ?? (payload as { error?: { message?: unknown } }).error?.message ?? '')
    : ''
  return new Error(`Resend Receiving API ${status}${detail ? `: ${detail}` : ''}`)
}

export class ResendReceivingClient {
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async list(after?: string): Promise<{ data: ReceivedEmailListItem[]; has_more: boolean }> {
    const url = new URL(ENDPOINT)
    url.searchParams.set('limit', String(PAGE_SIZE))
    if (after) url.searchParams.set('after', after)
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw apiError(response.status, payload)
    const body = payload as { data?: ReceivedEmailListItem[]; has_more?: boolean } | null
    return { data: Array.isArray(body?.data) ? body.data : [], has_more: Boolean(body?.has_more) }
  }

  async get(id: string): Promise<ReceivedEmailDetail> {
    const response = await this.fetchImpl(`${ENDPOINT}/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw apiError(response.status, payload)
    return payload as ReceivedEmailDetail
  }
}

export function mailbox(value: string): { name: string | null; email: string } {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  if (!match) return { name: null, email: value.trim().toLowerCase() }
  return { name: match[1].replace(/^"|"$/g, '').trim() || null, email: match[2].trim().toLowerCase() }
}

export function replyPreview(text: string | null | undefined, html: string | null | undefined): string {
  const source = text || (html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
  return source
    .split(/\n(?:On .+wrote:|Em .+escreveu:|From: .+|De: .+)/i)[0]
    .replace(/^>.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280)
}

async function receivedSince(client: ResendReceivingClient, cutoff: Date | null): Promise<ReceivedEmailListItem[]> {
  const items: ReceivedEmailListItem[] = []
  let after: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await client.list(after)
    if (!result.data.length) break
    let reachedCutoff = false
    for (const item of result.data) {
      const at = new Date(item.created_at)
      if (cutoff && Number.isFinite(at.getTime()) && at < cutoff) {
        reachedCutoff = true
        continue
      }
      items.push(item)
    }
    if (reachedCutoff || !result.has_more) break
    const next = result.data.at(-1)?.id
    if (!next || next === after) break
    after = next
  }
  return items
}

export async function syncInboundReplies(
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<ReplySyncResult> {
  const ready = replyTrackingReady()
  const base = { synced_at: now.toISOString(), checked: 0, created: 0, human: 0, automatic: 0, bounced: 0, unattributed: 0 }
  if (!ready.ready) return { ok: true, enabled: false, ...base, error: ready.reason }

  const state = await getTrackingState()
  const previous = state.last_reply_synced_at ? new Date(state.last_reply_synced_at) : null
  const cutoff = previous ? new Date(previous.getTime() - OVERLAP_MS) : null
  try {
    const client = new ResendReceivingClient(settings().replies.resendKey, fetchImpl)
    const listed = await receivedSince(client, cutoff)
    let checked = 0
    let created = 0
    let human = 0
    let automatic = 0
    let bounced = 0
    let unattributed = 0

    for (const item of listed) {
      const target = item.to.find((value) => mailbox(value).email.endsWith(`@${settings().replies.receivingDomain}`))
      if (!target) continue
      if (await InboundReply.exists({ provider_email_id: item.id })) continue
      checked++
      const detail = await client.get(item.id)
      const rid = ridFromReplyAddress(target)
      const send = rid
        ? await EmailSend.findOne({ reply_id_hash: hashRid(rid) }, { _id: 1, place_id: 1 }).lean()
        : null
      const classified = classifyInboundReply({ from: detail.from ?? item.from, subject: detail.subject ?? item.subject ?? '', headers: detail.headers })
      const from = mailbox(detail.from ?? item.from)
      const result = await persistInboundReply({
        providerEmailId: item.id,
        messageId: detail.message_id ?? item.message_id ?? null,
        emailSendId: send ? String(send._id) : null,
        placeId: send?.place_id ?? null,
        fromEmail: from.email,
        fromName: from.name,
        toEmail: mailbox(target).email,
        subject: detail.subject ?? item.subject ?? '',
        preview: replyPreview(detail.text, detail.html),
        kind: classified.kind,
        classificationReason: classified.reason,
        receivedAt: new Date(detail.created_at ?? item.created_at),
      })
      if (!result.created) continue
      created++
      if (!send) unattributed++
      if (classified.kind === 'human') human++
      else if (classified.kind === 'automatic') automatic++
      else bounced++
    }

    state.last_reply_synced_at = now
    state.last_reply_sync_ok = true
    state.last_reply_sync_error = null
    state.last_reply_sync_checked = checked
    state.last_reply_sync_created = created
    state.last_reply_sync_unattributed = unattributed
    await state.save()
    return { ok: true, enabled: true, synced_at: now.toISOString(), checked, created, human, automatic, bounced, unattributed, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    state.last_reply_sync_ok = false
    state.last_reply_sync_error = message
    await state.save()
    return { ok: false, enabled: true, ...base, error: message }
  }
}

export function startReplySyncLoop(): void {
  setTimeout(() => {
    void syncInboundReplies().catch((error) => console.error('[reply-sync]', error))
    setInterval(() => void syncInboundReplies().catch((error) => console.error('[reply-sync]', error)), POLL_INTERVAL_MS)
  }, FIRST_RUN_DELAY_MS)
}
