/**
 * The lead filter set — one definition for the two surfaces that offer it:
 * the dashboard feed panel and the full table. Both send it to GET /api/leads
 * and both paginate the answer, so a filter that behaved differently on one
 * of them would just be a bug with two homes.
 *
 * Every value is a query string as the API reads it; `category` is a list
 * because it is a multi-select (repeated ?category=… params).
 */

export type LeadFilters = {
  country: string
  language: string
  category: string[]
  score_min: string
  score_max: string
  rating_min: string
  rating_max: string
  has_email: string
  date_from: string
  date_to: string
  q: string
}

export const EMPTY_LEAD_FILTERS: LeadFilters = {
  country: '', language: '', category: [], score_min: '', score_max: '',
  rating_min: '', rating_max: '', has_email: '', date_from: '', date_to: '', q: '',
}

const isSet = (value: string | string[]) => (Array.isArray(value) ? value.length > 0 : Boolean(value))

/** Is anything narrowing the list right now? Drives the "Clear" affordance. */
export function anyLeadFilter(filters: LeadFilters): boolean {
  return Object.values(filters).some(isSet)
}

/** The filters as query params — empty ones left out entirely. */
export function leadFilterParams(filters: LeadFilters): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(filters)) if (isSet(value)) params[key] = value
  return params
}
