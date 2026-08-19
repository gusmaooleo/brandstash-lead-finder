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

import { TEMPLATE_PLACEHOLDERS } from './template-render'

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

OUTPUT FORMAT — strict JSON, nothing else, no markdown fence:
{
  "messages": [
    { "followup": 0, "subject": "...", "html": "..." },
    { "followup": 1, "subject": "...", "html": "..." },
    { "followup": 2, "subject": "...", "html": "..." }
  ]
}
followup 0 = the first email, 1 = a warm bump a few days later ("it's me
again"), 2 = a friendly breakup ("last time, promise") that leaves something
useful behind. All three must stand on their own if read in isolation.`

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
    'Write the three messages now. Return only the JSON object.',
  ]
  return parts.join('\n')
}

export type ParsedTemplateMessage = { followup: number; subject: string; html: string }

/**
 * Parses the model's answer defensively: a stray code fence or a sentence
 * before the JSON must not lose the work.
 */
export function parseGeneratedTemplate(raw: string): ParsedTemplateMessage[] {
  const withoutFence = raw
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim()
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The model did not return a JSON object')
  const parsed = JSON.parse(withoutFence.slice(start, end + 1)) as {
    messages?: Array<{ followup?: number; subject?: string; html?: string }>
  }
  const messages = (parsed.messages ?? [])
    .map((m, i) => ({
      followup: Number.isFinite(m.followup) ? Math.min(2, Math.max(0, Number(m.followup))) : i,
      subject: String(m.subject ?? '').trim(),
      html: String(m.html ?? '').trim(),
    }))
    .filter((m) => m.subject && m.html)
  if (!messages.length) throw new Error('The model returned no usable message')
  return messages
}
