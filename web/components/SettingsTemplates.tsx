/**
 * Settings → Email templates.
 *
 * The library that decides WHICH copy a lead receives: a generic template
 * (no categories) or one bound to Google Business categories, which wins.
 * Builtin rows point at the packs written in code — their targeting and their
 * on/off switch are editable here, their text is not. Custom rows (written by
 * Claude in the Generate tab, or by hand) carry their own HTML.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteTemplate as deleteTemplateApi,
  previewStoredTemplate,
  previewTemplate,
  updateTemplate,
  type EmailTemplate,
  type TemplateLibrary,
} from '../api'
import { CategoryPicker } from './CategoryPicker'
import { GmailFrame } from './GmailFrame'
import { Button, Chip, Input, Select, langLabel } from './ui'

const FOLLOWUP_LABEL = ['Initial email', 'Follow-up 1 · bump', 'Follow-up 2 · breakup']

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
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState<EmailTemplate | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [previewLang, setPreviewLang] = useState('en')

  const open = useCallback((template: EmailTemplate) => {
    setOpenId(template._id)
    setDraft(JSON.parse(JSON.stringify(template)) as EmailTemplate)
    setPreview(null)
    setPreviewIndex(0)
    setError(null)
  }, [])

  const dirty = useMemo(() => {
    if (!draft) return false
    const original = library.templates.find((t) => t._id === draft._id)
    return original ? JSON.stringify(original) !== JSON.stringify(draft) : false
  }, [draft, library.templates])

  /**
   * Every template is previewable. A custom one is rendered from the DRAFT so
   * edits show live; a built-in is rendered by the server through the very
   * code path that sends it, in the chosen language and message of the
   * sequence.
   */
  useEffect(() => {
    if (!draft) {
      setPreview(null)
      return
    }
    let cancelled = false
    const done = (r: { subject: string; html: string }) => !cancelled && setPreview(r)
    const fail = () => !cancelled && setPreview(null)

    if (draft.kind === 'custom') {
      const message = draft.messages[previewIndex]
      if (!message) {
        fail()
        return
      }
      void previewTemplate({
        subject: message.subject,
        html: message.html,
        language: draft.language ?? 'en',
        assets: draft.generation?.assets ?? [],
      })
        .then(done)
        .catch(fail)
    } else {
      void previewStoredTemplate(draft._id, { lang: previewLang, followup: previewIndex })
        .then(done)
        .catch(fail)
    }
    return () => {
      cancelled = true
    }
  }, [draft, previewIndex, previewLang])

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      await updateTemplate(draft._id, {
        name: draft.name,
        categories: draft.categories,
        active: draft.active,
        audience: draft.audience,
        language: draft.language ?? undefined,
        priority: draft.priority,
        notes: draft.notes,
        ...(draft.kind === 'custom' ? { messages: draft.messages } : {}),
      })
      await onChanged()
      setOpenId(null)
      setDraft(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (template: EmailTemplate) => {
    try {
      await updateTemplate(template._id, { active: !template.active })
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const remove = async (template: EmailTemplate) => {
    if (!window.confirm(`Delete “${template.name}”? Leads in its categories fall back to the generic template.`)) return
    try {
      await deleteTemplateApi(template._id)
      await onChanged()
      setOpenId(null)
      setDraft(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="grid gap-4">
      {error && <div className="rounded-xl border tint-bad px-4 py-3 text-[12.5px]">{error}</div>}

      <div className="rounded-2xl border border-line bg-card">
        <div className="border-b border-line px-5 py-3 text-[12px] text-gray-2">
          A lead gets the template whose categories match it; the most specific one wins. Nothing matching → the
          generic template below.
        </div>
        <ul>
          {library.templates.map((t) => (
            <li key={t._id} className="border-b border-line last:border-b-0">
              <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => (openId === t._id ? (setOpenId(null), setDraft(null)) : open(t))}
                >
                  <span className="flex items-center gap-2">
                    <span className={`truncate text-[13.5px] font-medium ${t.active ? 'text-ink' : 'text-gray-3'}`}>
                      {t.name}
                    </span>
                    {t.kind === 'builtin' ? <Chip>built-in</Chip> : <Chip className="tint-warn">custom</Chip>}
                    {t.language && <Chip>{langLabel(t.language)}</Chip>}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-[11.5px] text-gray-3">
                    {t.audience} · {t.messages.length || 3} message{(t.messages.length || 3) === 1 ? '' : 's'}
                  </span>
                </button>
                <CategorySummary categories={t.categories} />
                <label className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-gray-2">
                  <input type="checkbox" checked={t.active} onChange={() => void toggleActive(t)} />
                  active
                </label>
                <Button variant="ghost" className="!px-3 !py-1.5 !text-[12px]" onClick={() => (openId === t._id ? (setOpenId(null), setDraft(null)) : open(t))}>
                  {openId === t._id ? 'Close' : 'Edit'}
                </Button>
              </div>

              {openId === t._id && draft && (
                <div className="grid gap-4 border-t border-line bg-paper-2/40 px-5 py-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
                  <div className="grid content-start gap-3.5">
                    <label className="grid gap-1">
                      <span className="text-[11.5px] text-gray-2">Name</span>
                      <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                    </label>

                    <div className="grid gap-1">
                      <span className="text-[11.5px] text-gray-2">
                        Categories — empty means every category (generic)
                      </span>
                      <CategoryPicker
                        catalog={catalog}
                        selected={draft.categories}
                        onChange={(categories) => setDraft({ ...draft, categories })}
                      />
                    </div>

                    <div className="grid gap-3.5 sm:grid-cols-2">
                      <label className="grid gap-1">
                        <span className="text-[11.5px] text-gray-2">Audience label</span>
                        <Input
                          value={draft.audience}
                          disabled={draft.kind === 'builtin'}
                          onChange={(e) => setDraft({ ...draft, audience: e.target.value })}
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-[11.5px] text-gray-2">Language</span>
                        <Select
                          value={draft.language ?? ''}
                          disabled={draft.kind === 'builtin'}
                          onChange={(e) => setDraft({ ...draft, language: e.target.value })}
                        >
                          {draft.kind === 'builtin' && <option value="">all 10 languages</option>}
                          {library.languages.map((l) => (
                            <option key={l} value={l}>
                              {langLabel(l)}
                            </option>
                          ))}
                        </Select>
                      </label>
                    </div>

                    {draft.kind === 'builtin' ? (
                      <p className="rounded-xl border border-line bg-paper-2 px-3.5 py-2.5 text-[11.5px] text-gray-2">
                        {draft.notes} The text lives in code, hand-localized in 10 languages — retarget or disable it
                        here, edit it in a custom template.
                      </p>
                    ) : (
                      <div className="grid gap-2">
                        {draft.messages.map((m, i) => (
                          <details key={m.followup} open={i === previewIndex} className="rounded-xl border border-line bg-card">
                            <summary
                              className="cursor-pointer px-3.5 py-2 text-[12px] text-gray-1"
                              onClick={() => setPreviewIndex(i)}
                            >
                              {FOLLOWUP_LABEL[m.followup] ?? `Message ${m.followup}`}
                            </summary>
                            <div className="grid gap-2 px-3.5 pb-3.5">
                              <Input
                                value={m.subject}
                                placeholder="Subject"
                                onChange={(e) => {
                                  const messages = [...draft.messages]
                                  messages[i] = { ...m, subject: e.target.value }
                                  setDraft({ ...draft, messages })
                                }}
                              />
                              <textarea
                                className="h-56 w-full rounded-lg border border-line bg-paper-2 px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-ink outline-none focus:border-line-2"
                                value={m.html}
                                spellCheck={false}
                                onChange={(e) => {
                                  const messages = [...draft.messages]
                                  messages[i] = { ...m, html: e.target.value }
                                  setDraft({ ...draft, messages })
                                }}
                              />
                            </div>
                          </details>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Button variant="green" disabled={!dirty || saving} onClick={save}>
                        {saving ? 'Saving…' : 'Save template'}
                      </Button>
                      {draft.kind === 'custom' && (
                        <Button variant="danger" className="!px-3 !py-1.5 !text-[12px]" onClick={() => void remove(draft)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      {(draft.kind === 'custom' ? draft.messages.map((m) => m.followup) : [0, 1, 2]).map((f, i) => (
                        <button
                          key={f}
                          onClick={() => setPreviewIndex(i)}
                          className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                            previewIndex === i
                              ? 'border-brand-green-line bg-brand-green-soft text-brand-green'
                              : 'border-line bg-paper-2 text-gray-2 hover:text-ink'
                          }`}
                        >
                          {FOLLOWUP_LABEL[f] ?? `Message ${f}`}
                        </button>
                      ))}
                      {draft.kind === 'builtin' && (
                        <Select
                          className="ml-auto !py-1 !text-[11.5px]"
                          value={previewLang}
                          onChange={(e) => setPreviewLang(e.target.value)}
                        >
                          {library.languages.map((l) => (
                            <option key={l} value={l}>
                              {langLabel(l)}
                            </option>
                          ))}
                        </Select>
                      )}
                    </div>
                    {preview ? (
                      <GmailFrame
                        subject={preview.subject}
                        senderName={senderName}
                        senderEmail={senderEmail}
                        html={preview.html}
                        height={560}
                      />
                    ) : (
                      <div className="rounded-xl border border-line bg-paper-2 px-4 py-6 text-center text-[12px] text-gray-3">
                        Rendering preview…
                      </div>
                    )}
                    <p className="mt-2 text-[11px] text-gray-3">
                      Sample lead, rendered by the same code that sends the real email.
                    </p>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
