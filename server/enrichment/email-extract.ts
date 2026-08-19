/**
 * Public business-email extraction. Only legitimate, publicly displayed
 * addresses: mailto: links, visible page text (scripts, styles and form
 * placeholder attributes never scanned), schema.org JSON-LD contact data and
 * lightly obfuscated spellings the site itself shows humans ("info [at]
 * x.com"). Compliance/no-reply inboxes and known web-vendor domains are
 * dropped outright; every kept address is classified own-domain / freemail /
 * third-party. Freemail is a first-class contact — many small businesses have
 * no domain of their own — while third-party addresses (someone else's
 * company) rank last in the recipient election (recipient-election.ts).
 */

import * as cheerio from 'cheerio'

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

export type EmailDomainKind = 'own' | 'freemail' | 'third_party'

/** Generic business local-parts across the supported markets. */
const GENERIC_PREFIXES = new Set([
  // en
  'contact', 'hello', 'hi', 'info', 'support', 'sales', 'commercial', 'office',
  'enquiries', 'inquiries', 'mail', 'email', 'admin', 'team', 'bookings', 'booking',
  'reservations', 'reservation', 'service', 'services', 'welcome', 'customer', 'help',
  // pt
  'contato', 'atendimento', 'comercial', 'vendas', 'ola', 'geral', 'reservas', 'suporte',
  'faleconosco', 'sac', 'orcamento', 'orcamentos',
  // es
  'contacto', 'hola', 'ventas', 'soporte', 'reservas', 'general', 'informacion', 'atencion',
  // fr
  'bonjour', 'contactez', 'accueil', 'reservation', 'commande', 'infos',
  // de
  'kontakt', 'anfrage', 'anfragen', 'buero', 'buchung', 'buchungen', 'reservierung', 'termin',
  'empfang', 'zentrale', 'verkauf',
  // it
  'contatto', 'contatti', 'ciao', 'vendite', 'prenotazioni', 'segreteria', 'amministrazione',
  // nl
  'verkoop', 'receptie', 'klantenservice', 'afspraak',
  // no / dk / se — "post@" is THE general inbox across the Nordics
  'post', 'firmapost', 'resepsjon', 'kundeservice', 'kundtjanst', 'kansli', 'bokning', 'forsaljning',
  // fi
  'toimisto', 'myynti', 'asiakaspalvelu',
  // en, remaining desks
  'reception', 'frontdesk', 'order', 'orders',
])

/**
 * Inboxes that are real but are never the outreach contact: transactional
 * senders, compliance/DPO desks, HR/press. Cold-emailing a privacy officer is
 * the fastest route to a formal complaint.
 */
const DISCARD_EXACT = new Set([
  'postmaster', 'webmaster', 'hostmaster', 'abuse', 'spam', 'security',
  'privacy', 'privacidade', 'privacidad', 'dpo', 'dataprotection', 'datenschutz',
  'accessibility', 'press', 'presse', 'imprensa', 'prensa', 'media',
  'careers', 'career', 'jobs', 'job', 'vagas', 'recruiting', 'recruitment',
  'recrutement', 'rh', 'hr', 'trabalheconosco', 'jobb', 'stellen',
  'bounce', 'bounces', 'notification', 'notifications', 'alerts', 'newsletter',
  // legal / complaints desks: a cold pitch there is at best ignored
  'legal', 'juridico', 'jurdico', 'compliance', 'ouvidoria', 'ombudsman',
  'complaint', 'complaints', 'reclamacoes', 'reclamaciones', 'klachten', 'beschwerde',
  // placeholder local-parts that survive template pages
  'example', 'test', 'testing', 'demo', 'sample', 'user', 'username',
  'yourname', 'youremail', 'seuemail', 'seunome', 'johndoe', 'janedoe', 'someone',
  // "firstname.lastname" staff-address templates (letters-only form matches
  // every separator: etunimi.sukunimi, etunimi_sukunimi…)
  'firstnamelastname', 'namesurname', 'etunimisukunimi', 'fornavnetternavn',
  'fornamnefternamn', 'vornamenachname', 'prenomnom', 'nomecognome', 'nomesobrenome',
  'nombreapellido', 'voornaamachternaam',
])
// Prefix matches — kept short: a prefix here must be unambiguous even at the
// start of a real name ("bounce" is NOT: bouncehouse@ rentals exist).
const DISCARD_STARTS = [
  'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply', 'dontreply',
  'naoresponda', 'nao-responda', 'mailer-daemon', 'mailerdaemon', 'unsubscribe',
]
/**
 * Data-protection desks, wherever they sit in the local part and however
 * they spell themselves: gdpr-insight@, dpofunction@, website.privacy@,
 * privacyoffice@. Anchored to a word start so the term can't be swallowed by
 * a longer unrelated one.
 */
const DISCARD_WORDS =
  /(^|[^a-z])(gdpr|lgpd|rgpd|dsgvo|dpo|privacy|privacidade|privacidad|dataprotection|datenschutz)/

const NOISE_DOMAINS = [
  'example.com', 'example.org', 'example.net', 'email.com', 'domain.com', 'yourdomain.com',
  'mysite.com', 'sentry.io', 'wixpress.com', 'sentry-next.wixpress.com', 'godaddy.com',
  'website.com', 'yoursite.com', 'company.com', 'mail.com',
  // localized placeholder domains used by form/template examples across our markets
  'exemple.com', 'exemple.fr', 'ejemplo.com', 'ejemplo.es', 'beispiel.de', 'beispiel.com',
  'esempio.it', 'esempio.com', 'voorbeeld.nl', 'exempel.se', 'eksempel.no', 'esimerkki.fi',
]

/**
 * Web agencies / site-platform vendors whose addresses leak into client sites
 * ("powered by …" footers, template leftovers). Real emails, wrong company.
 * Curated from what actually shows up in our own audits (the reclean script
 * reports new cross-lead candidates for this list).
 */
const VENDOR_DOMAINS = [
  'leadventure.com', 'dealer.com', 'dealerinspire.com', 'dealereprocess.com',
  'dealerfire.com', 'dealersocket.com', 'azzurranet.com.br',
  'squarespace.com', 'shopify.com', 'wix.com', 'duda.co', 'webflow.com',
  'wordpress.com', 'jimdo.com', 'weebly.com', 'webnode.com',
]

/**
 * Freemail / consumer-ISP mailbox providers. An address here on a business's
 * own site is almost always the business itself (no bought domain) — never
 * "someone else's company". Families cover country TLD variants
 * (hotmail.com.br, yahoo.co.jp, outlook.fr, …); exacts cover regional
 * providers and old-school ISP mailboxes still common among small businesses.
 */
const FREEMAIL_FAMILIES = new Set([
  'gmail', 'googlemail', 'hotmail', 'outlook', 'live', 'msn', 'yahoo', 'ymail',
  'rocketmail', 'icloud', 'aol', 'protonmail', 'gmx', 'zoho', 'yandex',
])
const FREEMAIL_EXACT = new Set([
  'me.com', 'mac.com', 'pm.me', 'proton.me', 'mail.ru',
  // pt-BR / pt
  'uol.com.br', 'bol.com.br', 'terra.com.br', 'ig.com.br', 'globo.com', 'globomail.com',
  'oi.com.br', 'zipmail.com.br', 'sapo.pt', 'netcabo.pt', 'mail.telepac.pt', 'clix.pt',
  // de / at / ch
  'web.de', 't-online.de', 'freenet.de', 'posteo.de', 'mailbox.org', 'bluewin.ch',
  // fr
  'orange.fr', 'wanadoo.fr', 'laposte.net', 'free.fr', 'sfr.fr', 'neuf.fr', 'bbox.fr',
  // it
  'libero.it', 'virgilio.it', 'tiscali.it', 'alice.it', 'tin.it', 'fastwebnet.it', 'pec.it',
  // nl / be
  'ziggo.nl', 'kpnmail.nl', 'planet.nl', 'hetnet.nl', 'xs4all.nl', 'home.nl',
  'telenet.be', 'skynet.be', 'proximus.be',
  // nordics
  'telia.com', 'telia.se', 'comhem.se', 'bredband.net', 'spray.se',
  'online.no', 'frisurf.no', 'altibox.no', 'elisanet.fi', 'luukku.com', 'saunalahti.fi', 'kolumbus.fi',
  // au / nz
  'bigpond.com', 'bigpond.net.au', 'optusnet.com.au', 'iinet.net.au', 'westnet.com.au',
  'tpg.com.au', 'internode.on.net', 'xtra.co.nz',
  // kr / jp / cn-sphere
  'naver.com', 'daum.net', 'hanmail.net', 'kakao.com', 'nate.com',
  'docomo.ne.jp', 'ezweb.ne.jp', 'softbank.ne.jp', 'nifty.com', 'biglobe.ne.jp', 'ybb.ne.jp',
  'qq.com', '163.com', '126.com', '139.com', 'sina.com', 'sohu.com', 'yeah.net',
])

/**
 * Data-protection authorities. Privacy policies print the regulator's own
 * contact ("you may complain to the OAIC at enquiries@oaic.gov.au") and the
 * extraction picks it up like any other address — the one inbox where a cold
 * pitch does actual damage. Never a business contact, in any market.
 */
const AUTHORITY_DOMAINS = [
  'oaic.gov.au', 'privacy.org.nz', 'imy.se', 'datainspektionen.se', 'datatilsynet.no',
  'datatilsynet.dk', 'tietosuoja.fi', 'cnil.fr', 'aepd.es', 'garanteprivacy.it', 'gpdp.it',
  'bfdi.bund.de', 'dsb.gv.at', 'edoeb.admin.ch', 'autoriteitpersoonsgegevens.nl',
  'gegevensbeschermingsautoriteit.be', 'ico.org.uk', 'dataprotection.ie', 'cnpd.pt',
  'anpd.gov.br', 'edps.europa.eu', 'edpb.europa.eu', 'priv.gc.ca', 'ipc.on.ca', 'ftc.gov',
]

/** Disposable-inbox providers — rare in B2B, but never a business contact. */
const DISPOSABLE_DOMAINS = [
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'yopmail.com',
  'tempmail.com', 'temp-mail.org', 'trashmail.com', 'sharklasers.com',
  'getnada.com', 'dispostable.com', 'maildrop.cc', 'mintemail.com',
  'throwawaymail.com', 'fakeinbox.com', 'mohmal.com', 'tempinbox.com',
]

const NOISE_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|ico|css|js|pdf|mp4|webm|woff2?)$/i

export function isFreemailDomain(domain: string): boolean {
  const d = domain.toLowerCase()
  if (FREEMAIL_EXACT.has(d)) return true
  const label = d.split('.')[0] ?? ''
  return d.includes('.') && FREEMAIL_FAMILIES.has(label)
}

export function classifyEmailDomain(email: string, ownDomain: string | null): EmailDomainKind {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  if (ownDomain && (domain === ownDomain || domain.endsWith(`.${ownDomain}`))) return 'own'
  if (isFreemailDomain(domain)) return 'freemail'
  return 'third_party'
}

/** Real inbox, wrong purpose (DPO, no-reply, HR…) — never an outreach target. */
export function isDiscardedInbox(email: string): boolean {
  const local = email.split('@')[0]?.toLowerCase() ?? ''
  const normalized = local.replace(/[^a-z]/g, '')
  if (DISCARD_EXACT.has(local) || DISCARD_EXACT.has(normalized)) return true
  if (DISCARD_WORDS.test(local)) return true
  return DISCARD_STARTS.some((p) => local.startsWith(p) || normalized.startsWith(p.replace(/[^a-z]/g, '')))
}

export function isPlausibleBusinessEmail(email: string): boolean {
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return false
  if (email.includes('..')) return false
  const [local, domain] = email.split('@')
  if (!local || !domain) return false
  if (local.length > 40) return false // tracker/DSN hashes
  // Percent-escapes leaking out of a href (%5c%22sales@…) — never a real local part.
  if (local.includes('%')) return false
  if (NOISE_EXTENSIONS.test(email)) return false
  if (NOISE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return false
  if (VENDOR_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return false
  if (AUTHORITY_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return false
  if (DISPOSABLE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return false
  if (/^[0-9a-f]{16,}$/i.test(local)) return false
  if (isDiscardedInbox(email)) return false
  return true
}

/**
 * Undo the light obfuscation sites use for human readers: "info [at]
 * business [dot] com". Bracketed forms only — bare " at " is far too
 * ambiguous. Anything produced here still has to pass the address regex and
 * the plausibility filter.
 */
export function deobfuscate(text: string): string {
  return text
    .replace(/\s*[\[({]\s*(?:at|arroba)\s*[\])}]\s*/gi, '@')
    .replace(/\s*[\[({]\s*(?:dot|ponto|punto|punkt)\s*[\])}]\s*/gi, '.')
}

/** Recursively pull "email" values out of parsed schema.org JSON-LD. */
function jsonLdEmails(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 6 || value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) jsonLdEmails(item, out, depth + 1)
    return
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key.toLowerCase() === 'email' && typeof v === 'string') {
      out.add(v.replace(/^mailto:/i, '').trim().toLowerCase())
    } else {
      jsonLdEmails(v, out, depth + 1)
    }
  }
}

export function extractEmails(html: string): string[] {
  const $ = cheerio.load(html)
  const found = new Set<string>()

  // mailto: links (possibly URL-encoded, possibly with ?subject=…)
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    if (!/^mailto:/i.test(href.trim())) return
    try {
      const decoded = decodeURIComponent(href.trim().slice('mailto:'.length).split('?')[0])
      for (const part of decoded.toLowerCase().split(/[,;]/)) {
        const candidate = part.trim()
        if (candidate) found.add(candidate)
      }
    } catch {
      /* malformed encoding — skip */
    }
  })

  // schema.org structured data (LocalBusiness.email, contactPoint.email, …)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      jsonLdEmails(JSON.parse($(el).text()), found)
    } catch {
      /* invalid JSON-LD — skip */
    }
  })

  // microdata / open-graph email annotations
  $('meta[itemprop="email"], meta[property="og:email"]').each((_, el) => {
    const content = ($(el).attr('content') ?? '').trim().toLowerCase()
    if (content) found.add(content.replace(/^mailto:/i, ''))
  })

  // Visible text only: scripts, styles and markup attributes (form
  // placeholder="you@example.com", tracker payloads) are never scanned.
  $('script, style, noscript, template, svg').remove()
  const text = deobfuscate($('body').text())
  for (const raw of text.match(EMAIL_RE) ?? []) {
    found.add(raw.toLowerCase())
  }

  return [...found].filter(isPlausibleBusinessEmail)
}

/**
 * TLD endings across our operating markets, longest-first at match time.
 * Used to repair "glued" extractions where the page ran the address into the
 * next word ("…@gmail.comVisit us" → domain "gmail.comvisit").
 */
const KNOWN_SUFFIXES = [
  '.com.br', '.net.br', '.org.br', '.com.au', '.net.au', '.org.au', '.co.uk', '.org.uk',
  '.co.nz', '.co.jp', '.ne.jp', '.or.jp', '.co.kr', '.com.tw', '.com.hk', '.com.mx',
  '.com', '.net', '.org', '.info', '.biz', '.io', '.ai', '.app', '.dev', '.shop', '.store',
  '.online', '.site', '.no', '.se', '.fi', '.dk', '.is', '.de', '.at', '.ch', '.fr', '.be',
  '.nl', '.lu', '.it', '.pt', '.es', '.ie', '.uk', '.ca', '.us', '.mx', '.br', '.au', '.nz',
  '.jp', '.kr', '.tw', '.hk', '.eu',
].sort((a, b) => b.length - a.length)

/**
 * If `domain` doesn't end in a known TLD but CONTAINS one mid-string, return
 * the plausible real domain cut at that boundary ("gmail.comvisit" →
 * "gmail.com"; "retailfirst.com.aupostal" → "retailfirst.com.au"). Returns
 * null when the domain already looks fine or no boundary exists. Callers
 * must gate the candidate on DNS evidence (original no-MX + candidate MX ok)
 * before trusting it — see server/enrichment/mx.ts.
 */
export function repairGluedDomain(domain: string): string | null {
  const d = domain.toLowerCase()
  if (KNOWN_SUFFIXES.some((s) => d.endsWith(s))) return null
  for (const suffix of KNOWN_SUFFIXES) {
    const idx = d.indexOf(suffix)
    if (idx > 0 && d.length > idx + suffix.length) return d.slice(0, idx + suffix.length)
  }
  return null
}

export function isGenericPrefix(email: string): boolean {
  const local = email.split('@')[0]?.toLowerCase() ?? ''
  const normalized = local.replace(/[^a-z]/g, '')
  if (GENERIC_PREFIXES.has(local) || GENERIC_PREFIXES.has(normalized)) return true
  // e.g. contact.us, sales1, info-sp
  return [...GENERIC_PREFIXES].some((p) => p.length >= 4 && local.startsWith(p))
}

/**
 * Priority order for the approval screen and default selection. Freemail is a
 * first-class citizen (a gmail on the business's site IS the business):
 * own-domain generic → freemail generic → own-domain personal → freemail
 * personal → third-party generic → third-party personal. Stable within
 * groups.
 */
export function sortEmailsByPriority(emails: string[], ownDomain: string | null): string[] {
  const rank = (e: string): number => {
    const kind = classifyEmailDomain(e, ownDomain)
    const generic = isGenericPrefix(e)
    if (kind === 'own') return generic ? 0 : 2
    if (kind === 'freemail') return generic ? 1 : 3
    return generic ? 4 : 5
  }
  return [...emails].sort((a, b) => rank(a) - rank(b))
}
