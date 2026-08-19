/**
 * Tracked landing URLs — every link in an outreach email that points at the
 * landing goes through here, so the whole send carries ONE rid
 * and the exact UTM contract the landing validates:
 *
 *   https://your-site.example/{pt|en}
 *     ?utm_source=cold_email        (exact)
 *     &utm_medium=email             (exact)
 *     &utm_campaign=<stable slug>
 *     &utm_content=<template[_variant]>
 *     &utm_term=attempt_<n>
 *     &rid=<raw per-send token>
 *
 * Built exclusively with URL/URLSearchParams — never by string concatenation.
 */

import { isValidRid } from './rid'
import { settings } from '../settings/settings'

/**
 * Where tracked links point: the sender's own site (Settings → Offer). With
 * no site configured there is nowhere to link, and the email ships without a
 * landing link rather than pointing at somebody else's domain.
 */
export function landingBaseUrl(): string | null {
  return settings().offer.siteUrl || null
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
 * Analytics id of the copy that produced a send: the template's own id, with
 * the step appended so the initial email and its follow-ups can be compared
 * instead of averaged together.
 */
export function templateIdFor(templateId: string, followupNumber: number): string {
  return followupNumber > 0 ? `tpl_${templateId}_followup_${followupNumber}` : `tpl_${templateId}`
}

export type TrackedLandingUrlInput = {
  /** Raw per-send token — validated against the contract's charset/length. */
  rid: string
  language: string
  campaign: string
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
export function createPreviewLandingUrl(input: PreviewLandingUrlInput): string | null {
  const base = landingBaseUrl()
  if (!base) return null
  const url = new URL(landingPathForLanguage(input.language), base)
  url.search = new URLSearchParams({
    utm_source: 'preview',
    utm_medium: 'email',
    utm_campaign: input.campaign,
    utm_content: input.variantId ? `${input.templateId}_${input.variantId}` : input.templateId,
    utm_term: `attempt_${input.attemptNumber}`,
  }).toString()
  return url.toString()
}

export function createTrackedLandingUrl(input: TrackedLandingUrlInput): string | null {
  if (!isValidRid(input.rid)) {
    throw new Error('refusing to build a landing URL without a valid tracking id')
  }
  const base = landingBaseUrl()
  if (!base) return null
  const url = new URL(landingPathForLanguage(input.language), base)
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
