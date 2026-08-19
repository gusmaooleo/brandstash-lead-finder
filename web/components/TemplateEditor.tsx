/**
 * The one editor for email copy.
 *
 * Settings → Create writes a new template with it; Settings → Templates edits
 * an existing one with it. Same tabs, same fields, same variable picker, same
 * live preview — so "write an email" means one thing in this app, wherever you
 * start from, and the two screens can never drift apart.
 *
 * What it edits is one LANGUAGE of one template: the steps of the sequence,
 * each with one or more angles. Everything above that — who the template
 * targets, which languages it carries — belongs to the screens around it.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { previewTemplate, type TemplateLibrary } from '../api'
import { bandLabel, emptyDraft, filled, stepLabel, type Draft, type Step } from '../template-copy'
import { GmailFrame } from './GmailFrame'
import { Button, Input, Select } from './ui'

/* ── variable picker ─────────────────────────────────────────────────────── */

/**
 * Variables are inserted where the caret is, in whichever field was last
 * touched — writing by hand should never mean copying a token by eye from a
 * list somewhere else on the page.
 */
function VariablePicker({
  placeholders,
  onInsert,
}: {
  placeholders: TemplateLibrary['placeholders']
  onInsert: (token: string) => void
}) {
  const [open, setOpen] = useState(false)
  const groups = useMemo(() => [...new Set(placeholders.map((p) => p.group))], [placeholders])

  return (
    <div className="relative">
      <Button variant="ghost" className="!px-3 !py-1.5 !text-[12px]" onClick={() => setOpen((o) => !o)}>
        Insert variable {open ? '▴' : '▾'}
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-30 mt-1.5 max-h-[420px] w-[380px] max-w-[calc(100vw-2.5rem)] overflow-y-auto rounded-xl border border-line bg-card p-3 shadow-xl">
            {groups.map((group) => (
              <div key={group} className="mb-2.5 last:mb-0">
                <div className="mb-1 text-[10.5px] uppercase tracking-wide text-gray-3">{group}</div>
                <ul className="grid gap-0.5">
                  {placeholders
                    .filter((p) => p.group === group)
                    .map((p) => (
                      <li key={p.token}>
                        <button
                          className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1 text-left hover:bg-paper-2"
                          onClick={() => {
                            onInsert(p.token)
                            setOpen(false)
                          }}
                        >
                          <code className="shrink-0 font-mono text-[11px] text-ink">{p.token}</code>
                          <span className="min-w-0 flex-1 truncate text-[11px] text-gray-3">{p.description}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
            <p className="mt-2 border-t border-line pt-2 text-[11px] text-gray-3">
              A value may be missing. Wrap the part that depends on it:{' '}
              <code className="font-mono text-gray-1">{'{{#rating}}…{{/rating}}'}</code> keeps it only when there is
              one, <code className="font-mono text-gray-1">{'{{^rating}}…{{/rating}}'}</code> only when there is not.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

/* ── the editor ──────────────────────────────────────────────────────────── */

export function CopyEditor({
  library,
  steps,
  onChange,
  language,
  lowScoreVariants,
  assets,
  findings,
  strings,
  senderName,
  senderEmail,
  header,
  footer,
}: {
  library: TemplateLibrary
  steps: Step[]
  onChange: (steps: Step[]) => void
  language: string
  lowScoreVariants: boolean
  assets: string[]
  findings?: Record<string, string>
  strings?: Record<string, string>
  senderName: string
  senderEmail: string
  /** Rendered above the step tabs — the caller's own controls (save, name…). */
  header?: ReactNode
  footer?: ReactNode
}) {
  const stepCount = steps.length
  const [index, setIndex] = useState(0)
  const [angle, setAngle] = useState(0)
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const focused = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  const safeIndex = Math.min(index, stepCount - 1)
  const step = steps[safeIndex] ?? null
  const safeAngle = step ? Math.min(angle, step.variants.length - 1) : 0
  const current = step?.variants[safeAngle] ?? null

  const setDraft = (patch: Partial<Draft>) => {
    onChange(
      steps.map((s, i) =>
        i !== safeIndex ? s : { variants: s.variants.map((v, j) => (j === safeAngle ? { ...v, ...patch } : v)) },
      ),
    )
  }

  const addAngle = () => {
    const band = lowScoreVariants ? (step?.variants.some((v) => v.band === 'low') ? 'high' : 'low') : null
    onChange(steps.map((s, i) => (i !== safeIndex ? s : { variants: [...s.variants, emptyDraft(band)] })))
    setAngle(step ? step.variants.length : 0)
  }

  const removeAngle = (j: number) => {
    if (!step || step.variants.length === 1) return
    onChange(steps.map((s, i) => (i !== safeIndex ? s : { variants: s.variants.filter((_, k) => k !== j) })))
    setAngle(0)
  }

  /** Insert at the caret of the field the author last touched. */
  const insert = (token: string) => {
    const el = focused.current
    const field = (el?.dataset.field ?? 'body') as 'subject' | 'preheader' | 'body'
    if (!el || !current) return setDraft({ body: `${current?.body ?? ''}${token}` })
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    const value = current[field]
    setDraft({ [field]: value.slice(0, start) + token + value.slice(end) } as Partial<Draft>)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  // Debounced: the preview renders on the server, through the very code that
  // sends, so what is on screen is what a lead receives.
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
        assets,
        findings,
        strings,
      })
        .then((r) => !cancelled && setPreview({ subject: r.subject, html: r.html }))
        .catch(() => !cancelled && setPreview(null))
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [current?.subject, current?.body, current?.html, current?.preheader, language, assets.join('|')])

  return (
    <div className="grid min-w-0 gap-3">
      {header}

      {/* steps of the sequence */}
      <div className="flex flex-wrap items-center gap-1.5">
        {steps.map((s, i) => (
          <button
            key={i}
            onClick={() => {
              setIndex(i)
              setAngle(0)
            }}
            className={`rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
              i === safeIndex
                ? 'border-brand-green-line bg-brand-green-soft text-brand-green'
                : 'border-line bg-paper-2 text-gray-2 hover:text-ink'
            }`}
          >
            {stepLabel(i, stepCount)}
            {s.variants.filter(filled).length > 1 ? ` · ${s.variants.filter(filled).length} angles` : ''}
            {s.variants.some(filled) ? '' : ' · empty'}
          </button>
        ))}
      </div>

      <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
        {/* ── the copy ── */}
        <div className="grid min-w-0 content-start gap-2.5 rounded-2xl border border-line bg-card p-4">
          {/* angles of this step — one is drawn per lead */}
          <div className="flex flex-wrap items-center gap-1.5">
            {step?.variants.map((v, j) => (
              <span
                key={j}
                className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11.5px] ${
                  j === safeAngle ? 'border-line-2 bg-paper-2 text-ink' : 'border-line text-gray-2'
                }`}
              >
                <button onClick={() => setAngle(j)}>
                  Angle {j + 1}
                  {lowScoreVariants ? ` · ${bandLabel(v.band)}` : ''}
                  {filled(v) ? '' : ' · empty'}
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
            {current && (
              <label
                className="ml-auto flex items-center gap-1.5 text-[11.5px] text-gray-2"
                title="An unrated business would render an empty number — this angle is skipped for those leads."
              >
                <input
                  type="checkbox"
                  checked={current.needsRating}
                  onChange={(e) => setDraft({ needsRating: e.target.checked })}
                />
                names the lead's rating
              </label>
            )}
            {lowScoreVariants && current && (
              <Select
                className="!py-1 !text-[11.5px]"
                value={current.band ?? ''}
                onChange={(e) => setDraft({ band: (e.target.value || null) as 'low' | 'high' | null })}
              >
                <option value="">Written for: any lead</option>
                <option value="low">Written for: a poor score</option>
                <option value="high">Written for: a strong profile</option>
              </Select>
            )}
          </div>

          {current && (
            <>
              <div className="flex items-center justify-between gap-2">
                <VariablePicker placeholders={library.placeholders} onInsert={insert} />
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

              <label className="grid gap-1">
                <span className="text-[11.5px] text-gray-2">Subject</span>
                <Input
                  data-field="subject"
                  value={current.subject}
                  placeholder="Variables work here too"
                  onFocus={(e) => (focused.current = e.currentTarget)}
                  onChange={(e) => setDraft({ subject: e.target.value })}
                />
              </label>

              <label className="grid gap-1">
                <span className="text-[11.5px] text-gray-2">
                  Preview line — shown next to the subject in the inbox (optional)
                </span>
                <Input
                  data-field="preheader"
                  value={current.preheader}
                  placeholder="Continues the subject, never repeats it"
                  onFocus={(e) => (focused.current = e.currentTarget)}
                  onChange={(e) => setDraft({ preheader: e.target.value })}
                />
              </label>

              <label className="grid gap-1">
                <span className="text-[11.5px] text-gray-2">{current.html ? 'HTML body' : 'Body'}</span>
                <textarea
                  data-field="body"
                  className="h-[340px] w-full rounded-xl border border-line bg-paper-2 px-3 py-2 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-line-2"
                  value={current.body}
                  spellCheck={!current.html}
                  placeholder={
                    current.html
                      ? '<p>Hi {{business_name}},</p>'
                      : 'Hi {{business_name}},\n\nI had a look at your Google profile and {{finding_1}}.'
                  }
                  onFocus={(e) => (focused.current = e.currentTarget)}
                  onChange={(e) => setDraft({ body: e.target.value })}
                />
              </label>
            </>
          )}
        </div>

        {/* ── what the recipient sees ── */}
        <div className="min-w-0">
          {preview ? (
            <GmailFrame
              subject={preview.subject}
              senderName={senderName}
              senderEmail={senderEmail}
              html={preview.html}
              height={620}
            />
          ) : (
            <div className="grid h-full min-h-[320px] place-content-center rounded-2xl border border-dashed border-line bg-paper-2/40 px-6 text-center">
              <p className="text-[13px] text-gray-2">Your email appears here, exactly as Gmail shows it.</p>
              <p className="mt-1 text-[11.5px] text-gray-3">Write a subject and a body to see it.</p>
            </div>
          )}
          <p className="mt-2 text-[11px] text-gray-3">
            Sample lead. Variables, the tracked landing link and the unsubscribe footer are applied by the same code
            that sends the real email.
          </p>
        </div>
      </div>

      {footer}
    </div>
  )
}
