/**
 * WHICH template — and which of its languages — a lead gets.
 *
 * Every template is a document (email/template-models.ts); nothing is coded.
 * A lead's language is decided by the country it was found in (markets.ts), so
 * resolution never chooses a language: it looks for the copy that answers the
 * one the lead already has.
 *
 * Over active templates that carry that language AND the step being sent:
 *   1. templates whose `categories` contain one of the lead's category keys —
 *      the searched catalog name AND the Places primaryType, both as slugs
 *      (see category-match.ts);
 *   2. the most SPECIFIC match wins (fewest categories), then the lowest
 *      `priority`, then the most recently updated;
 *   3. nothing matched → the generic template (empty `categories`);
 *   4. nothing at all → null. The caller must say "no template" rather than
 *      invent one, or write to a lead in a language it does not read: an
 *      incomplete library is a state the UI shows, not an error.
 *
 * Whatever the rules pick is only a SUGGESTION: the lead screen may send with
 * any template that has the lead's language, category restrictions included.
 *
 * The list is cached in memory (templates change from one screen, rarely) and
 * invalidated on every write.
 */

import { EmailTemplate, languagesOf, type EmailTemplateDoc, type TemplateLanguageDoc } from './template-models'
import { categorySlug, leadCategoryKeys } from './category-match'
import type { FindingPhrases } from './findings'
import type { RenderableVariant } from './template-render'
import type { EmailLanguage } from '../../shared/types'

export type TemplateMessage = { followup: number; variants: RenderableVariant[] }

/** One template resolved down to ONE language — what the renderer consumes. */
export type ResolvedTemplate = {
  id: string
  name: string
  audience: string
  /** The language version this resolution picked. */
  language: EmailLanguage
  /** Narrow the variant pick by the lead's score band. */
  lowScoreVariants: boolean
  findings: FindingPhrases
  /** The template's own words for category names and opportunities. */
  strings: Record<string, string>
  assets: string[]
  messages: TemplateMessage[]
}

let cache: EmailTemplateDoc[] | null = null

export function invalidateTemplates(): void {
  cache = null
}

/**
 * Test seam — fills the cache without a database, so the resolution rules can
 * be exercised directly. Production code never calls this.
 */
export function setTemplatesForTests(docs: Array<Partial<EmailTemplateDoc> & { name: string }>): void {
  cache = docs as unknown as EmailTemplateDoc[]
}

export async function loadTemplates(): Promise<EmailTemplateDoc[]> {
  if (!cache) cache = (await EmailTemplate.find({}).sort({ priority: 1, updated_at: -1 })) as EmailTemplateDoc[]
  return cache
}

export type TemplateLead = {
  category?: string | null
  discovery?: { query?: string | null; search_category?: string | null } | null
}

/** Does this template target the lead's category explicitly? */
function categoryMatch(template: EmailTemplateDoc, keys: string[]): boolean {
  if (!template.categories?.length) return false
  const slugs = new Set(template.categories.map(categorySlug))
  return keys.some((key) => slugs.has(key))
}

/** One language of one template, whatever mongoose hands back for the Map. */
export function versionOf(doc: EmailTemplateDoc, language: string): TemplateLanguageDoc | null {
  const languages = doc.languages
  const version = languages instanceof Map ? languages.get(language) : (languages as Record<string, TemplateLanguageDoc> | null)?.[language]
  return (version as TemplateLanguageDoc | undefined) ?? null
}

/** Steps this language version can actually send — an empty step sends nothing. */
export function stepsOf(doc: EmailTemplateDoc, language: string): number[] {
  const version = versionOf(doc, language)
  return (version?.messages ?? []).filter((m) => (m.variants?.length ?? 0) > 0).map((m) => m.followup)
}

function hasStep(doc: EmailTemplateDoc, language: string, followupNumber: number): boolean {
  return stepsOf(doc, language).includes(followupNumber)
}

export type ResolveOptions = {
  language: string
  followupNumber?: number
  /**
   * The template that sent message 1 of this sequence. A follow-up sticks to
   * it while it is still active and still carries the step, so retargeting the
   * library never splits a lead's sequence across two voices.
   */
  preferTemplateId?: string | null
}

/** Active templates that can send THIS step to a lead reading THIS language. */
async function eligible(opts: ResolveOptions): Promise<EmailTemplateDoc[]> {
  const step = opts.followupNumber ?? 0
  return (await loadTemplates()).filter((t) => t.active && hasStep(t, opts.language, step))
}

export async function resolveTemplate(
  lead: TemplateLead,
  opts: ResolveOptions = { language: 'en' },
): Promise<ResolvedTemplate | null> {
  const templates = await eligible(opts)
  const keys = leadCategoryKeys(lead)

  if (opts.preferTemplateId) {
    const sticky = templates.find((t) => String(t._id) === opts.preferTemplateId)
    if (sticky) return resolvedFromDoc(sticky, opts.language)
  }

  const specific = templates
    .filter((t) => categoryMatch(t, keys))
    .sort(
      (a, b) =>
        (a.categories?.length ?? 0) - (b.categories?.length ?? 0) ||
        (a.priority ?? 0) - (b.priority ?? 0) ||
        Number(b.updated_at ?? 0) - Number(a.updated_at ?? 0),
    )
  const chosen = specific[0] ?? templates.find((t) => !t.categories?.length)
  return chosen ? resolvedFromDoc(chosen, opts.language) : null
}

/**
 * Every template the lead screen may offer, suggestion first. The whole
 * library is returned — including templates without the lead's language — so
 * the screen can show them as unavailable instead of hiding a gap the owner
 * needs to see and fill.
 */
export async function templateOptionsFor(
  lead: TemplateLead,
  opts: ResolveOptions,
): Promise<{ suggestedId: string | null; templates: EmailTemplateDoc[] }> {
  const suggestion = await resolveTemplate(lead, opts)
  const all = (await loadTemplates()).filter((t) => t.active)
  return { suggestedId: suggestion?.id ?? null, templates: all }
}

export async function templateById(id: string, language: string): Promise<ResolvedTemplate | null> {
  const doc = (await loadTemplates()).find((t) => String(t._id) === id)
  return doc ? resolvedFromDoc(doc, language) : null
}

/**
 * The runtime shape of ONE language of one stored template — also used by the
 * preview API. null when the template has nothing written in that language,
 * which the caller reports rather than papering over with another language.
 */
export function resolvedFromDoc(doc: EmailTemplateDoc, language: string): ResolvedTemplate | null {
  const version = versionOf(doc, language)
  if (!version) return null
  const strings =
    version.strings instanceof Map ? Object.fromEntries(version.strings) : ((version.strings ?? {}) as Record<string, string>)
  return {
    id: String(doc._id),
    name: doc.name,
    audience: doc.audience ?? 'custom',
    language: language as EmailLanguage,
    lowScoreVariants: Boolean(doc.low_score_variants),
    findings: (version.findings ?? {}) as FindingPhrases,
    strings,
    assets: [...(doc.assets ?? [])],
    messages: (version.messages ?? []).map((m) => ({
      followup: m.followup,
      variants: (m.variants ?? []).map((v) => ({
        subject: v.subject,
        html: v.html,
        text: v.text ?? null,
        preheader: v.preheader ?? '',
        band: v.band ?? null,
        needs_rating: Boolean(v.needs_rating),
      })),
    })),
  }
}

export { languagesOf }
