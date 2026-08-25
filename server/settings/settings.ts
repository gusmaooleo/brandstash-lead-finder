/**
 * Runtime settings — what used to be .env, now an encrypted document in
 * MongoDB that the owner edits in the app (Settings route). The environment
 * keeps only APP_PORT, MONGODB_URI and APP_ENCRYPTION_KEY.
 *
 * Reads are SYNCHRONOUS: the whole document is decrypted once at boot into an
 * in-memory snapshot and re-loaded on every write, so call sites keep the
 * shape they had with `config` and no hot path pays a database round-trip.
 *
 * A fresh database starts from the schema defaults — dry run, no credentials,
 * the shipped offer — so a new install can boot and be configured in the UI
 * without ever touching a file.
 */

import { AppSettings, type AppSettingsDoc } from './models'
import { encryptSecret, hasEncryptionKey, maskSecret, tryDecrypt } from './crypto'

export type EmailMode = 'dry_run' | 'smtp' | 'resend'

export type RuntimeSettings = {
  email: {
    mode: EmailMode
    /** `label` is the RFC form both transports send: `Name <email>`. */
    from: { name: string; email: string; label: string }
    replyTo: { name: string; email: string; label: string }
    resendKey: string
    smtpHost: string
    smtpPort: number
    smtpSecure: boolean
    smtpUser: string
    smtpPass: string
    unsubscribeBaseUrl: string
    /**
     * The disclosure block appended when a template carries no unsubscribe
     * link. Yours to word — may use {{unsubscribe_url}}. Empty = the bare
     * link goes out on its own, because a way out is never optional.
     */
    footerHtml: string
  }
  offer: {
    brandName: string
    whatWeSell: string
    siteUrl: string
    logoUrl: string
    useAnalysisInCopy: boolean
  }
  ai: { anthropicKey: string; model: string }
  googlePlacesApiKey: string
  leadsPerHour: number
  leadRetentionDays: number
  followupAfterDays: number
  /** Follow-ups after the initial email: 1–5. */
  followupSteps: number
  landing: { mongodbUri: string; dbName: string }
  replies: { enabled: boolean; receivingDomain: string; localPart: string; resendKey: string }
}

/** `Name <email>` — the one place the two fields are concatenated. */
export function addressLabel(name: string, email: string): string {
  const trimmedEmail = email.trim().toLowerCase()
  if (!trimmedEmail) return ''
  const display = name.trim().replace(/^"(.*)"$/, '$1').trim()
  return display ? `${display} <${trimmedEmail}>` : trimmedEmail
}

/**
 * A fresh install ships with NO offer: the brand, the pitch, the site and the
 * logo are the operator's own and are entered in Settings → Offer. Nothing
 * here names a company.
 */
const DEFAULT_OFFER = {
  brandName: '',
  whatWeSell: '',
  siteUrl: '',
  logoUrl: '',
  useAnalysisInCopy: true,
}

let snapshot: RuntimeSettings | null = null

function toSnapshot(doc: AppSettingsDoc): RuntimeSettings {
  const e = doc.email
  const fromName = e?.from_name ?? ''
  const fromEmail = e?.from_email ?? ''
  const replyName = e?.reply_to_name ?? ''
  const replyEmail = e?.reply_to_email ?? ''
  return {
    email: {
      mode: (e?.mode as EmailMode) ?? 'dry_run',
      from: { name: fromName, email: fromEmail, label: addressLabel(fromName, fromEmail) },
      replyTo: { name: replyName, email: replyEmail, label: addressLabel(replyName, replyEmail) },
      resendKey: tryDecrypt(e?.resend_key_enc) ?? '',
      smtpHost: e?.smtp_host ?? '',
      smtpPort: e?.smtp_port ?? 587,
      smtpSecure: Boolean(e?.smtp_secure),
      smtpUser: e?.smtp_user ?? '',
      smtpPass: tryDecrypt(e?.smtp_pass_enc) ?? '',
      unsubscribeBaseUrl: (e?.unsubscribe_base_url ?? 'http://localhost:4000').replace(/\/$/, ''),
      footerHtml: e?.footer_html ?? '',
    },
    offer: {
      brandName: doc.offer?.brand_name || DEFAULT_OFFER.brandName,
      whatWeSell: doc.offer?.what_we_sell || DEFAULT_OFFER.whatWeSell,
      siteUrl: (doc.offer?.site_url || DEFAULT_OFFER.siteUrl).replace(/\/$/, ''),
      logoUrl: doc.offer?.logo_url ?? DEFAULT_OFFER.logoUrl,
      useAnalysisInCopy: doc.offer?.use_analysis_in_copy !== false,
    },
    ai: { anthropicKey: tryDecrypt(doc.ai?.anthropic_key_enc) ?? '', model: doc.ai?.model ?? '' },
    googlePlacesApiKey: tryDecrypt(doc.places?.api_key_enc) ?? '',
    leadsPerHour: doc.discovery?.leads_per_hour ?? 10,
    leadRetentionDays: doc.discovery?.lead_retention_days ?? 45,
    followupAfterDays: doc.discovery?.followup_after_days ?? 3,
    followupSteps: Math.min(5, Math.max(1, doc.discovery?.followup_steps ?? 2)),
    landing: {
      mongodbUri: tryDecrypt(doc.landing?.mongodb_uri_enc) ?? '',
      dbName: doc.landing?.db_name ?? 'brandstash_leads',
    },
    replies: {
      enabled: Boolean(doc.replies?.enabled),
      receivingDomain: doc.replies?.receiving_domain ?? '',
      localPart: doc.replies?.local_part ?? 'reply',
      resendKey: tryDecrypt(doc.replies?.resend_key_enc) ?? (tryDecrypt(e?.resend_key_enc) ?? ''),
    },
  }
}

/**
 * Loads and caches the snapshot, creating the document on first run with the
 * schema defaults (dry run, no credentials, the shipped offer). There is
 * nothing to import from the environment: the app is configured in Settings.
 */
export async function loadSettings(): Promise<RuntimeSettings> {
  const doc = (await AppSettings.findOneAndUpdate(
    { _id: 'settings' },
    { $setOnInsert: { _id: 'settings' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )) as AppSettingsDoc
  snapshot = toSnapshot(doc)
  return snapshot
}

/**
 * The cached settings. Available after loadSettings() ran at boot; falls back
 * to an empty configuration (dry run, no keys) so a unit test importing a
 * module that reads settings never explodes.
 */
export function settings(): RuntimeSettings {
  return snapshot ?? EMPTY_SETTINGS
}

const EMPTY_SETTINGS: RuntimeSettings = {
  email: {
    mode: 'dry_run',
    from: { name: '', email: '', label: '' },
    replyTo: { name: '', email: '', label: '' },
    resendKey: '',
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: '',
    smtpPass: '',
    unsubscribeBaseUrl: 'http://localhost:4000',
    footerHtml: '',
  },
  offer: { ...DEFAULT_OFFER },
  ai: { anthropicKey: '', model: '' },
  googlePlacesApiKey: '',
  leadsPerHour: 10,
  leadRetentionDays: 45,
  followupAfterDays: 3,
  followupSteps: 2,
  landing: { mongodbUri: '', dbName: 'brandstash_leads' },
  replies: { enabled: false, receivingDomain: '', localPart: 'reply', resendKey: '' },
}

/**
 * Test seam — replaces the cached snapshot without a database, exactly as
 * loadSettings() does with one. Production code never calls this.
 */
export function setSettingsForTests(patch: DeepPartial<RuntimeSettings>): RuntimeSettings {
  const base = settings()
  snapshot = {
    ...base,
    ...patch,
    email: { ...base.email, ...patch.email, from: { ...base.email.from, ...patch.email?.from }, replyTo: { ...base.email.replyTo, ...patch.email?.replyTo } },
    ai: { ...base.ai, ...patch.ai },
    landing: { ...base.landing, ...patch.landing },
    replies: { ...base.replies, ...patch.replies },
  } as RuntimeSettings
  return snapshot
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

/* ── the shape the Settings screen reads and writes ─────────────────────── */

export type SettingsView = {
  email: {
    mode: EmailMode
    from_name: string
    from_email: string
    /** Preview of what recipients see — `Name <email>`. */
    from_label: string
    reply_to_name: string
    reply_to_email: string
    reply_to_label: string
    resend_key_masked: string | null
    smtp_host: string
    smtp_port: number
    smtp_secure: boolean
    smtp_user: string
    smtp_pass_masked: string | null
    unsubscribe_base_url: string
    footer_html: string
  }
  offer: {
    brand_name: string
    what_we_sell: string
    site_url: string
    logo_url: string
    use_analysis_in_copy: boolean
  }
  ai: { anthropic_key_masked: string | null; model: string }
  places: { api_key_masked: string | null }
  discovery: { leads_per_hour: number; lead_retention_days: number; followup_after_days: number; followup_steps: number }
  landing: { mongodb_uri_masked: string | null; db_name: string }
  replies: {
    enabled: boolean
    receiving_domain: string
    local_part: string
    resend_key_masked: string | null
    ready: boolean
    not_ready_reason: string | null
  }
  /** False = secrets cannot be stored; the UI must say so instead of failing. */
  encryption_ready: boolean
}

export function settingsView(): SettingsView {
  const s = settings()
  const replyState = replyTrackingReady(s)
  return {
    email: {
      mode: s.email.mode,
      from_name: s.email.from.name,
      from_email: s.email.from.email,
      from_label: s.email.from.label,
      reply_to_name: s.email.replyTo.name,
      reply_to_email: s.email.replyTo.email,
      reply_to_label: s.email.replyTo.label,
      resend_key_masked: maskSecret(s.email.resendKey || null),
      smtp_host: s.email.smtpHost,
      smtp_port: s.email.smtpPort,
      smtp_secure: s.email.smtpSecure,
      smtp_user: s.email.smtpUser,
      smtp_pass_masked: maskSecret(s.email.smtpPass || null),
      unsubscribe_base_url: s.email.unsubscribeBaseUrl,
      footer_html: s.email.footerHtml,
    },
    offer: {
      brand_name: s.offer.brandName,
      what_we_sell: s.offer.whatWeSell,
      site_url: s.offer.siteUrl,
      logo_url: s.offer.logoUrl,
      use_analysis_in_copy: s.offer.useAnalysisInCopy,
    },
    ai: { anthropic_key_masked: maskSecret(s.ai.anthropicKey || null), model: s.ai.model },
    places: { api_key_masked: maskSecret(s.googlePlacesApiKey || null) },
    discovery: {
      leads_per_hour: s.leadsPerHour,
      lead_retention_days: s.leadRetentionDays,
      followup_after_days: s.followupAfterDays,
      followup_steps: s.followupSteps,
    },
    landing: { mongodb_uri_masked: maskSecret(s.landing.mongodbUri || null), db_name: s.landing.dbName },
    replies: {
      enabled: s.replies.enabled,
      receiving_domain: s.replies.receivingDomain,
      local_part: s.replies.localPart,
      resend_key_masked: maskSecret(s.replies.resendKey || null),
      ready: replyState.ready,
      not_ready_reason: replyState.reason,
    },
    encryption_ready: hasEncryptionKey(),
  }
}

/** A secret field: absent = keep what is stored, '' = clear it. */
export type SecretInput = string | null | undefined

export type SettingsPatch = {
  email?: Partial<{
    mode: EmailMode
    from_name: string
    from_email: string
    reply_to_name: string
    reply_to_email: string
    resend_key: SecretInput
    smtp_host: string
    smtp_port: number
    smtp_secure: boolean
    smtp_user: string
    smtp_pass: SecretInput
    unsubscribe_base_url: string
    footer_html: string
  }>
  offer?: Partial<{
    brand_name: string
    what_we_sell: string
    site_url: string
    logo_url: string
    use_analysis_in_copy: boolean
  }>
  ai?: Partial<{ anthropic_key: SecretInput; model: string }>
  places?: Partial<{ api_key: SecretInput }>
  discovery?: Partial<{ leads_per_hour: number; lead_retention_days: number; followup_after_days: number; followup_steps: number }>
  landing?: Partial<{ mongodb_uri: SecretInput; db_name: string }>
  replies?: Partial<{ enabled: boolean; receiving_domain: string; local_part: string; resend_key: SecretInput }>
}

/** Builds the `$set` for one secret: untouched / cleared / re-encrypted. */
export function secretUpdate(path: string, value: SecretInput, out: Record<string, unknown>): void {
  if (value === undefined) return
  const trimmed = (value ?? '').trim()
  // The UI sends back the mask when the field wasn't edited — never store it.
  if (trimmed.startsWith('•')) return
  out[path] = trimmed ? encryptSecret(trimmed) : null
}

const POSITIVE_INT = (value: unknown, fallback: number): number => {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export async function updateSettings(patch: SettingsPatch): Promise<RuntimeSettings> {
  const current = settings()
  const $set: Record<string, unknown> = {}

  if (patch.email) {
    const e = patch.email
    if (e.mode && ['dry_run', 'smtp', 'resend'].includes(e.mode)) $set['email.mode'] = e.mode
    if (e.from_name !== undefined) $set['email.from_name'] = String(e.from_name).trim()
    if (e.from_email !== undefined) $set['email.from_email'] = String(e.from_email).trim().toLowerCase()
    if (e.reply_to_name !== undefined) $set['email.reply_to_name'] = String(e.reply_to_name).trim()
    if (e.reply_to_email !== undefined) $set['email.reply_to_email'] = String(e.reply_to_email).trim().toLowerCase()
    if (e.smtp_host !== undefined) $set['email.smtp_host'] = String(e.smtp_host).trim()
    if (e.smtp_port !== undefined) $set['email.smtp_port'] = POSITIVE_INT(e.smtp_port, current.email.smtpPort)
    if (e.smtp_secure !== undefined) $set['email.smtp_secure'] = Boolean(e.smtp_secure)
    if (e.smtp_user !== undefined) $set['email.smtp_user'] = String(e.smtp_user).trim()
    if (e.footer_html !== undefined) $set['email.footer_html'] = String(e.footer_html)
    if (e.unsubscribe_base_url !== undefined) {
      $set['email.unsubscribe_base_url'] = String(e.unsubscribe_base_url).trim().replace(/\/$/, '')
    }
    secretUpdate('email.resend_key_enc', e.resend_key, $set)
    secretUpdate('email.smtp_pass_enc', e.smtp_pass, $set)
  }

  if (patch.offer) {
    const o = patch.offer
    if (o.brand_name !== undefined) $set['offer.brand_name'] = String(o.brand_name).trim()
    if (o.what_we_sell !== undefined) $set['offer.what_we_sell'] = String(o.what_we_sell).trim()
    if (o.site_url !== undefined) $set['offer.site_url'] = String(o.site_url).trim().replace(/\/$/, '')
    if (o.logo_url !== undefined) $set['offer.logo_url'] = String(o.logo_url).trim()
    if (o.use_analysis_in_copy !== undefined) $set['offer.use_analysis_in_copy'] = Boolean(o.use_analysis_in_copy)
  }

  if (patch.ai) {
    if (patch.ai.model !== undefined) $set['ai.model'] = String(patch.ai.model).trim()
    secretUpdate('ai.anthropic_key_enc', patch.ai.anthropic_key, $set)
  }

  if (patch.places) secretUpdate('places.api_key_enc', patch.places.api_key, $set)

  if (patch.discovery) {
    const d = patch.discovery
    if (d.leads_per_hour !== undefined) {
      $set['discovery.leads_per_hour'] = POSITIVE_INT(d.leads_per_hour, current.leadsPerHour)
    }
    if (d.lead_retention_days !== undefined) {
      $set['discovery.lead_retention_days'] = POSITIVE_INT(d.lead_retention_days, current.leadRetentionDays)
    }
    if (d.followup_steps !== undefined) {
      $set['discovery.followup_steps'] = Math.min(5, Math.max(1, POSITIVE_INT(d.followup_steps, current.followupSteps)))
    }
    if (d.followup_after_days !== undefined) {
      $set['discovery.followup_after_days'] = POSITIVE_INT(d.followup_after_days, current.followupAfterDays)
    }
  }

  if (patch.landing) {
    if (patch.landing.db_name !== undefined) $set['landing.db_name'] = String(patch.landing.db_name).trim()
    secretUpdate('landing.mongodb_uri_enc', patch.landing.mongodb_uri, $set)
  }

  if (patch.replies) {
    const r = patch.replies
    if (r.enabled !== undefined) $set['replies.enabled'] = Boolean(r.enabled)
    if (r.receiving_domain !== undefined) {
      const domain = String(r.receiving_domain).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
      if (domain && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
        throw new Error('Receiving domain must be a valid domain name')
      }
      $set['replies.receiving_domain'] = domain
    }
    if (r.local_part !== undefined) {
      const localPart = String(r.local_part).trim().toLowerCase()
      if (!/^[a-z0-9][a-z0-9._-]{0,19}$/.test(localPart)) {
        throw new Error('Reply address prefix must use letters, numbers, dots, underscores or hyphens')
      }
      $set['replies.local_part'] = localPart
    }
    secretUpdate('replies.resend_key_enc', r.resend_key, $set)
  }

  if (Object.keys($set).length) {
    await AppSettings.updateOne({ _id: 'settings' }, { $set }, { upsert: true })
  }
  return loadSettings()
}

/** Live mode banner: what the app WILL do with the current credentials. */
export function emailModeReady(s: RuntimeSettings = settings()): { ready: boolean; reason: string | null } {
  if (!s.email.from.email) return { ready: false, reason: 'sender email is not set' }
  if (s.email.mode === 'resend' && !s.email.resendKey) return { ready: false, reason: 'Resend API key is not set' }
  if (s.email.mode === 'smtp' && !(s.email.smtpHost && s.email.smtpUser && s.email.smtpPass)) {
    return { ready: false, reason: 'SMTP host, user or password is missing' }
  }
  return { ready: true, reason: null }
}

export function replyTrackingReady(s: RuntimeSettings = settings()): { ready: boolean; reason: string | null } {
  if (!s.replies.enabled) return { ready: false, reason: 'Reply tracking is off' }
  if (!s.replies.receivingDomain) return { ready: false, reason: 'Receiving domain is not set' }
  if (!s.replies.resendKey) return { ready: false, reason: 'Resend API key is not set' }
  return { ready: true, reason: null }
}

/** Only ever used by the bootstrap log line — never prints a secret. */
export function settingsSummary(s: RuntimeSettings = settings()): string {
  const parts = [
    `email: ${s.email.mode}`,
    s.email.from.email ? `from ${s.email.from.email}` : 'from (unset)',
    s.googlePlacesApiKey ? 'places key ok' : 'places key MISSING',
    s.ai.anthropicKey ? `ai ${s.ai.model || '(model unset)'}` : 'ai key unset',
  ]
  return parts.join(' · ')
}
