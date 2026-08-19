import { describe, expect, it, vi } from 'vitest'
import { checkMx, annotateMx, recoverGluedEmails, type MxResolver } from './mx'
import { repairGluedDomain } from './email-extract'
import { classifyProviderEvent } from '../email/bounce-sync'
import { isHardBounce } from '../email/dead-addresses'
import type { ContactEmail } from '../../shared/types'

const mxRecord = [{ exchange: 'mx1.example.com', priority: 10 }]
const dnsError = (code: string): Error => Object.assign(new Error(code), { code })

describe('checkMx', () => {
  it('records → ok; empty → no_mx; NXDOMAIN/NODATA → no_mx', async () => {
    expect(await checkMx('has-mx-a.test', async () => mxRecord)).toBe('ok')
    expect(await checkMx('empty-mx-a.test', async () => [])).toBe('no_mx')
    expect(await checkMx('nx-a.test', async () => Promise.reject(dnsError('ENOTFOUND')))).toBe('no_mx')
    expect(await checkMx('nodata-a.test', async () => Promise.reject(dnsError('ENODATA')))).toBe('no_mx')
  })

  it('transient DNS failures are unknown, never no_mx — and are not cached', async () => {
    expect(await checkMx('flaky-a.test', async () => Promise.reject(dnsError('ETIMEOUT')))).toBe('unknown')
    // next call retries and can recover
    expect(await checkMx('flaky-a.test', async () => mxRecord)).toBe('ok')
  })

  it('caches definitive answers — one DNS query per domain', async () => {
    const resolver = vi.fn(async () => mxRecord) as MxResolver
    await checkMx('cached-a.test', resolver)
    await checkMx('cached-a.test', resolver)
    await checkMx('CACHED-A.test', resolver) // case-insensitive
    expect(resolver).toHaveBeenCalledTimes(1)
  })
})

describe('annotateMx', () => {
  it('stamps ok/no_mx per domain and leaves unknown untouched', async () => {
    const resolver: MxResolver = async (d) => {
      if (d === 'alive-b.test') return mxRecord
      if (d === 'dead-b.test') throw dnsError('ENOTFOUND')
      throw dnsError('ETIMEOUT')
    }
    const emails: ContactEmail[] = [
      { address: 'a@alive-b.test', source_url: 'x', generic: true },
      { address: 'b@alive-b.test', source_url: 'x', generic: false },
      { address: 'c@dead-b.test', source_url: 'x', generic: false },
      { address: 'd@flaky-b.test', source_url: 'x', generic: false },
    ]
    await annotateMx(emails, resolver)
    expect(emails.map((e) => e.mx ?? null)).toEqual(['ok', 'ok', 'no_mx', null])
  })
})

describe('isHardBounce', () => {
  it('permanent mailbox failures are hard bounces', () => {
    for (const e of [
      '550 5.1.1 The email account that you tried to reach does not exist',
      '553-5.1.2 mailbox unavailable',
      'Recipient address rejected: User unknown in virtual mailbox table',
      '550 No such user here',
    ]) {
      expect(isHardBounce(e), e).toBe(true)
    }
  })

  it('transient/config errors never dead-list an address', () => {
    for (const e of [
      '421 4.7.0 Try again later',
      '452 4.2.2 Mailbox full',
      '550 5.2.2 Mailbox full', // quota is temporary
      'Connection timeout',
      'Resend API 422: Invalid `from`',
      'getaddrinfo ENOTFOUND smtp.gmail.com',
    ]) {
      expect(isHardBounce(e), e).toBe(false)
    }
  })
})

describe('glued-domain repair', () => {
  it('cuts at the known-TLD boundary the page ran past', () => {
    expect(repairGluedDomain('gmail.comvisit')).toBe('gmail.com')
    expect(repairGluedDomain('gmail.comphone')).toBe('gmail.com')
    expect(repairGluedDomain('ryttern.notelefon')).toBe('ryttern.no')
    expect(repairGluedDomain('retailfirst.com.aupostal')).toBe('retailfirst.com.au')
    expect(repairGluedDomain('supremetimberfloors.com.au.get')).toBe('supremetimberfloors.com.au')
  })

  it('leaves valid domains alone', () => {
    expect(repairGluedDomain('padaria.com.br')).toBeNull()
    expect(repairGluedDomain('gmail.com')).toBeNull()
    expect(repairGluedDomain('hooks.no')).toBeNull()
    expect(repairGluedDomain('business.shop')).toBeNull()
  })

  it('recovery needs DNS evidence on BOTH sides — dead original, alive candidate', async () => {
    const resolver: MxResolver = async (d) => {
      if (d === 'gmail.com') return mxRecord
      throw dnsError('ENOTFOUND')
    }
    const emails: ContactEmail[] = [
      { address: 'lead@gmail.comvisit', source_url: 'x', generic: false, mx: 'no_mx' },
      { address: 'ok@alive-c.test', source_url: 'x', generic: false, mx: 'ok' }, // healthy: untouched
      { address: 'dead@brokenzzz.comextra', source_url: 'x', generic: false, mx: 'no_mx' },
    ]
    const added = await recoverGluedEmails(emails, null, resolver)
    expect(added).toEqual(['lead@gmail.com'])
    const recovered = emails.find((e) => e.address === 'lead@gmail.com')
    expect(recovered).toMatchObject({ mx: 'ok', kind: 'freemail' })
    // the dead candidate (brokenzzz.com has no MX either) was NOT added
    expect(emails.some((e) => e.address === 'dead@brokenzzz.com')).toBe(false)
    // originals stay in place, still badged
    expect(emails.some((e) => e.address === 'lead@gmail.comvisit')).toBe(true)
  })
})

describe('classifyProviderEvent', () => {
  it('maps Resend last_event to terminal/pending', () => {
    expect(classifyProviderEvent('bounced')).toBe('dead')
    expect(classifyProviderEvent('complained')).toBe('dead')
    expect(classifyProviderEvent('delivered')).toBe('ok')
    for (const e of ['sent', 'delivery_delayed', 'opened', 'clicked', '']) {
      expect(classifyProviderEvent(e), e).toBe('pending')
    }
  })
})
