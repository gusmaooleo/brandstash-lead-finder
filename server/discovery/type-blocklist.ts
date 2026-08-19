/**
 * Result-side filter (layer 2 of the owner-approved prune, 2026-08-16 — see
 * docs/category-prune-proposal.md). Search-category pruning alone can't stop
 * Google's Text Search fallback from returning public bodies on generic
 * queries, so every discovered place is also checked by its `primaryType`
 * before analysis. Deliberately NOT blocked: school, university, hospital,
 * corporate_office, tourist_attraction — legitimate businesses carry those.
 */

export const BLOCKED_PRIMARY_TYPES: ReadonlySet<string> = new Set([
  // government & public administration
  'local_government_office',
  'government_office',
  'city_hall',
  'courthouse',
  'embassy',
  'fire_station',
  'police',
  'post_office',
  'tourist_information_center',
  // civic / non-profit
  'association_or_organization',
  // worship & memorial
  'cemetery',
  'church',
  'mosque',
  'synagogue',
  'hindu_temple',
  'place_of_worship',
  // public spaces & nature
  'park',
  'national_park',
  'natural_feature',
  // transit infrastructure
  'train_station',
  'transit_station',
  'bus_station',
  'subway_station',
  'light_rail_station',
  'airport',
  // public institutions
  'library',
])

export function isBlockedPlaceType(
  primaryType: string | null | undefined,
  types: readonly string[] = [],
): boolean {
  const t = primaryType ?? types[0]
  return t ? BLOCKED_PRIMARY_TYPES.has(t) : false
}
