import { describe, expect, it } from 'vitest'
import {
  classifyEmailDomain,
  deobfuscate,
  extractEmails,
  isDiscardedInbox,
  isFreemailDomain,
  isGenericPrefix,
  isPlausibleBusinessEmail,
  sortEmailsByPriority,
} from './email-extract'
import { isPathAllowed, parseRobots } from './robots'
import { normalizeDomain } from '../leads/normalize-domain'

describe('extractEmails', () => {
  it('finds mailto and plain-text addresses, lowercased and deduped', () => {
    const html = `
      <a href="mailto:Contato@Padaria.com.br?subject=Oi">fale conosco</a>
      <p>ou escreva para contato@padaria.com.br / vendas@padaria.com.br</p>`
    expect(extractEmails(html).sort()).toEqual(['contato@padaria.com.br', 'vendas@padaria.com.br'])
  })

  it('drops asset filenames, placeholder domains and tracker hashes', () => {
    const html = `
      <img src="logo@2x.png"> hero@2x.webp
      <span>user@example.com</span>
      <span>a1b2c3d4e5f6a7b8c9d0@sentry.wixpress.com</span>
      <span>real@business.com</span>`
    expect(extractEmails(html)).toEqual(['real@business.com'])
  })

  it('drops localized placeholder domains (form templates: exemple.com, beispiel.de…)', () => {
    const html = `
      <input placeholder="email@exemple.com"> <span>mail@exemple.fr</span>
      <span>correo@ejemplo.com</span> <span>name@beispiel.de</span>
      <span>nome@esempio.it</span> <span>vrai@commerce.fr</span>`
    expect(extractEmails(html)).toEqual(['vrai@commerce.fr'])
  })

  it('classifies generic business prefixes across languages', () => {
    for (const e of [
      'contact@x.com', 'contato@x.com.br', 'atendimento@x.com.br', 'hola@x.mx',
      'kontakt@x.de', 'bonjour@x.fr', 'sales@x.com', 'vendas@x.com.br', 'info@x.it',
    ]) {
      expect(isGenericPrefix(e), e).toBe(true)
    }
    expect(isGenericPrefix('joao.silva@x.com.br')).toBe(false)
    expect(isGenericPrefix('maria@x.com')).toBe(false)
  })

  it('prioritizes generic + own-domain addresses', () => {
    const sorted = sortEmailsByPriority(
      ['maria@gmail.com', 'contato@negocio.com.br', 'hello@gmail.com', 'pedro@negocio.com.br'],
      'negocio.com.br',
    )
    expect(sorted[0]).toBe('contato@negocio.com.br')
    expect(sorted[1]).toBe('hello@gmail.com')
    expect(sorted[2]).toBe('pedro@negocio.com.br')
    expect(sorted[3]).toBe('maria@gmail.com')
  })

  it('ranks third-party addresses last — after every own-domain and freemail one', () => {
    const sorted = sortEmailsByPriority(
      ['info@agencia-web.com.br', 'padaria.central.exemplo@gmail.com', 'joao@padaria.com.br', 'dev@agencia-web.com.br'],
      'padaria.com.br',
    )
    expect(sorted).toEqual([
      'joao@padaria.com.br', // own-domain personal
      'padaria.central.exemplo@gmail.com', // freemail — the business itself, still first-class
      'info@agencia-web.com.br', // third-party generic
      'dev@agencia-web.com.br', // third-party personal
    ])
  })

  it('discards compliance/no-reply/HR inboxes outright', () => {
    for (const e of [
      'privacy@shop.com', 'dpo@loja.com.br', 'datenschutz@laden.de', 'accessibility@store.com',
      'noreply@negocio.com.br', 'no-reply@negocio.com.br', 'donotreply@x.com',
      'jobs@negocio.com', 'careers@negocio.com', 'rh@negocio.com.br', 'imprensa@negocio.com.br',
      'webmaster@negocio.com', 'abuse@negocio.com', 'unsubscribe@negocio.com',
    ]) {
      expect(isDiscardedInbox(e), e).toBe(true)
      expect(isPlausibleBusinessEmail(e), e).toBe(false)
    }
    for (const e of ['contato@negocio.com.br', 'bouncehouse@gmail.com', 'joao.silva@negocio.com.br']) {
      expect(isDiscardedInbox(e), e).toBe(false)
      expect(isPlausibleBusinessEmail(e), e).toBe(true)
    }
  })

  it('discards data-protection, legal and staff-template inboxes', () => {
    for (const e of [
      'gdpr-insight@bank.se', 'gdpr@shop.com', 'lgpd@loja.com.br', 'dsgvo@laden.de',
      'dpofunction@bank.com', 'website.privacy@dealer.example', 'privacyoffice@shop.com',
      'legal@shop.com', 'juridico@loja.com.br', 'ouvidoria@loja.com.br', 'klachten@winkel.nl',
      'etunimi.sukunimi@yritys.fi', 'firstname.lastname@shop.com', 'nome.sobrenome@loja.com.br',
    ]) {
      expect(isPlausibleBusinessEmail(e), e).toBe(false)
    }
    // A real address that merely starts like one of them stays.
    expect(isPlausibleBusinessEmail('legalizacao@cartorio.example')).toBe(true)
  })

  it('drops addresses whose local part is a leaked URL escape', () => {
    expect(isPlausibleBusinessEmail('%5c%22sales@stand.com.br')).toBe(false)
    expect(isPlausibleBusinessEmail('sales@stand.com.br')).toBe(true)
  })

  it('drops known web-vendor domains (agency emails on client sites)', () => {
    expect(isPlausibleBusinessEmail('marketing@leadventure.com')).toBe(false)
    expect(isPlausibleBusinessEmail('support@dealerinspire.com')).toBe(false)
    expect(isPlausibleBusinessEmail('contato@azzurranet.com.br')).toBe(false)
  })

  it('drops data-protection authorities quoted by privacy policies', () => {
    for (const e of ['enquiries@oaic.gov.au', 'imy@imy.se', 'info@ipc.on.ca', 'contact@cnil.fr']) {
      expect(isPlausibleBusinessEmail(e), e).toBe(false)
    }
    // A public body that IS the business keeps its own address.
    expect(isPlausibleBusinessEmail('contact@citymuseum.gov.example')).toBe(true)
  })

  it('classifies own / freemail / third-party — ISP mailboxes count as freemail', () => {
    expect(classifyEmailDomain('contato@padaria.com.br', 'padaria.com.br')).toBe('own')
    expect(classifyEmailDomain('loja@sub.padaria.com.br', 'padaria.com.br')).toBe('own')
    expect(classifyEmailDomain('padaria@gmail.com', 'padaria.com.br')).toBe('freemail')
    expect(classifyEmailDomain('dev@agencia.com', 'padaria.com.br')).toBe('third_party')
    expect(classifyEmailDomain('x@gmail.com', null)).toBe('freemail')
    for (const d of ['hotmail.com.br', 'yahoo.co.jp', 'outlook.fr', 'uol.com.br', 'iinet.net.au', 'bigpond.com', 'naver.com', 't-online.de']) {
      expect(isFreemailDomain(d), d).toBe(true)
    }
    expect(isFreemailDomain('padaria.com.br')).toBe(false)
    expect(isFreemailDomain('gmail')).toBe(false) // needs a real TLD
  })

  it('undoes bracketed [at]/[dot] obfuscation, but never bare " at "', () => {
    expect(extractEmails('<p>escreva para contato [at] padaria [dot] com [dot] br</p>')).toEqual([
      'contato@padaria.com.br',
    ])
    expect(extractEmails('<p>info (at) shop (dot) com</p>')).toEqual(['info@shop.com'])
    expect(deobfuscate('meet me at the shop dot')).toBe('meet me at the shop dot')
  })

  it('reads schema.org JSON-LD and meta emails', () => {
    const html = `
      <script type="application/ld+json">{"@type":"LocalBusiness","email":"mailto:Reservas@Cantina.it",
        "contactPoint":{"@type":"ContactPoint","email":"info@cantina.it"}}</script>
      <meta itemprop="email" content="chef@cantina.it">`
    expect(extractEmails(html).sort()).toEqual(['chef@cantina.it', 'info@cantina.it', 'reservas@cantina.it'])
  })

  it('never scans scripts, styles or attribute placeholders', () => {
    const html = `
      <script>var user = {email: "tracker@analytics-blob.com"}</script>
      <style>/* leak@styles.com */</style>
      <input type="email" placeholder="voce@seudominio.com.br">
      <p>real@negocio.com.br</p>`
    expect(extractEmails(html)).toEqual(['real@negocio.com.br'])
  })
})

describe('robots', () => {
  it('honors Disallow for * with longest-match and Allow override', () => {
    const rules = parseRobots(`
User-agent: *
Disallow: /admin
Disallow: /private/
Allow: /private/public
`)
    expect(isPathAllowed(rules, '/contact')).toBe(true)
    expect(isPathAllowed(rules, '/admin/panel')).toBe(false)
    expect(isPathAllowed(rules, '/private/data')).toBe(false)
    expect(isPathAllowed(rules, '/private/public/page')).toBe(true)
  })

  it('supports wildcards and empty robots', () => {
    const rules = parseRobots(`User-agent: *\nDisallow: /*.pdf$`)
    expect(isPathAllowed(rules, '/menu.pdf')).toBe(false)
    expect(isPathAllowed(rules, '/menu')).toBe(true)
    expect(isPathAllowed(null, '/anything')).toBe(true)
  })

  it('full Disallow blocks everything', () => {
    const rules = parseRobots(`User-agent: *\nDisallow: /`)
    expect(isPathAllowed(rules, '/')).toBe(false)
    expect(isPathAllowed(rules, '/contact')).toBe(false)
  })
})

describe('isPlatformHost', () => {
  it('flags social/aggregator hosts (which must never join domain-dedup)', async () => {
    const { isPlatformHost } = await import('./website-inspector')
    expect(isPlatformHost('instagram.com')).toBe(true)
    expect(isPlatformHost('www.facebook.com')).toBe(true)
    expect(isPlatformHost('linktr.ee')).toBe(true)
    expect(isPlatformHost('restaurante-do-mar.com.br')).toBe(false)
  })
})

describe('normalizeDomain', () => {
  it('lowercases, strips www and paths, tolerates missing scheme', () => {
    expect(normalizeDomain('https://WWW.Padaria.com.BR/contato?x=1')).toBe('padaria.com.br')
    expect(normalizeDomain('padaria.com.br/sobre')).toBe('padaria.com.br')
    expect(normalizeDomain(null)).toBeNull()
    expect(normalizeDomain('   ')).toBeNull()
  })
})
