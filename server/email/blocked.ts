/**
 * The two permanent recipient blocklists in ONE lookup: the suppression list
 * (asked not to be contacted) and the dead registry (mailbox provably
 * refuses mail). Sends are already blocked against both right before
 * delivery — this is the read used *earlier*, when electing a default
 * recipient, so the approval UI never offers a button whose send would be
 * refused.
 */

import { DeadAddress, Suppression } from '../leads/models'

export async function blockedAddresses(addresses: readonly string[]): Promise<Set<string>> {
  const list = [...new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))]
  if (!list.length) return new Set()
  const [suppressed, dead] = await Promise.all([
    Suppression.find({ email: { $in: list } }, { email: 1 }).lean(),
    DeadAddress.find({ email: { $in: list } }, { email: 1 }).lean(),
  ])
  return new Set([...suppressed, ...dead].map((d) => d.email))
}
