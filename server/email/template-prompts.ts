/**
 * Prompts that make Claude write an outreach template.
 *
 * The house style is Joe Girard's: sell like one person writing to another,
 * be liked before being useful, be specific about THIS business, ask for a
 * tiny reply instead of a meeting, and follow up warmly rather than
 * aggressively. Girard's rules that actually translate to cold email —
 * personal tone, one clear favor, remembering the person, persistence
 * without pressure — are stated to the model as constraints, not as flavor.
 *
 * Every preset inherits the non-negotiables: only public information, no
 * invented facts, no fake urgency, email-client-safe HTML, the placeholder
 * contract, and the unsubscribe link.
 */

import { TEMPLATE_PLACEHOLDERS, TEMPLATE_SECTIONS } from './template-render'

export type PromptPreset = 'joe_girard_note' | 'joe_girard_report' | 'free'

export const PROMPT_PRESETS: Array<{ id: PromptPreset; label: string; description: string }> = [
  {
    id: 'joe_girard_note',
    label: 'Personal note (Joe Girard)',
    description:
      'Plain text-looking email, as if typed by one owner to another: a specific observation, one small favor, a tiny reply CTA and a P.S. Highest reply rate, lowest spam risk.',
  },
  {
    id: 'joe_girard_report',
    label: 'Note + mini report',
    description:
      'The same voice, plus one light visual block (score and findings) built with tables and inline CSS. Use when the pitch needs proof at a glance.',
  },
  {
    id: 'free',
    label: 'Free prompt',
    description: 'Your brief drives everything. The compliance and HTML rules still apply.',
  },
]

const PLACEHOLDER_CONTRACT = TEMPLATE_PLACEHOLDERS.map((p) => `  ${p.token} — ${p.description}`).join('\n')
const SECTION_CONTRACT = TEMPLATE_SECTIONS.map((s) => `  ${s.token} — ${s.description}`).join('\n')

const HOUSE_RULES = `
NON-NEGOTIABLE RULES
- Honesty: every claim about the recipient must come from the placeholders
  below (their public Google profile). Never invent numbers, competitors,
  clients, awards, deadlines or scarcity. No "I noticed you're hiring" style
  guesses.
- Never claim to have accessed anything private; the analysis is public data
  only. Never ask for passwords or account access.
- Sound like a person, not a campaign: no "Dear Sir/Madam", no buzzword
  stacking, no ALL CAPS, no exclamation-mark spam, no fake personalization
  tokens beyond the ones listed.
- One ask per email, and it must be tiny (a reply, a word back), never a
  calendar link or a form.
- Subject lines: lowercase-ish, short (max ~60 chars), specific, no clickbait,
  no "RE:" fakery, no emoji.
- HTML must survive Gmail/Outlook: tables or simple divs, INLINE CSS only, no
  <style> blocks, no <script>, no external CSS, no web fonts, no background
  images. Images only from the asset URLs given (if any), always with alt text
  and explicit width.
- The email must include the unsubscribe link exactly as {{unsubscribe_url}}.
- Write in the requested LANGUAGE, natively — translate the intent, not the
  words.

PLACEHOLDERS (use them; anything you don't use is fine, but never invent new ones)
${PLACEHOLDER_CONTRACT}

CONDITIONAL BLOCKS — a value may be missing, and the sentence must still read
right. Wrap the part that depends on it:
${SECTION_CONTRACT}
Example: {{#rating}}your {{rating}}★ says a lot{{/rating}}{{^rating}}you are just getting started on Google{{/rating}}

OUTPUT FORMAT — strict JSON, nothing else, no markdown fence:
{
  "messages": [
    {
      "followup": 0,
      "variants": [
        { "subject": "...", "preheader": "...", "html": "...", "band": null }
      ]
    }
  ]
}

- One entry per STEP of the sequence: followup 0 is the first email, then 1, 2…
  Each step must stand on its own if read in isolation — a bump reads like a
  person following up, the last one closes warmly and leaves something useful.
- VARIANTS are different ANGLES on the same step, not rewordings: each opens on
  a different reason to care. One is drawn per lead, and a follow-up never
  reuses an angle already sent.
- "band" is null unless you are told to write for the score bands, in which
  case each step needs one "low" variant (a neglected profile — lead with what
  is costing them) and one "high" (a strong profile — lead with what they have
  already earned).
- "preheader" is the one line shown next to the subject in the inbox: a
  continuation of the subject, never a repeat of it. Keep it under 90
  characters.`

const GIRARD_VOICE = `
VOICE — Joe Girard's playbook, applied to cold email
- People buy from people they like: earn a smile in the first two lines.
- Be specific about THIS business (name, city, what their profile shows).
  Generic praise reads as mail-merge and kills the reply.
- Give before asking: the free thing you offer must be genuinely useful even
  if they never answer.
- Sell the next small step, not the product. The goal of email #1 is a reply,
  nothing else.
- Follow up like a friend who remembers, not like a system: reference the
  first email, stay warm, never guilt-trip.
- Say the honest thing plainly, including "if it's not for you, no problem".`

/** The sender's own offer (Settings → Offer), never a company baked in here. */
function offerContext(brandName: string, whatWeSell: string): string {
  return `
WHO IS WRITING: ${brandName}

WHAT WE SELL (do not exaggerate it)
${whatWeSell}`
}

/**
 * The app always analyses the lead's public Google profile — it is what scores
 * and ranks the leads. Whether the COPY may lean on that analysis is the
 * sender's call (Settings → Offer): it is a strong, honest hook when the offer
 * is about that profile, and an irrelevant detour when it isn't.
 */
const ANALYSIS_ON = `
THE PROFILE ANALYSIS IS AVAILABLE
Each lead comes with a public Google Business Profile analysis: a 0–10 score
and up to two concrete findings ({{score}}, {{finding_1}}, {{finding_2}}).
Using one finding as the opening observation is the single strongest way to
prove this is not a mail-merge. Never present it as more than it is: a reading
of public information.`

const ANALYSIS_OFF = `
DO NOT USE THE PROFILE ANALYSIS
Do not mention the Google profile score or its findings, and do not use
{{score}}, {{finding_1}} or {{finding_2}}. Earn attention with the offer
itself and with what is public about the business (name, city, rating).`

export type BuildPromptInput = {
  preset: PromptPreset
  /** The owner's brief: who this is for and what the email should do. */
  brief: string
  language: string
  /** Free-text audience label shown in the UI ('agency', 'restaurants'…). */
  audience: string
  categories: string[]
  /** Asset URLs available as {{logo_url}} / {{asset_n}}. */
  assets: string[]
  /** How many messages the sequence has: initial + the configured follow-ups. */
  steps?: number
  /** Different angles to write per step. Ignored when `bands` is on. */
  variantsPerStep?: number
  /** Write one variant per score band instead of free angles. */
  bands?: boolean
}

export type SystemPromptOptions = {
  brandName: string
  whatWeSell: string
  useAnalysis: boolean
}

export function buildSystemPrompt(preset: PromptPreset, offer: SystemPromptOptions): string {
  const layout =
    preset === 'joe_girard_report'
      ? `\nLAYOUT — note plus ONE compact visual block (a table with the score and up to two findings). Keep it under ~600px wide, light background, hairline borders, no icons that need external files.`
      : preset === 'joe_girard_note'
        ? `\nLAYOUT — a plain note. Arial/Helvetica, ~14.5px, short paragraphs in <p>, no logo, no cards, no buttons: it must look typed by a person, not designed.`
        : `\nLAYOUT — follow the brief; when it says nothing, default to a plain note.`

  return `You write cold outreach emails for ${offer.brandName}, and you are very good at it.
${offerContext(offer.brandName, offer.whatWeSell)}
${offer.useAnalysis ? ANALYSIS_ON : ANALYSIS_OFF}
${preset === 'free' ? '' : GIRARD_VOICE}
${layout}
${HOUSE_RULES}`
}

export function buildUserPrompt(input: BuildPromptInput): string {
  const steps = input.steps ?? 3
  const parts = [
    `LANGUAGE: ${input.language}`,
    `AUDIENCE: ${input.audience || 'small business owners'}`,
    input.categories.length
      ? `GOOGLE BUSINESS CATEGORIES this template will be sent to: ${input.categories.join(', ')}`
      : 'This template is generic: it may be sent to any category.',
    input.assets.length
      ? `ASSET URLS available (use only if the layout calls for an image):\n${input.assets
          .map((url, i) => `  {{asset_${i + 1}}} = ${url}`)
          .join('\n')}`
      : 'No image assets are available — do not reference any image.',
    '',
    'BRIEF FROM THE SENDER:',
    input.brief.trim() || '(no extra brief — use your judgment for this audience)',
    '',
    input.bands
      ? 'WRITE FOR THE SCORE BANDS: every step needs a "low" variant and a "high" one.'
      : `ANGLES PER STEP: ${input.variantsPerStep ?? 1}${(input.variantsPerStep ?? 1) > 1 ? ' — genuinely different reasons to care, not the same email reworded.' : ''}`,
    '',
    `Write ${steps} step${steps === 1 ? '' : 's'} now (followup 0 = initial${steps > 1 ? `, then 1..${steps - 1}` : ''}). Return only the JSON object.`,
  ]
  return parts.join('\n')
}

export type ParsedVariant = { subject: string; html: string; preheader: string; band: 'low' | 'high' | null }
export type ParsedTemplateMessage = { followup: number; variants: ParsedVariant[] }

/**
 * Parses the model's answer defensively: a stray code fence or a sentence
 * before the JSON must not lose the work, and a model that forgets the
 * variants array and returns a flat message is still understood.
 */
export function parseGeneratedTemplate(raw: string, maxFollowup = 5): ParsedTemplateMessage[] {
  const withoutFence = raw
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim()
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The model did not return a JSON object')

  type RawVariant = { subject?: string; html?: string; preheader?: string; band?: string | null }
  const parsed = JSON.parse(withoutFence.slice(start, end + 1)) as {
    messages?: Array<RawVariant & { followup?: number; variants?: RawVariant[] }>
  }

  const variant = (v: RawVariant): ParsedVariant => ({
    subject: String(v.subject ?? '').trim(),
    html: String(v.html ?? '').trim(),
    preheader: String(v.preheader ?? '').trim(),
    band: v.band === 'low' || v.band === 'high' ? v.band : null,
  })

  const messages = (parsed.messages ?? [])
    .map((m, i) => ({
      followup: Number.isFinite(m.followup) ? Math.min(maxFollowup, Math.max(0, Number(m.followup))) : i,
      // A model that skipped the variants array still wrote one angle.
      variants: (Array.isArray(m.variants) && m.variants.length ? m.variants : [m]).map(variant).filter((v) => v.subject && v.html),
    }))
    .filter((m) => m.variants.length)
  if (!messages.length) throw new Error('The model returned no usable message')
  return messages
}
