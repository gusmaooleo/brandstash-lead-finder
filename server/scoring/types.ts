/**
 * Input/output shapes of the Brandstash rules engine, ported from:
 *   brandstash-app/api/src/gbp/interfaces/place-profile.interface.ts
 *   brandstash-app/api/src/gbp/interfaces/project-briefing.interface.ts (subset)
 *   brandstash-app/api/src/gbp/interfaces/gbp-report.interface.ts (GbpCategory)
 *
 * Keep these in lockstep with the source — the lead-finder score must stay
 * identical in meaning and behavior to the Brandstash business score.
 */

export interface PlaceProfileSummary {
  name: string
  address: string | null
  phone: string | null
  website: string | null
  rating: number | null
  total_ratings: number | null
  has_hours: boolean
  hours_text: string[] | null
  photos_count: number
  reviews_count: number
  reviews_sample: Array<{
    rating: number
    text: string
  }>
  types: string[]
  editorial_summary: string | null
  business_status: string | null
}

/**
 * The subset of the Brandstash `ProjectBriefing` the rules engine actually
 * reads: `keywords` (explicit niche keywords) and the niche fields used to
 * derive them (`industry`, `differentiators`, `targetAudience`,
 * `businessName`). The lead finder passes `{ industry: <discovery category> }`
 * — see docs/SCORING_PARITY.md.
 */
export interface ScoringBriefing {
  businessName?: string
  industry?: string
  differentiators?: string
  targetAudience?: string
  keywords?: string[]
}

export type DescriptionSource = 'gbp_profile' | 'editorial_summary'

export type ResolvedDescription = {
  text: string
  source: DescriptionSource
}

/** Mirrors brandstash-app `DESCRIPTION_SOURCE_LABELS` (gbp-description-source.service.ts). */
export const DESCRIPTION_SOURCE_LABELS: Record<DescriptionSource, string> = {
  gbp_profile: 'descrição do perfil (Google Business)',
  editorial_summary: 'resumo editorial do Google',
}

export type GbpCategory = {
  category: string
  label: string
  status: 'bom' | 'precisa_melhorar' | 'ausente'
  value: string | null
  recommendation: string
  score: number
  sourceLabel?: string
}
