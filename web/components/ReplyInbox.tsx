import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getReplyInbox,
  markAllRepliesRead,
  markReplyRead,
  type InboundReplyRow,
} from '../api'
import { Button, Chip, Input, SectionLabel } from './ui'

const PAGE_SIZE = 12

const fmtReceived = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

const senderName = (reply: InboundReplyRow) => reply.from_name || reply.lead_name || reply.from_email

export function ReplyInbox({
  refreshKey,
  onOpenSend,
}: {
  refreshKey: number
  onOpenSend: (id: string) => void
}) {
  const [rows, setRows] = useState<InboundReplyRow[]>([])
  const [total, setTotal] = useState(0)
  const [unread, setUnread] = useState(0)
  const [page, setPage] = useState(1)
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryDraft.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [queryDraft])

  useEffect(() => setPage(1), [query, unreadOnly])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getReplyInbox({
        page: String(page),
        page_size: String(PAGE_SIZE),
        ...(query ? { q: query } : {}),
        ...(unreadOnly ? { unread: 'true' } : {}),
      })
      setRows(result.replies)
      setTotal(result.total)
      setUnread(result.unread)
      setSelectedId((current) => current && result.replies.some((reply) => reply.id === current) ? current : result.replies[0]?.id ?? null)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [page, query, unreadOnly])

  useEffect(() => void load(), [load, refreshKey])

  const selected = useMemo(() => rows.find((reply) => reply.id === selectedId) ?? null, [rows, selectedId])
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const selectReply = (reply: InboundReplyRow) => {
    setSelectedId(reply.id)
    if (reply.read_at) return
    const readAt = new Date().toISOString()
    setRows((current) => current.map((row) => row.id === reply.id ? { ...row, read_at: readAt } : row))
    setUnread((count) => Math.max(0, count - 1))
    void markReplyRead(reply.id).catch(() => void load())
  }

  const markAll = async () => {
    setBusy(true)
    try {
      await markAllRepliesRead()
      const readAt = new Date().toISOString()
      setRows((current) => current.map((row) => ({ ...row, read_at: row.read_at ?? readAt })))
      setUnread(0)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="brand-rise overflow-hidden rounded-3xl border border-line bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <SectionLabel>Reply inbox</SectionLabel>
        {unread > 0 && (
          <span className="rounded-full px-2 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums tint-reply">
            {unread} new
          </span>
        )}
        <span className="text-[11px] text-gray-3">human replies · newest first</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input
            className="w-48"
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            placeholder="Sender or subject…"
          />
          <button
            type="button"
            onClick={() => setUnreadOnly((value) => !value)}
            className={`rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors ${
              unreadOnly ? 'border-reply bg-reply-soft text-reply' : 'border-line bg-paper-2 text-gray-2 hover:text-ink'
            }`}
          >
            Unread only
          </button>
          <Button variant="ghost" className="!px-2.5 !py-1.5 !text-[12px]" disabled={busy || unread === 0} onClick={() => void markAll()}>
            {busy ? 'Marking…' : 'Mark all read'}
          </Button>
        </div>
      </div>

      {error && <div className="tint-bad m-3 rounded-xl border px-4 py-2.5 text-[12.5px]">{error}</div>}

      {rows.length === 0 && !loading ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center">
          <span className="mb-3 flex size-11 items-center justify-center rounded-2xl border border-line bg-paper-2 text-[19px] text-gray-2">↩</span>
          <div className="text-[13.5px] font-semibold text-ink">{unreadOnly ? 'No unread replies' : 'No human replies yet'}</div>
          <div className="mt-1 max-w-md text-[11.5px] leading-relaxed text-gray-3">
            New messages appear here after the receiving inbox is synced. Automatic replies and bounces stay out of this view.
          </div>
        </div>
      ) : (
        <div className="grid min-h-[360px] lg:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.28fr)]">
          <div className="border-b border-line lg:border-b-0 lg:border-r">
            <div className="max-h-[300px] overflow-y-auto lg:max-h-[450px]">
              {loading && rows.length === 0 && <div className="px-4 py-10 text-center text-[12px] text-gray-3">Loading replies…</div>}
              {rows.map((reply) => {
                const active = reply.id === selectedId
                const isUnread = !reply.read_at
                return (
                  <button
                    type="button"
                    key={reply.id}
                    onClick={() => selectReply(reply)}
                    className={`group flex w-full gap-3 border-b border-line/70 px-4 py-3 text-left transition-colors last:border-b-0 ${
                      active ? 'bg-paper-2' : 'hover:bg-paper-2/60'
                    }`}
                  >
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${isUnread ? 'bg-reply shadow-[0_0_0_4px_var(--color-reply-soft)]' : 'bg-line-2'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={`truncate text-[12.5px] ${isUnread ? 'font-semibold text-ink' : 'font-medium text-gray-1'}`}>
                          {senderName(reply)}
                        </span>
                        <span className="ml-auto shrink-0 text-[10px] text-gray-3">{fmtReceived(reply.received_at)}</span>
                      </span>
                      <span className={`mt-0.5 block truncate text-[11.5px] ${isUnread ? 'text-ink' : 'text-gray-2'}`}>
                        {reply.subject || '(no subject)'}
                      </span>
                      <span className="mt-0.5 block truncate text-[10.5px] text-gray-3">{reply.preview || 'No text preview available.'}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-gray-3">
              <span>{total} repl{total === 1 ? 'y' : 'ies'}</span>
              <span className="flex items-center gap-1.5">
                <button className="rounded-md px-2 py-1 hover:bg-paper-2 hover:text-ink disabled:opacity-35" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>←</button>
                <span className="font-mono tabular-nums">{page}/{pages}</span>
                <button className="rounded-md px-2 py-1 hover:bg-paper-2 hover:text-ink disabled:opacity-35" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>→</button>
              </span>
            </div>
          </div>

          {selected && (
            <article className="flex min-w-0 flex-col p-5 lg:p-6">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-reply bg-reply-soft font-mono text-[13px] font-semibold uppercase text-reply">
                  {senderName(selected).slice(0, 2)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-[15px] font-semibold text-ink">{senderName(selected)}</h2>
                    {!selected.read_at && <Chip className="tint-reply">new</Chip>}
                    {selected.correlation === 'unattributed' && <Chip className="tint-warn">unattributed</Chip>}
                  </div>
                  <div className="truncate text-[11px] text-gray-3">{selected.from_email} · {fmtReceived(selected.received_at)}</div>
                </div>
              </div>

              <div className="mt-5">
                <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-3">Subject</div>
                <div className="mt-1 text-[14px] font-medium text-ink">{selected.subject || '(no subject)'}</div>
              </div>

              <div className="mt-4 min-h-[110px] rounded-2xl border border-line bg-paper-2 px-4 py-3 text-[13px] leading-relaxed text-gray-1">
                {selected.preview || <span className="text-gray-3">No text preview available.</span>}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-[10.5px] text-gray-2">
                {selected.lead_name && <Chip>{selected.lead_name}</Chip>}
                {selected.search_category && <Chip>{selected.search_category}</Chip>}
                {(selected.template_name || selected.template_id) && (
                  <Chip>{selected.template_name || selected.template_id} · v{(selected.variant ?? 0) + 1}</Chip>
                )}
                {selected.attempt && <Chip>attempt {selected.attempt}</Chip>}
              </div>

              <div className="mt-auto flex flex-wrap items-center gap-2 pt-6">
                <a
                  href={`mailto:${selected.from_email}?subject=${encodeURIComponent(`Re: ${selected.subject.replace(/^Re:\s*/i, '')}`)}`}
                  className="inline-flex items-center rounded-lg bg-ink px-3.5 py-2 text-[12px] font-semibold text-paper transition-opacity hover:opacity-85"
                >
                  ↩ Reply by email
                </a>
                {selected.email_send_id && (
                  <Button variant="ghost" className="!px-3 !py-1.5 !text-[12px]" onClick={() => onOpenSend(selected.email_send_id!)}>
                    View original send →
                  </Button>
                )}
                <span className="ml-auto text-[10px] text-gray-3">preview stored locally</span>
              </div>
            </article>
          )}
        </div>
      )}
    </section>
  )
}
