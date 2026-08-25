import { describe, expect, it } from 'vitest'
import { generateRid, hashRid, TRACKING_HASH_PATTERN } from './rid'
import { buildSendRecord } from './send-log'
import { sanitizeDbError } from './landing-db'

const lead = {
  place_id: 'ChIJrecord1',
  name: 'Padaria Central',
  language: 'pt',
  market_scope: 'portuguese',
  discovery: { search_category: 'Bakery' },
} as never

describe('persisted send record', () => {
  it('contains ONLY the hash — the raw rid is never a field or value', () => {
    const rid = generateRid()
    const record = buildSendRecord(
      { lead, recipient: 'contato@padaria.com.br', followupNumber: 0 },
      hashRid(rid),
    )
    const json = JSON.stringify(record)
    expect(json).not.toContain(rid)
    expect(Object.keys(record)).not.toContain('rid')
    expect(record.tracking_id_hash).toBe(hashRid(rid))
    expect(String(record.tracking_id_hash)).toMatch(TRACKING_HASH_PATTERN)
    expect(record.tracking_schema_version).toBe(1)
    expect(record.status).toBe('queued')
  })

  it('carries the attribution metadata of the individual send', () => {
    const record = buildSendRecord(
      { lead, recipient: 'a@b.co', followupNumber: 2 },
      hashRid(generateRid()),
    )
    expect(record.campaign).toBe('leadfinder_portuguese')
    // No template resolved yet: the id is filled in by beginTrackedSend.
    expect(record.template_id).toBe('unresolved')
    expect(record.followup).toBe(2)
    expect(record.attempt).toBe(3)
    expect(record.place_id).toBe('ChIJrecord1')
    expect(record.search_category).toBe('Bakery')
  })

  it('two records for the SAME lead never share a hash', () => {
    const a = buildSendRecord({ lead, recipient: 'a@b.co', followupNumber: 0 }, hashRid(generateRid()))
    const b = buildSendRecord({ lead, recipient: 'a@b.co', followupNumber: 1 }, hashRid(generateRid()))
    expect(a.tracking_id_hash).not.toBe(b.tracking_id_hash)
  })
})

describe('landing store error sanitization (Atlas failure ≠ "no visit")', () => {
  // Synthetic on purpose: `.invalid` is the reserved TLD that can never
  // resolve (RFC 2606), so nobody reading this file can mistake the fixture
  // for a real cluster. The real URI lives encrypted in app_settings and is
  // never written down — here or anywhere else.
  const FAKE_URI = 'mongodb+srv://example-user:example-password@cluster.example.invalid/example-db'

  it('never leaks the connection URI or credentials', () => {
    const clean = sanitizeDbError(`connection refused ${FAKE_URI}`)
    expect(clean).not.toContain('example-password')
    expect(clean).not.toContain('example-user')
    expect(clean).not.toContain('cluster.example.invalid')
    expect(clean).toContain('[mongodb-uri]')
  })

  it('leaves a message that carries no URI untouched', () => {
    expect(sanitizeDbError('connection refused')).toBe('connection refused')
  })
})
