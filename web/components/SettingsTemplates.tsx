/**
 * Settings → Templates.
 *
 * The library that decides WHICH copy a lead receives: a generic template (no
 * categories) or one bound to Google Business categories, which wins.
 *
 * A row is a TEMPLATE — one pitch, listed once no matter how many languages it
 * carries. Opening it shows what the pitch targets, then a bar of the
 * languages it is written in: pick one and the editor below is that language's
 * words. Adding a language is a tab, not a second template, so the targeting
 * of a pitch can never drift between its own translations.
 */

import { useCallback, useMemo, useState } from 'react'
import {
  deleteTemplate as deleteTemplateApi,
  deleteTemplateLanguage,
  saveTemplateLanguage,
  updateTemplate,
  type EmailTemplate,
  type TemplateLibrary,
  type TemplateSettingsPatch,
} from '../api'
import { CategoryPicker } from './CategoryPicker'
import { CopyEditor } from './TemplateEditor'
import { canonicalMessages, emptyDraft, filled, messagesFromSteps, stepsFromMessages, type Step } from '../template-copy'
import { Button, Chip, Input, Select, langLabel } from './ui'

/** The pitch's own fields — everything about a template that is not words. */
type Settings = {
  name: string
  audience: string
  categories: string[]
  low_score_variants: boolean
  assets: string[]
}

const settingsOf = (t: EmailTemplate): Settings => ({
  name: t.name,
  audience: t.audience,
  categories: [...t.categories],
  low_score_variants: t.low_score_variants,
  assets: t.assets.length ? [...t.assets] : [''],
})

function CategorySummary({ categories }: { categories: string[] }) {
  if (!categories.length) return <Chip>every category</Chip>
  return (
    <span className="flex flex-wrap gap-1">
      {categories.slice(0, 3).map((c) => (
        <Chip key={c} className="tint-good">
          {c}
        </Chip>
      ))}
      {categories.length > 3 && <Chip>+{categories.length - 3}</Chip>}
    </span>
  )
}

export function TemplatesTab({
  library,
  catalog,
  senderName,
  senderEmail,
  onChanged,
}: {
  library: TemplateLibrary
  catalog: string[]
  senderName: string
  senderEmail: string
  onChanged: () => Promise<void> | void
}) {
  const stepCount = library.max_followups + 1
  const [openId, setOpenId] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  /** Every language of the open template, kept while tabs are switched. */
  const [versions, setVersions] = useState<Record<string, Step[]>>({})
  const [lang, setLang] = useState<string>('en')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const template = useMemo(() => library.templates.find((t) => t._id === openId) ?? null, [library.templates, openId])

  const open = useCallback(
    (t: EmailTemplate) => {
      setOpenId(t._id)
      setSettings(settingsOf(t))
      setVersions(
        Object.fromEntries(
          t.language_codes.map((l) => [l, stepsFromMessages(t.languages[l].messages, stepCount, t.low_score_variants)]),
        ),
      )
      setLang(t.language_codes[0] ?? 'en')
      setError(null)
    },
    [stepCount],
  )

  const close = () => {
    setOpenId(null)
    setSettings(null)
    setVersions({})
  }

  /** What changed since the template was opened — settings, words, or both. */
  const changes = useMemo(() => {
    if (!template || !settings) return { settings: false, languages: [] as string[], added: [] as string[] }
    const base = settingsOf(template)
    const cleanAssets = (a: string[]) => a.map((x) => x.trim()).filter(Boolean)
    const settingsChanged =
      JSON.stringify({ ...base, assets: cleanAssets(base.assets) }) !==
      JSON.stringify({ ...settings, assets: cleanAssets(settings.assets) })
    const languages = Object.keys(versions).filter((l) => {
      const stored = template.languages[l]
      if (!stored) return messagesFromSteps(versions[l]).length > 0
      return canonicalMessages(stored.messages, stepCount) !== JSON.stringify(messagesFromSteps(versions[l]))
    })
    return { settings: settingsChanged, languages, added: Object.keys(versions).filter((l) => !template.languages[l]) }
  }, [template, settings, versions, stepCount])

  const dirty = changes.settings || changes.languages.length > 0

  const save = async () => {
    if (!template || !settings) return
    setSaving(true)
    setError(null)
    try {
      if (changes.settings) {
        const patch: TemplateSettingsPatch = {
          name: settings.name,
          audience: settings.audience,
          categories: settings.categories,
          low_score_variants: settings.low_score_variants,
          assets: settings.assets.map((a) => a.trim()).filter(Boolean),
        }
        await updateTemplate(template._id, patch)
      }
      for (const code of changes.languages) {
        const messages = messagesFromSteps(versions[code])
        if (!messages.length) throw new Error(`${langLabel(code)} has no message with both a subject and a body`)
        await saveTemplateLanguage(template._id, code, {
          messages,
          findings: template.languages[code]?.findings,
          strings: template.languages[code]?.strings,
        })
      }
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  /**
   * A new language starts as the current one's skeleton — same steps, same
   * angles, same bands, no words. Translating is filling boxes in, not
   * rebuilding the shape of a sequence that already works.
   */
  const addLanguage = (code: string) => {
    const shape = versions[lang] ?? []
    setVersions({
      ...versions,
      [code]: shape.length
        ? shape.map((s) => ({ variants: s.variants.map((v) => emptyDraft(v.band)) }))
        : Array.from({ length: stepCount }, () => ({ variants: [emptyDraft()] })),
    })
    setLang(code)
  }

  const removeLanguage = async (code: string) => {
    if (!template) return
    const stored = Boolean(template.languages[code])
    if (stored && !window.confirm(`Delete the ${langLabel(code)} version of “${template.name}”?`)) return
    const rest = Object.keys(versions).filter((l) => l !== code)
    if (!rest.length) return setError('A template needs at least one language — delete the template instead.')
    try {
      if (stored) {
        await deleteTemplateLanguage(template._id, code)
        await onChanged()
      }
      setVersions(Object.fromEntries(rest.map((l) => [l, versions[l]])))
      setLang(rest[0])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const toggleActive = async (t: EmailTemplate) => {
    try {
      await updateTemplate(t._id, { active: !t.active })
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const remove = async (t: EmailTemplate) => {
    if (!window.confirm(`Delete “${t.name}” and every language of it? Leads in its categories fall back to the generic template.`))
      return
    try {
      await deleteTemplateApi(t._id)
      await onChanged()
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const missingLanguages = library.languages.filter((l) => !versions[l])

  /**
   * Languages of one template should run the same sequence. When they don't,
   * leads drop out of the follow-ups depending on where they live — worth a
   * sentence, not a silent difference nobody would think to look for.
   */
  const uneven = useMemo(() => {
    const reach = Object.entries(versions).map(([l, steps]) => ({
      language: l,
      steps: steps.filter((s) => s.variants.some(filled)).length,
    }))
    const longest = Math.max(0, ...reach.map((r) => r.steps))
    return reach.filter((r) => r.steps < longest)
  }, [versions])

  return (
    <div className="grid gap-4">
      {error && <div className="rounded-xl border tint-bad px-4 py-3 text-[12.5px]">{error}</div>}

      <div className="rounded-2xl border border-line bg-card">
        <div className="border-b border-line px-5 py-3 text-[12px] text-gray-2">
          A lead gets the template whose categories match it, in the language of the country it was found in. The most
          specific match wins; nothing matching → the generic template.
        </div>
        {!library.templates.length && (
          <div className="px-5 py-8 text-center text-[12.5px] text-gray-3">
            No template yet — write your first one in the Create tab.
          </div>
        )}
        <ul>
          {library.templates.map((t) => (
            <li key={t._id} className="border-b border-line last:border-b-0">
              <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => (openId === t._id ? close() : open(t))}>
                  <span className={`block truncate text-[13.5px] font-medium ${t.active ? 'text-ink' : 'text-gray-3'}`}>
                    {t.name}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-gray-3">
                    {t.audience}
                    <span>·</span>
                    {t.language_codes.map((l) => (
                      <Chip key={l} className="!text-[10px]">
                        {langLabel(l)}
                      </Chip>
                    ))}
                  </span>
                </button>
                <CategorySummary categories={t.categories} />
                <label className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-gray-2">
                  <input type="checkbox" checked={t.active} onChange={() => void toggleActive(t)} />
                  active
                </label>
                <Button
                  variant="ghost"
                  className="!px-3 !py-1.5 !text-[12px]"
                  onClick={() => (openId === t._id ? close() : open(t))}
                >
                  {openId === t._id ? 'Close' : 'Edit'}
                </Button>
              </div>

              {openId === t._id && settings && (
                <div className="grid gap-4 border-t border-line bg-paper-2/40 px-5 py-4">
                  {/* ── the pitch: shared by every language ── */}
                  <div className="grid gap-3.5 rounded-2xl border border-line bg-card p-4">
                    <div className="text-[11px] uppercase tracking-wide text-gray-3">
                      This template — the same in every language
                    </div>
                    <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_220px]">
                      <label className="grid gap-1">
                        <span className="text-[11.5px] text-gray-2">Name</span>
                        <Input value={settings.name} onChange={(e) => setSettings({ ...settings, name: e.target.value })} />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-[11.5px] text-gray-2">Audience label</span>
                        <Input
                          value={settings.audience}
                          onChange={(e) => setSettings({ ...settings, audience: e.target.value })}
                        />
                      </label>
                    </div>

                    <div className="grid gap-1">
                      <span className="text-[11.5px] text-gray-2">Categories — empty means every category (generic)</span>
                      <CategoryPicker
                        catalog={catalog}
                        selected={settings.categories}
                        onChange={(categories) => setSettings({ ...settings, categories })}
                        title="The lead categories this template is written for"
                        footer={(n) => (n ? `Suggested first for these ${n}.` : 'Empty = generic, every category.')}
                      />
                    </div>

                    <div className="grid gap-3.5 lg:grid-cols-2">
                      <label className="flex items-start gap-2 rounded-xl border border-line bg-paper-2 px-3.5 py-2.5">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={settings.low_score_variants}
                          onChange={(e) => setSettings({ ...settings, low_score_variants: e.target.checked })}
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
                        {settings.assets.map((a, i) => (
                          <span key={i} className="flex items-center gap-1.5">
                            <Input
                              className="min-w-0 flex-1 font-mono !text-[11.5px]"
                              value={a}
                              placeholder="https://…/logo.svg"
                              onChange={(e) => {
                                const next = [...settings.assets]
                                next[i] = e.target.value
                                setSettings({ ...settings, assets: next })
                              }}
                            />
                            <button
                              className="shrink-0 text-[12px] text-gray-3 hover:text-ink"
                              onClick={() =>
                                setSettings({
                                  ...settings,
                                  assets: settings.assets.length === 1 ? [''] : settings.assets.filter((_, j) => j !== i),
                                })
                              }
                              aria-label="Remove image"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <button
                          className="justify-self-start text-[11.5px] text-gray-2 underline-offset-2 hover:text-ink hover:underline"
                          onClick={() => setSettings({ ...settings, assets: [...settings.assets, ''] })}
                        >
                          + add image
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ── the words: one language at a time ── */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[11px] uppercase tracking-wide text-gray-3">Language</span>
                    {Object.keys(versions)
                      .sort((a, b) => library.languages.indexOf(a) - library.languages.indexOf(b))
                      .map((l) => (
                        <span
                          key={l}
                          className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                            l === lang
                              ? 'border-brand-green-line bg-brand-green-soft text-brand-green'
                              : 'border-line bg-paper-2 text-gray-2'
                          }`}
                        >
                          <button onClick={() => setLang(l)}>
                            {langLabel(l)}
                            {changes.added.includes(l) ? ' · new' : ''}
                            {!changes.added.includes(l) && changes.languages.includes(l) ? ' ·' : ''}
                          </button>
                          {Object.keys(versions).length > 1 && (
                            <button
                              className="opacity-60 hover:opacity-100"
                              onClick={() => void removeLanguage(l)}
                              aria-label={`Remove ${langLabel(l)}`}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                    {missingLanguages.length > 0 && (
                      <Select
                        className="!py-1 !text-[11.5px]"
                        value=""
                        onChange={(e) => e.target.value && addLanguage(e.target.value)}
                      >
                        <option value="">+ add language</option>
                        {missingLanguages.map((l) => (
                          <option key={l} value={l}>
                            {langLabel(l)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>

                  {uneven.length > 0 && (
                    <div className="rounded-xl border px-3.5 py-2.5 text-[12px] tint-warn">
                      {uneven.map((r) => `${langLabel(r.language)} stops after ${r.steps === 0 ? 'nothing' : r.steps === 1 ? 'the initial email' : `follow-up ${r.steps - 1}`}`).join('; ')}
                      . Leads reading those languages leave the sequence earlier than the others.
                    </div>
                  )}

                  {versions[lang] && (
                    <CopyEditor
                      library={library}
                      steps={versions[lang]}
                      onChange={(steps) => setVersions({ ...versions, [lang]: steps })}
                      language={lang}
                      lowScoreVariants={settings.low_score_variants}
                      assets={settings.assets.map((a) => a.trim()).filter(Boolean)}
                      findings={t.languages[lang]?.findings}
                      strings={t.languages[lang]?.strings}
                      senderName={senderName}
                      senderEmail={senderEmail}
                      footer={
                        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                          <Button variant="green" disabled={!dirty || saving} onClick={() => void save()}>
                            {saving ? 'Saving…' : 'Save changes'}
                          </Button>
                          {dirty && (
                            <span className="text-[11.5px] text-gray-3">
                              {[
                                changes.settings ? 'template settings' : null,
                                changes.languages.length
                                  ? `${changes.languages.map(langLabel).join(', ')}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}{' '}
                              unsaved
                            </span>
                          )}
                          <Button
                            variant="danger"
                            className="ml-auto !px-3 !py-1.5 !text-[12px]"
                            onClick={() => void remove(t)}
                          >
                            Delete template
                          </Button>
                        </div>
                      }
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
