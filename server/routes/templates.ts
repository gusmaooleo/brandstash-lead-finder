/**
 * Email templates API — the copy library.
 *
 * Every email the app can send is a document here: written by hand, generated,
 * or both. A template decides WHICH lead it fits (categories) and carries one
 * message per step of the sequence, each with one or more variants — per
 * language, because only the words change from one language to the next.
 *
 * The shape mirrors that split, and so does this API:
 *   PUT    /:id                  — the pitch: name, categories, targeting
 *   PUT    /:id/languages/:lang  — the words, one language at a time
 *   DELETE /:id/languages/:lang  — drop a language (never the last one)
 *
 * Nothing is shipped with the code. An empty library is a legitimate state:
 * the lead screen says so instead of offering a send that cannot work.
 */

import { Router } from 'express'
import { Types } from 'mongoose'
import { ALL_CATEGORIES } from '../discovery/categories'
import { EmailTemplate, languagesOf, type EmailTemplateDoc } from '../email/template-models'
import { invalidateTemplates, versionOf, type ResolvedTemplate } from '../email/template-store'
import { renderForLead } from '../email/sender'
import { maxSends } from '../leads/followup'
import { analyzePlaceProfile } from '../scoring/analyze'
import type { PlaceProfileSummary } from '../scoring/types'
import { stripScripts, TEMPLATE_PLACEHOLDERS } from '../email/template-render'
import {
  buildSystemPrompt,
  buildUserPrompt,
  parseGeneratedTemplate,
  PROMPT_PRESETS,
  type PromptPreset,
} from '../email/template-prompts'
import { AnthropicError, generateText } from '../settings/anthropic'
import { settings } from '../settings/settings'
import { EMAIL_LANGUAGES, isEmailLanguage, type EmailLanguage } from '../../shared/types'

export const templatesRouter = Router()

const FINDING_KEYS = ['no_photos', 'few_photos', 'no_reviews', 'few_reviews', 'no_hours', 'no_description', 'clean'] as const

type VariantInput = {
  subject?: string
  html?: string
  text?: string | null
  preheader?: string | null
  band?: string | null
  needs_rating?: boolean
}

type MessageInput = { followup?: number; variants?: VariantInput[] }

/** The words of one language, as they arrive from the editor. */
type LanguageInput = {
  messages?: MessageInput[]
  findings?: unknown
  strings?: unknown
  generation?: { model?: string; preset?: string; brief?: string } | null
}

const asLanguage = (value: unknown): EmailLanguage | null => (isEmailLanguage(value) ? value : null)

function languageView(version: ReturnType<typeof versionOf>) {
  const strings =
    version?.strings instanceof Map ? Object.fromEntries(version.strings) : ((version?.strings ?? {}) as Record<string, string>)
  return {
    messages: (version?.messages ?? []).map((m) => ({
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
    findings: Object.fromEntries(FINDING_KEYS.map((k) => [k, (version?.findings as Record<string, string> | null)?.[k] ?? ''])),
    strings,
    generation: version?.generation
      ? {
          model: version.generation.model ?? null,
          preset: version.generation.preset ?? null,
          brief: version.generation.brief ?? null,
          at: version.generation.at ?? null,
        }
      : null,
  }
}

function toView(doc: EmailTemplateDoc) {
  const languages = languagesOf(doc)
  return {
    _id: String(doc._id),
    name: doc.name,
    audience: doc.audience ?? 'custom',
    categories: doc.categories ?? [],
    active: doc.active !== false,
    priority: doc.priority ?? 0,
    low_score_variants: Boolean(doc.low_score_variants),
    assets: doc.assets ?? [],
    notes: doc.notes ?? '',
    /** In the UI's fixed language order, so the tab bar never reshuffles. */
    language_codes: languages,
    languages: Object.fromEntries(languages.map((l) => [l, languageView(versionOf(doc, l))])),
    updated_at: doc.updated_at,
  }
}

/** Only real catalog categories may be bound — the picker uses the same list. */
function validCategories(input: unknown): { ok: true; value: string[] } | { ok: false; error: string } {
  if (input === undefined) return { ok: true, value: [] }
  if (!Array.isArray(input) || input.some((c) => typeof c !== 'string')) {
    return { ok: false, error: 'categories must be an array of category names' }
  }
  const catalog = new Set(ALL_CATEGORIES)
  const unknown = (input as string[]).find((c) => !catalog.has(c))
  if (unknown) return { ok: false, error: `unknown category: ${unknown}` }
  return { ok: true, value: [...new Set(input as string[])] }
}

/** A step with no usable variant is dropped: an empty message sends nothing. */
function normalizeMessages(input: MessageInput[] | undefined): Array<Record<string, unknown>> {
  const limit = maxSends() - 1
  return (input ?? [])
    .map((m, i) => ({
      followup: Math.min(limit, Math.max(0, Number(m.followup ?? i))),
      variants: (m.variants ?? [])
        .map((v) => ({
          subject: String(v.subject ?? '').trim(),
          html: stripScripts(String(v.html ?? '')),
          text: v.text ? String(v.text) : null,
          preheader: String(v.preheader ?? ''),
          band: v.band === 'low' || v.band === 'high' ? v.band : null,
          needs_rating: Boolean(v.needs_rating),
        }))
        .filter((v) => v.subject && v.html),
    }))
    .filter((m) => m.variants.length)
}

function normalizeFindings(input: unknown): Record<string, string> {
  const source = (input ?? {}) as Record<string, unknown>
  return Object.fromEntries(FINDING_KEYS.map((k) => [k, String(source[k] ?? '').trim()]))
}

function normalizeStrings(input: unknown): Record<string, string> {
  const source = (input ?? {}) as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key, value]) => /^[a-z0-9_]+$/i.test(key) && typeof value === 'string')
      .map(([key, value]) => [key, String(value)]),
  )
}

/** The words of one language, ready to be stored — or an error to report. */
function normalizeVersion(input: LanguageInput): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const messages = normalizeMessages(input.messages)
  if (!messages.length) return { ok: false, error: 'a language needs at least one message with a subject and a body' }
  return {
    ok: true,
    value: {
      messages,
      findings: normalizeFindings(input.findings),
      strings: normalizeStrings(input.strings),
      generation: input.generation
        ? {
            model: input.generation.model ?? null,
            preset: input.generation.preset ?? null,
            brief: input.generation.brief ?? null,
            at: new Date(),
          }
        : null,
    },
  }
}

const httpUrls = (input: unknown): string[] =>
  (Array.isArray(input) ? input : []).filter((a): a is string => typeof a === 'string' && /^https?:\/\//i.test(a))

async function findTemplate(id: string): Promise<EmailTemplateDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null
  return (await EmailTemplate.findById(id)) as EmailTemplateDoc | null
}

templatesRouter.get('/', async (_req, res) => {
  const docs = (await EmailTemplate.find({}).sort({ priority: 1, name: 1 })) as EmailTemplateDoc[]
  res.json({
    templates: docs.map(toView),
    placeholders: TEMPLATE_PLACEHOLDERS,
    presets: PROMPT_PRESETS,
    languages: EMAIL_LANGUAGES,
    max_followups: maxSends() - 1,
    model: settings().ai.model,
    ai_ready: Boolean(settings().ai.anthropicKey && settings().ai.model),
  })
})

/** A new template starts with the one language it was written in. */
templatesRouter.post('/', async (req, res) => {
  const body = req.body as {
    name?: string
    audience?: string
    categories?: string[]
    language?: string
    assets?: string[]
    low_score_variants?: boolean
    notes?: string
  } & LanguageInput
  const name = String(body.name ?? '').trim()
  if (!name) return res.status(400).json({ error: 'a template needs a name' })
  const lang = asLanguage(body.language)
  if (!lang) return res.status(400).json({ error: 'a template needs a language it is written in' })
  const categories = validCategories(body.categories)
  if (!categories.ok) return res.status(400).json({ error: categories.error })
  const version = normalizeVersion(body)
  if (!version.ok) return res.status(400).json({ error: version.error })

  const doc = await EmailTemplate.create({
    name,
    audience: String(body.audience ?? 'custom').trim() || 'custom',
    categories: categories.value,
    active: true,
    priority: 0,
    assets: httpUrls(body.assets),
    low_score_variants: Boolean(body.low_score_variants),
    languages: { [lang]: version.value },
    notes: String(body.notes ?? ''),
  })
  invalidateTemplates()
  res.json({ template: toView(doc as EmailTemplateDoc) })
})

/** The pitch itself — who it targets and how it behaves, never its words. */
templatesRouter.put('/:id', async (req, res) => {
  const doc = await findTemplate(req.params.id)
  if (!doc) return res.status(404).json({ error: 'template not found' })
  const body = req.body as {
    name?: string
    audience?: string
    categories?: string[]
    active?: boolean
    priority?: number
    notes?: string
    assets?: string[]
    low_score_variants?: boolean
  }

  if (body.categories !== undefined) {
    const categories = validCategories(body.categories)
    if (!categories.ok) return res.status(400).json({ error: categories.error })
    doc.categories = categories.value
  }
  if (body.name !== undefined && String(body.name).trim()) doc.name = String(body.name).trim()
  if (body.active !== undefined) doc.active = Boolean(body.active)
  if (body.priority !== undefined && Number.isFinite(Number(body.priority))) doc.priority = Number(body.priority)
  if (body.notes !== undefined) doc.notes = String(body.notes)
  if (body.audience !== undefined) doc.audience = String(body.audience).trim() || 'custom'
  if (body.low_score_variants !== undefined) doc.low_score_variants = Boolean(body.low_score_variants)
  if (body.assets !== undefined) doc.set('assets', httpUrls(body.assets))
  await doc.save()
  invalidateTemplates()
  res.json({ template: toView(doc) })
})

/** Write (or rewrite) one language of a template. */
templatesRouter.put('/:id/languages/:lang', async (req, res) => {
  const doc = await findTemplate(req.params.id)
  if (!doc) return res.status(404).json({ error: 'template not found' })
  const lang = asLanguage(req.params.lang)
  if (!lang) return res.status(400).json({ error: `unknown language: ${req.params.lang}` })
  const version = normalizeVersion(req.body as LanguageInput)
  if (!version.ok) return res.status(400).json({ error: version.error })

  doc.languages.set(lang, version.value as never)
  await doc.save()
  invalidateTemplates()
  res.json({ template: toView(doc) })
})

/** A template with no language left could never be sent — refuse the last one. */
templatesRouter.delete('/:id/languages/:lang', async (req, res) => {
  const doc = await findTemplate(req.params.id)
  if (!doc) return res.status(404).json({ error: 'template not found' })
  const lang = asLanguage(req.params.lang)
  if (!lang || !versionOf(doc, lang)) return res.status(404).json({ error: 'this template has no such language' })
  if (languagesOf(doc).length === 1) {
    return res.status(400).json({ error: 'this is the last language — delete the template instead' })
  }
  doc.languages.delete(lang)
  await doc.save()
  invalidateTemplates()
  res.json({ template: toView(doc) })
})

templatesRouter.delete('/:id', async (req, res) => {
  const doc = await findTemplate(req.params.id)
  if (!doc) return res.status(404).json({ error: 'template not found' })
  await EmailTemplate.deleteOne({ _id: doc._id })
  invalidateTemplates()
  res.json({ ok: true })
})

/* ── preview ─────────────────────────────────────────────────────────────── */

/**
 * A believable lead, run through the REAL analysis, so every preview goes
 * through the exact code path that sends — there is no second renderer to
 * drift from the first.
 */
const SAMPLE_SUMMARY: PlaceProfileSummary = {
  name: 'Northside Studio',
  address: '400 W 2nd St, Austin',
  phone: '+1 512 555 0134',
  website: 'https://northside.example',
  rating: 4.7,
  total_ratings: 38,
  has_hours: false,
  hours_text: null,
  photos_count: 2,
  reviews_count: 0,
  reviews_sample: [],
  types: ['marketing_agency'],
  editorial_summary: null,
  business_status: 'OPERATIONAL',
}

function renderSample(template: ResolvedTemplate, followupNumber: number) {
  const scoring = analyzePlaceProfile(SAMPLE_SUMMARY, { industry: 'Marketing agency' })
  return renderForLead(
    {
      place_id: 'preview-place',
      name: SAMPLE_SUMMARY.name,
      city_label: 'Austin, United States',
      google_rating: SAMPLE_SUMMARY.rating,
      review_count: SAMPLE_SUMMARY.total_ratings,
      score: scoring.overallScore,
      category: 'marketing_agency',
      discovery: { search_category: template.audience },
    } as never,
    scoring,
    SAMPLE_SUMMARY,
    template.language,
    'preview',
    { followupNumber, preview: true, template, campaign: 'leadfinder_preview' },
  )
}

/**
 * Preview of a DRAFT — what the editor shows while you type, for copy written
 * by hand or by the generator, in HTML or plain text. Same renderer, so what
 * you see is what a lead receives.
 */
templatesRouter.post('/preview', (req, res) => {
  const body = req.body as {
    subject?: string
    html?: string
    text?: string | null
    preheader?: string | null
    language?: string
    assets?: string[]
    findings?: unknown
    strings?: unknown
  }
  const lang = asLanguage(body.language) ?? 'en'
  const html = String(body.html ?? '').trim()
  const text = body.text ? String(body.text) : null
  if (!html && !text) return res.status(400).json({ error: 'nothing to preview yet' })

  // Plain text is a first-class way to write: wrapped once, it renders and
  // previews exactly like HTML copy, and still ships its own text/plain part.
  const draft = {
    subject: String(body.subject ?? ''),
    html: html || `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.65;white-space:pre-wrap;">${escapeText(text ?? '')}</div>`,
    text,
    preheader: String(body.preheader ?? ''),
  }

  try {
    const rendered = renderSample(
      {
        id: 'draft',
        name: 'Draft',
        audience: 'custom',
        language: lang,
        lowScoreVariants: false,
        findings: normalizeFindings(body.findings),
        strings: normalizeStrings(body.strings),
        assets: httpUrls(body.assets),
        messages: [{ followup: 0, variants: [draft] }],
      },
      0,
    )
    res.json({ subject: rendered.subject, html: rendered.html, text: rendered.text })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

/** Plain-text copy is escaped, then trusted to be plain — never markup. */
function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/* ── generation ──────────────────────────────────────────────────────────── */

templatesRouter.post('/generate', async (req, res) => {
  const body = req.body as {
    preset?: PromptPreset
    brief?: string
    language?: string
    audience?: string
    categories?: string[]
    assets?: string[]
    steps?: number
    variants_per_step?: number
    bands?: boolean
    model?: string
  }
  const preset = (PROMPT_PRESETS.some((p) => p.id === body.preset) ? body.preset : 'joe_girard_note') as PromptPreset
  const lang = asLanguage(body.language) ?? 'en'
  const categories = validCategories(body.categories)
  if (!categories.ok) return res.status(400).json({ error: categories.error })
  const assets = httpUrls(body.assets)
  const steps = Math.min(maxSends(), Math.max(1, Number(body.steps ?? maxSends()) || maxSends()))
  const variantsPerStep = Math.min(4, Math.max(1, Number(body.variants_per_step ?? 1) || 1))

  try {
    const { text, model, usage } = await generateText({
      system: buildSystemPrompt(preset, {
        brandName: settings().offer.brandName,
        whatWeSell: settings().offer.whatWeSell,
        useAnalysis: settings().offer.useAnalysisInCopy,
      }),
      prompt: buildUserPrompt({
        preset,
        brief: String(body.brief ?? ''),
        language: lang,
        audience: String(body.audience ?? ''),
        categories: categories.value,
        assets,
        steps,
        variantsPerStep,
        bands: Boolean(body.bands),
      }),
      model: body.model,
    })
    const messages = parseGeneratedTemplate(text, maxSends() - 1).map((m) => ({
      ...m,
      variants: m.variants.map((v) => ({ ...v, html: stripScripts(v.html) })),
    }))
    res.json({ messages, model, usage, preset, language: lang })
  } catch (err) {
    const status = err instanceof AnthropicError ? err.status : 502
    res.status(status >= 400 && status < 600 ? status : 502).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})
