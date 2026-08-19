/**
 * The profile scoring engine:
 *   the product’s rules engine
 * (NestJS service flattened to a pure function; the injected description
 * pipeline becomes `analyzeDescription`. Behavior is identical — see
 * scoring.spec.ts for the ported parity suite.)
 *
 * Deterministic, LLM-free GBP analysis engine. Same input ⇒ same output: no
 * `Date.now`, no randomness, no network. 8 categories + overallScore +
 * priorityActions, all on the 0–10 scale, plus rules metadata.
 */

import { analyzeDescription } from './description/pipeline'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  CATEGORY_WEIGHTS,
  MAX_CATEGORY_SCORE,
  PHOTO_THRESHOLDS,
  PRIORITY_ACTIONS_COUNT,
  RECOMMENDATIONS,
  REVIEW_THRESHOLDS,
  RULES_VERSION,
  type CategoryKey,
  type CategoryStatus,
} from './rules-dictionary'
import {
  DESCRIPTION_SOURCE_LABELS,
  type GbpCategory,
  type PlaceProfileSummary,
  type ResolvedDescription,
  type ScoringBriefing,
} from './types'

export type RulesAnalysisResult = {
  analysis_engine: 'rules'
  rules_version: string
  categories: GbpCategory[]
  overallScore: number
  priorityActions: string[]
  evidence: Record<string, unknown>
  applied_templates: string[]
  warnings: string[]
}

type CategoryComputation = {
  status: CategoryStatus
  value: string | null
  score: number
  evidence: Record<string, unknown>
  warning?: string
  sourceLabel?: string
}

export function analyzePlaceProfile(
  summary: PlaceProfileSummary,
  briefing?: ScoringBriefing,
  descriptionOverride?: ResolvedDescription,
): RulesAnalysisResult {
  const computations: Record<CategoryKey, CategoryComputation> = {
    fotos: scoreFotos(summary),
    avaliacoes: scoreAvaliacoes(summary),
    horarios: scoreHorarios(summary),
    descricao: scoreDescricao(summary, briefing, descriptionOverride),
    website: scoreWebsite(summary),
    telefone: scoreTelefone(summary),
    categorias: scoreCategorias(summary, briefing),
    status: scoreStatus(summary),
  }

  const categories: GbpCategory[] = CATEGORY_ORDER.map((key) => ({
    category: key,
    label: CATEGORY_LABELS[key],
    status: computations[key].status,
    value: computations[key].value,
    recommendation: RECOMMENDATIONS[key][computations[key].status],
    score: computations[key].score,
    ...(computations[key].sourceLabel ? { sourceLabel: computations[key].sourceLabel } : {}),
  }))

  const overallScore = computeOverallScore(computations)
  const priorityActions = computePriorityActions(computations)
  const applied_templates = CATEGORY_ORDER.map(
    (key) => `${key}.${computations[key].status}`,
  )
  const evidence = Object.fromEntries(
    CATEGORY_ORDER.map((key) => [key, computations[key].evidence]),
  )
  const warnings = CATEGORY_ORDER.map((key) => computations[key].warning).filter(
    (w): w is string => Boolean(w),
  )

  return {
    analysis_engine: 'rules',
    rules_version: RULES_VERSION,
    categories,
    overallScore,
    priorityActions,
    evidence,
    applied_templates,
    warnings,
  }
}

function scoreFotos(summary: PlaceProfileSummary): CategoryComputation {
  // photos come from the Places API (capped at 10), so the score must be
  // reachable within that cap — presence-graded rather than count-graded:
  // ≥5 → bom (10), 1–4 → precisa_melhorar (6), 0 → ausente (0).
  const count = summary.photos_count ?? 0
  const evidence = { count }
  if (count >= PHOTO_THRESHOLDS.bom) {
    return { status: 'bom', value: `${count} fotos`, score: 10, evidence }
  }
  if (count >= PHOTO_THRESHOLDS.precisa_melhorar) {
    return { status: 'precisa_melhorar', value: `${count} fotos`, score: 6, evidence }
  }
  return {
    status: 'ausente',
    value: '0 fotos',
    score: 0,
    evidence,
    warning: 'Perfil sem fotos.',
  }
}

function scoreAvaliacoes(summary: PlaceProfileSummary): CategoryComputation {
  const rating = summary.rating
  const count = summary.total_ratings ?? 0
  const evidence = { rating: rating ?? null, count }

  if (!count || rating == null) {
    return {
      status: 'ausente',
      value: null,
      score: 0,
      evidence,
      warning: 'Perfil sem avaliações.',
    }
  }

  const value = `${rating} (${count} avaliações)`

  if (count >= REVIEW_THRESHOLDS.minCount && rating >= REVIEW_THRESHOLDS.goodRating) {
    return { status: 'bom', value, score: 10, evidence }
  }
  if (count >= REVIEW_THRESHOLDS.minCount && rating >= REVIEW_THRESHOLDS.weakRating) {
    return { status: 'precisa_melhorar', value, score: 7, evidence }
  }
  if (count >= REVIEW_THRESHOLDS.minCount) {
    return { status: 'precisa_melhorar', value, score: 4, evidence }
  }
  return { status: 'precisa_melhorar', value, score: 5, evidence }
}

function scoreHorarios(summary: PlaceProfileSummary): CategoryComputation {
  const hasHours = Boolean(summary.has_hours)
  const evidence = { has_hours: hasHours }
  if (hasHours) {
    return {
      status: 'bom',
      value: summary.hours_text?.[0] ?? 'Horário configurado',
      score: 10,
      evidence,
    }
  }
  return { status: 'ausente', value: null, score: 0, evidence }
}

/**
 * Description scoring — delegated to the deterministic rule pipeline.
 * `descriptionOverride` carries source-resolved text; without it (the lead
 * finder's normal path) the Places `editorial_summary` is scored, exactly like
 * 's unconnected-project/competitor pipeline.
 */
function scoreDescricao(
  summary: PlaceProfileSummary,
  briefing?: ScoringBriefing,
  descriptionOverride?: ResolvedDescription,
): CategoryComputation {
  const text = descriptionOverride?.text.trim() ?? summary.editorial_summary?.trim() ?? ''
  const source = descriptionOverride?.source ?? 'editorial_summary'
  const result = analyzeDescription(text, briefing)
  return {
    status: result.status,
    value: text || null,
    score: result.score,
    evidence: { ...result.evidence, source },
    sourceLabel: DESCRIPTION_SOURCE_LABELS[source],
  }
}

function scoreWebsite(summary: PlaceProfileSummary): CategoryComputation {
  const website = summary.website?.trim() ?? ''
  const evidence = { present: Boolean(website) }
  if (website) {
    return { status: 'bom', value: website, score: 10, evidence }
  }
  return { status: 'ausente', value: null, score: 0, evidence }
}

function scoreTelefone(summary: PlaceProfileSummary): CategoryComputation {
  const phone = summary.phone?.trim() ?? ''
  const evidence = { present: Boolean(phone) }
  if (phone) {
    return { status: 'bom', value: phone, score: 10, evidence }
  }
  return { status: 'ausente', value: null, score: 0, evidence }
}

function scoreCategorias(
  summary: PlaceProfileSummary,
  briefing?: ScoringBriefing,
): CategoryComputation {
  const types = (summary.types ?? []).filter((t) => Boolean(t?.trim()))
  const evidence = { types, niche: briefing?.industry?.trim() || null }
  const value = types.length ? types.join(', ') : null

  if (types.length === 0) {
    return { status: 'ausente', value, score: 0, evidence }
  }
  if (types.length === 1) {
    return { status: 'precisa_melhorar', value, score: 6, evidence }
  }
  return { status: 'bom', value, score: 10, evidence }
}

function scoreStatus(summary: PlaceProfileSummary): CategoryComputation {
  const status = summary.business_status ?? null
  const evidence = { business_status: status }

  switch (status) {
    case 'OPERATIONAL':
      return { status: 'bom', value: 'Em operação', score: 10, evidence }
    case 'CLOSED_TEMPORARILY':
      return {
        status: 'precisa_melhorar',
        value: 'Fechado temporariamente',
        score: 4,
        evidence,
        warning: 'Status: fechado temporariamente.',
      }
    case 'CLOSED_PERMANENTLY':
      return {
        status: 'ausente',
        value: 'Fechado permanentemente',
        score: 0,
        evidence,
        warning: 'Status: fechado permanentemente.',
      }
    default:
      return {
        status: 'precisa_melhorar',
        value: status ?? 'Desconhecido',
        score: 5,
        evidence,
        warning: 'Status operacional desconhecido.',
      }
  }
}

function computeOverallScore(
  computations: Record<CategoryKey, CategoryComputation>,
): number {
  let weightedSum = 0
  let weightTotal = 0
  for (const key of CATEGORY_ORDER) {
    const weight = CATEGORY_WEIGHTS[key]
    weightedSum += computations[key].score * weight
    weightTotal += weight
  }
  if (weightTotal === 0) return 0
  return Math.round((weightedSum / weightTotal) * 10) / 10
}

function computePriorityActions(
  computations: Record<CategoryKey, CategoryComputation>,
): string[] {
  // Highest impact = largest weighted deficit (10 − score) × weight.
  // Deterministic tiebreak by CATEGORY_ORDER index.
  const ranked = CATEGORY_ORDER.map((key, index) => ({
    key,
    index,
    impact: (MAX_CATEGORY_SCORE - computations[key].score) * CATEGORY_WEIGHTS[key],
  })).sort((a, b) => (b.impact !== a.impact ? b.impact - a.impact : a.index - b.index))

  return ranked
    .slice(0, PRIORITY_ACTIONS_COUNT)
    .map(({ key }) => RECOMMENDATIONS[key][computations[key].status])
}
