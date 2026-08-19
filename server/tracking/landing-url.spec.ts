import { beforeAll, describe, expect, it } from 'vitest'
import { setSettingsForTests } from '../settings/settings'
import { generateRid } from './rid'
import {
  campaignFor,
  createPreviewLandingUrl,
  createTrackedLandingUrl,
  landingBaseUrl,
  landingPathForLanguage,
  templateIdFor,
} from './landing-url'
import { EMAIL_LANGUAGES } from '../../shared/types'

const SITE = 'https://acme.example'

describe('tracked landing URL', () => {
  beforeAll(() => setSettingsForTests({ offer: { siteUrl: SITE } }))
  const rid = generateRid()
  const base = {
    rid,
    language: 'pt',
    campaign: 'leadfinder_portuguese',
    templateId: 'note',
    variantId: 'v2',
    attemptNumber: 1,
  }

  it('carries every parameter with the exact contract names', () => {
    const url = new URL(createTrackedLandingUrl(base)!)
    expect(url.origin).toBe(SITE)
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
    for (const lang of EMAIL_LANGUAGES.filter((l) => l !== 'pt')) {
      expect(landingPathForLanguage(lang)).toBe('/en')
    }
    expect(new URL(createTrackedLandingUrl({ ...base, language: 'ja' })!).pathname).toBe('/en')
  })

  it('encodes special characters in UTM values correctly', () => {
    const url = createTrackedLandingUrl({
      ...base,
      campaign: 'salvador restaurants & cafés',
      templateId: 'nota?especial=1',
      variantId: null,
    })
    const parsed = new URL(url!)
    // Round-trips exactly through URLSearchParams — nothing double-encoded.
    expect(parsed.searchParams.get('utm_campaign')).toBe('salvador restaurants & cafés')
    expect(parsed.searchParams.get('utm_content')).toBe('nota?especial=1')
    expect(url).not.toContain('cafés&')
    expect(url).toContain('caf%C3%A9s')
  })

  it('links nowhere when no site is configured — never to somebody else’s', () => {
    setSettingsForTests({ offer: { siteUrl: '' } })
    expect(landingBaseUrl()).toBeNull()
    expect(createTrackedLandingUrl(base)).toBeNull()
    const { rid: _rid, ...preview } = base
    expect(createPreviewLandingUrl(preview)).toBeNull()
    setSettingsForTests({ offer: { siteUrl: SITE } })
  })

  it('refuses to build a URL for an invalid rid', () => {
    expect(() => createTrackedLandingUrl({ ...base, rid: 'ABCDE' })).toThrow()
    expect(() => createTrackedLandingUrl({ ...base, rid: 'has spaces not allowed!!' })).toThrow()
  })

  it('builds a preview link that the landing can never book as cold email', () => {
    const { rid: _rid, ...previewInput } = base
    const url = new URL(createPreviewLandingUrl(previewInput)!)
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
    // The id is the template's own, so analytics names the copy that was sent.
    expect(templateIdFor('64ab12', 0)).toBe('tpl_64ab12')
    expect(templateIdFor('64ab12', 1)).toBe('tpl_64ab12_followup_1')
    expect(templateIdFor('64ab12', 5)).toBe('tpl_64ab12_followup_5')
  })
})
