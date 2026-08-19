import { beforeAll, describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, hasEncryptionKey, isEncrypted, maskSecret, tryDecrypt } from './crypto'
import { addressLabel, secretUpdate, setSettingsForTests, settingsView } from './settings'

// A throwaway key: the module reads the environment on every call, so tests
// never touch the real one.
beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})

describe('credential encryption', () => {
  it('round-trips a secret and never stores it in the clear', () => {
    const plain = 're_live_1234567890abcdef'
    const cipher = encryptSecret(plain)
    expect(cipher).not.toContain(plain)
    expect(isEncrypted(cipher)).toBe(true)
    expect(cipher.startsWith('v1:')).toBe(true)
    expect(decryptSecret(cipher)).toBe(plain)
  })

  it('uses a fresh IV per value — the same secret never yields the same ciphertext', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })

  it('refuses a tampered ciphertext instead of returning garbage', () => {
    const cipher = encryptSecret('sk-ant-secret')
    const [v, iv, tag, data] = cipher.split(':')
    const flipped = Buffer.from(data, 'base64')
    flipped[0] ^= 0xff
    expect(() => decryptSecret([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow()
    expect(tryDecrypt([v, iv, tag, flipped.toString('base64')].join(':'))).toBeNull()
  })

  it('treats an unreadable or absent credential as "not configured"', () => {
    expect(tryDecrypt(null)).toBeNull()
    expect(tryDecrypt('')).toBeNull()
    expect(tryDecrypt('not-encrypted')).toBeNull()
  })

  it('rejects a key that is not 32 bytes', () => {
    const saved = process.env.APP_ENCRYPTION_KEY
    try {
      process.env.APP_ENCRYPTION_KEY = 'too-short'
      expect(hasEncryptionKey()).toBe(false)
      expect(() => encryptSecret('x')).toThrow(/APP_ENCRYPTION_KEY/)
      process.env.APP_ENCRYPTION_KEY = ''
      expect(() => encryptSecret('x')).toThrow(/missing/)
    } finally {
      process.env.APP_ENCRYPTION_KEY = saved
    }
  })

  it('masks a stored secret down to its last 4 characters', () => {
    expect(maskSecret('re_live_1234567890abcd')).toMatch(/^•+abcd$/)
    expect(maskSecret('')).toBeNull()
    expect(maskSecret(null)).toBeNull()
  })
})

describe('settings writes', () => {
  it('keeps the stored secret when the field was not edited', () => {
    const $set: Record<string, unknown> = {}
    secretUpdate('ai.anthropic_key_enc', undefined, $set)
    expect($set).toEqual({})
    // The UI echoes back the mask for untouched fields — storing it would
    // overwrite the real key with bullets.
    secretUpdate('ai.anthropic_key_enc', '••••••••cdef', $set)
    expect($set).toEqual({})
  })

  it('clears a secret on an explicit empty value and encrypts a new one', () => {
    const cleared: Record<string, unknown> = {}
    secretUpdate('email.resend_key_enc', '', cleared)
    expect(cleared).toEqual({ 'email.resend_key_enc': null })

    const written: Record<string, unknown> = {}
    secretUpdate('email.resend_key_enc', '  re_new_key  ', written)
    const stored = written['email.resend_key_enc'] as string
    expect(isEncrypted(stored)).toBe(true)
    expect(decryptSecret(stored)).toBe('re_new_key')
  })

  it('never exposes a credential to the browser', () => {
    setSettingsForTests({
      email: {
        mode: 'resend',
        resendKey: 're_live_secret_value',
        smtpPass: 'app-password-1234',
        from: { name: 'Leonardo', email: 'hello@acme.example', label: 'Leonardo <hello@acme.example>' },
      },
      ai: { anthropicKey: 'sk-ant-secret-key', model: 'claude-opus-5' },
      googlePlacesApiKey: 'AIzaPlacesKey',
      landing: { mongodbUri: 'mongodb+srv://user:pass@cluster/db', dbName: 'landing' },
    })
    const view = JSON.stringify(settingsView())
    for (const secret of [
      're_live_secret_value',
      'app-password-1234',
      'sk-ant-secret-key',
      'AIzaPlacesKey',
      'mongodb+srv://user:pass@cluster/db',
    ]) {
      expect(view, secret).not.toContain(secret)
    }
    // …while still telling the UI what is configured, and what it looks like.
    expect(settingsView().ai.anthropic_key_masked).toMatch(/key$/)
    expect(settingsView().ai.model).toBe('claude-opus-5')
    expect(settingsView().email.from_label).toBe('Leonardo <hello@acme.example>')
  })

  it('ships NO offer: brand, pitch, site and logo belong to the operator', () => {
    setSettingsForTests({ offer: { brandName: '', whatWeSell: '', siteUrl: '', logoUrl: '' } })
    const view = settingsView()
    expect(view.offer.brand_name).toBe('')
    expect(view.offer.what_we_sell).toBe('')
    expect(view.offer.site_url).toBe('')
    expect(view.offer.logo_url).toBe('')
  })

  it('concatenates the sender identity the way both transports expect', () => {
    expect(addressLabel('Leonardo', 'hello@acme.example')).toBe('Leonardo <hello@acme.example>')
    expect(addressLabel('  "Acme"  ', ' HELLO@Acme.Example ')).toBe('Acme <hello@acme.example>')
  })
})
