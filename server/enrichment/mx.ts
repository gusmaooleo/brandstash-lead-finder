/**
 * Recipient-domain MX verification. A domain without MX records cannot
 * receive mail — sending there is a guaranteed bounce, and bounces are what
 * burn sender reputation. Pure DNS (node:dns), in-process cache, resolver
 * injectable for tests. Only a definitive ENOTFOUND/ENODATA condemns a
 * domain; transient DNS failures are 'unknown' and never block anything.
 */

import { resolveMx } from 'node:dns/promises'
import type { ContactEmail } from '../../shared/types'
import {
  classifyEmailDomain,
  isGenericPrefix,
  isPlausibleBusinessEmail,
  repairGluedDomain,
} from './email-extract'

export type MxStatus = 'ok' | 'no_mx' | 'unknown'
export type MxResolver = (domain: string) => Promise<Array<{ exchange: string; priority: number }>>

const TTL_MS = 24 * 60 * 60 * 1000
const CACHE_CAP = 5000
const cache = new Map<string, { status: MxStatus; at: number }>()

export async function checkMx(domain: string, resolver: MxResolver = resolveMx): Promise<MxStatus> {
  const d = domain.trim().toLowerCase()
  if (!d) return 'unknown'
  const hit = cache.get(d)
  if (hit && hit.status !== 'unknown' && Date.now() - hit.at < TTL_MS) return hit.status
  let status: MxStatus
  try {
    const records = await resolver(d)
    status = records.length > 0 ? 'ok' : 'no_mx'
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    status = code === 'ENOTFOUND' || code === 'ENODATA' ? 'no_mx' : 'unknown'
  }
  cache.set(d, { status, at: Date.now() })
  if (cache.size > CACHE_CAP) cache.delete(cache.keys().next().value as string)
  return status
}

/**
 * Annotates each email's `mx` in place (one DNS query per unique domain).
 * 'unknown' leaves the field untouched — absence of evidence is not a badge.
 */
export async function annotateMx(emails: ContactEmail[], resolver: MxResolver = resolveMx): Promise<void> {
  const domains = [...new Set(emails.map((e) => e.address.split('@')[1] ?? '').filter(Boolean))]
  const results = new Map<string, MxStatus>()
  for (const domain of domains) {
    results.set(domain, await checkMx(domain, resolver))
  }
  for (const e of emails) {
    const status = results.get(e.address.split('@')[1] ?? '')
    if (status === 'ok' || status === 'no_mx') e.mx = status
  }
}

/**
 * Recovers addresses the page glued to the next word ("…@gmail.comVisit"):
 * for each no-MX address whose domain contains a known TLD boundary, the cut
 * candidate is added ALONGSIDE the original — but only with DNS evidence on
 * both sides (original provably dead, candidate provably alive), so a real
 * exotic-TLD domain can never be "repaired" into the wrong one. Returns the
 * addresses it added.
 */
export async function recoverGluedEmails(
  emails: ContactEmail[],
  ownDomain: string | null,
  resolver: MxResolver = resolveMx,
): Promise<string[]> {
  const added: string[] = []
  for (const e of [...emails]) {
    if (e.mx !== 'no_mx') continue
    const [local, domain] = e.address.split('@')
    if (!local || !domain) continue
    const repairedDomain = repairGluedDomain(domain)
    if (!repairedDomain) continue
    const candidate = `${local}@${repairedDomain}`
    if (!isPlausibleBusinessEmail(candidate)) continue
    if (emails.some((x) => x.address === candidate)) continue
    if ((await checkMx(repairedDomain, resolver)) !== 'ok') continue
    emails.push({
      address: candidate,
      source_url: e.source_url,
      generic: isGenericPrefix(candidate),
      kind: classifyEmailDomain(candidate, ownDomain),
      mx: 'ok',
    })
    added.push(candidate)
  }
  return added
}
