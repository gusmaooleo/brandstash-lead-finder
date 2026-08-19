/**
 * WHO the outreach is written for. A business owner is pitched their own
 * Google profile; a marketing agency is pitched the multi-client dashboard
 * (see notes-agency.ts) — the same lead data, a different sale.
 *
 * The audience is derived from the lead's category, which exists in two
 * vocabularies: the catalog display name discovery SEARCHED for ("Marketing
 * agency" — the same list the header picker shows) and the Places API
 * primaryType stored on the lead ("marketing_agency"). Both are compared as
 * slugs, so one list of catalog names covers both.
 */

import type { LeadDoc } from '../leads/models'

export type OutreachAudience = 'business' | 'agency'

/**
 * Catalog categories whose leads ARE marketing agencies. Deliberately narrow:
 * companies that sell marketing/branding/web work to other businesses. Not
 * printers, not software houses, not travel/insurance "agencies".
 */
export const AGENCY_CATEGORIES: readonly string[] = [
  'Marketing agency',
  'Marketing consultant',
  'Advertising agency',
  'Branding agency',
  'Design agency',
  'E commerce agency',
  'Internet marketing service',
  'Public relations firm',
  'Media company',
  'Media consultant',
  'Media house',
  'Website designer',
  'Graphic designer',
  'Video production service',
]

export function categorySlug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const AGENCY_SLUGS = new Set(AGENCY_CATEGORIES.map(categorySlug))

/**
 * The catalog category a lead was discovered under. Stored on new leads;
 * recovered from the search query ("<category> in <City, Country>") for the
 * ones queued before the field existed.
 */
export function searchedCategory(lead: {
  discovery?: { query?: string | null; search_category?: string | null } | null
}): string | null {
  const stored = lead.discovery?.search_category
  if (stored) return stored
  const query = lead.discovery?.query
  if (!query) return null
  // The place suffix never contains " in ", so the LAST separator is the one.
  const cut = query.lastIndexOf(' in ')
  return cut > 0 ? query.slice(0, cut).trim() : null
}

/** Every category key a lead can be matched by (catalog name + primaryType). */
export function leadCategoryKeys(lead: {
  category?: string | null
  discovery?: { query?: string | null; search_category?: string | null } | null
}): string[] {
  const keys = new Set<string>()
  const searched = searchedCategory(lead)
  if (searched) keys.add(categorySlug(searched))
  if (lead.category) keys.add(categorySlug(lead.category))
  return [...keys]
}

export function audienceForLead(
  lead: Pick<LeadDoc, 'category'> | { category?: string | null; discovery?: { query?: string | null; search_category?: string | null } | null },
): OutreachAudience {
  return leadCategoryKeys(lead).some((key) => AGENCY_SLUGS.has(key)) ? 'agency' : 'business'
}
