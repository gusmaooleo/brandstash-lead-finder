import { describe, expect, it } from 'vitest'
import { electRecipient } from './recipient-election'
import type { ContactEmail } from '../../shared/types'

/** Terse candidate builder — the fields the election actually reads. */
function email(address: string, extra: Partial<ContactEmail> = {}): ContactEmail {
  const kind = extra.kind ?? null
  return {
    address,
    source_url: 'https://shop.example/contact',
    generic: extra.generic ?? false,
    kind,
    mx: extra.mx ?? null,
    ...extra,
  } as ContactEmail
}

describe('recipient election', () => {
  it('elects a recipient whenever one can be mailed (approve stays available)', () => {
    const emails = [
      email('joao@shop.se', { kind: 'own' }),
      email('info@shop.se', { generic: true, kind: 'own' }),
      email('shop@gmail.com', { generic: true, kind: 'freemail' }),
    ]
    expect(electRecipient(emails)).toBe('info@shop.se')
  })

  it('keeps the approval list order: own generic → freemail generic → own personal → freemail personal', () => {
    const own = email('anna@shop.se', { kind: 'own' })
    const freemailGeneric = email('contato@gmail.com', { generic: true, kind: 'freemail' })
    const freemailPersonal = email('anna@gmail.com', { kind: 'freemail' })
    expect(electRecipient([own, freemailGeneric, freemailPersonal])).toBe('contato@gmail.com')
    expect(electRecipient([own, freemailPersonal])).toBe('anna@shop.se')
    expect(electRecipient([freemailPersonal, own])).toBe('anna@shop.se')
  })

  it('prefers the desk that reads a pitch: general → commercial → operational', () => {
    const desks = [
      email('bookings@shop.se', { generic: true, kind: 'own' }),
      email('vendas@shop.se', { generic: true, kind: 'own' }),
      email('contato@shop.se', { generic: true, kind: 'own' }),
    ]
    expect(electRecipient(desks)).toBe('contato@shop.se')
    expect(electRecipient(desks.slice(0, 2))).toBe('vendas@shop.se')
    expect(electRecipient(desks.slice(0, 1))).toBe('bookings@shop.se')
  })

  it('ranks a task queue below a human at the same domain, above other domains', () => {
    const queue = email('support@shop.se', { generic: true, kind: 'own' })
    const person = email('anna@shop.se', { kind: 'own' })
    const outsider = email('info@agency.com', { generic: true, kind: 'third_party' })
    expect(electRecipient([queue, person])).toBe('anna@shop.se')
    expect(electRecipient([queue, outsider])).toBe('support@shop.se')
  })

  it('recognises a general inbox the row was stored too early to know about', () => {
    // "post@" is THE front desk across the Nordics; rows discovered before
    // the prefix list learned it carry generic:false.
    expect(
      electRecipient([
        email('morten@autovia.example', { kind: 'own', mx: 'ok' }),
        email('post@autovia.example', { kind: 'own', mx: 'ok' }),
      ]),
    ).toBe('post@autovia.example')
  })

  it('never elects an address that cannot receive mail (no MX)', () => {
    expect(
      electRecipient([
        email('info@dead-domain.se', { generic: true, kind: 'own', mx: 'no_mx' }),
        email('shop@gmail.com', { generic: true, kind: 'freemail', mx: 'ok' }),
      ]),
    ).toBe('shop@gmail.com')
    expect(electRecipient([email('info@dead-domain.se', { generic: true, kind: 'own', mx: 'no_mx' })])).toBeNull()
  })

  it('never elects a suppressed or dead address — the send would be refused', () => {
    const emails = [
      email('info@shop.se', { generic: true, kind: 'own' }),
      email('anna@shop.se', { kind: 'own' }),
    ]
    expect(electRecipient(emails, { blocked: new Set(['info@shop.se']) })).toBe('anna@shop.se')
    expect(electRecipient(emails, { blocked: new Set(['info@shop.se', 'anna@shop.se']) })).toBeNull()
  })

  it('elects a third-party address only as a last resort (the UI badges it)', () => {
    const thirdParty = email('reception@golfbokning.example', { generic: true, kind: 'third_party' })
    const own = email('kansli@golfklubb.example', { generic: true, kind: 'own' })
    expect(electRecipient([thirdParty, own])).toBe('kansli@golfklubb.example')
    expect(electRecipient([thirdParty])).toBe('reception@golfbokning.example')
  })

  it('never elects a public authority quoted on the site — unless it IS the lead', () => {
    // Privacy pages print the regulator's own address; it must never win.
    expect(
      electRecipient([
        email('enquiries@oaic.gov.au', { generic: true, kind: 'third_party' }),
        email('sales@dealer.example', { generic: true, kind: 'own' }),
      ]),
    ).toBe('sales@dealer.example')
    expect(electRecipient([email('enquiries@oaic.gov.au', { generic: true, kind: 'third_party' })])).toBeNull()
    // A museum on its own gov domain is a normal lead.
    expect(electRecipient([email('contact@citymuseum.gov.example', { generic: true, kind: 'own' })])).toBe(
      'contact@citymuseum.gov.example',
    )
  })

  it('proven MX breaks a tie between equally ranked candidates', () => {
    expect(
      electRecipient([
        email('contato@shop.se', { generic: true, kind: 'own' }),
        email('contact@shop.se', { generic: true, kind: 'own', mx: 'ok' }),
      ]),
    ).toBe('contact@shop.se')
  })

  it('refuses addresses today’s extraction rules would drop (legacy rows)', () => {
    expect(
      electRecipient([
        email('noreply@shop.se', { generic: true, kind: 'own' }),
        email('privacy@leadventure.com', { generic: true, kind: 'third_party' }),
        email('anna@shop.se', { kind: 'own' }),
      ]),
    ).toBe('anna@shop.se')
    expect(electRecipient([email('dpo@shop.se', { generic: true, kind: 'own' })])).toBeNull()
  })

  it('classifies legacy candidates that never stored a kind', () => {
    const emails = [
      { address: 'shop@gmail.com', source_url: 'manual', generic: true },
      { address: 'info@shop.se', source_url: 'manual', generic: true },
    ] as ContactEmail[]
    expect(electRecipient(emails, { ownDomain: 'shop.se' })).toBe('info@shop.se')
    // Without the business domain, own-vs-third-party is unknowable: the
    // freemail inbox is the safer of the two.
    expect(electRecipient(emails)).toBe('shop@gmail.com')
  })

  it('is deterministic and returns null when there is nothing to elect', () => {
    expect(electRecipient([])).toBeNull()
    const emails = [
      email('a@shop.se', { kind: 'own' }),
      email('b@shop.se', { kind: 'own' }),
    ]
    expect(electRecipient(emails)).toBe('a@shop.se')
    expect(electRecipient([...emails].reverse())).toBe('b@shop.se')
  })
})
