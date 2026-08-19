/**
 * Settings → Create.
 *
 * Where an email starts. Two ways in, one editor: write it yourself, or have
 * Claude draft it from a brief and then edit what came back — neither is a
 * detour, and both land in the same fields with the same variable picker and
 * the same live preview.
 *
 * What you are writing is one LANGUAGE of one template. It can be a brand new
 * template, or a language added to one you already have — which is how a pitch
 * gets translated without becoming a second, drifting copy of itself.
 */

import { useCallback, useMemo, useState } from 'react'
import {
  createTemplate,
  generateTemplate,
  saveTemplateLanguage,
  type TemplateLibrary,
} from '../api'
import { CategoryPicker } from './CategoryPicker'
import { ClaudeIcon } from './BrandIcons'
import { CopyEditor } from './TemplateEditor'
import { emptyStep, messagesFromSteps, type Step } from '../template-copy'
import { Button, Chip, Input, Select, langLabel } from './ui'

export function CreateTab({
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

  /** '' = a new template; otherwise the template this language is added to. */
  const [targetId, setTargetId] = useState('')
  const target = useMemo(() => library.templates.find((t) => t._id === targetId) ?? null, [library.templates, targetId])

  const [name, setName] = useState('')
  const [audience, setAudience] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [assets, setAssets] = useState<string[]>([''])
  const [lowScoreVariants, setLowScoreVariants] = useState(false)
  const [anglesWanted, setAnglesWanted] = useState(1)

  const [preset, setPreset] = useState(library.presets[0]?.id ?? 'joe_girard_note')
  const [brief, setBrief] = useState('')
  const [showBrief, setShowBrief] = useState(false)

  const [steps, setSteps] = useState<Step[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usedModel, setUsedModel] = useState<string | null>(null)

  /** Adding a language: everything but the words belongs to the template. */
  const languagesLeft = target ? library.languages.filter((l) => !target.languages[l]) : library.languages
  /**
   * A new language of an existing template gets the sequence that template
   * already runs — one language reaching further than its siblings would mean
   * leads silently dropping out of the sequence depending on where they live.
   */
  const targetSteps = target
    ? Math.max(1, ...Object.values(target.languages).map((v) => Math.max(0, ...v.messages.map((m) => m.followup)) + 1))
    : stepCount
  const wantedSteps = Math.min(stepCount, targetSteps)
  const [language, setLanguage] = useState('en')
  const effectiveLanguage = languagesLeft.includes(language) ? language : (languagesLeft[0] ?? 'en')
  const bands = target ? target.low_score_variants : lowScoreVariants
  const assetUrls = useMemo(
    () => (target ? target.assets : assets.map((a) => a.trim()).filter(Boolean)),
    [target, assets],
  )

  const pickTarget = (id: string) => {
    setTargetId(id)
    setSteps(null)
    setError(null)
  }

  const startBlank = () => {
    setSteps(Array.from({ length: wantedSteps }, () => emptyStep(bands)))
    setUsedModel(null)
    setShowBrief(false)
  }

  const generate = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await generateTemplate({
        preset,
        brief,
        language: effectiveLanguage,
        audience: target ? target.audience : audience,
        categories: target ? target.categories : categories,
        assets: assetUrls,
        steps: wantedSteps,
        variants_per_step: anglesWanted,
        bands,
      })
      setSteps(
        Array.from({ length: wantedSteps }, (_, followup) => {
          const message = res.messages.find((m) => m.followup === followup)
          if (!message?.variants.length) return emptyStep(bands)
          return {
            variants: message.variants.map((v) => ({
              subject: v.subject,
              preheader: v.preheader ?? '',
              body: v.html,
              html: true,
              band: v.band ?? null,
              needsRating: false,
            })),
          }
        }),
      )
      setUsedModel(res.model)
      if (!target && !name.trim()) setName(audience.trim() ? `${audience.trim()} — outreach` : 'New template')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [preset, brief, effectiveLanguage, target, audience, categories, assetUrls, wantedSteps, anglesWanted, bands, name])

  const written = steps ? messagesFromSteps(steps) : []

  const save = async () => {
    if (!steps || !written.length) return
    setSaving(true)
    setError(null)
    const generation = usedModel ? { model: usedModel, preset, brief } : null
    try {
      if (target) {
        await saveTemplateLanguage(target._id, effectiveLanguage, { messages: written, generation })
      } else {
        await createTemplate({
          name: name.trim() || 'New template',
          audience: audience.trim() || 'custom',
          categories,
          language: effectiveLanguage,
          low_score_variants: lowScoreVariants,
          assets: assetUrls,
          messages: written,
          generation,
        })
      }
      await onSaved()
      setSteps(null)
      setName('')
      setBrief('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const presetInfo = library.presets.find((p) => p.id === preset)

  return (
    <div className="grid min-w-0 gap-4">
      {/* ── what is being written ── */}
      <div className="grid gap-3.5 rounded-2xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[14px] font-semibold tracking-tight text-ink">New email</h2>
          <div className="flex items-center gap-1 rounded-lg border border-line bg-paper p-0.5">
            {[
              { id: '', label: 'As a new template' },
              { id: 'existing', label: 'As a language of an existing one' },
            ].map((mode) => {
              const active = mode.id === '' ? !targetId : Boolean(targetId)
              return (
                <button
                  key={mode.label}
                  disabled={mode.id === 'existing' && !library.templates.length}
                  onClick={() => pickTarget(mode.id === '' ? '' : (library.templates[0]?._id ?? ''))}
                  className={`rounded-md px-2.5 py-1 text-[11.5px] transition-colors disabled:opacity-40 ${
                    active ? 'bg-paper-2 font-medium text-ink' : 'text-gray-2 hover:text-ink'
                  }`}
                >
                  {mode.label}
                </button>
              )
            })}
          </div>
        </div>

        {targetId ? (
          <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_220px]">
            <label className="grid gap-1">
              <span className="text-[11.5px] text-gray-2">Template</span>
              <Select value={targetId} onChange={(e) => pickTarget(e.target.value)}>
                {library.templates.map((t) => (
                  <option key={t._id} value={t._id}>
                    {t.name} · {t.language_codes.map(langLabel).join(', ')}
                  </option>
                ))}
              </Select>
              {target && (
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-3">
                  Targeting, angles and images come from it:
                  <Chip>{target.audience}</Chip>
                  <Chip>{target.categories.length ? `${target.categories.length} categories` : 'every category'}</Chip>
                  <Chip>{wantedSteps === 1 ? 'initial email only' : `${wantedSteps} steps`}</Chip>
                  {target.low_score_variants && <Chip>score-band angles</Chip>}
                </span>
              )}
            </label>
            <label className="grid gap-1">
              <span className="text-[11.5px] text-gray-2">Language to add</span>
              <Select value={effectiveLanguage} onChange={(e) => setLanguage(e.target.value)} disabled={!languagesLeft.length}>
                {languagesLeft.map((l) => (
                  <option key={l} value={l}>
                    {langLabel(l)}
                  </option>
                ))}
              </Select>
              {!languagesLeft.length && (
                <span className="text-[11px] tint-warn-text">This template is already written in every language.</span>
              )}
            </label>
          </div>
        ) : (
          <>
            <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
              <label className="grid gap-1">
                <span className="text-[11.5px] text-gray-2">Template name</span>
                <Input
                  value={name}
                  placeholder="Agencies — multi-client panel"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11.5px] text-gray-2">Language</span>
                <Select value={effectiveLanguage} onChange={(e) => setLanguage(e.target.value)}>
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
                Empty = generic. Bound categories make this the first suggestion for those leads; any template can still
                be picked by hand on the lead screen.
              </span>
            </div>

            <div className="grid gap-3.5 lg:grid-cols-2">
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
                    Angles marked for a low score go to struggling profiles, the others to strong ones.
                  </span>
                </span>
              </label>

              <div className="grid gap-1">
                <span className="text-[11.5px] text-gray-2">
                  Image URLs — available to the copy as {'{{logo_url}}'}, {'{{asset_2}}'}…
                </span>
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
              </div>
            </div>
          </>
        )}

        {/* ── the two ways to start ── */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
          <Button variant={steps ? 'ghost' : 'green'} onClick={startBlank}>
            {steps ? 'Start over, blank' : 'Write it myself'}
          </Button>
          <Button variant={steps ? 'ghost' : 'primary'} onClick={() => setShowBrief((s) => !s)}>
            <ClaudeIcon className="size-3.5" />
            {steps && usedModel ? 'Draft again with AI' : 'Draft with AI'}
          </Button>
          {library.ai_ready ? (
            <Chip className="tint-good">{library.model}</Chip>
          ) : (
            <button className="text-[11.5px] text-gray-2 underline hover:text-ink" onClick={onOpenCredentials}>
              set the key & model first
            </button>
          )}
          {steps && (
            <span className="ml-auto text-[11.5px] text-gray-3">
              {written.length} of {wantedSteps} step{wantedSteps === 1 ? '' : 's'} written
              {usedModel ? ` · drafted by ${usedModel}` : ''}
            </span>
          )}
        </div>

        {showBrief && (
          <div className="grid gap-3 rounded-xl border border-line bg-paper-2 p-3.5">
            <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_220px]">
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
              {!bands && (
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
            </div>
            <label className="grid gap-1">
              <span className="text-[11.5px] text-gray-2">Brief</span>
              <textarea
                className="h-32 w-full rounded-lg border border-line bg-card px-2.5 py-2 text-[12.5px] leading-relaxed text-ink outline-none focus:border-line-2"
                value={brief}
                placeholder="Who they are, what to offer, what to avoid, the CTA you want…"
                onChange={(e) => setBrief(e.target.value)}
              />
            </label>
            <div>
              <Button variant="green" disabled={busy || !library.ai_ready} onClick={() => void generate()}>
                {busy ? 'Writing…' : `Draft ${wantedSteps} step${wantedSteps === 1 ? '' : 's'} in ${langLabel(effectiveLanguage)}`}
              </Button>
            </div>
          </div>
        )}

        {error && <div className="rounded-xl border tint-bad px-3.5 py-2.5 text-[12px]">{error}</div>}
      </div>

      {/* ── the copy ── */}
      {steps ? (
        <CopyEditor
          library={library}
          steps={steps}
          onChange={setSteps}
          language={effectiveLanguage}
          lowScoreVariants={bands}
          assets={assetUrls}
          senderName={senderName}
          senderEmail={senderEmail}
          footer={
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <Button variant="green" disabled={saving || !written.length} onClick={() => void save()}>
                {saving
                  ? 'Saving…'
                  : target
                    ? `Add ${langLabel(effectiveLanguage)} to “${target.name}”`
                    : 'Save as a new template'}
              </Button>
              {!written.length && (
                <span className="text-[11.5px] text-gray-3">A step needs both a subject and a body to be saved.</span>
              )}
            </div>
          }
        />
      ) : (
        <div className="grid min-h-[220px] place-content-center rounded-2xl border border-dashed border-line bg-paper-2/40 px-6 text-center">
          <p className="text-[13px] text-gray-2">Write it yourself, or describe it and let Claude draft it.</p>
          <p className="mt-1 text-[11.5px] text-gray-3">
            Either way you edit the same fields and see the same preview before anything is saved.
          </p>
        </div>
      )}
    </div>
  )
}
