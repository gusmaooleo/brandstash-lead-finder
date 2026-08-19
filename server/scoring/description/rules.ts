/**
 * VERBATIM PORT of the five deterministic description criteria:
 *   brandstash-app/api/src/gbp/description-analysis/rules/length.rule.ts
 *   brandstash-app/api/src/gbp/description-analysis/rules/keywords.rule.ts
 *   brandstash-app/api/src/gbp/description-analysis/rules/density.rule.ts
 *   brandstash-app/api/src/gbp/description-analysis/rules/prohibited-content.rule.ts
 *   brandstash-app/api/src/gbp/description-analysis/rules/readability.rule.ts
 * (classes flattened into one module; @Injectable dropped — behavior unchanged.)
 */

import {
  DESCRIPTION_CRITERION_WEIGHTS,
  DESCRIPTION_DENSITY,
  DESCRIPTION_LENGTH,
  DESCRIPTION_PROHIBITED,
  DESCRIPTION_READABILITY,
} from '../rules-dictionary'
import { clamp01 } from './description-context'
import type { DescriptionContext, DescriptionRule, RuleResult } from './description-rule'

/** Length: 250–750 chars is ideal; ramps up below, gently decays above. */
export class LengthRule implements DescriptionRule {
  readonly id = 'length'
  readonly label = 'Comprimento'
  readonly weight = DESCRIPTION_CRITERION_WEIGHTS.length

  evaluate(ctx: DescriptionContext): RuleResult {
    const n = ctx.text.length
    const { idealMin, idealMax } = DESCRIPTION_LENGTH
    let score: number
    if (n >= idealMin && n <= idealMax) score = 1
    else if (n < idealMin) score = clamp01(n / idealMin)
    else score = clamp01(1 - ((n - idealMax) / idealMax) * 0.5)
    return { id: this.id, score, applicable: true, evidence: { length: n } }
  }
}

/**
 * Niche keyword coverage. Not applicable (weight dropped) when the project has
 * no niche keywords — the score isn't penalized by a missing signal.
 */
export class KeywordsRule implements DescriptionRule {
  readonly id = 'keywords'
  readonly label = 'Palavras-chave do nicho'
  readonly weight = DESCRIPTION_CRITERION_WEIGHTS.keywords

  evaluate(ctx: DescriptionContext): RuleResult {
    const total = ctx.keywords.length
    if (total === 0) {
      return {
        id: this.id,
        score: 0,
        applicable: false,
        evidence: { niche_keywords: [], matched_keywords: [] },
      }
    }
    const matched = ctx.keywords.filter((kw) => ctx.normalized.includes(kw))
    const target = Math.min(3, Math.max(1, total))
    return {
      id: this.id,
      score: clamp01(matched.length / target),
      applicable: true,
      evidence: { niche_keywords: ctx.keywords, matched_keywords: matched },
    }
  }
}

/** Lexical density (unique/total words) — penalizes excessive repetition. */
export class DensityRule implements DescriptionRule {
  readonly id = 'density'
  readonly label = 'Densidade de texto'
  readonly weight = DESCRIPTION_CRITERION_WEIGHTS.density

  evaluate(ctx: DescriptionContext): RuleResult {
    const words = ctx.words
    const unique = new Set(words).size
    // Too few words to judge repetition meaningfully → neutral-ish score.
    const score =
      words.length < DESCRIPTION_DENSITY.minWords
        ? 0.7
        : clamp01(unique / words.length / DESCRIPTION_DENSITY.goodRatio)
    return {
      id: this.id,
      score,
      applicable: true,
      evidence: { word_count: words.length, unique_words: unique },
    }
  }
}

/** Absence of prohibited content: URLs, phone numbers, excessive emojis. */
export class ProhibitedContentRule implements DescriptionRule {
  readonly id = 'prohibited'
  readonly label = 'Ausência de proibidos'
  readonly weight = DESCRIPTION_CRITERION_WEIGHTS.prohibited

  evaluate(ctx: DescriptionContext): RuleResult {
    const text = ctx.text
    const emojis = (text.match(DESCRIPTION_PROHIBITED.emoji) ?? []).length
    const violations = {
      url: DESCRIPTION_PROHIBITED.url.test(text),
      phone: DESCRIPTION_PROHIBITED.phone.test(text),
      emojis,
    }
    let score = 1
    if (violations.url) score -= 0.5
    if (violations.phone) score -= 0.4
    if (violations.emojis > DESCRIPTION_PROHIBITED.maxEmojis) score -= 0.3
    return { id: this.id, score: clamp01(score), applicable: true, evidence: { violations } }
  }
}

/** Readability via average words/sentence (simplified Flesch — shorter is better). */
export class ReadabilityRule implements DescriptionRule {
  readonly id = 'readability'
  readonly label = 'Legibilidade'
  readonly weight = DESCRIPTION_CRITERION_WEIGHTS.readability

  evaluate(ctx: DescriptionContext): RuleResult {
    const sentences = ctx.text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean)
    const sentenceCount = Math.max(1, sentences.length)
    const avg = ctx.words.length / sentenceCount
    const { idealWordsPerSentence, hardWordsPerSentence } = DESCRIPTION_READABILITY
    const score =
      avg <= idealWordsPerSentence
        ? 1
        : clamp01(1 - (avg - idealWordsPerSentence) / (hardWordsPerSentence - idealWordsPerSentence))
    return {
      id: this.id,
      score,
      applicable: true,
      evidence: { sentences: sentenceCount, words_per_sentence: Math.round(avg * 10) / 10 },
    }
  }
}

/** Run/evidence order mirrors the Brandstash module's RULE_CLASSES list. */
export const DESCRIPTION_RULES: DescriptionRule[] = [
  new LengthRule(),
  new KeywordsRule(),
  new DensityRule(),
  new ProhibitedContentRule(),
  new ReadabilityRule(),
]
