/**
 * Settings — route: /settings
 *
 * Every credential the app needs, edited here and stored ENCRYPTED in MongoDB
 * (server/settings). The browser only ever sees masks: an untouched secret
 * field shows •••• and is sent back unchanged, which the server ignores.
 *
 * Layout: the services that hold a key first (Claude, Google, MongoDB), then
 * the identity recipients actually see, then discovery rate — and, below a
 * divider, the technical sending transport (Resend vs SMTP).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getCategories,
  getSettings,
  getTemplates,
  listAnthropicModels,
  saveSettings,
  type AnthropicModel,
  type AppSettings,
  type AppSettingsPatch,
  type TemplateLibrary,
} from '../api'
import { Button, Chip, Input, Select } from './ui'
import { ClaudeIcon, GoogleIcon, MongoIcon } from './BrandIcons'
import { ThemeToggle, useTheme } from './ThemeToggle'
import { TemplatesTab } from './SettingsTemplates'
import { GenerateTab } from './SettingsGenerate'

type Tab = 'credentials' | 'templates' | 'generate'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'credentials', label: 'Credentials' },
  { key: 'templates', label: 'Email templates' },
  { key: 'generate', label: 'Generate' },
]

/** A secret input: starts masked, becomes editable once the owner touches it. */
function SecretField({
  label,
  hint,
  masked,
  value,
  onChange,
  placeholder,
}: {
  label: string
  hint?: string
  masked: string | null
  value: string | undefined
  onChange: (next: string | undefined) => void
  placeholder?: string
}) {
  const editing = value !== undefined
  return (
    <label className="grid auto-rows-min content-start gap-1">
      <span className="text-[11.5px] text-gray-2">{label}</span>
      <span className="flex items-center gap-1.5">
        <Input
          className="min-w-0 flex-1 font-mono !text-[12px]"
          type={editing ? 'text' : 'text'}
          value={editing ? value : (masked ?? '')}
          placeholder={placeholder ?? (masked ? '' : 'not set')}
          readOnly={!editing}
          spellCheck={false}
          autoComplete="off"
          onFocus={() => !editing && onChange('')}
          onChange={(e) => onChange(e.target.value)}
        />
        {editing && (
          <button
            className="shrink-0 text-[11.5px] text-gray-2 underline-offset-2 hover:text-ink hover:underline"
            onClick={() => onChange(undefined)}
            title="Discard this change and keep the stored value"
          >
            cancel
          </button>
        )}
      </span>
      {hint && <span className="text-[11px] text-gray-3">{hint}</span>}
    </label>
  )
}

/**
 * One labelled control. `content-start` + `auto-rows-min` keep the input the
 * same height in every cell of a grid row: without it a field carrying a hint
 * stretches its neighbour's input to match, which is what made the sender
 * identity look ragged.
 */
function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="grid auto-rows-min content-start gap-1">
      <span className="text-[11.5px] text-gray-2">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-gray-3">{hint}</span>}
    </label>
  )
}

function Card({
  icon,
  title,
  subtitle,
  children,
}: {
  icon?: React.ReactNode
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <header className="mb-3.5 flex items-center gap-2">
        {icon}
        <h2 className="text-[14px] font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle && <span className="text-[11.5px] text-gray-3">· {subtitle}</span>}
      </header>
      <div className="grid gap-3.5">{children}</div>
    </section>
  )
}

export function SettingsPage() {
  const navigate = useNavigate()
  const [theme, toggleTheme] = useTheme()
  const [stored, setStored] = useState<AppSettings | null>(null)
  const [patch, setPatch] = useState<AppSettingsPatch>({})
  const [models, setModels] = useState<AnthropicModel[]>([])
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('credentials')
  const [library, setLibrary] = useState<TemplateLibrary | null>(null)
  const [catalog, setCatalog] = useState<string[]>([])
  const loadedOnce = useRef(false)

  const load = useCallback(async () => {
    try {
      setStored(await getSettings())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const loadLibrary = useCallback(async () => {
    try {
      setLibrary(await getTemplates())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
    void loadLibrary()
    void getCategories()
      .then((r) => setCatalog(r.categories))
      .catch(() => {})
  }, [load, loadLibrary])

  // Esc leaves the page, like every other secondary route.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0) navigate(-1)
      else navigate('/')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  /** Current value of a field: the pending edit, else what is stored. */
  const val = <S extends keyof AppSettings, K extends string>(section: S, key: K): unknown => {
    const pending = (patch as Record<string, Record<string, unknown>>)[section as string]?.[key]
    if (pending !== undefined) return pending
    return (stored as unknown as Record<string, Record<string, unknown>>)?.[section as string]?.[key]
  }
  const set = (section: keyof AppSettingsPatch, key: string, value: unknown) =>
    setPatch((p) => ({ ...p, [section]: { ...(p[section] as object), [key]: value } }))
  const secret = (section: keyof AppSettingsPatch, key: string): string | undefined =>
    (patch as Record<string, Record<string, string | undefined>>)[section as string]?.[key]
  const setSecret = (section: keyof AppSettingsPatch, key: string, value: string | undefined) =>
    setPatch((p) => {
      const next = { ...(p[section] as Record<string, unknown>) }
      if (value === undefined) delete next[key]
      else next[key] = value
      const cleaned = { ...p, [section]: next }
      if (!Object.keys(next).length) delete cleaned[section]
      return cleaned
    })

  const dirty = Object.keys(patch).length > 0
  const mode = (val('email', 'mode') as AppSettings['email']['mode']) ?? 'dry_run'

  const loadModels = useCallback(async () => {
    setLoadingModels(true)
    setModelsError(null)
    try {
      const key = secret('ai', 'anthropic_key')
      const res = await listAnthropicModels(key && key.trim() ? key.trim() : undefined)
      setModels(res.models)
      if (!loadedOnce.current) loadedOnce.current = true
    } catch (e) {
      setModels([])
      setModelsError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingModels(false)
    }
  }, [patch])

  // Fetch the model list once, as soon as a key is known to exist.
  useEffect(() => {
    if (stored?.ai.anthropic_key_masked && !loadedOnce.current && !loadingModels) void loadModels()
  }, [stored, loadModels, loadingModels])

  const onSave = async () => {
    setSaving(true)
    setError(null)
    try {
      setStored(await saveSettings(patch))
      setPatch({})
      setSavedAt(new Date().toLocaleTimeString())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const senderPreview = useMemo(() => {
    const name = String(val('email', 'from_name') ?? '').trim()
    const email = String(val('email', 'from_email') ?? '').trim().toLowerCase()
    if (!email) return '—'
    return name ? `${name} <${email}>` : email
  }, [patch, stored])

  const replyPreview = useMemo(() => {
    const name = String(val('email', 'reply_to_name') ?? '').trim()
    const email = String(val('email', 'reply_to_email') ?? '').trim().toLowerCase()
    if (!email) return 'no Reply-To header'
    return name ? `${name} <${email}>` : email
  }, [patch, stored])

  if (!stored) {
    return (
      <div className="flex h-screen items-center justify-center bg-paper text-[13px] text-gray-2">
        {error ?? 'Loading settings…'}
      </div>
    )
  }

  const modelValue = String(val('ai', 'model') ?? '')

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1100px] items-center gap-3 px-5 py-3">
          <Button variant="ghost" className="!px-3 !py-1.5 !text-[12px]" onClick={() => navigate('/')}>
            ← Dashboard
          </Button>
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-bold tracking-tight">Settings</span>
            <span className="hidden text-[12px] text-gray-3 sm:inline">
              credentials are stored encrypted in MongoDB
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            {tab === 'credentials' && savedAt && !dirty && <Chip className="tint-good">saved {savedAt}</Chip>}
            {tab === 'credentials' && dirty && <Chip className="tint-warn">unsaved changes</Chip>}
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            {tab === 'credentials' && (
              <Button variant="green" disabled={!dirty || saving} onClick={onSave}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            )}
          </div>
        </div>
      </header>

      <nav className="border-b border-line bg-paper">
        <div className="mx-auto flex w-full max-w-[1240px] gap-1 px-5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3.5 py-2.5 text-[12.5px] transition-colors ${
                tab === t.key ? 'border-ink text-ink' : 'border-transparent text-gray-2 hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {tab !== 'credentials' && (
        <main className="mx-auto grid w-full max-w-[1240px] gap-4 px-5 py-5">
          {!library ? (
            <div className="px-1 py-8 text-center text-[12.5px] text-gray-3">Loading templates…</div>
          ) : tab === 'templates' ? (
            <TemplatesTab
              library={library}
              catalog={catalog}
              senderName={stored.email.from_name || 'Brandstash'}
              senderEmail={stored.email.from_email || 'get@brandstash.ai'}
              onChanged={loadLibrary}
            />
          ) : (
            <GenerateTab
              library={library}
              catalog={catalog}
              senderName={stored.email.from_name || 'Brandstash'}
              senderEmail={stored.email.from_email || 'get@brandstash.ai'}
              onSaved={async () => {
                await loadLibrary()
                setTab('templates')
              }}
              onOpenCredentials={() => setTab('credentials')}
            />
          )}
        </main>
      )}

      {tab === 'credentials' && (
      <main className="mx-auto grid w-full max-w-[1100px] gap-4 px-5 py-5">
        {!stored.encryption_ready && (
          <div className="rounded-xl border tint-bad px-4 py-3 text-[12.5px]">
            APP_ENCRYPTION_KEY is not set on the server — credentials cannot be saved. Generate one with{' '}
            <code className="font-mono">openssl rand -base64 32</code>, put it in <code className="font-mono">.env</code>{' '}
            and restart.
          </div>
        )}
        {error && <div className="rounded-xl border tint-bad px-4 py-3 text-[12.5px]">{error}</div>}

        {/* ── who is sending, and what they sell ── */}
        <Card title="Offer" subtitle="who you are and what you sell">
          <div className="grid items-start gap-3.5 sm:grid-cols-2">
            <Field label="Brand name" hint="Signs the emails and brands the report template.">
              <Input
                value={String(val('offer', 'brand_name') ?? '')}
                onChange={(e) => set('offer', 'brand_name', e.target.value)}
              />
            </Field>
            <Field label="Site URL" hint="Base of every tracked link in an outreach email.">
              <Input
                value={String(val('offer', 'site_url') ?? '')}
                onChange={(e) => set('offer', 'site_url', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Logo URL" hint="Used by the report template and available to generated copy as {{logo_url}}.">
            <Input
              className="font-mono !text-[12px]"
              value={String(val('offer', 'logo_url') ?? '')}
              onChange={(e) => set('offer', 'logo_url', e.target.value)}
            />
          </Field>
          <Field
            label="What you sell"
            hint="One paragraph. This is the context Claude writes from in the Generate tab."
          >
            <textarea
              className="h-28 w-full rounded-lg border border-line bg-paper-2 px-2.5 py-2 text-[12.5px] leading-relaxed text-ink outline-none focus:border-line-2"
              value={String(val('offer', 'what_we_sell') ?? '')}
              onChange={(e) => set('offer', 'what_we_sell', e.target.value)}
            />
          </Field>
          <label className="flex items-start gap-2 rounded-xl border border-line bg-paper-2 px-3.5 py-2.5 text-[12px] text-gray-1">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={Boolean(val('offer', 'use_analysis_in_copy'))}
              onChange={(e) => set('offer', 'use_analysis_in_copy', e.target.checked)}
            />
            <span>
              Let the copy use the Google profile analysis
              <span className="mt-0.5 block text-[11px] text-gray-3">
                Every lead is always analysed and scored — that is what ranks the queue. This only decides whether
                generated emails may lean on it (the score and the findings) as the hook, or must sell on the offer
                alone.
              </span>
            </span>
          </label>
        </Card>

        {/* ── service credentials ── */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card icon={<ClaudeIcon className="size-4" />} title="Claude" subtitle="writes the email templates">
            <SecretField
              label="Anthropic API key"
              masked={stored.ai.anthropic_key_masked}
              value={secret('ai', 'anthropic_key')}
              onChange={(v) => setSecret('ai', 'anthropic_key', v)}
              placeholder="sk-ant-…"
            />
            <Field
              label="Model"
              hint={
                modelsError
                  ? modelsError
                  : models.length
                    ? `${models.length} models available to this key`
                    : 'Load the list to pick a model this key can use.'
              }
            >
              <span className="flex items-center gap-1.5">
                <Select
                  className="min-w-0 flex-1"
                  value={modelValue}
                  onChange={(e) => set('ai', 'model', e.target.value)}
                >
                  <option value="">{modelValue ? modelValue : 'not set'}</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name} — {m.id}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="ghost"
                  className="!px-3 !py-1.5 !text-[12px]"
                  disabled={loadingModels}
                  onClick={() => void loadModels()}
                >
                  {loadingModels ? '…' : 'Load models'}
                </Button>
              </span>
            </Field>
          </Card>

          <Card icon={<GoogleIcon className="size-4" />} title="Google Places" subtitle="lead discovery">
            <SecretField
              label="Places API key"
              hint="Server-side only: Text Search + Place Details with minimal field masks."
              masked={stored.places.api_key_masked}
              value={secret('places', 'api_key')}
              onChange={(v) => setSecret('places', 'api_key', v)}
              placeholder="AIza…"
            />
          </Card>

          <Card icon={<MongoIcon className="size-3.5" />} title="Landing database" subtitle="visit attribution">
            <SecretField
              label="MongoDB URI"
              hint="Read-only user is enough. Empty = read events from the lead finder's own database."
              masked={stored.landing.mongodb_uri_masked}
              value={secret('landing', 'mongodb_uri')}
              onChange={(v) => setSecret('landing', 'mongodb_uri', v)}
              placeholder="paste the read-only connection string"
            />
            <Field label="Database name">
              <Input
                value={String(val('landing', 'db_name') ?? '')}
                onChange={(e) => set('landing', 'db_name', e.target.value)}
              />
            </Field>
          </Card>

          <Card title="Discovery" subtitle="rate & housekeeping">
            <div className="grid gap-3.5">
              <Field label="Leads / hour" hint="New leads queued per hourly window; discovery pauses when it is full.">
                <Input
                  type="number"
                  min={1}
                  value={String(val('discovery', 'leads_per_hour') ?? '')}
                  onChange={(e) => set('discovery', 'leads_per_hour', Number(e.target.value))}
                />
              </Field>
              <Field label="Follow-up after (days)" hint="Days after a send before the lead is due for its next touch.">
                <Input
                  type="number"
                  min={1}
                  value={String(val('discovery', 'followup_after_days') ?? '')}
                  onChange={(e) => set('discovery', 'followup_after_days', Number(e.target.value))}
                />
              </Field>
              <Field label="Archive pending after (days)" hint="Stale pending leads are hidden (reopenable), never deleted.">
                <Input
                  type="number"
                  min={1}
                  value={String(val('discovery', 'lead_retention_days') ?? '')}
                  onChange={(e) => set('discovery', 'lead_retention_days', Number(e.target.value))}
                />
              </Field>
            </div>
          </Card>
        </div>

        {/* ── the identity recipients see ── */}
        <Card title="Sender identity" subtitle="what the recipient sees">
          <div className="grid items-start gap-3.5 sm:grid-cols-2">
            <Field label="From — name">
              <Input
                value={String(val('email', 'from_name') ?? '')}
                placeholder="Leonardo"
                onChange={(e) => set('email', 'from_name', e.target.value)}
              />
            </Field>
            <Field label="From — email">
              <Input
                value={String(val('email', 'from_email') ?? '')}
                placeholder="get@brandstash.ai"
                onChange={(e) => set('email', 'from_email', e.target.value)}
              />
            </Field>
            <Field label="Reply-To — name">
              <Input
                value={String(val('email', 'reply_to_name') ?? '')}
                onChange={(e) => set('email', 'reply_to_name', e.target.value)}
              />
            </Field>
            <Field label="Reply-To — email">
              <Input
                value={String(val('email', 'reply_to_email') ?? '')}
                onChange={(e) => set('email', 'reply_to_email', e.target.value)}
              />
            </Field>
          </div>
          <span className="-mt-1 text-[11px] text-gray-3">
            Reply-To is optional — leave its email empty for no Reply-To header.
          </span>
          <div className="rounded-xl border border-line bg-paper-2 px-3.5 py-2.5 text-[12px]">
            <div className="text-gray-2">
              From: <span className="font-mono text-ink">{senderPreview}</span>
            </div>
            <div className="mt-0.5 text-gray-2">
              Reply-To: <span className="font-mono text-ink">{replyPreview}</span>
            </div>
          </div>
          <Field label="Unsubscribe base URL" hint="Builds the one-click unsubscribe link in every email.">
            <Input
              value={String(val('email', 'unsubscribe_base_url') ?? '')}
              onChange={(e) => set('email', 'unsubscribe_base_url', e.target.value)}
            />
          </Field>
        </Card>

        {/* ── technical: how the mail actually leaves ── */}
        <div className="mt-2 flex items-center gap-3">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-gray-3">
            Delivery — technical
          </span>
          <span className="h-px flex-1 bg-line" />
          {stored.email_ready ? (
            <Chip className="tint-good">{stored.email.mode} ready</Chip>
          ) : (
            <Chip className="tint-warn">{stored.email_not_ready_reason}</Chip>
          )}
        </div>

        <Card title="Transport" subtitle="dry run, Resend or SMTP">
          <div className="flex flex-wrap gap-2">
            {(['dry_run', 'resend', 'smtp'] as const).map((m) => (
              <button
                key={m}
                onClick={() => set('email', 'mode', m)}
                className={`rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors ${
                  mode === m
                    ? 'border-brand-green-line bg-brand-green-soft text-brand-green'
                    : 'border-line bg-paper-2 text-gray-2 hover:text-ink'
                }`}
              >
                {m === 'dry_run' ? 'Dry run (renders, sends nothing)' : m === 'resend' ? 'Resend' : 'SMTP'}
              </button>
            ))}
          </div>

          {mode === 'resend' && (
            <SecretField
              label="Resend API key"
              hint="The sending domain must be verified in Resend for live sends to succeed."
              masked={stored.email.resend_key_masked}
              value={secret('email', 'resend_key')}
              onChange={(v) => setSecret('email', 'resend_key', v)}
              placeholder="re_…"
            />
          )}

          {mode === 'smtp' && (
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="SMTP host">
                <Input
                  value={String(val('email', 'smtp_host') ?? '')}
                  placeholder="smtp.gmail.com"
                  onChange={(e) => set('email', 'smtp_host', e.target.value)}
                />
              </Field>
              <Field label="SMTP port">
                <Input
                  type="number"
                  value={String(val('email', 'smtp_port') ?? '')}
                  onChange={(e) => set('email', 'smtp_port', Number(e.target.value))}
                />
              </Field>
              <Field label="SMTP user">
                <Input
                  value={String(val('email', 'smtp_user') ?? '')}
                  onChange={(e) => set('email', 'smtp_user', e.target.value)}
                />
              </Field>
              <SecretField
                label="SMTP password"
                masked={stored.email.smtp_pass_masked}
                value={secret('email', 'smtp_pass')}
                onChange={(v) => setSecret('email', 'smtp_pass', v)}
              />
              <label className="flex items-center gap-2 text-[12.5px] text-gray-1">
                <input
                  type="checkbox"
                  checked={Boolean(val('email', 'smtp_secure'))}
                  onChange={(e) => set('email', 'smtp_secure', e.target.checked)}
                />
                Implicit TLS (port 465)
              </label>
            </div>
          )}
        </Card>

        <p className="pb-8 text-[11.5px] text-gray-3">
          Only the port, the database location and the encryption key still live in{' '}
          <code className="font-mono">.env</code> on the server.
          Everything on this page is stored in the database, with every secret encrypted (AES-256-GCM) — the browser
          only ever receives masks.
        </p>
      </main>
      )}
    </div>
  )
}
