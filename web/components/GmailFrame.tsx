/**
 * Gmail-fidelity email preview: reproduces the Gmail reading pane chrome —
 * subject + Inbox chip, avatar, sender line ("<email>", "to me"),
 * time + action icons — with the rendered email in a sandboxed iframe below.
 * Deliberately ALWAYS light, exactly like Gmail, regardless of the app theme.
 */

import { EllipsisVertical, ExternalLink, Printer, Reply, Smile, Star } from 'lucide-react'

const G_TEXT = '#1f1f1f'
const G_MUTED = '#5f6368'

function gmailTime(): string {
  const now = new Date()
  let h = now.getHours()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${String(now.getMinutes()).padStart(2, '0')} ${ampm}`
}

export function GmailFrame({
  subject,
  senderName,
  senderEmail,
  html,
  height = 480,
}: {
  subject: string
  senderName: string
  senderEmail: string
  html: string
  height?: number
}) {
  return (
    <div
      className="@container overflow-hidden rounded-xl border border-line bg-white"
      style={{ fontFamily: "'Roboto', 'Helvetica Neue', Arial, sans-serif" }}
    >
      {/* subject row */}
      <div className="flex items-start gap-3 px-5 pb-1 pt-4">
        <h2 className="min-w-0 flex-1 truncate text-[20px] font-normal leading-7" style={{ color: G_TEXT }}>
          {subject}
          <span
            className="ml-3 inline-flex translate-y-[-2px] items-center gap-1 rounded px-1.5 py-0.5 align-middle text-[11px]"
            style={{ background: '#eeeeee', color: G_MUTED }}
          >
            Inbox <span className="text-[10px]">×</span>
          </span>
        </h2>
        <span className="flex shrink-0 items-center gap-4 pt-1" style={{ color: G_MUTED }}>
          <Printer className="size-[18px]" />
          <ExternalLink className="size-[18px]" />
        </span>
      </div>

      {/* sender row */}
      <div className="flex items-center gap-3 px-5 py-2.5">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-[16px] font-medium text-white"
          style={{ background: '#7e57c2' }}
        >
          {senderName.trim().charAt(0).toUpperCase() || 'B'}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[14px]" style={{ color: G_TEXT }}>
            <b className="font-bold">{senderName}</b>{' '}
            <span style={{ color: G_MUTED }}>&lt;{senderEmail}&gt;</span>
          </span>
          <span className="block text-[12px]" style={{ color: G_MUTED }}>
            to me ▾
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2.5 text-[12px]" style={{ color: G_MUTED }}>
          {gmailTime()}
          <Star className="hidden size-[16px] @[520px]:block" />
          <Smile className="hidden size-[16px] @[520px]:block" />
          <Reply className="size-[16px]" />
          <EllipsisVertical className="size-[16px]" />
        </span>
      </div>

      {/* rendered email body */}
      <iframe
        title="email preview"
        srcDoc={html}
        sandbox=""
        className="w-full border-0 bg-white"
        style={{ height }}
      />
    </div>
  )
}
