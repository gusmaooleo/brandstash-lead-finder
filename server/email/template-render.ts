/**
 * Rendering for CUSTOM templates (the HTML written in Settings → Generate).
 *
 * A template is HTML with `{{placeholders}}`. Whatever the generator writes,
 * three things are enforced here and cannot be lost:
 *   - the compliance footer (why this email exists, public-data disclosure,
 *     unsubscribe link) is appended when the copy doesn't already carry the
 *     unsubscribe URL;
 *   - <script> is stripped — an email client would ignore it, our database
 *     shouldn't store it;
 *   - a text/plain alternative always ships, derived from the HTML when the
 *     template has none.
 */

import { CATEGORY_WEIGHTS, type CategoryKey } from '../scoring/rules-dictionary'

/** One line of the profile analysis, as a template may address it. */
export type TemplateCategory = {
  key: string
  label: string
  status: 'bom' | 'precisa_melhorar' | 'ausente'
  score: number
  recommendation: string
}

export type TemplateContext = {
  businessName: string
  city: string
  /** "Salvador, BA" — the unabbreviated location line. */
  cityLabel?: string
  /** The sender's site without the scheme, e.g. "acme.com". */
  siteLabel?: string
  rating: number | null
  reviewCount: number | null
  score: number
  /** Top two localized findings about the lead's public profile. */
  finding1: string
  finding2: string | null
  senderName: string
  senderEmail: string
  /** The sender's own brand, from Settings → Offer. */
  brandName: string
  unsubscribeUrl: string
  landingUrl: string | null
  /** Asset URLs the owner attached to the template (logo first). */
  assets: string[]
  /** The analysis, category by category — drives every score_* token. */
  categories?: TemplateCategory[]
  /**
   * The template's OWN dictionary: how it names each category and how it
   * phrases each opportunity. Words belong to the template, never to the code
   * — a token with nothing behind it resolves to nothing.
   */
  strings?: Record<string, string>
  profile?: {
    photosCount?: number | null
    hasHours?: boolean | null
    address?: string | null
    phone?: string | null
    website?: string | null
    category?: string | null
  }
  language?: string
}

/**
 * Every token a template may use — the ONE catalogue: the editor lists it, the
 * generator is handed it, and the renderer resolves exactly these.
 */
export const TEMPLATE_PLACEHOLDERS: Array<{ token: string; description: string; group: string }> = [
  { group: 'Lead', token: '{{business_name}}', description: "The lead's business name" },
  { group: 'Lead', token: '{{city}}', description: 'City only (no state/country)' },
  { group: 'Lead', token: '{{city_label}}', description: 'Full location line, e.g. "Austin, United States"' },
  { group: 'Lead', token: '{{rating}}', description: 'Google rating, e.g. 4.6 (empty when unrated)' },
  { group: 'Lead', token: '{{reviews}}', description: 'Review count (empty when none)' },
  { group: 'Lead', token: '{{review_count}}', description: 'Review count, 0 when none' },
  { group: 'Lead', token: '{{category}}', description: "The lead's Google category" },
  { group: 'Lead', token: '{{address}}', description: 'Public address' },
  { group: 'Lead', token: '{{phone}}', description: 'Public phone number' },
  { group: 'Lead', token: '{{website}}', description: 'Public website' },
  { group: 'Lead', token: '{{photos_count}}', description: 'How many photos the profile has' },
  { group: 'Analysis', token: '{{score}}', description: 'Overall profile score, 0–10' },
  { group: 'Analysis', token: '{{score_color}}', description: 'Colour for that score (green/amber/red)' },
  { group: 'Analysis', token: '{{finding_1}}', description: 'Strongest finding, in this template’s words' },
  { group: 'Analysis', token: '{{finding_2}}', description: 'Second finding (may be empty)' },
  { group: 'Analysis', token: '{{score_<category>}}', description: 'Score of one category, e.g. {{score_fotos}}' },
  { group: 'Analysis', token: '{{status_<category>}}', description: 'bom | precisa_melhorar | ausente' },
  { group: 'Analysis', token: '{{label_<category>}}', description: 'That category’s name, from this template' },
  { group: 'Analysis', token: '{{top_1_label}}', description: 'Worst category first: label, _score, _pct, _bar, _color, _text (1–8)' },
  { group: 'Analysis', token: '{{issue_1_label}}', description: 'Only what still needs work: label, _text, _color (1–8)' },
  { group: 'Sender', token: '{{sender_name}}', description: 'Your full sender name' },
  { group: 'Sender', token: '{{sender_first_name}}', description: 'First name only' },
  { group: 'Sender', token: '{{sender_email}}', description: 'Your sender address' },
  { group: 'Sender', token: '{{sender_email_url}}', description: 'Same address, URL-encoded for mailto:' },
  { group: 'Sender', token: '{{brand_name}}', description: 'Your brand name' },
  { group: 'Sender', token: '{{site_label}}', description: 'Your site without the scheme' },
  { group: 'Links', token: '{{unsubscribe_url}}', description: 'One-click unsubscribe link (always required)' },
  { group: 'Links', token: '{{landing_url}}', description: 'Tracked landing link for this send' },
  { group: 'Links', token: '{{logo_url}}', description: 'First image you attached — your logo' },
  { group: 'Links', token: '{{asset_1}}', description: 'Images you attached, in order (asset_1, asset_2…)' },
]

/**
 * Conditional blocks, for copy that must read right when a value is missing.
 * Documented next to the tokens because a template author needs both.
 */
export const TEMPLATE_SECTIONS: Array<{ token: string; description: string }> = [
  { token: '{{#rating}}…{{/rating}}', description: 'Only when the value exists' },
  { token: '{{^rating}}…{{/rating}}', description: 'Only when it does NOT exist' },
]

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Bar/dot colour per status — presentation, and the only place it is decided. */
export const STATUS_COLOR: Record<string, string> = {
  bom: '#10b981',
  precisa_melhorar: '#f59e0b',
  ausente: '#ef4444',
}

/** The overall score, coloured on the same scale the dashboard always used. */
export function scoreColor(score: number): string {
  if (score >= 7) return '#059669'
  if (score >= 4) return '#d97706'
  return '#dc2626'
}

/**
 * Worst first: how far a category is from 10, weighted by how much it counts
 * toward the score. The same ordering the report has always shown.
 */
function byImpact(categories: TemplateCategory[]): TemplateCategory[] {
  return [...categories].sort(
    (a, b) =>
      (10 - b.score) * (CATEGORY_WEIGHTS[b.key as CategoryKey] ?? 1) -
      (10 - a.score) * (CATEGORY_WEIGHTS[a.key as CategoryKey] ?? 1),
  )
}

function values(ctx: TemplateContext): Record<string, string> {
  const firstName = ctx.senderName.split(/\s+/)[0] || ctx.senderName
  const strings = ctx.strings ?? {}
  const map: Record<string, string> = {
    business_name: ctx.businessName,
    /** For a mailto: subject, where a raw space breaks the link. */
    business_name_url: encodeURIComponent(ctx.businessName),
    city: ctx.city,
    /** The full "City, State" line, as the report header shows it. */
    city_label: ctx.cityLabel ?? ctx.city,
    site_label: ctx.siteLabel ?? '',
    rating: ctx.rating != null ? ctx.rating.toFixed(1) : '',
    reviews: ctx.reviewCount != null ? String(ctx.reviewCount) : '',
    /** Same count, but always a number — for copy that reads "· 0 reviews". */
    review_count: String(ctx.reviewCount ?? 0),
    score: ctx.score.toFixed(1),
    score_color: scoreColor(ctx.score),
    finding_1: ctx.finding1,
    finding_2: ctx.finding2 ?? '',
    sender_name: ctx.senderName,
    sender_first_name: firstName,
    sender_email: ctx.senderEmail,
    /** URL-encoded, for a mailto: link. */
    sender_email_url: encodeURIComponent(ctx.senderEmail),
    brand_name: ctx.brandName,
    unsubscribe_url: ctx.unsubscribeUrl,
    landing_url: ctx.landingUrl ?? '',
    logo_url: ctx.assets[0] ?? '',
    language: ctx.language ?? '',
    photos_count: ctx.profile?.photosCount != null ? String(ctx.profile.photosCount) : '',
    has_hours: ctx.profile?.hasHours ? 'yes' : '',
    address: ctx.profile?.address ?? '',
    phone: ctx.profile?.phone ?? '',
    website: ctx.profile?.website ?? '',
    category: ctx.profile?.category ?? '',
  }
  ctx.assets.forEach((url, i) => {
    map[`asset_${i + 1}`] = url
  })

  // The analysis, three ways: by name, ranked worst-first, and as the subset
  // that still needs work. A template uses whichever shape it is written for.
  const categories = ctx.categories ?? []
  const label = (c: TemplateCategory): string => strings[c.key] || c.label
  const advice = (c: TemplateCategory): string => strings[`${c.key}_${c.status}`] || c.recommendation

  for (const c of categories) {
    map[`score_${c.key}`] = c.score.toFixed(1)
    map[`status_${c.key}`] = c.status
    map[`label_${c.key}`] = label(c)
    map[`color_${c.key}`] = STATUS_COLOR[c.status] ?? ''
  }

  byImpact(categories).forEach((c, i) => {
    const n = i + 1
    map[`top_${n}_label`] = label(c)
    map[`top_${n}_score`] = c.score.toFixed(1)
    map[`top_${n}_pct`] = String(Math.round(c.score * 10))
    map[`top_${n}_bar`] = String(Math.max(4, Math.min(100, Math.round(c.score * 10))))
    map[`top_${n}_status`] = c.status
    map[`top_${n}_color`] = STATUS_COLOR[c.status] ?? ''
    map[`top_${n}_text`] = advice(c)
  })

  byImpact(categories.filter((c) => c.status !== 'bom')).forEach((c, i) => {
    const n = i + 1
    map[`issue_${n}_label`] = label(c)
    map[`issue_${n}_text`] = advice(c)
    map[`issue_${n}_status`] = c.status
    map[`issue_${n}_color`] = STATUS_COLOR[c.status] ?? ''
  })

  return map
}

/**
 * Conditional sections: `{{#token}}…{{/token}}` keeps the block when the token
 * has a value, `{{^token}}…{{/token}}` keeps it when it has none.
 *
 * A lead with a single finding must not read "two things caught my eye", and
 * an unrated business must not be complimented on its rating — the copy has to
 * be able to say both, and only the template knows which words go with which.
 * Sections are flat by design: no nesting, no expressions, no loops.
 */
const SECTION = /\{\{\s*([#^])\s*([a-z0-9_]+)\s*\}\}([\s\S]*?)\{\{\s*\/\s*\2\s*\}\}/gi

/** Marks where a section was dropped, so its blank line can go with it. */
const DROPPED = '\u0000'

export function applySections(input: string, map: Record<string, string>): string {
  const substituted = input.replace(SECTION, (_all, kind: string, token: string, body: string) => {
    const present = Boolean((map[token.toLowerCase()] ?? '').trim())
    return (kind === '#') === present ? body : DROPPED
  })
  if (!substituted.includes(DROPPED)) return substituted

  // A paragraph that disappears must not leave its line — nor, in the plain
  // text part, the blank line that separated it from the next paragraph.
  const lines = substituted.split('\n')
  const kept: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const vanished = line.includes(DROPPED) && line.split(DROPPED).join('').trim() === ''
    if (!vanished) {
      kept.push(line)
      continue
    }
    const between = kept.length > 0 && kept[kept.length - 1].trim() === '' && (lines[i + 1] ?? '').trim() === ''
    if (between) kept.pop()
  }
  return kept.join('\n').split(DROPPED).join('')
}

/** Replaces every {{token}}; unknown tokens are removed, never left visible. */
export function applyPlaceholders(input: string, ctx: TemplateContext, { escape = false } = {}): string {
  const map = values(ctx)
  return applySections(input, map).replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_all, token: string) => {
    const value = map[token.toLowerCase()] ?? ''
    return escape ? escapeHtml(value) : value
  })
}

/** Very small HTML → text reduction for the plain-text alternative. */
export function htmlToText(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
}

export function stripScripts(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
}

/**
 * The disclosure + unsubscribe block. Its WORDS come from Settings → Email,
 * never from here: a footer written for one company would be wrong for the
 * next. What the code guarantees is that a way out always ships — if no footer
 * is configured, the bare link goes out on its own rather than nothing.
 */
function fallbackFooter(footerHtml: string, ctx: TemplateContext): { html: string; text: string } {
  const configured = footerHtml.trim()
  if (configured) {
    const html = applyPlaceholders(configured, ctx, { escape: true })
    return { html: `\n  <div>${html}</div>`, text: `--\n${htmlToText(html)}` }
  }
  const url = escapeHtml(ctx.unsubscribeUrl)
  return {
    html:
      `\n  <div style="margin-top:28px;padding-top:12px;border-top:1px solid #ececec;` +
      `font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#9a9a9a;">` +
      `<a href="${url}" style="color:#9a9a9a;text-decoration:underline;">${url}</a></div>`,
    text: `--\n${ctx.unsubscribeUrl}`,
  }
}

/** Where mail clients read the preview line from: right after <body>. */
const PREVIEW_LENGTH = 120

function withPreheader(html: string, preheader: string): string {
  const text = escapeHtml(preheader.slice(0, PREVIEW_LENGTH))
  const block = `\n  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${text}</div>`
  return /<body[^>]*>/i.test(html) ? html.replace(/(<body[^>]*>)/i, `$1${block}`) : `${block}${html}`
}

export type RenderableVariant = {
  subject: string
  html: string
  text?: string | null
  /** Optional preview line; tokens resolved, then trimmed to the preview length. */
  preheader?: string | null
  /** Selection metadata — see email/variants.ts. */
  band?: string | null
  needs_rating?: boolean | null
}

export type RenderedTemplate = { subject: string; html: string; text: string }

export function renderCustomMessage(
  message: RenderableVariant,
  ctx: TemplateContext,
  options: { footerHtml?: string } = {},
): RenderedTemplate {
  const subject = applyPlaceholders(message.subject, ctx).trim()
  let html = stripScripts(applyPlaceholders(message.html, ctx, { escape: true }))
  let text = message.text ? applyPlaceholders(message.text, ctx) : htmlToText(html)

  // The preview line is resolved BEFORE trimming: a static template cannot cut
  // interpolated text at the right place, so the renderer does it.
  const preheader = (message.preheader ?? '').trim()
  if (preheader) html = withPreheader(html, applyPlaceholders(preheader, ctx))

  // A way out is not optional, and not the template author's job to remember.
  // The link may already be there in escaped form — that still counts.
  const carriesUnsubscribe = html.includes(ctx.unsubscribeUrl) || html.includes(escapeHtml(ctx.unsubscribeUrl))
  if (!carriesUnsubscribe) {
    const footer = fallbackFooter(options.footerHtml ?? '', ctx)
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${footer.html}\n</body>`) : `${html}${footer.html}`
    text = `${text}\n\n${footer.text}`
  }
  return { subject, html, text }
}
