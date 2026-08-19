/**
 * Normalized website domain — the secondary dedup signal (Place ID is primary).
 * Lowercased hostname without `www.`; null when the value isn't a usable URL.
 */
export function normalizeDomain(website: string | null | undefined): string | null {
  const raw = website?.trim()
  if (!raw) return null
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    let host = url.hostname.toLowerCase()
    if (host.startsWith('www.')) host = host.slice(4)
    return host || null
  } catch {
    return null
  }
}
