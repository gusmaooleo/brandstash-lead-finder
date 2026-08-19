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

import type { EmailLanguage } from '../../shared/types'
import { EMAIL_LOCALES } from './locales'
import type { TemplateMessage } from './template-store'

export type TemplateContext = {
  businessName: string
  city: string
  rating: number | null
  reviewCount: number | null
  score: number
  /** Top two localized findings about the lead's public profile. */
  finding1: string
  finding2: string | null
  senderName: string
  senderEmail: string
  unsubscribeUrl: string
  landingUrl: string | null
  /** Asset URLs the owner attached to the template (logo first). */
  assets: string[]
}

/** Shown in the generator UI so the owner knows what a template may use. */
export const TEMPLATE_PLACEHOLDERS: Array<{ token: string; description: string }> = [
  { token: '{{business_name}}', description: "The lead's business name" },
  { token: '{{city}}', description: 'City only (no state/country)' },
  { token: '{{rating}}', description: 'Google rating, e.g. 4.6 (empty when unrated)' },
  { token: '{{reviews}}', description: 'Review count (empty when none)' },
  { token: '{{score}}', description: 'Google profile score from the built-in analysis, 0–10' },
  { token: '{{finding_1}}', description: 'Strongest public-profile finding' },
  { token: '{{finding_2}}', description: 'Second finding (may be empty)' },
  { token: '{{sender_name}}', description: 'Your full sender name' },
  { token: '{{sender_first_name}}', description: 'First name only' },
  { token: '{{sender_email}}', description: 'Your sender address' },
  { token: '{{unsubscribe_url}}', description: 'One-click unsubscribe link (always required)' },
  { token: '{{landing_url}}', description: 'Tracked landing link for this send' },
  { token: '{{logo_url}}', description: 'First asset URL — your logo' },
  { token: '{{asset_1}}', description: 'Asset URLs in order (asset_1, asset_2…)' },
]

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function values(ctx: TemplateContext): Record<string, string> {
  const firstName = ctx.senderName.split(/\s+/)[0] || ctx.senderName
  const map: Record<string, string> = {
    business_name: ctx.businessName,
    city: ctx.city,
    rating: ctx.rating != null ? ctx.rating.toFixed(1) : '',
    reviews: ctx.reviewCount != null ? String(ctx.reviewCount) : '',
    score: ctx.score.toFixed(1),
    finding_1: ctx.finding1,
    finding_2: ctx.finding2 ?? '',
    sender_name: ctx.senderName,
    sender_first_name: firstName,
    sender_email: ctx.senderEmail,
    unsubscribe_url: ctx.unsubscribeUrl,
    landing_url: ctx.landingUrl ?? '',
    logo_url: ctx.assets[0] ?? '',
  }
  ctx.assets.forEach((url, i) => {
    map[`asset_${i + 1}`] = url
  })
  return map
}

/** Replaces every {{token}}; unknown tokens are removed, never left visible. */
export function applyPlaceholders(input: string, ctx: TemplateContext, { escape = false } = {}): string {
  const map = values(ctx)
  return input.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_all, token: string) => {
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

/** The disclosure + unsubscribe block every outreach email must carry. */
function complianceFooter(language: EmailLanguage, unsubscribeUrl: string): { html: string; text: string } {
  const labels = (EMAIL_LOCALES[language] ?? EMAIL_LOCALES.en).labels
  return {
    html: `
  <div style="margin-top:28px;padding-top:12px;border-top:1px solid #ececec;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#9a9a9a;">
    ${escapeHtml(labels.reasonLine)}<br>
    ${escapeHtml(labels.assessmentNote)}<br>
    <a href="${escapeHtml(unsubscribeUrl)}" style="color:#9a9a9a;text-decoration:underline;">${escapeHtml(labels.unsubscribe)}</a>
  </div>`,
    text: `--\n${labels.reasonLine}\n${labels.assessmentNote}\n${labels.unsubscribe}: ${unsubscribeUrl}`,
  }
}

export type RenderedTemplate = { subject: string; html: string; text: string }

export function renderCustomMessage(
  message: TemplateMessage,
  ctx: TemplateContext,
  language: EmailLanguage,
): RenderedTemplate {
  const subject = applyPlaceholders(message.subject, ctx).trim()
  let html = stripScripts(applyPlaceholders(message.html, ctx))
  let text = message.text ? applyPlaceholders(message.text, ctx) : htmlToText(html)

  // Compliance is not optional and not the generator's job to remember.
  if (!html.includes(ctx.unsubscribeUrl)) {
    const footer = complianceFooter(language, ctx.unsubscribeUrl)
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${footer.html}\n</body>`) : `${html}${footer.html}`
    text = `${text}\n\n${footer.text}`
  }
  return { subject, html, text }
}
