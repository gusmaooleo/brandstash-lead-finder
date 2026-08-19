/**
 * Official-website inspector. Visits only the business's own public site:
 * the homepage plus a small set of relevant same-domain pages (contact, about,
 * legal, privacy — localized variants included), honoring robots.txt, with
 * timeouts and size caps. Extracts only public business contact channels:
 * emails, contact forms, phone numbers. Never follows off-domain links, never
 * bypasses protections (a 401/403/429 simply ends the visit).
 */

import * as cheerio from 'cheerio'
import { CRAWLER_USER_AGENT, fetchRobots, isPathAllowed } from './robots'
import { classifyEmailDomain, extractEmails, isGenericPrefix, sortEmailsByPriority } from './email-extract'
import { normalizeDomain } from '../leads/normalize-domain'
import type { ContactEmail } from '../../shared/types'

const MAX_EXTRA_PAGES = 6
const PAGE_TIMEOUT_MS = 12_000
const MAX_PAGE_BYTES = 800_000
const MAX_SITEMAP_BYTES = 500_000

/**
 * Social/aggregator platforms — never an "official website": we don't inspect
 * them (their ToS/robots disallow scraping) and their domain must NOT enter
 * domain-dedup, or the first Instagram-linked business would mark every later
 * one as a duplicate.
 */
const PLATFORM_DOMAINS = [
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com',
  'linkedin.com', 'whatsapp.com', 'wa.me', 'm.me', 't.me', 'telegram.me', 'linktr.ee',
  'linktree.com', 'goo.gl', 'g.page', 'maps.google.com', 'bit.ly', 'ifood.com.br',
  'ubereats.com', 'rappi.com.br', 'rappi.com', 'tripadvisor.com', 'doordash.com',
]

export function isPlatformHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  return PLATFORM_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`))
}

const CANDIDATE_KEYWORDS = [
  // en
  'contact', 'contact-us', 'contactus', 'about', 'legal', 'privacy', 'imprint', 'team',
  // pt
  'contato', 'contacto', 'fale-conosco', 'faleconosco', 'atendimento', 'sobre', 'quem-somos', 'equipe', 'privacidade',
  // es
  'contactanos', 'nosotros', 'acerca', 'privacidad', 'aviso-legal',
  // fr
  'contactez', 'a-propos', 'apropos', 'mentions-legales', 'confidentialite',
  // de
  'kontakt', 'ueber-uns', 'uber-uns', 'impressum', 'datenschutz',
  // it
  'contatti', 'chi-siamo', 'note-legali',
  // zh / ja / ko (path fragments are usually latin; text matching below covers CJK labels)
  'inquiry', 'access',
]

const CANDIDATE_TEXT = [
  'contact', 'contato', 'contacto', 'kontakt', 'contatti', 'fale conosco', 'sobre', 'about',
  'impressum', 'datenschutz', 'privacy', 'privacidade', 'privacidad', 'mentions légales',
  '聯絡', '联系', '聯繫', 'お問い合わせ', '会社概要', '문의', '연락처', '會社',
]

export type PageVisit = {
  url: string
  status: number | null
  emails_found: number
  note?: string
}

export type WebsiteAudit = {
  website: string
  normalized_domain: string | null
  pages_checked: PageVisit[]
  emails: ContactEmail[]
  forms: string[]
  phones: string[]
  robots_blocked: string[]
  reachable: boolean
}

async function fetchPage(url: string): Promise<{ status: number; html: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': CRAWLER_USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      redirect: 'follow',
    })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || (type && !type.includes('html'))) {
      return { status: res.status, html: '' }
    }
    const html = (await res.text()).slice(0, MAX_PAGE_BYTES)
    return { status: res.status, html }
  } catch {
    return null
  }
}

function sameSite(href: string, base: URL): URL | null {
  try {
    const url = new URL(href, base)
    if (!/^https?:$/.test(url.protocol)) return null
    const host = url.hostname.replace(/^www\./, '')
    const baseHost = base.hostname.replace(/^www\./, '')
    if (host !== baseHost) return null
    url.hash = ''
    return url
  } catch {
    return null
  }
}

function candidateLinks(html: string, base: URL): string[] {
  const $ = cheerio.load(html)
  const seen = new Set<string>()
  const out: string[] = []
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const text = $(el).text().trim().toLowerCase()
    const url = sameSite(href, base)
    if (!url) return
    const path = url.pathname.toLowerCase()
    const matches =
      CANDIDATE_KEYWORDS.some((k) => path.includes(k)) ||
      CANDIDATE_TEXT.some((t) => text.includes(t))
    if (!matches) return
    const key = url.toString()
    if (seen.has(key) || key === base.toString()) return
    seen.add(key)
    out.push(key)
  })
  return out.slice(0, MAX_EXTRA_PAGES)
}

/**
 * Sitemap peek — used only when the homepage yielded no emails: many sites
 * don't link their contact page from the menu. Same-host, keyword-matching,
 * non-nested entries only.
 */
async function sitemapCandidates(base: URL): Promise<string[]> {
  try {
    const res = await fetch(new URL('/sitemap.xml', base).toString(), {
      headers: { 'User-Agent': CRAWLER_USER_AGENT, Accept: 'application/xml,text/xml' },
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow',
    })
    if (!res.ok) return []
    const xml = (await res.text()).slice(0, MAX_SITEMAP_BYTES)
    const out: string[] = []
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const url = sameSite(m[1], base)
      if (!url || url.pathname.endsWith('.xml')) continue
      const path = url.pathname.toLowerCase()
      if (CANDIDATE_KEYWORDS.some((k) => path.includes(k))) out.push(url.toString())
      if (out.length >= 2) break
    }
    return out
  } catch {
    return []
  }
}

function pageHasContactForm(html: string): boolean {
  const $ = cheerio.load(html)
  let has = false
  $('form').each((_, form) => {
    const f = $(form)
    if (f.find('input[type="email"], input[name*="email" i], textarea').length > 0) has = true
  })
  return has
}

function extractPhones(html: string): string[] {
  const out = new Set<string>()
  const telRe = /href\s*=\s*["']tel:([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = telRe.exec(html))) {
    const phone = decodeURIComponent(m[1]).replace(/[^\d+()\-.\s]/g, '').trim()
    if (phone.replace(/\D/g, '').length >= 7) out.add(phone)
  }
  return [...out]
}

export async function inspectWebsite(website: string): Promise<WebsiteAudit> {
  const audit: WebsiteAudit = {
    website,
    normalized_domain: normalizeDomain(website),
    pages_checked: [],
    emails: [],
    forms: [],
    phones: [],
    robots_blocked: [],
    reachable: false,
  }

  let base: URL
  try {
    base = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`)
  } catch {
    return audit
  }
  if (isPlatformHost(base.hostname)) {
    audit.normalized_domain = null
    audit.pages_checked.push({ url: base.toString(), status: null, emails_found: 0, note: 'platform_not_inspected' })
    return audit
  }

  const robots = await fetchRobots(base.origin)
  const emailMap = new Map<string, string>() // address → first source url

  const visit = async (url: URL): Promise<string | null> => {
    const path = url.pathname + url.search
    if (!isPathAllowed(robots, path)) {
      audit.robots_blocked.push(url.toString())
      return null
    }
    const page = await fetchPage(url.toString())
    if (!page) {
      audit.pages_checked.push({ url: url.toString(), status: null, emails_found: 0, note: 'unreachable' })
      return null
    }
    const emails = page.html ? extractEmails(page.html) : []
    for (const address of emails) {
      if (!emailMap.has(address)) emailMap.set(address, url.toString())
    }
    if (page.html && pageHasContactForm(page.html)) audit.forms.push(url.toString())
    for (const phone of page.html ? extractPhones(page.html) : []) {
      if (!audit.phones.includes(phone)) audit.phones.push(phone)
    }
    audit.pages_checked.push({ url: url.toString(), status: page.status, emails_found: emails.length })
    return page.html || null
  }

  const homeHtml = await visit(base)
  audit.reachable = audit.pages_checked.some((p) => p.status !== null && p.status < 500)
  if (homeHtml === null) return audit

  const links = candidateLinks(homeHtml, base)
  const fallbacks =
    links.length === 0
      ? ['/contact', '/contact-us', '/contato', '/contacto', '/kontakt', '/contatti', '/about'].map((p) =>
          new URL(p, base).toString(),
        )
      : []
  for (const link of [...links, ...fallbacks].slice(0, MAX_EXTRA_PAGES)) {
    await visit(new URL(link))
  }

  // Still empty-handed? The contact page may only be reachable via sitemap.
  if (emailMap.size === 0) {
    const visited = new Set(audit.pages_checked.map((p) => p.url))
    for (const link of await sitemapCandidates(base)) {
      if (!visited.has(link)) await visit(new URL(link))
    }
  }

  const sorted = sortEmailsByPriority([...emailMap.keys()], audit.normalized_domain)
  audit.emails = sorted.map((address) => ({
    address,
    source_url: emailMap.get(address) ?? base.toString(),
    generic: isGenericPrefix(address),
    kind: classifyEmailDomain(address, audit.normalized_domain),
  }))
  return audit
}
