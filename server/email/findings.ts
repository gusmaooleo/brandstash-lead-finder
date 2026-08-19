/**
 * WHICH gap in a lead's public profile the copy leads with.
 *
 * The rule lives here: what counts as "no photos", "few reviews", the order
 * they matter in (photos and reviews weigh double in the score, then hours,
 * then description), and the rotation that stops every send in a sequence
 * from opening with the same observation.
 *
 * The WORDS live in the template (`findings` on the document), so each
 * template says it in its own voice — and a template that says nothing about
 * a gap simply resolves to nothing instead of borrowing someone else's line.
 */

export type FindingPhrases = {
  no_photos?: string | null
  few_photos?: string | null
  no_reviews?: string | null
  few_reviews?: string | null
  no_hours?: string | null
  no_description?: string | null
  clean?: string | null
}

export type FindingsSummary = {
  photos_count: number
  has_hours: boolean
  editorial_summary: string | null
  total_ratings: number | null
}

/** Below these, the profile reads as thin to someone comparing on Google. */
const FEW_PHOTOS = 4
const FEW_REVIEWS = 30

/** `{{count}}` is the only token a finding phrase may carry. */
function withCount(phrase: string, count: number): string {
  return phrase.replace(/\{\{\s*count\s*\}\}/gi, String(count))
}

/**
 * The findings that apply, strongest first. `variant` rotates the list so the
 * second send of a sequence leads with a different gap than the first.
 */
export function resolveFindings(
  phrases: FindingPhrases | null | undefined,
  summary: FindingsSummary,
  variant = 0,
): string[] {
  const p = phrases ?? {}
  const out: string[] = []
  const push = (phrase: string | null | undefined, count?: number): void => {
    const text = (phrase ?? '').trim()
    if (text) out.push(count == null ? text : withCount(text, count))
  }

  if (summary.photos_count === 0) push(p.no_photos)
  else if (summary.photos_count < FEW_PHOTOS) push(p.few_photos, summary.photos_count)

  if (summary.total_ratings == null || summary.total_ratings === 0) push(p.no_reviews)
  else if (summary.total_ratings < FEW_REVIEWS) push(p.few_reviews, summary.total_ratings)

  if (!summary.has_hours) push(p.no_hours)
  if (!summary.editorial_summary) push(p.no_description)
  if (!out.length) push(p.clean)

  if (out.length < 2) return out
  const shift = ((variant % out.length) + out.length) % out.length
  return out.map((_, i) => out[(i + shift) % out.length])
}
