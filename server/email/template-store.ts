/**
 * Which template a lead gets, and the seed that puts the coded packs in the
 * database so they can be retargeted from the UI.
 *
 * Resolution (active templates only):
 *   1. every template whose `categories` contain one of the lead's category
 *      keys — the searched catalog name AND the Places primaryType, both as
 *      slugs (see audience.ts);
 *   2. a custom template must also match the lead's language;
 *   3. the most SPECIFIC match wins (fewest categories), then the lowest
 *      `priority`, then the most recently updated;
 *   4. nothing matched → the generic template (empty `categories`) for that
 *      audience, i.e. today's business-owner pack.
 *
 * The list is cached in memory (templates change from one screen, rarely) and
 * invalidated on every write.
 */

import { EmailTemplate, type EmailTemplateDoc } from './template-models'
import { AGENCY_CATEGORIES, categorySlug, leadCategoryKeys, type OutreachAudience } from './audience'

export type ResolvedTemplate =
  | { kind: 'builtin'; pack: 'business_note' | 'agency_note' | 'dashboard'; audience: OutreachAudience; id: string | null; name: string }
  | { kind: 'custom'; id: string; name: string; audience: string; messages: TemplateMessage[] }

export type TemplateMessage = { followup: number; subject: string; html: string; text: string | null }

export const BUILTIN_BUSINESS_NOTE = 'Business owners — personal note'
export const BUILTIN_AGENCY_NOTE = 'Marketing agencies — multi-client panel'
export const BUILTIN_DASHBOARD = 'Business owners — dashboard report'

/** The coded packs and, for each, the audience rule that decides who gets it. */
export const BUILTIN_DEFINITIONS = [
  {
    name: BUILTIN_BUSINESS_NOTE,
    builtin_pack: 'business_note' as const,
    audience: 'business',
    categories: [] as readonly string[],
    priority: 100,
    notes: 'The original hand-written note, localized in 10 languages. Generic: every category with no template of its own.',
  },
  {
    name: BUILTIN_DASHBOARD,
    builtin_pack: 'dashboard' as const,
    audience: 'business',
    categories: [] as readonly string[],
    priority: 110,
    notes: 'The visual profile report. Used only for leads whose email style is "dashboard".',
  },
  {
    name: BUILTIN_AGENCY_NOTE,
    builtin_pack: 'agency_note' as const,
    audience: 'agency',
    categories: AGENCY_CATEGORIES,
    priority: 10,
    notes: 'Multi-client panel pitch: free client audit / demo / partner terms, plus the two follow-ups.',
  },
]

/**
 * Puts the coded packs in the collection the first time the app runs against a
 * database that has none, and keeps their targeting in step afterwards.
 * Their copy, name and active flag are never overwritten.
 */
export async function seedBuiltinTemplates(): Promise<void> {
  for (const b of BUILTIN_DEFINITIONS) {
    await EmailTemplate.updateOne(
      { kind: 'builtin', builtin_pack: b.builtin_pack },
      { $setOnInsert: { ...b, categories: [...b.categories], kind: 'builtin', active: true, messages: [], generation: null } },
      { upsert: true },
    )
    // Who a pack is FOR is a coded rule (audience.ts), not a one-time copy
    // into the row: an existing database must pick up categories added since
    // it was seeded. The owner's own targeting is never touched.
    await EmailTemplate.updateOne(
      { kind: 'builtin', builtin_pack: b.builtin_pack, categories_customized: { $ne: true } },
      { $set: { categories: [...b.categories] } },
    )
  }
  invalidateTemplates()
}

let cache: EmailTemplateDoc[] | null = null

export function invalidateTemplates(): void {
  cache = null
}

/**
 * Test seam — fills the cache without a database, so the resolution rules can
 * be exercised directly. Production code never calls this.
 */
export function setTemplatesForTests(docs: Array<Partial<EmailTemplateDoc> & { name: string; kind: string }>): void {
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

/**
 * The template for this send. `style` only matters for the builtin business
 * pack, where the owner can choose the dashboard format per lead.
 */
export async function resolveTemplate(
  lead: TemplateLead,
  opts: {
    language: string
    style?: 'note' | 'dashboard'
    followupNumber?: number
    /**
     * The template that sent message 1 of this sequence. A follow-up sticks to
     * it while it is still active, so retargeting the library never splits a
     * lead's sequence across two voices.
     */
    preferTemplateId?: string | null
  } = { language: 'en' },
): Promise<ResolvedTemplate> {
  const templates = (await loadTemplates()).filter((t) => t.active)
  const keys = leadCategoryKeys(lead)

  if (opts.preferTemplateId) {
    const sticky = templates.find((t) => String(t._id) === opts.preferTemplateId)
    if (sticky) return resolvedFromDoc(sticky, opts)
  }

  const specific = templates
    .filter((t) => categoryMatch(t, keys))
    .filter((t) => t.kind !== 'custom' || !t.language || t.language === opts.language)
    .sort(
      (a, b) =>
        (a.categories?.length ?? 0) - (b.categories?.length ?? 0) ||
        (a.priority ?? 0) - (b.priority ?? 0) ||
        Number(b.updated_at ?? 0) - Number(a.updated_at ?? 0),
    )

  const chosen = specific[0]
  if (chosen) return resolvedFromDoc(chosen, opts)

  // Generic fallback: the dashboard report when that's the lead's style,
  // otherwise the business note. Both are the coded packs.
  const wantsDashboard = opts.style === 'dashboard' && (opts.followupNumber ?? 0) === 0
  const generic = templates.find(
    (t) =>
      !t.categories?.length &&
      t.kind === 'builtin' &&
      t.builtin_pack === (wantsDashboard ? 'dashboard' : 'business_note'),
  )
  if (generic) return resolvedFromDoc(generic, opts)
  return {
    kind: 'builtin',
    pack: wantsDashboard ? 'dashboard' : 'business_note',
    audience: 'business',
    id: null,
    name: wantsDashboard ? BUILTIN_DASHBOARD : BUILTIN_BUSINESS_NOTE,
  }
}

/** The runtime shape of one stored template — also used by the preview API. */
export function resolvedFromDoc(
  doc: EmailTemplateDoc,
  opts: { style?: 'note' | 'dashboard'; followupNumber?: number },
): ResolvedTemplate {
  if (doc.kind === 'custom') {
    const messages = (doc.messages ?? []).map((m) => ({
      followup: m.followup,
      subject: m.subject,
      html: m.html,
      text: m.text ?? null,
    }))
    // A custom template that has no copy for this follow-up hands the send
    // back to the coded pack of the same audience instead of guessing.
    const wanted = opts.followupNumber ?? 0
    if (!messages.some((m) => m.followup === wanted)) {
      const audience: OutreachAudience = doc.audience === 'agency' ? 'agency' : 'business'
      return {
        kind: 'builtin',
        pack: audience === 'agency' ? 'agency_note' : 'business_note',
        audience,
        id: String(doc._id),
        name: doc.name,
      }
    }
    return { kind: 'custom', id: String(doc._id), name: doc.name, audience: doc.audience ?? 'custom', messages }
  }
  const pack = (doc.builtin_pack ?? 'business_note') as 'business_note' | 'agency_note' | 'dashboard'
  return {
    kind: 'builtin',
    pack,
    audience: pack === 'agency_note' ? 'agency' : 'business',
    id: String(doc._id),
    name: doc.name,
  }
}
