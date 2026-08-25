import { addressLabel, replyTrackingReady, settings } from '../settings/settings'
import { isValidRid } from '../tracking/rid'

function addressOf(value: string): string {
  return value.match(/<([^>]+)>/)?.[1]?.trim().toLowerCase() ?? value.trim().toLowerCase()
}

export function replyAddressForRid(rid: string | null | undefined): string | null {
  const current = settings()
  if (!rid || !isValidRid(rid) || !replyTrackingReady(current).ready) {
    return current.email.replyTo.label || null
  }
  const email = `${current.replies.localPart}-${rid.toLowerCase()}@${current.replies.receivingDomain}`
  return addressLabel(current.email.replyTo.name || current.email.from.name, email)
}

export function ridFromReplyAddress(value: string): string | null {
  const current = settings()
  const address = addressOf(value)
  const suffix = `@${current.replies.receivingDomain}`
  const prefix = `${current.replies.localPart}-`
  if (!address.endsWith(suffix)) return null
  const local = address.slice(0, -suffix.length)
  if (!local.startsWith(prefix)) return null
  const rid = local.slice(prefix.length)
  return isValidRid(rid) ? rid : null
}
