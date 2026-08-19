/**
 * WHICH angle of a message a lead receives.
 *
 * One rule, deterministic: the same lead always draws the same variant, so a
 * preview shows what will actually be sent and a re-send never changes voice.
 * Three filters narrow the pool first:
 *
 *  - a variant that names the lead's rating is skipped for an unrated lead;
 *  - with `low_score_variants` on, only variants written for the lead's score
 *    band are eligible (a neglected profile and a strong one get different
 *    openings);
 *  - a follow-up never repeats an angle already used in the sequence.
 */

export type PickableVariant = {
  band?: string | null
  needs_rating?: boolean | null
}

/** FNV-1a — deterministic selection keyed by Place ID. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Well-rated leads read as 'high'; everything else, including unrated, 'low'. */
export function scoreBand(rating: number | null | undefined): 'low' | 'high' {
  return rating != null && rating >= 4 ? 'high' : 'low'
}

export type PickVariantInput = {
  placeId: string
  rating?: number | null
  /** Only honoured when the template opts in. */
  useBands?: boolean
  /** Indexes already sent in this sequence. */
  used?: readonly number[]
}

/**
 * The index of the chosen variant, or -1 when the template has none that fits.
 * Filters that would empty the pool are dropped rather than enforced: a
 * template with a single angle still sends it.
 */
export function pickVariantIndex(variants: readonly PickableVariant[], input: PickVariantInput): number {
  if (!variants.length) return -1

  let eligible = variants.map((_, i) => i)
  if (input.useBands) {
    const band = scoreBand(input.rating)
    const banded = eligible.filter((i) => (variants[i].band ?? band) === band)
    if (banded.length) eligible = banded
  }
  if (input.rating == null) {
    const rateless = eligible.filter((i) => !variants[i].needs_rating)
    if (rateless.length) eligible = rateless
  }

  const used = input.used ?? []
  const base = hashString(input.placeId) % eligible.length
  for (let i = 0; i < eligible.length; i++) {
    const candidate = eligible[(base + i) % eligible.length]
    if (!used.includes(candidate)) return candidate
  }
  return eligible[base]
}
