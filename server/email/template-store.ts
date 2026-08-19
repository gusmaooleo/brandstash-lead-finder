/**
 * WHICH template a lead gets.
 *
 * Every template is a document (email/template-models.ts); nothing is coded.
 * Resolution, over active templates that carry the step being sent:
 *   1. the template's language must match the lead's;
 *   2. templates whose `categories` contain one of the lead's category keys —
 *      the searched catalog name AND the Places primaryType, both as slugs
 *      (see category-match.ts);
 *   3. the most SPECIFIC match wins (fewest categories), then the lowest
 *      `priority`, then the most recently updated;
 *   4. nothing matched → the generic template (empty `categories`);
 *   5. nothing at all → null. The caller must say "no template" rather than
 *      invent one: an empty library is a state the UI shows, not an error.
 *
 * Whatever the rules pick is only a SUGGESTION: the lead screen may send with
 * any template in the library, category restrictions included.
 *
 * The list is cached in memory (templates change from one screen, rarely) and
 * invalidated on every write.
 */

import { EmailTemplate, type EmailTemplateDoc } from './template-models'
import { categorySlug, leadCategoryKeys } from './category-match'
import type { FindingPhrases } from './findings'
import type { RenderableVariant } from './template-render'

export type TemplateMessage = { followup: number; variants: RenderableVariant[] }

export type ResolvedTemplate = {
  id: string
  name: string
  audience: string
  language: string | null
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

function hasStep(doc: EmailTemplateDoc, followupNumber: number): boolean {
  return (doc.messages ?? []).some((m) => m.followup === followupNumber && (m.variants?.length ?? 0) > 0)
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

export async function resolveTemplate(
  lead: TemplateLead,
  opts: ResolveOptions = { language: 'en' },
): Promise<ResolvedTemplate | null> {
  const step = opts.followupNumber ?? 0
  const templates = (await loadTemplates()).filter((t) => t.active && hasStep(t, step))
  const keys = leadCategoryKeys(lead)

  if (opts.preferTemplateId) {
    const sticky = templates.find((t) => String(t._id) === opts.preferTemplateId)
    if (sticky) return resolvedFromDoc(sticky)
  }

  const eligible = templates.filter((t) => !t.language || t.language === opts.language)
  const specific = eligible
    .filter((t) => categoryMatch(t, keys))
    .sort(
      (a, b) =>
        (a.categories?.length ?? 0) - (b.categories?.length ?? 0) ||
        (a.priority ?? 0) - (b.priority ?? 0) ||
        Number(b.updated_at ?? 0) - Number(a.updated_at ?? 0),
    )
  const chosen = specific[0] ?? eligible.find((t) => !t.categories?.length)
  return chosen ? resolvedFromDoc(chosen) : null
}

/** Every template the lead screen may offer, suggestion first. */
export async function templateOptionsFor(
  lead: TemplateLead,
  opts: ResolveOptions,
): Promise<{ suggestedId: string | null; templates: EmailTemplateDoc[] }> {
  const suggestion = await resolveTemplate(lead, opts)
  const all = (await loadTemplates()).filter((t) => t.active)
  return { suggestedId: suggestion?.id ?? null, templates: all }
}

export async function templateById(id: string): Promise<ResolvedTemplate | null> {
  const doc = (await loadTemplates()).find((t) => String(t._id) === id)
  return doc ? resolvedFromDoc(doc) : null
}

/** The runtime shape of one stored template — also used by the preview API. */
export function resolvedFromDoc(doc: EmailTemplateDoc): ResolvedTemplate {
  const strings = doc.strings instanceof Map ? Object.fromEntries(doc.strings) : ((doc.strings ?? {}) as Record<string, string>)
  return {
    id: String(doc._id),
    name: doc.name,
    audience: doc.audience ?? 'custom',
    language: doc.language ?? null,
    lowScoreVariants: Boolean(doc.low_score_variants),
    findings: (doc.findings ?? {}) as FindingPhrases,
    strings,
    assets: [...(doc.assets ?? [])],
    messages: (doc.messages ?? []).map((m) => ({
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
