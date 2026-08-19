import { describe, expect, it } from 'vitest'
import { generateRid } from './rid'
import {
  campaignFor,
  createPreviewLandingUrl,
  createTrackedLandingUrl,
  landingPathForLanguage,
  LANDING_BASE_URL,
  templateIdFor,
} from './landing-url'

describe('tracked landing URL', () => {
  const rid = generateRid()
  const base = {
    rid,
    language: 'pt',
    campaign: 'leadfinder_portuguese',
    emailType: 'note' as const,
    templateId: 'note',
    variantId: 'v2',
    attemptNumber: 1,
  }

  it('carries every parameter with the exact contract names', () => {
    const url = new URL(createTrackedLandingUrl(base))
    expect(url.origin).toBe(LANDING_BASE_URL)
    expect(url.pathname).toBe('/pt')
    expect(url.searchParams.get('utm_source')).toBe('cold_email')
    expect(url.searchParams.get('utm_medium')).toBe('email')
    expect(url.searchParams.get('utm_campaign')).toBe('leadfinder_portuguese')
    expect(url.searchParams.get('utm_content')).toBe('note_v2')
    expect(url.searchParams.get('utm_term')).toBe('attempt_1')
    expect(url.searchParams.get('rid')).toBe(rid)
    expect([...url.searchParams.keys()]).toEqual([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'rid',
    ])
  })

  it('routes pt to /pt and every other language to /en', () => {
    expect(landingPathForLanguage('pt')).toBe('/pt')
    for (const lang of ['en', 'es', 'fr', 'de', 'it', 'zh-TW', 'zh-HK', 'ja', 'ko']) {
      expect(landingPathForLanguage(lang)).toBe('/en')
    }
    expect(new URL(createTrackedLandingUrl({ ...base, language: 'ja' })).pathname).toBe('/en')
  })

  it('encodes special characters in UTM values correctly', () => {
    const url = createTrackedLandingUrl({
      ...base,
      campaign: 'salvador restaurants & cafés',
      templateId: 'nota?especial=1',
      variantId: null,
    })
    const parsed = new URL(url)
    // Round-trips exactly through URLSearchParams — nothing double-encoded.
    expect(parsed.searchParams.get('utm_campaign')).toBe('salvador restaurants & cafés')
    expect(parsed.searchParams.get('utm_content')).toBe('nota?especial=1')
    expect(url).not.toContain('cafés&')
    expect(url).toContain('caf%C3%A9s')
  })

  it('refuses to build a URL for an invalid rid', () => {
    expect(() => createTrackedLandingUrl({ ...base, rid: 'ABCDE' })).toThrow()
    expect(() => createTrackedLandingUrl({ ...base, rid: 'has spaces not allowed!!' })).toThrow()
  })

  it('builds a preview link that the landing can never book as cold email', () => {
    const { rid: _rid, ...previewInput } = base
    const url = new URL(createPreviewLandingUrl(previewInput))
    // Same shape — the preview must look like the real thing…
    expect(url.pathname).toBe('/pt')
    expect(url.searchParams.get('utm_medium')).toBe('email')
    expect(url.searchParams.get('utm_campaign')).toBe('leadfinder_portuguese')
    expect(url.searchParams.get('utm_content')).toBe('note_v2')
    expect(url.searchParams.get('utm_term')).toBe('attempt_1')
    // …without the two things that make a visit attributable to a send.
    expect(url.searchParams.get('utm_source')).toBe('preview')
    expect(url.searchParams.has('rid')).toBe(false)
  })

  it('derives stable campaign slugs and template ids', () => {
    expect(campaignFor('portuguese')).toBe('leadfinder_portuguese')
    expect(campaignFor('Mandarin Taiwan!')).toBe('leadfinder_mandarin_taiwan_')
    expect(templateIdFor('note', 0)).toBe('note')
    expect(templateIdFor('note', 1)).toBe('note_followup_1')
    expect(templateIdFor('note', 2)).toBe('note_followup_2')
    expect(templateIdFor('dashboard', 0)).toBe('dashboard')
  })
})
