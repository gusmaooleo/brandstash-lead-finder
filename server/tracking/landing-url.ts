/**
 * Tracked landing URLs — every link in an outreach email that points at the
 * Brandstash landing goes through here, so the whole send carries ONE rid
 * and the exact UTM contract the landing validates:
 *
 *   https://www.brandstash.ai/{pt|en}
 *     ?utm_source=cold_email        (exact)
 *     &utm_medium=email             (exact)
 *     &utm_campaign=<stable slug>
 *     &utm_content=<template[_variant]>
 *     &utm_term=attempt_<n>
 *     &rid=<raw per-send token>
 *
 * Built exclusively with URL/URLSearchParams — never by string concatenation.
 */

import type { EmailStyle } from '../../shared/types'
import type { OutreachAudience } from '../email/audience'
import { isValidRid } from './rid'
import { settings } from '../settings/settings'

/** Fallback only — the real base is the offer's site URL (Settings → Offer). */
export const LANDING_BASE_URL = 'https://www.brandstash.ai'

/** Where tracked links point: the sender's own site. */
export function landingBaseUrl(): string {
  return settings().offer.siteUrl || LANDING_BASE_URL
}

/** The landing only exists in pt and en — every other market reads en. */
export function landingPathForLanguage(language: string): '/pt' | '/en' {
  return language === 'pt' ? '/pt' : '/en'
}

/** Stable campaign slug per market (e.g. leadfinder_portuguese). */
export function campaignFor(marketScope: string): string {
  const slug = marketScope.toLowerCase().replace(/[^a-z0-9_-]+/g, '_')
  return `leadfinder_${slug || 'unknown'}`
}

/**
 * Template identifier: note / note_followup_1 / note_followup_2 / dashboard,
 * prefixed with the audience when the copy isn't the business-owner one
 * (agency_note, agency_note_followup_1…) so analytics can compare the two
 * pitches instead of averaging them together.
 */
export function templateIdFor(
  style: EmailStyle,
  followupNumber: number,
  audience: OutreachAudience = 'business',
): string {
  const prefix = audience === 'agency' ? 'agency_' : ''
  if (style === 'dashboard') return `${prefix}dashboard`
  return followupNumber > 0 ? `${prefix}note_followup_${followupNumber}` : `${prefix}note`
}

export type TrackedLandingUrlInput = {
  /** Raw per-send token — validated against the contract's charset/length. */
  rid: string
  language: string
  campaign: string
  emailType: EmailStyle
  templateId: string
  /** e.g. "v2" — appended to utm_content when present. */
  variantId?: string | null
  /** 1-based: 1 = initial send, 2/3 = follow-ups. */
  attemptNumber: number
}

export type PreviewLandingUrlInput = Omit<TrackedLandingUrlInput, 'rid'>

/**
 * The same link, for a PREVIEW — deliberately NOT the tracked contract.
 *
 * A preview renders an email nobody was sent, so it has no rid to carry. It
 * used to borrow a throwaway one: the link then looked like a real cold-email
 * click to the landing, which recorded a `cold_email` visit whose hash matched
 * no send and could never be reconciled — phantom traffic in the funnel. The
 * preview link therefore drops `rid` and declares `utm_source=preview`, so the
 * landing books it as an ordinary visit and the cold-email numbers stay honest.
 */
export function createPreviewLandingUrl(input: PreviewLandingUrlInput): string {
  const url = new URL(landingPathForLanguage(input.language), landingBaseUrl())
  url.search = new URLSearchParams({
    utm_source: 'preview',
    utm_medium: 'email',
    utm_campaign: input.campaign,
    utm_content: input.variantId ? `${input.templateId}_${input.variantId}` : input.templateId,
    utm_term: `attempt_${input.attemptNumber}`,
  }).toString()
  return url.toString()
}

export function createTrackedLandingUrl(input: TrackedLandingUrlInput): string {
  if (!isValidRid(input.rid)) {
    throw new Error('refusing to build a landing URL without a valid tracking id')
  }
  const url = new URL(landingPathForLanguage(input.language), landingBaseUrl())
  url.search = new URLSearchParams({
    utm_source: 'cold_email',
    utm_medium: 'email',
    utm_campaign: input.campaign,
    utm_content: input.variantId ? `${input.templateId}_${input.variantId}` : input.templateId,
    utm_term: `attempt_${input.attemptNumber}`,
    rid: input.rid,
  }).toString()
  return url.toString()
}
