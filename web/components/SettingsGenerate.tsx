/**
 * Settings → Generate.
 *
 * Claude writes a three-message sequence (initial + bump + breakup) from a
 * brief, in one language, for the categories the owner picks. The right half
 * shows exactly what the recipient will read — the same Gmail frame the lead
 * page uses, rendered through the real placeholder + compliance pipeline —
 * and "Save as template" puts it in the library, live for those categories.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  createTemplate,
  generateTemplate,
  previewTemplate,
  type TemplateLibrary,
  type TemplateMessage,
} from '../api'
import { CategoryPicker } from './CategoryPicker'
import { GmailFrame } from './GmailFrame'
import { ClaudeIcon } from './BrandIcons'
import { Button, Chip, Input, Select, langLabel } from './ui'

const FOLLOWUP_LABEL = ['Initial email', 'Follow-up 1 · bump', 'Follow-up 2 · breakup']

export function GenerateTab({
  library,
  catalog,
  senderName,
  senderEmail,
  onSaved,
  onOpenCredentials,
}: {
  library: TemplateLibrary
  catalog: string[]
  senderName: string
  senderEmail: string
  onSaved: () => Promise<void> | void
  onOpenCredentials: () => void
}) {
  const [preset, setPreset] = useState(library.presets[0]?.id ?? 'joe_girard_note')
  const [language, setLanguage] = useState('en')
  const [audience, setAudience] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [brief, setBrief] = useState('')
  const [assets, setAssets] = useState<string[]>([''])
  const [name, setName] = useState('')

  const [messages, setMessages] = useState<TemplateMessage[] | null>(null)
  const [index, setIndex] = useState(0)
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usedModel, setUsedModel] = useState<string | null>(null)

  const assetUrls = assets.map((a) => a.trim()).filter(Boolean)

  useEffect(() => {
    const message = messages?.[index]
    if (!message) {
      setPreview(null)
      return
    }
    let cancelled = false
    void previewTemplate({ subject: message.subject, html: message.html, language, assets: assetUrls })
      .then((r) => !cancelled && setPreview({ subject: r.subject, html: r.html }))
      .catch(() => !cancelled && setPreview(null))
    return () => {
      cancelled = true
    }
  }, [messages, index, language, assets.join('|')])

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await generateTemplate({ preset, brief, language, audience, categories, assets: assetUrls })
      setMessages(res.messages)
      setUsedModel(res.model)
      setIndex(0)
      if (!name.trim()) {
        setName(`${audience.trim() || 'New template'} — ${langLabel(language)}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [preset, brief, language, audience, categories, assets.join('|'), name])

  const save = async () => {
    if (!messages?.length) return
    setSaving(true)
    setError(null)
    try {
      await createTemplate({
        name: name.trim() || `Template — ${langLabel(language)}`,
        audience: audience.trim() || 'custom',
        categories,
        language,
        messages,
        generation: { model: usedModel ?? library.model, preset, brief, assets: assetUrls },
      })
      await onSaved()
      setMessages(null)
      setPreview(null)
      setName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const presetInfo = library.presets.find((p) => p.id === preset)

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
      {/* ── brief ── */}
      <div className="grid content-start gap-3.5 rounded-2xl border border-line bg-card p-5">
        <header className="flex items-center gap-2">
          <ClaudeIcon className="size-4" />
          <h2 className="text-[14px] font-semibold tracking-tight text-ink">Write a template</h2>
          {library.ai_ready ? (
            <Chip className="tint-good">{library.model}</Chip>
          ) : (
            <button className="text-[11.5px] text-gray-2 underline hover:text-ink" onClick={onOpenCredentials}>
              set the key & model first
            </button>
          )}
        </header>

        <label className="grid gap-1">
          <span className="text-[11.5px] text-gray-2">Style</span>
          <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
            {library.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
          {presetInfo && <span className="text-[11px] text-gray-3">{presetInfo.description}</span>}
        </label>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-[11.5px] text-gray-2">Language</span>
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {library.languages.map((l) => (
                <option key={l} value={l}>
                  {langLabel(l)}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-1">
            <span className="text-[11.5px] text-gray-2">Audience</span>
            <Input
              value={audience}
              placeholder="marketing agencies, dentists…"
              onChange={(e) => setAudience(e.target.value)}
            />
          </label>
        </div>

        <div className="grid gap-1">
          <span className="text-[11.5px] text-gray-2">Categories this template will be sent to</span>
          <CategoryPicker catalog={catalog} selected={categories} onChange={setCategories} />
          <span className="text-[11px] text-gray-3">
            Empty = generic. Bound categories override the generic template for those leads.
          </span>
        </div>

        <label className="grid gap-1">
          <span className="text-[11.5px] text-gray-2">Brief</span>
          <textarea
            className="h-40 w-full rounded-lg border border-line bg-paper-2 px-2.5 py-2 text-[12.5px] leading-relaxed text-ink outline-none focus:border-line-2"
            value={brief}
            placeholder="Who they are, what to offer, what to avoid, the CTA you want…"
            onChange={(e) => setBrief(e.target.value)}
          />
        </label>

        <div className="grid gap-1">
          <span className="text-[11.5px] text-gray-2">Asset URLs (logo first)</span>
          {assets.map((a, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <Input
                className="min-w-0 flex-1 font-mono !text-[11.5px]"
                value={a}
                placeholder="https://…/logo.svg"
                onChange={(e) => {
                  const next = [...assets]
                  next[i] = e.target.value
                  setAssets(next)
                }}
              />
              <button
                className="shrink-0 text-[12px] text-gray-3 hover:text-ink"
                onClick={() => setAssets(assets.length === 1 ? [''] : assets.filter((_, j) => j !== i))}
                aria-label="Remove asset"
              >
                ×
              </button>
            </span>
          ))}
          <button
            className="justify-self-start text-[11.5px] text-gray-2 underline-offset-2 hover:text-ink hover:underline"
            onClick={() => setAssets([...assets, ''])}
          >
            + add asset
          </button>
          <span className="text-[11px] text-gray-3">
            Available to the copy as {'{{logo_url}}'}, {'{{asset_2}}'}…
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="green" disabled={busy || !library.ai_ready} onClick={() => void run()}>
            {busy ? 'Writing…' : messages ? 'Regenerate' : 'Generate'}
          </Button>
          {messages && (
            <span className="text-[11.5px] text-gray-3">
              {messages.length} of 3 messages · {usedModel}
            </span>
          )}
          {messages && messages.length < 3 && (
            <Chip className="tint-warn">
              missing follow-ups fall back to the built-in pack — regenerate to get all three
            </Chip>
          )}
        </div>

        {error && <div className="rounded-xl border tint-bad px-3.5 py-2.5 text-[12px]">{error}</div>}

        <details className="rounded-xl border border-line bg-paper-2 px-3.5 py-2.5">
          <summary className="cursor-pointer text-[11.5px] text-gray-2">Placeholders the copy may use</summary>
          <ul className="mt-2 grid gap-1">
            {library.placeholders.map((p) => (
              <li key={p.token} className="text-[11px] text-gray-3">
                <code className="font-mono text-gray-1">{p.token}</code> — {p.description}
              </li>
            ))}
          </ul>
        </details>
      </div>

      {/* ── preview ── */}
      <div className="min-w-0">
        {messages?.length ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {messages.map((m, i) => (
                <button
                  key={m.followup}
                  onClick={() => setIndex(i)}
                  className={`rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
                    i === index
                      ? 'border-brand-green-line bg-brand-green-soft text-brand-green'
                      : 'border-line bg-paper-2 text-gray-2 hover:text-ink'
                  }`}
                >
                  {FOLLOWUP_LABEL[m.followup] ?? `Message ${m.followup}`}
                </button>
              ))}
              <span className="ml-auto flex items-center gap-2">
                <Input
                  className="w-56"
                  value={name}
                  placeholder="Template name"
                  onChange={(e) => setName(e.target.value)}
                />
                <Button variant="primary" disabled={saving} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Save as template'}
                </Button>
              </span>
            </div>

            {preview ? (
              <GmailFrame
                subject={preview.subject}
                senderName={senderName}
                senderEmail={senderEmail}
                html={preview.html}
                height={620}
              />
            ) : (
              <div className="rounded-xl border border-line bg-paper-2 px-4 py-10 text-center text-[12px] text-gray-3">
                Rendering preview…
              </div>
            )}
            <p className="text-[11px] text-gray-3">
              Preview uses a sample lead. Placeholders, the tracked landing link and the unsubscribe footer are applied
              by the same code that sends the real email.
            </p>
          </div>
        ) : (
          <div className="grid h-full min-h-[320px] place-content-center rounded-2xl border border-dashed border-line bg-paper-2/40 px-6 text-center">
            <p className="text-[13px] text-gray-2">The generated email appears here, exactly as Gmail shows it.</p>
            <p className="mt-1 text-[11.5px] text-gray-3">
              Describe the audience and the offer on the left, then Generate.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
