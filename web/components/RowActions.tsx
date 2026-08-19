/**
 * Per-row lead controls, shared by the dashboard feed and the full table:
 * pending → ✓ approve / → skip / ✕ do-not-contact; followup → ✓ send next
 * follow-up / → stop following up / ✕ do-not-contact; skipped & archived →
 * reopen; failed → retry; approved/sent → delivery chip; dnc → suppressed.
 */

import {
  approveLead,
  doNotContactApproved,
  doNotContactLead,
  reopenLead,
  retryDelivery,
  sendFollowup,
  skipLead,
  stopFollowups,
  type Lead,
} from '../api'
import { Button, Chip, IconButton } from './ui'

export type LeadTabKey =
  | 'pending'
  | 'approved'
  | 'sent'
  | 'followup'
  | 'failed'
  | 'skipped'
  | 'do_not_contact'
  | 'archived'

type Props = {
  lead: Lead
  tab: LeadTabKey
  /** `<leadId>:<action>` while an action is in flight (shared across rows). */
  rowBusy: string | null
  run: (lead: Lead, action: string, fn: () => Promise<unknown>) => Promise<void>
}

export function RowActions({ lead, tab, rowBusy, run }: Props) {
  const isBusy = rowBusy?.startsWith(`${lead._id}:`) ?? false

  if (tab === 'pending') {
    const selectedIsThirdParty =
      lead.contact.emails.find((e) => e.address === lead.contact.selected_email)?.kind === 'third_party'
    return (
      <span className="inline-flex items-center gap-1">
        <IconButton
          tone="green"
          disabled={isBusy || !lead.contact.selected_email}
          aria-label="Approve & send"
          title={
            lead.contact.selected_email
              ? `Approve & send to ${lead.contact.selected_email}${selectedIsThirdParty ? ' (may be third-party)' : ''}`
              : 'Open the lead to choose or add a recipient'
          }
          onClick={() => run(lead, 'approve', () => approveLead(lead._id, lead.contact.selected_email!))}
        >
          {rowBusy === `${lead._id}:approve` ? '…' : '✓'}
        </IconButton>
        <IconButton
          tone="neutral"
          disabled={isBusy}
          aria-label="Skip"
          title="Skip"
          onClick={() => run(lead, 'skip', () => skipLead(lead._id))}
        >
          {rowBusy === `${lead._id}:skip` ? '…' : '→'}
        </IconButton>
        <IconButton
          tone="red"
          disabled={isBusy}
          aria-label="Do not contact"
          title="Do not contact — suppress every discovered address"
          onClick={() => run(lead, 'dnc', () => doNotContactLead(lead._id))}
        >
          {rowBusy === `${lead._id}:dnc` ? '…' : '✕'}
        </IconButton>
      </span>
    )
  }

  if (tab === 'followup') {
    const next = Math.min((lead.outreach?.count ?? 1) + 1, 3)
    return (
      <span className="inline-flex items-center gap-1">
        <IconButton
          tone="green"
          disabled={isBusy}
          aria-label={`Send follow-up ${next} of 3`}
          title={`Send follow-up ${next}/3 — a different variant, “it's me again” tone`}
          onClick={() => run(lead, 'followup', () => sendFollowup(lead._id))}
        >
          {rowBusy === `${lead._id}:followup` ? '…' : '✓'}
        </IconButton>
        <IconButton
          tone="neutral"
          disabled={isBusy}
          aria-label="Stop following up"
          title="Skip — stop following this lead up"
          onClick={() => run(lead, 'fstop', () => stopFollowups(lead._id))}
        >
          {rowBusy === `${lead._id}:fstop` ? '…' : '→'}
        </IconButton>
        <IconButton
          tone="red"
          disabled={isBusy}
          aria-label="Do not contact"
          title="Do not contact — suppress every discovered address"
          onClick={() => run(lead, 'fdnc', () => doNotContactApproved(lead._id))}
        >
          {rowBusy === `${lead._id}:fdnc` ? '…' : '✕'}
        </IconButton>
      </span>
    )
  }

  if (tab === 'skipped' || tab === 'archived') {
    return (
      <Button
        variant="ghost"
        className="!px-2.5 !py-1 !text-[11.5px]"
        disabled={isBusy}
        onClick={() => run(lead, 'reopen', () => reopenLead(lead._id))}
      >
        Reopen
      </Button>
    )
  }

  if (tab === 'failed') {
    return (
      <Button
        variant="primary"
        className="!px-2.5 !py-1 !text-[11.5px]"
        disabled={isBusy}
        title={lead.delivery.last_error ?? ''}
        onClick={() => run(lead, 'retry', () => retryDelivery(lead._id))}
      >
        {rowBusy === `${lead._id}:retry` ? '…' : 'Retry'}
      </Button>
    )
  }

  if (tab === 'approved' || tab === 'sent') {
    return (
      <Chip
        className={
          lead.delivery.state === 'failed'
            ? 'tint-bad'
            : 'tint-good'
        }
      >
        {lead.delivery.state.replace(/_/g, ' ')}
      </Chip>
    )
  }

  return <span className="text-[10.5px] text-gray-3">suppressed</span>
}
