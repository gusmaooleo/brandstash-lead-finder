/**
 * VERBATIM PORT of:
 *   the product’s rules engine
 * (the DI-injected rule list becomes the static DESCRIPTION_RULES array.)
 *
 * Runs the registered description rules over a single shared context and
 * combines their sub-scores by weight, renormalizing over the *applicable*
 * rules (a non-applicable rule, e.g. keywords without niche, drops its weight
 * instead of scoring zero). Deterministic — same text + briefing ⇒ same result.
 */

import {
  DESCRIPTION_SCORE_THRESHOLDS,
  RULES_VERSION,
  type CategoryStatus,
} from '../rules-dictionary'
import type { ScoringBriefing } from '../types'
import { buildDescriptionContext } from './description-context'
import type { RuleResult } from './description-rule'
import { DESCRIPTION_RULES } from './rules'

export type DescriptionAnalysisResult = {
  /** Composite score, 0–10. */
  score: number
  status: CategoryStatus
  version: string
  perRule: RuleResult[]
  /** Shape consumed by the UI/report (`evidence.descricao`). */
  evidence: Record<string, unknown>
}

export function analyzeDescription(
  text: string | null | undefined,
  briefing?: ScoringBriefing,
): DescriptionAnalysisResult {
  const trimmed = (text ?? '').trim()
  if (!trimmed) {
    return {
      score: 0,
      status: 'ausente',
      version: RULES_VERSION,
      perRule: [],
      evidence: { length: 0 },
    }
  }

  const ctx = buildDescriptionContext(trimmed, briefing)
  const results = DESCRIPTION_RULES.map((rule) => ({ rule, result: rule.evaluate(ctx) }))

  let weighted = 0
  let weightTotal = 0
  for (const { rule, result } of results) {
    if (!result.applicable) continue
    weighted += result.score * rule.weight
    weightTotal += rule.weight
  }
  const score = weightTotal === 0 ? 0 : Math.round((weighted / weightTotal) * 100) / 10

  const status: CategoryStatus =
    score >= DESCRIPTION_SCORE_THRESHOLDS.bom ? 'bom' : 'precisa_melhorar'

  const subScores: Record<string, number> = {}
  let evidence: Record<string, unknown> = { length: trimmed.length, word_count: ctx.words.length }
  let keywordsApplied = false
  for (const { result } of results) {
    if (result.applicable) subScores[result.id] = result.score
    if (result.id === 'keywords') keywordsApplied = result.applicable
    evidence = { ...evidence, ...result.evidence }
  }

  return {
    score,
    status,
    version: RULES_VERSION,
    perRule: results.map((r) => r.result),
    evidence: {
      ...evidence,
      sub_scores: subScores,
      weighted_score: score,
      keywords_applied: keywordsApplied,
    },
  }
}
