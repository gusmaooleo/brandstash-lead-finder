/**
 * HTML email renderer — a compact visual version of the Brandstash dashboard.
 *
 * Design language mirrors the Brandstash light "warm paper" identity
 * (brandstash-app/src/index.css landing tokens + .brand-paper): paper #fbfbfa,
 * ink #0b0b0c, hairlines #e2e1dc, Geist-style system sans stack. Score bands
 * and status colors mirror src/features/gbp/constants.tsx (≥7 green, ≥4 amber,
 * <4 red; bom=emerald / precisa_melhorar=amber / ausente=red).
 *
 * Email-client constraints: table-based layout, inline CSS, no JS, no remote
 * fonts. The ONLY external asset is the public Brandstash SVG logo.
 */

import type { EmailLanguage } from '../../shared/types'
import type { GbpCategory } from '../scoring/types'
import type { CategoryKey, CategoryStatus } from '../scoring/rules-dictionary'
import { CATEGORY_WEIGHTS } from '../scoring/rules-dictionary'
import { EMAIL_LOCALES, type EmailLocale } from './locales'

/** Shipped default — the real one comes from the offer profile (Settings). */
export const BRANDSTASH_LOGO_URL =
  'https://pub-62b9434b63214cb4b5b74cebb8d4c261.r2.dev/content/brandstash-icon-black.svg'

const FONT = "'Geist', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

const INK = '#0b0b0c'
const GRAY = '#57575b'
const GRAY_2 = '#84848a'
const PAPER = '#fbfbfa'
const PAPER_2 = '#f1f0ec'
const PAPER_3 = '#e9e8e3'
const LINE = '#e2e1dc'

const STATUS_BAR: Record<CategoryStatus, string> = {
  bom: '#10b981',
  precisa_melhorar: '#f59e0b',
  ausente: '#ef4444',
}

/** Score band colors — light-theme chart tokens (≥7 / ≥4 / below). */
function scoreColor(score: number): string {
  if (score >= 7) return '#059669'
  if (score >= 4) return '#d97706'
  return '#dc2626'
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** FNV-1a — deterministic subject-variant selection keyed by Place ID. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export type RenderInput = {
  placeId: string
  name: string
  cityLabel: string
  rating: number | null
  reviewCount: number | null
  score: number
  categories: GbpCategory[]
  language: EmailLanguage
  sender: { name: string; email: string }
  /** Who the report is branded for — Settings → Offer. */
  brand?: { name: string; logoUrl: string; siteLabel: string }
  unsubscribeUrl: string
  /**
   * Tracked landing URL (per-send rid). Every landing link in the email uses
   * this SAME rid: the header wordmark and the footer link. null = no
   * landing link is rendered (never an untracked one).
   */
  landingUrl?: string | null
}

export type RenderedEmail = {
  subject: string
  /** Index into the band's variant list — recorded for measurability. */
  subjectVariant: number
  band: 'low' | 'high'
  html: string
}

export function pickSubject(
  locale: EmailLocale,
  placeId: string,
  name: string,
  rating: number | null,
): { subject: string; variant: number; band: 'low' | 'high' } {
  const band: 'low' | 'high' = rating != null && rating >= 4 ? 'high' : 'low'
  const all = band === 'high' ? locale.subjectsHigh : locale.subjectsLow
  const eligible = all
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => !(v.needsRating && rating == null))
  const pick = eligible[hashString(placeId) % eligible.length]
  return { subject: pick.v.render(name, rating), variant: pick.i, band }
}

function categoryBars(categories: GbpCategory[], locale: EmailLocale): string {
  const byImpact = [...categories].sort(
    (a, b) =>
      (10 - b.score) * (CATEGORY_WEIGHTS[b.category as CategoryKey] ?? 1) -
      (10 - a.score) * (CATEGORY_WEIGHTS[a.category as CategoryKey] ?? 1),
  )
  const shown = byImpact.slice(0, 4)
  return shown
    .map((cat) => {
      const pct = Math.max(4, Math.min(100, Math.round(cat.score * 10)))
      const color = STATUS_BAR[cat.status]
      const label = locale.categories[cat.category as CategoryKey] ?? cat.label
      return `
        <tr>
          <td style="padding:5px 0 2px;font-family:${FONT};font-size:12px;color:${GRAY};">
            ${esc(label)}
            <span style="float:right;color:${GRAY_2};font-size:11px;">${Math.round(cat.score * 10)}%</span>
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 6px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr>
                <td style="background:${PAPER_3};border-radius:3px;height:6px;font-size:0;line-height:0;">
                  <table role="presentation" width="${pct}%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                    <tr><td style="background:${color};border-radius:3px;height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>`
    })
    .join('')
}

function opportunitiesBlock(categories: GbpCategory[], locale: EmailLocale): string {
  const issues = categories
    .filter((c) => c.status !== 'bom')
    .sort(
      (a, b) =>
        (10 - b.score) * (CATEGORY_WEIGHTS[b.category as CategoryKey] ?? 1) -
        (10 - a.score) * (CATEGORY_WEIGHTS[a.category as CategoryKey] ?? 1),
    )
    .slice(0, 2)

  if (!issues.length) {
    return `
      <tr><td style="padding:6px 0;">
        <span style="font-family:${FONT};font-size:13.5px;line-height:1.6;color:${GRAY};">${esc(locale.labels.retentionLine)}</span>
      </td></tr>`
  }

  return issues
    .map((cat) => {
      const text =
        locale.opportunities[cat.category as CategoryKey]?.[cat.status] ?? cat.recommendation
      const color = STATUS_BAR[cat.status]
      return `
      <tr>
        <td style="padding:7px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td valign="top" style="padding:6px 10px 0 0;">
                <span style="display:inline-block;width:8px;height:8px;border-radius:8px;background:${color};font-size:0;line-height:0;">&nbsp;</span>
              </td>
              <td style="font-family:${FONT};font-size:13.5px;line-height:1.55;color:#3a3a3e;">
                <strong style="color:${INK};">${esc(locale.categories[cat.category as CategoryKey] ?? cat.label)}.</strong>
                ${esc(text)}
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    })
    .join('')
}

export function renderLeadEmail(input: RenderInput): RenderedEmail {
  const brand = {
    name: input.brand?.name || 'Brandstash',
    logoUrl: input.brand?.logoUrl || BRANDSTASH_LOGO_URL,
    siteLabel: input.brand?.siteLabel || 'www.brandstash.ai',
  }
  const locale = EMAIL_LOCALES[input.language] ?? EMAIL_LOCALES.en
  const { subject, variant, band } = pickSubject(locale, input.placeId, input.name, input.rating)

  const name = esc(input.name)
  const color = scoreColor(input.score)
  const intro =
    band === 'high'
      ? locale.introHigh(input.name, input.cityLabel)
      : locale.introLow(input.name, input.cityLabel)

  const ratingLine =
    input.rating != null
      ? `<span style="color:${INK};font-weight:600;">★ ${input.rating.toFixed(1)}</span>` +
        `<span style="color:${GRAY_2};"> · ${input.reviewCount ?? 0} ${esc(locale.labels.reviews)}</span>`
      : `<span style="color:${GRAY_2};">${esc(locale.labels.googleRating)}: —</span>`

  const ctaHref = `mailto:${encodeURIComponent(input.sender.email)}?subject=${encodeURIComponent(
    locale.labels.ctaMailSubject(input.name),
  )}`

  const html = `<!doctype html>
<html lang="${input.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER_2};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(intro.slice(0, 120))}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${PAPER_2};">
    <tr>
      <td align="center" style="padding:28px 14px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="border-collapse:separate;width:100%;max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;">
          <tr>
            <td style="padding:22px 28px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  <td valign="middle">
                    <!-- The logo SVG is portrait (302×464) — dimensions must keep that ratio or clients squish it. -->
                    ${
                      input.landingUrl
                        ? `<a href="${esc(input.landingUrl)}" style="text-decoration:none;color:${INK};">
                    <img src="${esc(brand.logoUrl)}" width="16" height="24" alt="${esc(brand.name)}" style="width:16px;height:24px;vertical-align:middle;border:0;">
                    <span style="font-family:${FONT};font-size:15px;font-weight:700;color:${INK};letter-spacing:-0.2px;vertical-align:middle;">&nbsp;${esc(brand.name)}</span>
                    </a>`
                        : `<img src="${esc(brand.logoUrl)}" width="16" height="24" alt="${esc(brand.name)}" style="width:16px;height:24px;vertical-align:middle;border:0;">
                    <span style="font-family:${FONT};font-size:15px;font-weight:700;color:${INK};letter-spacing:-0.2px;vertical-align:middle;">&nbsp;${esc(brand.name)}</span>`
                    }
                  </td>
                  <td align="right" style="font-family:${FONT};font-size:10.5px;letter-spacing:0.8px;text-transform:uppercase;color:${GRAY_2};">
                    ${esc(locale.labels.reportTag)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 6px;">
              <span style="font-family:${FONT};font-size:23px;line-height:1.25;font-weight:700;color:${INK};letter-spacing:-0.4px;">${name}</span><br>
              <span style="font-family:${FONT};font-size:13px;color:${GRAY_2};">${esc(input.cityLabel)}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:4px 28px 18px;font-family:${FONT};font-size:14px;line-height:1.65;color:${GRAY};">
              ${esc(intro)}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${PAPER};border:1px solid ${LINE};border-radius:12px;">
                <tr>
                  <td valign="middle" width="42%" style="padding:20px 8px 20px 22px;border-right:1px solid ${LINE};">
                    <span style="font-family:${FONT};font-size:40px;font-weight:700;color:${color};letter-spacing:-1px;">${input.score.toFixed(1)}</span>
                    <span style="font-family:${FONT};font-size:13px;color:${GRAY_2};">${esc(locale.labels.outOfTen)}</span><br>
                    <span style="font-family:${FONT};font-size:10.5px;letter-spacing:0.8px;text-transform:uppercase;color:${GRAY_2};">${esc(locale.labels.overallScore)}</span><br>
                    <span style="font-family:${FONT};font-size:12.5px;">${ratingLine}</span>
                  </td>
                  <td valign="middle" style="padding:16px 22px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                      ${categoryBars(input.categories, locale)}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 2px;">
              <span style="font-family:${FONT};font-size:10.5px;letter-spacing:0.8px;text-transform:uppercase;color:${GRAY_2};">${esc(locale.labels.opportunities)}</span>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:4px;">
                ${opportunitiesBlock(input.categories, locale)}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:linear-gradient(160deg,#eef8f2,${PAPER});border:1px solid #cfe8db;border-radius:12px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <span style="font-family:${FONT};font-size:14.5px;line-height:1.5;font-weight:700;color:#14532d;">${esc(locale.labels.autopilotLine)}</span><br>
                    <span style="display:inline-block;margin-top:5px;font-family:${FONT};font-size:13.5px;line-height:1.6;color:#204d3a;">${esc(locale.labels.ctaLead(input.name))}</span>
                    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin-top:12px;">
                      <tr>
                        <td style="background:${INK};border-radius:999px;">
                          <a href="${ctaHref}" style="display:inline-block;padding:10px 22px;font-family:${FONT};font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${esc(locale.labels.ctaButton)}</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 0;font-family:${FONT};font-size:11px;line-height:1.6;color:${GRAY_2};">
              ${esc(locale.labels.assessmentNote)}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 22px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:1px solid ${LINE};">
                <tr>
                  <td style="padding-top:14px;font-family:${FONT};font-size:11.5px;line-height:1.7;color:${GRAY_2};">
                    ${esc(locale.labels.sentBy)} <span style="color:${GRAY};font-weight:600;">${esc(input.sender.name)}</span> · ${esc(input.sender.email)}${
                      input.landingUrl
                        ? ` · <a href="${esc(input.landingUrl)}" style="color:${GRAY_2};text-decoration:underline;">${esc(brand.siteLabel)}</a>`
                        : ''
                    }<br>
                    ${esc(locale.labels.reasonLine)}<br>
                    <a href="${esc(input.unsubscribeUrl)}" style="color:${GRAY_2};text-decoration:underline;">${esc(locale.labels.unsubscribe)}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <div style="font-family:${FONT};font-size:10.5px;color:#a8a8ad;padding-top:12px;">${esc(brand.name)}</div>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, subjectVariant: variant, band, html }
}
