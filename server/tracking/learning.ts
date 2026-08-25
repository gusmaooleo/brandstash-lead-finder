import { isSent, type SendRow } from './metrics'

export const ATTRIBUTION_WINDOW_DAYS = 7
export const MIN_PERFORMANCE_SAMPLE = 20
const WINDOW_MS = ATTRIBUTION_WINDOW_DAYS * 86_400_000

function dateOf(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

export function wilsonLowerBound(successes: number, total: number, z = 1.96): number {
  if (total <= 0) return 0
  const p = successes / total
  const z2 = z * z
  const denominator = 1 + z2 / total
  const centre = p + z2 / (2 * total)
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)
  return Math.max(0, (centre - margin) / denominator)
}

function convertedWithin(row: SendRow, type: 'visit' | 'reply'): boolean {
  const sent = dateOf(row.sent_at)
  const converted = dateOf(
    type === 'visit' ? row.landing_visit?.first_observed_at : row.reply_summary?.first_observed_at,
  )
  if (!sent || !converted) return false
  const elapsed = converted.getTime() - sent.getTime()
  return elapsed >= 0 && elapsed <= WINDOW_MS
}

export function isMatureSend(row: SendRow, now = new Date()): boolean {
  const sent = dateOf(row.sent_at)
  return isSent(row) && Boolean(sent && sent.getTime() <= now.getTime() - WINDOW_MS)
}

export type LearningMetrics = {
  sent: number
  visited: number
  visit_rate: number
  visit_confidence: number
  replied: number
  reply_rate: number
  reply_confidence: number
  score: number | null
  eligible: boolean
}

function performance(rows: readonly SendRow[]): LearningMetrics {
  const sent = rows.length
  const visited = rows.filter((row) => convertedWithin(row, 'visit')).length
  const replied = rows.filter((row) => convertedWithin(row, 'reply')).length
  const visitConfidence = wilsonLowerBound(visited, sent)
  const replyConfidence = wilsonLowerBound(replied, sent)
  const eligible = sent >= MIN_PERFORMANCE_SAMPLE
  return {
    sent,
    visited,
    visit_rate: sent ? (visited / sent) * 100 : 0,
    visit_confidence: visitConfidence * 100,
    replied,
    reply_rate: sent ? (replied / sent) * 100 : 0,
    reply_confidence: replyConfidence * 100,
    score: eligible ? (replyConfidence * 0.7 + visitConfidence * 0.3) * 100 : null,
    eligible,
  }
}

export type VariantLearningRow = LearningMetrics & {
  key: string
  cohort_key: string
  template_key: string
  template_name: string
  language: string
  followup: number
  variant: number
  fingerprint: string
  subject: string
  band: string | null
  winner: boolean
}

export function rankVariants(rows: readonly SendRow[], now = new Date()): VariantLearningRow[] {
  const groups = new Map<string, SendRow[]>()
  for (const row of rows) {
    if (!isMatureSend(row, now) || !row.template_key || !row.variant_fingerprint) continue
    if (row.template_key === 'legacy' || row.template_key === 'one_off') continue
    const key = [row.template_key, row.language ?? '—', row.followup ?? 0, row.variant_band ?? 'any', row.variant_fingerprint].join('|')
    const current = groups.get(key)
    if (current) current.push(row)
    else groups.set(key, [row])
  }
  const ranked = [...groups.entries()].map(([key, list]) => {
    const sample = list[0]
    const cohort = [sample.template_key, sample.language ?? '—', sample.followup ?? 0, sample.variant_band ?? 'any'].join('|')
    return {
      key,
      cohort_key: cohort,
      template_key: sample.template_key!,
      template_name: sample.template_name ?? sample.template_key!,
      language: sample.language ?? '—',
      followup: sample.followup ?? 0,
      variant: sample.variant ?? 0,
      fingerprint: sample.variant_fingerprint!,
      subject: sample.variant_subject ?? '',
      band: sample.variant_band ?? null,
      winner: false,
      ...performance(list),
    }
  })
  ranked.sort((a, b) => {
    if (a.cohort_key !== b.cohort_key) return a.cohort_key.localeCompare(b.cohort_key)
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
    return (b.score ?? -1) - (a.score ?? -1) || b.sent - a.sent
  })
  const winners = new Set<string>()
  for (const row of ranked) {
    if (row.eligible && !winners.has(row.cohort_key)) {
      row.winner = true
      winners.add(row.cohort_key)
    }
  }
  return ranked
}

export type CategoryLearningRow = LearningMetrics & { key: string; winner: boolean }

export function rankCategories(rows: readonly SendRow[], now = new Date()): CategoryLearningRow[] {
  const groups = new Map<string, SendRow[]>()
  for (const row of rows) {
    if (!isMatureSend(row, now) || !row.search_category) continue
    const current = groups.get(row.search_category)
    if (current) current.push(row)
    else groups.set(row.search_category, [row])
  }
  const ranked = [...groups.entries()].map(([key, list]) => ({ key, winner: false, ...performance(list) }))
  ranked.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
    return (b.score ?? -1) - (a.score ?? -1) || b.sent - a.sent
  })
  const winner = ranked.find((row) => row.eligible)
  if (winner) winner.winner = true
  return ranked
}
