/**
 * VERBATIM PORT of the description-analysis rule contract:
 *   the product’s rules engine
 * (minus the NestJS DI token — the lead finder wires the rule list statically.)
 */

export type DescriptionContext = {
  /** Raw (trimmed) description text. */
  text: string
  /** Lowercased + accent-stripped text, for matching. */
  normalized: string
  /** Tokenized words from the normalized text. */
  words: string[]
  /** Niche keywords for the project (explicit briefing.keywords or derived). */
  keywords: string[]
}

export type RuleResult = {
  /** Rule id (e.g. 'length' | 'keywords' | …). */
  id: string
  /** Sub-score in 0..1. */
  score: number
  /** When false, the rule is excluded from the weighted score (weight dropped). */
  applicable: boolean
  /** Rule-specific evidence merged into `evidence.descricao`. */
  evidence: Record<string, unknown>
}

export interface DescriptionRule {
  readonly id: string
  readonly label: string
  /** Relative weight in the composite score (renormalized over applicable rules). */
  readonly weight: number
  evaluate(ctx: DescriptionContext): RuleResult
}
