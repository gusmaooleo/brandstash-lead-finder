/**
 * Settings → Write.
 *
 * One editor for the whole sequence: as many messages as the follow-up setting
 * allows, each written by hand or drafted by Claude from a brief, in plain text
 * or in HTML. The right half always shows what the recipient will read — the
 * same Gmail frame the lead page uses, rendered through the real placeholder +
 * compliance pipeline — and "Save as template" puts it in the library.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createTemplate, generateTemplate, previewTemplate, type TemplateLibrary } from '../api'
import { CategoryPicker } from './CategoryPicker'
import { GmailFrame } from './GmailFrame'
import { ClaudeIcon } from './BrandIcons'
import { Button, Chip, Input, Select, langLabel } from './ui'

/** One angle of one step: what the author is actually editing. */
type Draft = {
  subject: string
  preheader: string
  body: string
  html: boolean
  band: 'low' | 'high' | null
}

/** A step of the sequence carries one or more angles. */
type Step = { variants: Draft[] }

const emptyDraft = (band: 'low' | 'high' | null = null): Draft => ({
  subject: '',
  preheader: '',
  body: '',
  html: false,
  band,
})

const emptyStep = (bands: boolean): Step => ({
  variants: bands ? [emptyDraft('low'), emptyDraft('high')] : [emptyDraft()],
})

const bandLabel = (band: 'low' | 'high' | null): string =>
  band === 'low' ? 'poor score' : band === 'high' ? 'strong profile' : 'any lead'

function stepLabel(followup: number, total: number): string {
  if (followup === 0) return 'Initial email'
  if (followup === total - 1 && total > 2) return `Follow-up ${followup} · last`
  return `Follow-up ${followup}`
}

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
  const stepCount = library.max_followups + 1
  const [preset, setPreset] = useState(library.presets[0]?.id ?? 'joe_girard_note')
  const [language, setLanguage] = useState('en')
  const [audience, setAudience] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [brief, setBrief] = useState('')
  const [assets, setAssets] = useState<string[]>([''])
  const [name, setName] = useState('')
  const [lowScoreVariants, setLowScoreVariants] = useState(false)

  const [steps, setSteps] = useState<Step[] | null>(null)
  const [index, setIndex] = useState(0)
  const [angle, setAngle] = useState(0)
  const [anglesWanted, setAnglesWanted] = useState(1)
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usedModel, setUsedModel] = useState<string | null>(null)

  const assetUrls = useMemo(() => assets.map((a) => a.trim()).filter(Boolean), [assets])
  const step = steps?.[index] ?? null
  const current = step?.variants[Math.min(angle, step.variants.length - 1)] ?? null

  const setDraft = (patch: Partial<Draft>) => {
    if (!steps) return
    setSteps(
      steps.map((s, i) =>
        i !== index ? s : { variants: s.variants.map((v, j) => (j === angle ? { ...v, ...patch } : v)) },
      ),
    )
  }

  const addAngle = () => {
    if (!steps) return
    const band = lowScoreVariants ? (step?.variants.some((v) => v.band === 'low') ? 'high' : 'low') : null
    setSteps(steps.map((s, i) => (i !== index ? s : { variants: [...s.variants, emptyDraft(band)] })))
    setAngle(step ? step.variants.length : 0)
  }

  const removeAngle = (j: number) => {
    if (!steps || !step || step.variants.length === 1) return
    setSteps(steps.map((s, i) => (i !== index ? s : { variants: s.variants.filter((_, k) => k !== j) })))
    setAngle(0)
  }

  // The preview is debounced: it renders through the server so what is shown
  // is what would be sent, footer and tokens included.
  useEffect(() => {
    if (!current || (!current.subject.trim() && !current.body.trim())) {
      setPreview(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void previewTemplate({
        subject: current.subject,
        ...(current.html ? { html: current.body } : { text: current.body }),
        preheader: current.preheader,
        language,
        assets: assetUrls,
      })
        .then((r) => !cancelled && setPreview({ subject: r.subject, html: r.html }))
        .catch(() => !cancelled && setPreview(null))
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [current?.subject, current?.body, current?.html, language, assetUrls.join('|')])

  const startBlank = () => {
    setSteps(Array.from({ length: stepCount }, () => emptyStep(lowScoreVariants)))
    setIndex(0)
    setAngle(0)
    setUsedModel(null)
  }

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await generateTemplate({
        preset,
        brief,
        language,
        audience,
        categories,
        assets: assetUrls,
        steps: stepCount,
        variants_per_step: anglesWanted,
        bands: lowScoreVariants,
      })
      const next: Step[] = Array.from({ length: stepCount }, (_, followup) => {
        const message = res.messages.find((m) => m.followup === followup)
        if (!message?.variants.length) return emptyStep(lowScoreVariants)
        return {
          variants: message.variants.map((v) => ({
            subject: v.subject,
            preheader: v.preheader ?? '',
            body: v.html,
            html: true,
            band: v.band ?? null,
          })),
        }
      })
      setSteps(next)
      setUsedModel(res.model)
      setIndex(0)
      setAngle(0)
      if (!name.trim()) setName(`${audience.trim() || 'New template'} — ${langLabel(language)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [preset, brief, language, audience, categories, assetUrls.join('|'), name, stepCount, anglesWanted, lowScoreVariants])

  const filled = (d: Draft) => Boolean(d.subject.trim() && d.body.trim())
  const written = steps?.filter((s) => s.variants.some(filled)) ?? []

  const save = async () => {
    if (!steps || !written.length) return
    setSaving(true)
    setError(null)
    try {
      await createTemplate({
        name: name.trim() || `Template — ${langLabel(language)}`,
        audience: audience.trim() || 'custom',
        categories,
        language,
        low_score_variants: lowScoreVariants,
        assets: assetUrls,
        messages: steps
          .map((s, followup) => ({ followup, variants: s.variants.filter(filled).map(textOrHtml) }))
          .filter((m) => m.variants.length),
        generation: usedModel ? { model: usedModel, preset, brief } : null,
      })
      await onSaved()
      setSteps(null)
      setPreview(null)
      setName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const presetInfo = library.presets.find((p) => p.id === preset)
  const groups = [...new Set(library.placeholders.map((p) => p.group))]

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
            Empty = generic. Bound categories make this the first suggestion for those leads; any template can still be
            picked by hand on the lead screen.
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
          <span className="text-[11.5px] text-gray-2">Image URLs (logo first)</span>
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
                aria-label="Remove image"
              >
                ×
              </button>
            </span>
          ))}
          <button
            className="justify-self-start text-[11.5px] text-gray-2 underline-offset-2 hover:text-ink hover:underline"
            onClick={() => setAssets([...assets, ''])}
          >
            + add image
          </button>
          <span className="text-[11px] text-gray-3">
            Available to the copy as {'{{logo_url}}'}, {'{{asset_2}}'}…
          </span>
        </div>

        <label className="flex items-start gap-2 rounded-xl border border-line bg-paper-2 px-3.5 py-2.5">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={lowScoreVariants}
            onChange={(e) => setLowScoreVariants(e.target.checked)}
          />
          <span className="grid gap-0.5">
            <span className="text-[12px] text-ink">Change the tone when the lead's score is poor</span>
            <span className="text-[11px] text-gray-3">
              Variants marked for a low score go to struggling profiles, the others to strong ones.
            </span>
          </span>
        </label>

        {!lowScoreVariants && (
          <label className="grid gap-1">
            <span className="text-[11.5px] text-gray-2">Angles per step</span>
            <Select value={String(anglesWanted)} onChange={(e) => setAnglesWanted(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? 'One' : `${n} — drawn per lead, never repeated in a sequence`}
                </option>
              ))}
            </Select>
          </label>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="green" disabled={busy || !library.ai_ready} onClick={() => void run()}>
            {busy ? 'Writing…' : steps ? 'Regenerate' : 'Generate with AI'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={startBlank}>
            Write it myself
          </Button>
          {steps && (
            <span className="text-[11.5px] text-gray-3">
              {written.length} of {stepCount} written{usedModel ? ` · ${usedModel}` : ''}
            </span>
          )}
        </div>

        {error && <div className="rounded-xl border tint-bad px-3.5 py-2.5 text-[12px]">{error}</div>}

        <details className="rounded-xl border border-line bg-paper-2 px-3.5 py-2.5">
          <summary className="cursor-pointer text-[11.5px] text-gray-2">Variables the copy may use</summary>
          {groups.map((group) => (
            <div key={group} className="mt-2">
              <div className="text-[10.5px] uppercase tracking-wide text-gray-3">{group}</div>
              <ul className="mt-1 grid gap-1">
                {library.placeholders
                  .filter((p) => p.group === group)
                  .map((p) => (
                    <li key={p.token} className="text-[11px] text-gray-3">
                      <code className="font-mono text-gray-1">{p.token}</code> — {p.description}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          <p className="mt-2 text-[11px] text-gray-3">
            A value may be missing. Wrap the part that depends on it:{' '}
            <code className="font-mono text-gray-1">{'{{#rating}}…{{/rating}}'}</code> keeps it only when there is one,{' '}
            <code className="font-mono text-gray-1">{'{{^rating}}…{{/rating}}'}</code> only when there is not.
          </p>
        </details>
      </div>

      {/* ── editor + preview ── */}
      <div className="min-w-0">
        {steps ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {steps.map((s, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setIndex(i)
                    setAngle(0)
                  }}
                  className={`rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
                    i === index
                      ? 'border-brand-green-line bg-brand-green-soft text-brand-green'
                      : 'border-line bg-paper-2 text-gray-2 hover:text-ink'
                  }`}
                >
                  {stepLabel(i, stepCount)}
                  {s.variants.length > 1 ? ` · ${s.variants.length}` : ''}
                  {s.variants.some(filled) ? '' : ' ·'}
                </button>
              ))}
              <span className="ml-auto flex items-center gap-2">
                <Input className="w-56" value={name} placeholder="Template name" onChange={(e) => setName(e.target.value)} />
                <Button variant="primary" disabled={saving || !written.length} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Save as template'}
                </Button>
              </span>
            </div>

            {current && step && (
              <div className="grid gap-2 rounded-2xl border border-line bg-card p-4">
                {/* angles of this step — one is drawn per lead */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {step.variants.map((v, j) => (
                    <span
                      key={j}
                      className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11.5px] ${
                        j === angle ? 'border-line-2 bg-paper-2 text-ink' : 'border-line text-gray-2'
                      }`}
                    >
                      <button onClick={() => setAngle(j)}>
                        Angle {j + 1}
                        {lowScoreVariants ? ` · ${bandLabel(v.band)}` : ''}
                        {filled(v) ? '' : ' ·'}
                      </button>
                      {step.variants.length > 1 && (
                        <button className="text-gray-3 hover:text-ink" onClick={() => removeAngle(j)} aria-label="Remove angle">
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                  <button
                    className="rounded-lg border border-dashed border-line px-2 py-1 text-[11.5px] text-gray-2 hover:text-ink"
                    onClick={addAngle}
                  >
                    + angle
                  </button>
                  {lowScoreVariants && (
                    <Select
                      className="ml-auto !py-1 !text-[11.5px]"
                      value={current.band ?? ''}
                      onChange={(e) => setDraft({ band: (e.target.value || null) as 'low' | 'high' | null })}
                    >
                      <option value="">Written for: any lead</option>
                      <option value="low">Written for: a poor score</option>
                      <option value="high">Written for: a strong profile</option>
                    </Select>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11.5px] text-gray-2">{stepLabel(index, stepCount)}</span>
                  <div className="flex items-center gap-1 rounded-lg border border-line bg-paper p-0.5">
                    {[
                      { html: false, label: 'Plain text' },
                      { html: true, label: 'HTML' },
                    ].map((mode) => (
                      <button
                        key={mode.label}
                        onClick={() => setDraft({ html: mode.html })}
                        className={`rounded-md px-2.5 py-1 text-[11.5px] transition-colors ${
                          current.html === mode.html ? 'bg-paper-2 font-medium text-ink' : 'text-gray-2 hover:text-ink'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Input
                  value={current.subject}
                  placeholder="Subject — variables work here too"
                  onChange={(e) => setDraft({ subject: e.target.value })}
                />
                <Input
                  value={current.preheader}
                  placeholder="Preview line shown next to the subject (optional)"
                  onChange={(e) => setDraft({ preheader: e.target.value })}
                />
                <textarea
                  className="h-56 w-full rounded-xl border border-line bg-paper-2 px-3 py-2 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-line-2"
                  value={current.body}
                  placeholder={
                    current.html
                      ? '<p>Hi {{business_name}},</p>'
                      : 'Hi {{business_name}},\n\nI had a look at your Google profile and {{finding_1}}.'
                  }
                  onChange={(e) => setDraft({ body: e.target.value })}
                />
              </div>
            )}

            {preview ? (
              <GmailFrame
                subject={preview.subject}
                senderName={senderName}
                senderEmail={senderEmail}
                html={preview.html}
                height={560}
              />
            ) : (
              <div className="rounded-xl border border-line bg-paper-2 px-4 py-10 text-center text-[12px] text-gray-3">
                Write a subject and a body to see the preview.
              </div>
            )}
            <p className="text-[11px] text-gray-3">
              Preview uses a sample lead. Variables, the tracked landing link and the unsubscribe footer are applied by
              the same code that sends the real email.
            </p>
          </div>
        ) : (
          <div className="grid h-full min-h-[320px] place-content-center rounded-2xl border border-dashed border-line bg-paper-2/40 px-6 text-center">
            <p className="text-[13px] text-gray-2">Your email appears here, exactly as Gmail shows it.</p>
            <p className="mt-1 text-[11.5px] text-gray-3">
              Describe the audience and the offer on the left and generate it, or write it yourself.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/** Plain text is stored as text; HTML is stored as HTML. Both preview alike. */
function textOrHtml(draft: Draft) {
  const common = { subject: draft.subject.trim(), preheader: draft.preheader.trim(), band: draft.band }
  if (draft.html) return { ...common, html: draft.body }
  const escaped = draft.body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return {
    ...common,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.65;white-space:pre-wrap;">${escaped}</div>`,
    text: draft.body,
  }
}
