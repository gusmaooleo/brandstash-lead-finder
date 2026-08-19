import { describe, expect, it } from 'vitest'
import { generateRid, hashRid, isValidRid, maskTrackingHash, TRACKING_HASH_PATTERN } from './rid'

describe('rid generation', () => {
  it('produces 32 URL-safe characters', () => {
    for (let i = 0; i < 50; i++) {
      const rid = generateRid()
      expect(rid).toHaveLength(32)
      expect(rid).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(isValidRid(rid)).toBe(true)
    }
  })

  it('two sends to the SAME lead produce different rids and different hashes', () => {
    const first = generateRid()
    const second = generateRid()
    expect(second).not.toBe(first)
    expect(hashRid(second)).not.toBe(hashRid(first))
  })

  it('a resend produces a new hash every time', () => {
    const hashes = new Set(Array.from({ length: 20 }, () => hashRid(generateRid())))
    expect(hashes.size).toBe(20)
  })

  it('rejects short codes, PII-looking values and forbidden characters', () => {
    expect(isValidRid('ABCDE')).toBe(false)
    expect(isValidRid('user@example.com')).toBe(false)
    expect(isValidRid('a'.repeat(19))).toBe(false)
    expect(isValidRid('a'.repeat(129))).toBe(false)
    expect(isValidRid('a'.repeat(20))).toBe(true)
    expect(isValidRid('a'.repeat(128))).toBe(true)
  })
})

describe('tracking hash', () => {
  it('is sha256(rid, utf8) hex — exactly 64 lowercase hex chars, no extras', () => {
    const hash = hashRid(generateRid())
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(TRACKING_HASH_PATTERN)
    expect(hash).toBe(hash.toLowerCase())
    // Known vector: sha256("test") — proves no salt/HMAC/prefix/normalization.
    expect(hashRid('test')).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')
  })

  it('masking never reveals the middle of the hash', () => {
    const hash = hashRid(generateRid())
    const masked = maskTrackingHash(hash)
    expect(masked).toContain('…')
    expect(masked.length).toBeLessThan(20)
    expect(hash).toContain(masked.slice(0, 10))
  })
})
