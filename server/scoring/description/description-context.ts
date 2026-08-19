/**
 * VERBATIM PORT of:
 *   the product’s rules engine
 *
 * Builds the shared `DescriptionContext` once per analysis. Pure +
 * deterministic. Niche keywords come from `briefing.keywords` when present;
 * otherwise they're derived from the briefing's niche fields.
 */

import { KEYWORD_STOPWORDS } from '../rules-dictionary'
import type { ScoringBriefing } from '../types'
import type { DescriptionContext } from './description-rule'

export function buildDescriptionContext(
  text: string,
  briefing?: ScoringBriefing,
): DescriptionContext {
  const normalized = normalizeText(text)
  return {
    text,
    normalized,
    words: normalized.split(/\s+/).filter(Boolean),
    keywords: resolveKeywords(briefing),
  }
}

/** Lowercase + strip diacritics for deterministic matching. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** Explicit project keywords take precedence; else derive from the niche. */
function resolveKeywords(briefing?: ScoringBriefing): string[] {
  const explicit = briefing?.keywords
  if (Array.isArray(explicit) && explicit.length) {
    return dedupe(
      explicit
        .map((k) => normalizeText(String(k)).trim())
        .filter((k) => k.length > 0),
    )
  }
  return deriveNicheKeywords(briefing)
}

/** Tokens from the briefing's niche fields, normalized + de-noised. */
export function deriveNicheKeywords(briefing?: ScoringBriefing): string[] {
  if (!briefing) return []
  const raw = [
    briefing.industry,
    briefing.differentiators,
    briefing.targetAudience,
    briefing.businessName,
  ]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(' ')
  const tokens = normalizeText(raw)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !KEYWORD_STOPWORDS.has(t))
  return dedupe(tokens)
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}
