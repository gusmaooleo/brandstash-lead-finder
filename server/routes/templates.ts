/**
 * Email templates API — the copy library behind Settings.
 *
 * Templates decide WHICH email a lead receives: a generic one (no categories)
 * or one bound to specific Google Business categories, which wins. Builtin
 * rows point at the coded packs and can be retargeted or disabled but not
 * rewritten; custom rows carry their own HTML, written by Claude or by hand.
 */

import { Router } from 'express'
import { Types } from 'mongoose'
import { ALL_CATEGORIES } from '../discovery/categories'
import { EmailTemplate, type EmailTemplateDoc } from '../email/template-models'
import { invalidateTemplates, resolvedFromDoc } from '../email/template-store'
import { renderForLead } from '../email/sender'
import { analyzePlaceProfile } from '../scoring/analyze'
import type { PlaceProfileSummary } from '../scoring/types'
import { renderCustomMessage, stripScripts, TEMPLATE_PLACEHOLDERS } from '../email/template-render'
import {
  buildSystemPrompt,
  buildUserPrompt,
  parseGeneratedTemplate,
  PROMPT_PRESETS,
  type PromptPreset,
} from '../email/template-prompts'
import { AnthropicError, generateText } from '../settings/anthropic'
import { settings } from '../settings/settings'
import { createPreviewLandingUrl } from '../tracking/landing-url'
import type { EmailLanguage } from '../../shared/types'

export const templatesRouter = Router()

const LANGUAGES: EmailLanguage[] = ['en', 'pt', 'es', 'fr', 'de', 'it', 'zh-TW', 'zh-HK', 'ja', 'ko']

function toView(doc: EmailTemplateDoc) {
  return {
    _id: String(doc._id),
    name: doc.name,
    kind: doc.kind,
    builtin_pack: doc.builtin_pack ?? null,
    audience: doc.audience ?? 'custom',
    categories: doc.categories ?? [],
    language: doc.language ?? null,
    active: doc.active !== false,
    priority: doc.priority ?? 0,
    messages: (doc.messages ?? []).map((m) => ({
      followup: m.followup,
      subject: m.subject,
      html: m.html,
      text: m.text ?? null,
    })),
    generation: doc.generation
      ? {
          model: doc.generation.model ?? null,
          preset: doc.generation.preset ?? null,
          brief: doc.generation.brief ?? null,
          assets: doc.generation.assets ?? [],
          at: doc.generation.at ?? null,
        }
      : null,
    notes: doc.notes ?? '',
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

templatesRouter.get('/', async (_req, res) => {
  const docs = (await EmailTemplate.find({}).sort({ priority: 1, name: 1 })) as EmailTemplateDoc[]
  res.json({
    templates: docs.map(toView),
    placeholders: TEMPLATE_PLACEHOLDERS,
    presets: PROMPT_PRESETS,
    languages: LANGUAGES,
    model: settings().ai.model,
    ai_ready: Boolean(settings().ai.anthropicKey && settings().ai.model),
  })
})

templatesRouter.post('/', async (req, res) => {
  const body = req.body as {
    name?: string
    audience?: string
    categories?: string[]
    language?: string
    messages?: Array<{ followup?: number; subject?: string; html?: string; text?: string | null }>
    generation?: { model?: string; preset?: string; brief?: string; assets?: string[] } | null
    notes?: string
  }
  const name = String(body.name ?? '').trim()
  if (!name) return res.status(400).json({ error: 'a template needs a name' })
  const categories = validCategories(body.categories)
  if (!categories.ok) return res.status(400).json({ error: categories.error })
  const messages = (body.messages ?? [])
    .map((m, i) => ({
      followup: Math.min(2, Math.max(0, Number(m.followup ?? i))),
      subject: String(m.subject ?? '').trim(),
      html: stripScripts(String(m.html ?? '')),
      text: m.text ? String(m.text) : null,
    }))
    .filter((m) => m.subject && m.html)
  if (!messages.length) return res.status(400).json({ error: 'a template needs at least one message' })

  const doc = await EmailTemplate.create({
    name,
    kind: 'custom',
    audience: String(body.audience ?? 'custom').trim() || 'custom',
    categories: categories.value,
    language: body.language && LANGUAGES.includes(body.language as EmailLanguage) ? body.language : 'en',
    active: true,
    priority: 0,
    messages,
    generation: body.generation
      ? {
          model: body.generation.model ?? null,
          preset: body.generation.preset ?? null,
          brief: body.generation.brief ?? null,
          assets: body.generation.assets ?? [],
          at: new Date(),
        }
      : null,
    notes: String(body.notes ?? ''),
  })
  invalidateTemplates()
  res.json({ template: toView(doc as EmailTemplateDoc) })
})

templatesRouter.put('/:id', async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'invalid id' })
  const doc = (await EmailTemplate.findById(req.params.id)) as EmailTemplateDoc | null
  if (!doc) return res.status(404).json({ error: 'template not found' })
  const body = req.body as {
    name?: string
    audience?: string
    categories?: string[]
    language?: string
    active?: boolean
    priority?: number
    notes?: string
    messages?: Array<{ followup?: number; subject?: string; html?: string; text?: string | null }>
  }

  if (body.categories !== undefined) {
    const categories = validCategories(body.categories)
    if (!categories.ok) return res.status(400).json({ error: categories.error })
    // Retargeting a builtin makes its list the owner's: the seeder stops
    // realigning it with the coded rule from here on.
    const changed = categories.value.join('\u0000') !== (doc.categories ?? []).join('\u0000')
    if (changed && doc.kind === 'builtin') doc.categories_customized = true
    doc.categories = categories.value
  }
  if (body.name !== undefined && String(body.name).trim()) doc.name = String(body.name).trim()
  if (body.active !== undefined) doc.active = Boolean(body.active)
  if (body.priority !== undefined && Number.isFinite(Number(body.priority))) doc.priority = Number(body.priority)
  if (body.notes !== undefined) doc.notes = String(body.notes)

  if (doc.kind === 'custom') {
    if (body.audience !== undefined) doc.audience = String(body.audience).trim() || 'custom'
    if (body.language !== undefined && LANGUAGES.includes(body.language as EmailLanguage)) {
      doc.language = body.language
    }
    if (body.messages !== undefined) {
      const messages = body.messages
        .map((m, i) => ({
          followup: Math.min(2, Math.max(0, Number(m.followup ?? i))),
          subject: String(m.subject ?? '').trim(),
          html: stripScripts(String(m.html ?? '')),
          text: m.text ? String(m.text) : null,
        }))
        .filter((m) => m.subject && m.html)
      if (!messages.length) return res.status(400).json({ error: 'a template needs at least one message' })
      doc.set('messages', messages)
    }
  }
  await doc.save()
  invalidateTemplates()
  res.json({ template: toView(doc) })
})

templatesRouter.delete('/:id', async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'invalid id' })
  const doc = (await EmailTemplate.findById(req.params.id)) as EmailTemplateDoc | null
  if (!doc) return res.status(404).json({ error: 'template not found' })
  if (doc.kind === 'builtin') {
    return res.status(409).json({ error: 'a builtin template can be disabled, but not deleted' })
  }
  await EmailTemplate.deleteOne({ _id: doc._id })
  invalidateTemplates()
  res.json({ ok: true })
})

/* ── preview ─────────────────────────────────────────────────────────────── */

/** A believable lead so the preview shows what a recipient would read. */
const SAMPLE = {
  businessName: 'Northside Studio',
  city: 'Austin',
  rating: 4.7,
  reviewCount: 38,
  score: 6.4,
  finding1: 'the profile only has 2 photos, and people comparing on Google decide with their eyes',
  finding2: 'no business description, so Google is not sure what you sell',
}

/**
 * The same sample as a real lead + analysis, so a BUILT-IN template can be
 * previewed through the exact code path that sends it — no second renderer to
 * drift from the first.
 */
const SAMPLE_SUMMARY: PlaceProfileSummary = {
  name: SAMPLE.businessName,
  address: '400 W 2nd St, Austin',
  phone: '+1 512 555 0134',
  website: 'https://northside.example',
  rating: SAMPLE.rating,
  total_ratings: SAMPLE.reviewCount,
  has_hours: false,
  hours_text: null,
  photos_count: 2,
  reviews_count: 0,
  reviews_sample: [],
  types: ['marketing_agency'],
  editorial_summary: null,
  business_status: 'OPERATIONAL',
}

templatesRouter.get('/:id/preview', async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'invalid id' })
  const doc = (await EmailTemplate.findById(req.params.id)) as EmailTemplateDoc | null
  if (!doc) return res.status(404).json({ error: 'template not found' })

  const language = (LANGUAGES.includes(req.query.lang as EmailLanguage) ? req.query.lang : 'en') as EmailLanguage
  const followupNumber = Math.min(2, Math.max(0, Number(req.query.followup ?? 0) || 0)) as 0 | 1 | 2
  const style = doc.builtin_pack === 'dashboard' ? 'dashboard' : 'note'

  try {
    const scoring = analyzePlaceProfile(SAMPLE_SUMMARY, { industry: 'Marketing agency' })
    const rendered = renderForLead(
      {
        place_id: 'preview-place',
        name: SAMPLE.businessName,
        city_label: `${SAMPLE.city}, United States`,
        google_rating: SAMPLE.rating,
        review_count: SAMPLE.reviewCount,
        score: scoring.overallScore,
        category: 'marketing_agency',
        discovery: { search_category: doc.categories?.[0] ?? null },
      } as never,
      scoring,
      SAMPLE_SUMMARY,
      language,
      'preview',
      { followupNumber, style, preview: true, template: resolvedFromDoc(doc, { followupNumber, style }) },
    )
    res.json({
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      template_name: rendered.templateName,
      style: rendered.style,
      followup: followupNumber,
      language,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

templatesRouter.post('/preview', (req, res) => {
  const body = req.body as {
    subject?: string
    html?: string
    text?: string | null
    language?: string
    assets?: string[]
  }
  const language = (LANGUAGES.includes(body.language as EmailLanguage) ? body.language : 'en') as EmailLanguage
  try {
    const rendered = renderCustomMessage(
      {
        followup: 0,
        subject: String(body.subject ?? ''),
        html: String(body.html ?? ''),
        text: body.text ?? null,
      },
      {
        ...SAMPLE,
        senderName: settings().email.from.name || 'Brandstash',
        senderEmail: settings().email.from.email || 'get@brandstash.ai',
        unsubscribeUrl: `${settings().email.unsubscribeBaseUrl}/unsubscribe?t=preview`,
        landingUrl: createPreviewLandingUrl({
          language,
          campaign: 'leadfinder_preview',
          emailType: 'note',
          templateId: 'draft',
          attemptNumber: 1,
        }),
        assets: Array.isArray(body.assets) ? body.assets.filter((a) => typeof a === 'string') : [],
      },
      language,
    )
    res.json({ ...rendered, sample: SAMPLE })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

/* ── generation ──────────────────────────────────────────────────────────── */

templatesRouter.post('/generate', async (req, res) => {
  const body = req.body as {
    preset?: PromptPreset
    brief?: string
    language?: string
    audience?: string
    categories?: string[]
    assets?: string[]
    model?: string
  }
  const preset = (PROMPT_PRESETS.some((p) => p.id === body.preset) ? body.preset : 'joe_girard_note') as PromptPreset
  const language = (LANGUAGES.includes(body.language as EmailLanguage) ? body.language : 'en') as EmailLanguage
  const categories = validCategories(body.categories)
  if (!categories.ok) return res.status(400).json({ error: categories.error })
  const assets = (Array.isArray(body.assets) ? body.assets : []).filter(
    (a) => typeof a === 'string' && /^https?:\/\//i.test(a),
  )

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
        language,
        audience: String(body.audience ?? ''),
        categories: categories.value,
        assets,
      }),
      model: body.model,
    })
    const messages = parseGeneratedTemplate(text).map((m) => ({ ...m, html: stripScripts(m.html) }))
    res.json({ messages, model, usage, preset, language })
  } catch (err) {
    const status = err instanceof AnthropicError ? err.status : 502
    res.status(status >= 400 && status < 600 ? status : 502).json({
      error: err instanceof Error ? err.message : String(err),
    })
  }
})
