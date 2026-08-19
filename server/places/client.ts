/**
 * Google Places API (New) client — server-side only, minimal field masks.
 *
 * The details mask mirrors the product’s place-details field mask
 * (the product’s rules engine) minus `reviews`:
 * no scoring rule reads the review sample, and `reviews` alone pins the call to
 * the most expensive billing tier. `photos.name` is requested instead of full
 * `photos` — only the count feeds the score (Places caps the list at 10, which
 * is exactly what the ported thresholds are calibrated for).
 */

import { settings } from '../settings/settings'
import type { PlaceProfileSummary } from '../scoring/types'

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
const DETAILS_URL = 'https://places.googleapis.com/v1/places'

const SEARCH_FIELD_MASK = 'places.id,nextPageToken'

export const DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  // Essentials-tier geometry — plotted on the dashboard globe.
  'location',
  'nationalPhoneNumber',
  'internationalPhoneNumber',
  'websiteUri',
  'rating',
  'userRatingCount',
  'regularOpeningHours',
  'photos.name',
  'types',
  'primaryType',
  'primaryTypeDisplayName',
  'businessStatus',
  'editorialSummary',
].join(',')

export type PlaceDetails = {
  id: string
  displayName?: { text?: string }
  formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
  nationalPhoneNumber?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  rating?: number
  userRatingCount?: number
  regularOpeningHours?: { weekdayDescriptions?: string[] }
  photos?: Array<{ name?: string }>
  types?: string[]
  primaryType?: string
  primaryTypeDisplayName?: { text?: string }
  businessStatus?: string
  editorialSummary?: { text?: string }
}

export class PlacesApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function placesFetch(url: string, fieldMask: string, init: RequestInit): Promise<unknown> {
  if (!settings().googlePlacesApiKey) {
    throw new PlacesApiError('No Google Places API key configured — add it in Settings.', 0)
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': settings().googlePlacesApiKey,
      'X-Goog-FieldMask': fieldMask,
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new PlacesApiError(`Places API ${res.status}: ${body.slice(0, 300)}`, res.status)
  }
  return res.json()
}

export async function searchPlaceIds(params: {
  textQuery: string
  languageCode: string
  regionCode: string
  pageToken?: string | null
}): Promise<{ ids: string[]; nextPageToken: string | null }> {
  const body: Record<string, unknown> = {
    textQuery: params.textQuery,
    languageCode: params.languageCode,
    regionCode: params.regionCode,
    pageSize: 20,
  }
  if (params.pageToken) body.pageToken = params.pageToken
  const data = (await placesFetch(SEARCH_URL, SEARCH_FIELD_MASK, {
    method: 'POST',
    body: JSON.stringify(body),
  })) as { places?: Array<{ id?: string }>; nextPageToken?: string }
  return {
    ids: (data.places ?? []).map((p) => p.id).filter((id): id is string => Boolean(id)),
    nextPageToken: data.nextPageToken ?? null,
  }
}

export async function getPlaceDetails(
  placeId: string,
  languageCode: string,
  regionCode: string,
): Promise<PlaceDetails> {
  const qs = new URLSearchParams({ languageCode, regionCode })
  return (await placesFetch(`${DETAILS_URL}/${encodeURIComponent(placeId)}?${qs}`, DETAILS_FIELD_MASK, {
    method: 'GET',
  })) as PlaceDetails
}

/**
 * Builds the place profile
 * (the product’s rules engine): same field
 * resolution order. `reviews_count`/`reviews_sample` are stored empty — not
 * requested (see header) and never read by the scoring rules.
 */
export function buildSummary(details: PlaceDetails, fallbackName = '(sem nome)'): PlaceProfileSummary {
  return {
    name: details.displayName?.text ?? fallbackName,
    address: details.formattedAddress ?? null,
    phone: details.nationalPhoneNumber ?? details.internationalPhoneNumber ?? null,
    website: details.websiteUri ?? null,
    rating: details.rating ?? null,
    total_ratings: details.userRatingCount ?? null,
    has_hours: !!details.regularOpeningHours,
    hours_text: details.regularOpeningHours?.weekdayDescriptions ?? null,
    photos_count: details.photos?.length ?? 0,
    reviews_count: 0,
    reviews_sample: [],
    types: details.types ?? [],
    editorial_summary: details.editorialSummary?.text ?? null,
    business_status: details.businessStatus ?? null,
  }
}
