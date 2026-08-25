import { beforeEach, describe, expect, it } from 'vitest'
import { generateRid } from '../tracking/rid'
import { addressLabel, setSettingsForTests } from '../settings/settings'
import { replyAddressForRid, ridFromReplyAddress } from './reply-address'

beforeEach(() => {
  setSettingsForTests({
    email: {
      from: { name: 'Leonardo', email: 'hello@acme.example', label: 'Leonardo <hello@acme.example>' },
      replyTo: { name: 'Leonardo', email: 'inbox@acme.example', label: 'Leonardo <inbox@acme.example>' },
    },
    replies: { enabled: true, receivingDomain: 'reply.acme.example', localPart: 'reply', resendKey: 're_test' },
  })
})

describe('reply correlation address', () => {
  it('builds and reads a private Reply-To without storing a different identifier', () => {
    const rid = generateRid()
    const address = replyAddressForRid(rid)
    expect(address).toBe(`Leonardo <reply-${rid.toLowerCase()}@reply.acme.example>`)
    expect(ridFromReplyAddress(address!)).toBe(rid.toLowerCase())
  })

  it('falls back to the configured inbox while tracking is unavailable', () => {
    setSettingsForTests({ replies: { enabled: false } })
    expect(replyAddressForRid(generateRid())).toBe(addressLabel('Leonardo', 'inbox@acme.example'))
  })

  it('rejects addresses from another domain or prefix', () => {
    const rid = generateRid()
    expect(ridFromReplyAddress(`reply-${rid}@other.example`)).toBeNull()
    expect(ridFromReplyAddress(`other-${rid}@reply.acme.example`)).toBeNull()
  })
})
