import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  addEmail,
  approveLead,
  doNotContactLead,
  getEmailPreview,
  getLead,
  getStatus,
  reopenLead,
  retryDelivery,
  selectEmail,
  sendFollowup,
  skipLead,
  stopFollowups,
  chooseLeadTemplate,
  getLeadTemplates,
  previewOneOff,
  type Analysis,
  type EmailPreview,
  type Lead,
  type LeadTemplateOptions,
  type Status,
} from '../api'
import { ScoreRing } from './ScoreRing'
import { GmailFrame } from './GmailFrame'
import { Button, Chip, Input, SectionLabel, Select, STATUS_STYLE, flagEmoji, langLabel } from './ui'
import { ThemeToggle, useTheme } from './ThemeToggle'


/** Full-screen lead review — route: /leads/:id */
export function LeadPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // Message carried across the approve redirect (the approved lead lives
  // under a new id, so the URL is swapped in place — see onApprove).
  const navNotice = (location.state as { notice?: string } | null)?.notice ?? null
  const goBack = useCallback(() => {
    // Return to wherever the lead was opened from (dashboard or /table);
    // '/' only when the page was opened cold (no in-app history).
    if (((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0) navigate(-1)
    else navigate('/')
  }, [navigate])

  const [lead, setLead] = useState<Lead | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [source, setSource] = useState<'approval_list' | 'approved'>('approval_list')
  const [preview, setPreview] = useState<EmailPreview | null>(null)
  const [previewLang, setPreviewLang] = useState<string | null>(null)
  const [previewFollowup, setPreviewFollowup] = useState(0)
  const [templateOptions, setTemplateOptions] = useState<LeadTemplateOptions | null>(null)
  // A one-off email: written here, sent to this lead, never saved.
  const [oneOff, setOneOff] = useState<{ subject: string; body: string; html: boolean } | null>(null)
  const [appStatus, setAppStatus] = useState<Status | null>(null)
  const [recipient, setRecipient] = useState<string>('')
  const [manualEmail, setManualEmail] = useState<string>('')
  const [showAllEmails, setShowAllEmails] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [approveResult, setApproveResult] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [theme, toggleTheme] = useTheme()

  const load = useCallback(async () => {
    const data = await getLead(id)
    setLead(data.lead)
    setAnalysis(data.analysis)
    setSource(data.source as 'approval_list' | 'approved')
    setRecipient(data.lead.contact.selected_email ?? '')
  }, [id])

  useEffect(() => {
    setLead(null)
    setPreview(null)
    setPreviewLang(null)
    setPreviewFollowup(0)
    setShowAllEmails(false)
    setApproveResult(navNotice)
    setActionError(null)
    setLoadError(null)
    void load().catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))
    void getStatus().then(setAppStatus).catch(() => {})
  }, [id, load, navNotice])

  useEffect(() => {
    if (!lead) return
    void getLeadTemplates(id, previewFollowup).then(setTemplateOptions).catch(() => setTemplateOptions(null))
  }, [id, lead, previewFollowup])

  const chosenTemplate = templateOptions?.chosen_id ?? templateOptions?.suggested_id ?? null

  /**
   * The lead's language is decided by the country it was found in; the copy
   * that answers it must exist. Everything below is derived from that pair —
   * which templates can serve this lead, and which languages each carries.
   */
  const leadLanguage = templateOptions?.lead_language ?? lead?.language ?? 'en'
  const serves = useCallback(
    (t: LeadTemplateOptions['templates'][number]) => (t.steps_by_language[leadLanguage] ?? []).includes(previewFollowup),
    [leadLanguage, previewFollowup],
  )
  const templateLanguages = useMemo(() => {
    const chosen = templateOptions?.templates.find((t) => t.id === chosenTemplate)
    return Object.keys(chosen?.steps_by_language ?? {}).filter((l) =>
      (chosen?.steps_by_language[l] ?? []).includes(previewFollowup),
    )
  }, [templateOptions, chosenTemplate, previewFollowup])

  useEffect(() => {
    if (!lead) return
    // A language the chosen template does not carry is not a preview, it is a
    // 404: fall back to the one this lead would actually be written in.
    const lang = previewLang && templateLanguages.includes(previewLang) ? previewLang : leadLanguage
    if (oneOff) {
      const draft = oneOff.html ? { html: oneOff.body } : { text: oneOff.body }
      void previewOneOff(id, { subject: oneOff.subject, ...draft })
        .then(setPreview)
        .catch(() => setPreview(null))
      return
    }
    void getEmailPreview(id, { lang, template: chosenTemplate ?? undefined, followup: previewFollowup })
      .then(setPreview)
      .catch(() => setPreview(null))
  }, [id, lead, previewLang, leadLanguage, templateLanguages, previewFollowup, chosenTemplate, oneOff])

  const onPickTemplate = (templateId: string) => {
    setOneOff(null)
    void run('template', async () => {
      await chooseLeadTemplate(id, templateId, previewFollowup)
      setTemplateOptions((prev) => (prev ? { ...prev, chosen_id: templateId } : prev))
    })
  }

  /**
   * Nothing can be sent, and the UI must say so rather than offer a button
   * that fails at render time. Two different gaps, two different sentences:
   * an empty library, or a library with nothing in this lead's language.
   */
  const noTemplates = templateOptions !== null && templateOptions.templates.length === 0
  const noneInLanguage =
    templateOptions !== null && templateOptions.templates.length > 0 && !templateOptions.templates.some(serves)
  const cannotSend = noTemplates || noneInLanguage

  /** Next follow-up is due (approved, 1–2 sends, waited long enough, not stopped). */
  const followupDue = Boolean(
    source === 'approved' &&
      lead &&
      lead.outreach &&
      lead.outreach.count >= 1 &&
      lead.outreach.count < 3 &&
      !lead.outreach.stopped_at &&
      ['sent', 'sent_dry_run'].includes(lead.delivery.state) &&
      lead.outreach.last_sent_at &&
      appStatus &&
      Date.now() - new Date(lead.outreach.last_sent_at).getTime() >=
        appStatus.followup_after_days * 86_400_000,
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && goBack()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goBack])

  const emails = lead?.contact.emails ?? []
  const needsSelection = emails.length > 1
  const canApprove =
    source === 'approval_list' &&
    lead?.status === 'pending' &&
    Boolean(recipient) &&
    emails.length > 0 &&
    (!cannotSend || Boolean(oneOff?.subject.trim() && oneOff?.body.trim()))

  const prospectReasons = useMemo(() => {
    if (!lead || !analysis) return []
    const reasons: string[] = []
    const missing = analysis.scoring.categories.filter((c) => c.status === 'ausente').map((c) => c.label)
    if (lead.google_rating != null && lead.google_rating < 4) {
      reasons.push(`Google rating ${lead.google_rating.toFixed(1)} — below the 4★ trust bar, strong improvement pitch.`)
    }
    if (lead.google_rating != null && lead.google_rating >= 4) {
      reasons.push(`Strong ${lead.google_rating.toFixed(1)}★ reputation — retention/consistency pitch applies.`)
    }
    if (lead.google_rating == null) reasons.push('No Google rating yet — visibility pitch from zero.')
    if (lead.score < 7) reasons.push(`Profile score ${lead.score.toFixed(1)}/10 — visible, fixable gaps.`)
    if (missing.length) reasons.push(`Missing on the profile: ${missing.join(', ')}.`)
    if (emails.some((e) => e.generic)) reasons.push('Generic business inbox available — appropriate outreach channel.')
    if ((lead.review_count ?? 0) < 50 && lead.google_rating != null) {
      reasons.push(`Only ${lead.review_count ?? 0} reviews — review-generation opportunity.`)
    }
    return reasons
  }, [lead, analysis, emails])

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    setActionError(null)
    try {
      await fn()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const onApprove = () =>
    run('approve', async () => {
      const res = await approveLead(id, recipient)
      const notice =
        res.delivery.state === 'sent_dry_run'
          ? 'Approved — email rendered and recorded (dry run mode, nothing sent).'
          : res.ok
            ? `Approved — email sent to ${recipient}.`
            : `Approved, but delivery failed: ${res.delivery.last_error ?? 'unknown error'}`
      // Approval moves the lead to the approved collection under a NEW id —
      // swap the URL in place (no extra history entry) so the page stays put
      // and reloads showing the approved/sent state.
      navigate(`/leads/${res.lead._id}`, { replace: true, state: { notice } })
    })

  const headerBar = (
    <div className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1240px] items-center gap-3 px-5 py-3">
        <Button variant="ghost" onClick={goBack} className="!px-3.5" title="Back to the queue (Esc)">
          <span aria-hidden>←</span> Back
        </Button>
        {lead && (
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <h1 className="truncate text-[16px] font-bold tracking-tight text-ink">{lead.name}</h1>
            <span className="hidden items-center gap-1.5 sm:flex">
              <Chip>
                {flagEmoji(lead.country)} {lead.country}
              </Chip>
              <Chip>{langLabel(lead.language)}</Chip>
              {lead.google_rating != null && (
                <Chip className="font-mono tabular-nums">
                  ★ {lead.google_rating.toFixed(1)} · {lead.review_count ?? 0} reviews
                </Chip>
              )}
              {source === 'approved' && (
                <Chip
                  className={
                    lead.delivery.state === 'failed'
                      ? 'tint-bad'
                      : 'tint-good'
                  }
                >
                  {lead.delivery.state.replace(/_/g, ' ')}
                </Chip>
              )}
            </span>
          </div>
        )}
        <span className="ml-auto">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </span>
      </div>
    </div>
  )

  if (!lead) {
    return (
      <div className="min-h-full bg-paper">
        {headerBar}
        <div className="mx-auto max-w-[1240px] px-5 py-10 text-[13px] text-gray-2">{loadError ?? 'Loading…'}</div>
      </div>
    )
  }

  const website = lead.website
  const scoring = analysis?.scoring

  return (
    <div className="min-h-full bg-paper">
      {headerBar}

      <div className="brand-rise mx-auto max-w-[1240px] px-5 pb-16 pt-6">
        {/* lead identity */}
        <div className="rounded-2xl border border-line bg-card px-6 py-5">
          <h2 className="text-[22px] font-bold tracking-tight text-ink">{lead.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-gray-2">
            <Chip>
              {flagEmoji(lead.country)} {lead.country}
            </Chip>
            <Chip>{langLabel(lead.language)}</Chip>
            <Chip>{lead.market_scope}</Chip>
            {lead.google_rating != null && (
              <Chip className="font-mono tabular-nums">
                ★ {lead.google_rating.toFixed(1)} · {lead.review_count ?? 0} reviews
              </Chip>
            )}
            <Chip>{lead.category ?? lead.types[0] ?? '—'}</Chip>
          </div>
          <div className="mt-1.5 text-[12.5px] text-gray-2">{lead.address ?? lead.city_label}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
            {website && (
              <a className="text-brand-green underline decoration-brand-green-line underline-offset-2" href={website} target="_blank" rel="noreferrer">
                {website}
              </a>
            )}
            <span className="font-mono text-gray-3">place: {lead.place_id}</span>
            <span className="text-gray-3">
              found {new Date(lead.discovery.discovered_at).toLocaleString()} · “{lead.discovery.query}”
            </span>
          </div>
        </div>

        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[1fr_440px]">
          {/* ── left: analysis ─────────────────────────────────── */}
          <div>
            {scoring && (
              <>
                <div className="flex items-center gap-6 rounded-2xl border border-line bg-card p-5">
                  <div className="flex flex-col items-center gap-1">
                    <ScoreRing score={scoring.overallScore} />
                    <span className="text-[11px] text-gray-2">Overall score</span>
                    <span className="font-mono text-[9.5px] text-gray-3">rules v{scoring.rules_version}</span>
                  </div>
                  <div className="grid flex-1 grid-cols-2 gap-2 xl:grid-cols-2">
                    {scoring.categories.map((cat) => {
                      const st = STATUS_STYLE[cat.status]
                      const pct = Math.round(cat.score * 10)
                      return (
                        <div key={cat.category} className="rounded-xl border border-line bg-paper px-3 py-2">
                          <div className="flex items-center justify-between text-[11.5px]">
                            <span className="font-medium text-ink">{cat.label}</span>
                            <span className="font-mono text-[10.5px] text-gray-2 tabular-nums">{pct}%</span>
                          </div>
                          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-paper-3">
                            <div className={`h-full rounded-full ${st.bar}`} style={{ width: `${Math.max(3, pct)}%` }} />
                          </div>
                          <span className={`mt-1.5 inline-block rounded-full border px-1.5 py-px text-[9.5px] ${st.cls}`}>
                            {st.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="mt-4">
                  <SectionLabel>Key score drivers (scoring rules)</SectionLabel>
                  <ol className="mt-2 flex flex-col gap-1.5">
                    {scoring.priorityActions.map((action, i) => (
                      <li key={i} className="flex gap-2.5 rounded-xl border border-line bg-card px-3.5 py-2.5 text-[12.5px] leading-relaxed text-gray-1">
                        <span className="font-mono text-[11px] font-semibold text-gray-3">{i + 1}</span>
                        {action}
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="mt-4">
                  <SectionLabel>Why a good prospect</SectionLabel>
                  <ul className="mt-2 flex flex-col gap-1">
                    {prospectReasons.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-gray-1">
                        <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-brand-green" />
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-4">
                  <SectionLabel>Audit findings</SectionLabel>
                  <div className="mt-2 flex flex-col gap-1.5 text-[12px] text-gray-1">
                    {scoring.warnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="mt-[6px] size-1.5 shrink-0 rounded-full bg-amber-400" />
                        {w}
                      </div>
                    ))}
                    {analysis?.website_audit && (
                      <div className="mt-1 rounded-xl border border-line bg-card px-3.5 py-2.5">
                        <span className="font-medium text-ink">Website inspection.</span>{' '}
                        {analysis.website_audit.pages_checked.length} page
                        {analysis.website_audit.pages_checked.length === 1 ? '' : 's'} checked ·{' '}
                        {emails.length} public email{emails.length === 1 ? '' : 's'} ·{' '}
                        {analysis.website_audit.forms.length} contact form
                        {analysis.website_audit.forms.length === 1 ? '' : 's'}
                        {analysis.website_audit.robots_blocked.length > 0 &&
                          ` · ${analysis.website_audit.robots_blocked.length} path(s) skipped per robots.txt`}
                        <div className="mt-1.5 flex flex-col gap-0.5 font-mono text-[10.5px] text-gray-3">
                          {analysis.website_audit.pages_checked.map((p, i) => (
                            <span key={i} className="truncate">
                              {p.status ?? '—'} · {p.url}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {lead.audit_trail.length > 0 && (
                  <div className="mt-4">
                    <SectionLabel>Audit trail</SectionLabel>
                    <div className="mt-2 flex flex-col gap-1 font-mono text-[10.5px] text-gray-3">
                      {lead.audit_trail.map((ev, i) => (
                        <span key={i}>
                          {new Date(ev.at).toLocaleString()} · {ev.event}
                          {ev.detail ? ` · ${ev.detail}` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── right: contact + email + actions ───────────────── */}
          <div className="rounded-2xl border border-line bg-card px-5 py-5 lg:sticky lg:top-[64px]">
            <SectionLabel>Public contact channels</SectionLabel>
            <div className="mt-2 flex flex-col gap-1.5">
              {emails.length === 0 && (
                <div className="rounded-xl border border-dashed border-line-2 bg-paper px-3 py-2.5 text-[12px] text-gray-2">
                  No public email found on the website — you can add a recipient manually below.
                </div>
              )}
              {emails.length > 0 && (
                /* long candidate lists collapse to the 10 best (nothing is
                   ever dropped from the data) and scroll inside this box */
                <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto pr-1">
                  {(showAllEmails ? emails : emails.slice(0, 10)).map((e) => (
                    <div key={e.address} className="flex shrink-0 items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[12px] text-ink">{e.address}</span>
                        {e.source_url === 'manual' ? (
                          <span className="block truncate text-[10px] text-gray-3">added manually</span>
                        ) : (
                          <a href={e.source_url} target="_blank" rel="noreferrer" className="block truncate text-[10px] text-gray-3 underline-offset-2 hover:underline">
                            {e.source_url}
                          </a>
                        )}
                      </span>
                      {e.source_url === 'manual' && <Chip className="border-line bg-paper-2 text-gray-2">manual</Chip>}
                      {e.generic && <Chip className="tint-good">generic</Chip>}
                      {e.kind === 'third_party' && <Chip className="tint-warn">third-party</Chip>}
                      {e.kind === 'freemail' && <Chip className="border-line bg-paper-2 text-gray-2">freemail</Chip>}
                      {e.mx === 'no_mx' && <Chip className="tint-bad">no MX</Chip>}
                    </div>
                  ))}
                </div>
              )}
              {emails.length > 10 && (
                <button
                  type="button"
                  onClick={() => setShowAllEmails((v) => !v)}
                  className="self-start text-[10.5px] text-gray-2 underline underline-offset-2 hover:text-ink"
                >
                  {showAllEmails ? 'Show the 10 best only' : `Show all ${emails.length} addresses`}
                </button>
              )}
              {emails.length > 4 && (
                <span className="text-[10.5px] text-gray-3">best candidates first — scroll inside the list</span>
              )}
              {lead.contact.phones.length > 0 && (
                <div className="text-[11.5px] text-gray-2">☎ {lead.contact.phones.join(' · ')}</div>
              )}
              {lead.contact.forms.length > 0 && (
                <div className="truncate text-[11.5px] text-gray-2">
                  ✎ contact form:{' '}
                  <a className="underline underline-offset-2" href={lead.contact.forms[0]} target="_blank" rel="noreferrer">
                    {lead.contact.forms[0]}
                  </a>
                </div>
              )}
            </div>

            {source === 'approval_list' && lead.status === 'pending' && (
              <div className={`mt-4 rounded-2xl border p-3.5 ${!recipient ? 'tint-warn' : 'border-line bg-paper'}`}>
                <SectionLabel>
                  Recipient {needsSelection ? '— selection required (multiple emails found)' : ''}
                </SectionLabel>
                {emails.length > 0 && (
                  <Select
                    className="mt-2 w-full font-mono text-[12px]"
                    value={recipient}
                    onChange={(e) => {
                      const value = e.target.value
                      setRecipient(value)
                      if (value) void selectEmail(id, value).catch(() => {})
                    }}
                  >
                    <option value="">— choose the recipient —</option>
                    {emails.map((e) => (
                      <option key={e.address} value={e.address}>
                        {e.address}
                        {e.mx === 'no_mx'
                          ? '  (no MX — will bounce!)'
                          : e.source_url === 'manual'
                            ? '  (manual)'
                            : e.kind === 'third_party'
                              ? '  (third-party!)'
                              : e.generic
                                ? '  (generic)'
                                : ''}
                      </option>
                    ))}
                  </Select>
                )}
                <div className="mt-2 flex items-center gap-1.5">
                  <Input
                    className="min-w-0 flex-1 font-mono text-[12px]"
                    type="email"
                    placeholder="add an email manually…"
                    value={manualEmail}
                    onChange={(e) => setManualEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && manualEmail.trim()) {
                        void run('add-email', async () => {
                          await addEmail(id, manualEmail.trim())
                          setManualEmail('')
                          await load()
                        })
                      }
                    }}
                  />
                  <Button
                    variant="ghost"
                    disabled={!manualEmail.trim() || busy !== null}
                    onClick={() =>
                      run('add-email', async () => {
                        await addEmail(id, manualEmail.trim())
                        setManualEmail('')
                        await load()
                      })
                    }
                  >
                    {busy === 'add-email' ? 'Adding…' : 'Add'}
                  </Button>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* ── outreach email — full-width preview + actions ──────────── */}
        <div className="mt-4 rounded-2xl border border-line bg-card px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionLabel>Outreach email</SectionLabel>
            <Chip title="Decided by the country this lead was found in">
              {flagEmoji(lead.country)} {langLabel(lead.language)}
            </Chip>
          </div>

          <div className="mx-auto mt-3 w-full max-w-[920px]">
            {/* which template this send uses — the resolver only suggests */}
            <div className="flex flex-wrap items-center gap-2">
              <Select
                className="min-w-[280px] flex-1"
                value={oneOff ? 'one_off' : (chosenTemplate ?? '')}
                disabled={busy !== null || noTemplates}
                onChange={(e) => {
                  const value = e.target.value
                  if (value === 'one_off') setOneOff({ subject: '', body: '', html: false })
                  else onPickTemplate(value)
                }}
              >
                {templateOptions?.templates.map((t) => (
                  <option key={t.id} value={t.id} disabled={!serves(t)}>
                    {t.name}
                    {t.id === templateOptions.suggested_id ? ' · suggested for this category' : ''}
                    {serves(t) ? '' : ` · nothing written in ${langLabel(leadLanguage)} for this step`}
                  </option>
                ))}
                <option value="one_off">Write a one-off email…</option>
              </Select>

              {/* Which language of that template to look at. The send always
                  uses the lead's own — this only changes what is on screen. */}
              {!oneOff && templateLanguages.length > 1 && (
                <Select
                  className="w-[210px]"
                  value={previewLang && templateLanguages.includes(previewLang) ? previewLang : leadLanguage}
                  onChange={(e) => setPreviewLang(e.target.value)}
                >
                  {templateLanguages.map((l) => (
                    <option key={l} value={l}>
                      {langLabel(l)}
                      {l === leadLanguage ? ' · this lead' : ''}
                    </option>
                  ))}
                </Select>
              )}

              {source === 'approved' &&
                lead.outreach &&
                lead.outreach.count >= 1 &&
                lead.outreach.count <= (templateOptions?.max_followups ?? 2) && (
                  <button
                    onClick={() => setPreviewFollowup((f) => (f ? 0 : lead.outreach.count))}
                    className={`rounded-lg border border-line px-3 py-1.5 text-[12px] transition-colors ${
                      previewFollowup ? 'bg-brand-green-soft font-medium text-brand-green' : 'text-gray-2 hover:text-ink'
                    }`}
                    title="Preview the next follow-up email"
                  >
                    Follow-up {lead.outreach.count}/{templateOptions?.max_followups ?? 2}
                  </button>
                )}
            </div>

            {noTemplates && (
              <div className="mt-2 rounded-xl border px-3.5 py-2.5 text-[12.5px] tint-warn">
                You have no saved email template yet. Create one in Settings → Create, or write a one-off
                email below — until then there is nothing to send.
              </div>
            )}

            {noneInLanguage && (
              <div className="mt-2 rounded-xl border px-3.5 py-2.5 text-[12.5px] tint-warn">
                This lead reads {langLabel(leadLanguage)}, and no template is written in it
                {previewFollowup ? ` for follow-up ${previewFollowup}` : ''}. Add that language to one of your
                templates in Settings → Templates, or write a one-off email below.
              </div>
            )}

            {oneOff && (
              <div className="mt-2 rounded-xl border border-line bg-paper p-3">
                <div className="flex items-center justify-between gap-2">
                  <SectionLabel>One-off email · not saved to the library</SectionLabel>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-[11.5px] text-gray-2">
                      <input
                        type="checkbox"
                        checked={oneOff.html}
                        onChange={(e) => setOneOff({ ...oneOff, html: e.target.checked })}
                      />
                      write HTML
                    </label>
                    <Button variant="ghost" onClick={() => setOneOff(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
                <Input
                  className="mt-2"
                  placeholder="Subject — {{business_name}} works here too"
                  value={oneOff.subject}
                  onChange={(e) => setOneOff({ ...oneOff, subject: e.target.value })}
                />
                <textarea
                  className="mt-2 h-44 w-full rounded-xl border border-line bg-card px-3 py-2 font-mono text-[12.5px] text-ink outline-none focus:border-gray-3"
                  placeholder={oneOff.html ? '<p>Hi {{business_name}}…</p>' : 'Hi {{business_name}},\n\nI had a look at your Google profile…'}
                  value={oneOff.body}
                  onChange={(e) => setOneOff({ ...oneOff, body: e.target.value })}
                />
                <div className="mt-1 text-[11px] text-gray-3">
                  The preview below updates as you type. The unsubscribe footer is added automatically.
                </div>
              </div>
            )}

            {previewLang && templateLanguages.includes(previewLang) && previewLang !== leadLanguage && (
              <div className="mt-1.5 text-[11px] tint-warn-text">
                Preview only — the sent email uses the lead’s market language: {langLabel(leadLanguage)}.
              </div>
            )}
            {preview && (
              <>
                <div className="mt-2 text-[10.5px] text-gray-3">
                  {preview.template_name || 'One-off email'} · variant {preview.subject_variant + 1} (picked for this
                  lead){preview.followup ? ` · follow-up #${preview.followup}` : ''} · sent with a plain-text version
                </div>
                <div className="mt-2">
                  <GmailFrame
                    subject={preview.subject}
                    senderName={appStatus?.sender_name ?? 'Your name'}
                    senderEmail={appStatus?.sender_email ?? 'sender@example.com'}
                    html={preview.html}
                    height={640}
                  />
                </div>
              </>
            )}

            {(actionError || approveResult) && (
              <div
                className={`mt-3 rounded-xl border px-3.5 py-2.5 text-[12.5px] ${
                  actionError ? 'tint-bad' : 'tint-good'
                }`}
              >
                {actionError ?? approveResult}
              </div>
            )}

            {/* actions */}
            <div className="mt-4 flex items-center gap-2 border-t border-line pt-3.5">
              {source === 'approval_list' && lead.status === 'pending' && (
                <>
                  <Button variant="green" className="flex-1" disabled={!canApprove || busy !== null} onClick={onApprove} title={!canApprove ? 'Select a recipient first' : undefined}>
                    {busy === 'approve' ? 'Sending…' : 'Approve & send'}
                  </Button>
                  <Button variant="ghost" disabled={busy !== null} onClick={() => run('skip', () => skipLead(id).then(goBack))}>
                    Skip
                  </Button>
                  <Button variant="danger" disabled={busy !== null} onClick={() => run('dnc', () => doNotContactLead(id).then(goBack))}>
                    Do not contact
                  </Button>
                </>
              )}
              {source === 'approval_list' && (lead.status === 'skipped' || lead.status === 'archived') && (
                <Button variant="ghost" disabled={busy !== null} onClick={() => run('reopen', () => reopenLead(id).then(load))}>
                  Reopen as pending
                </Button>
              )}
              {source === 'approved' && (
                <div className="flex w-full items-center gap-2">
                  <Chip
                    className={
                      lead.delivery.state === 'failed'
                        ? 'tint-bad'
                        : 'tint-good'
                    }
                  >
                    {lead.delivery.state.replace(/_/g, ' ')}
                    {lead.delivery.sent_at ? ` · ${new Date(lead.delivery.sent_at).toLocaleString()}` : ''}
                  </Chip>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-gray-2">
                    {lead.delivery.state === 'failed'
                      ? lead.delivery.last_error
                      : `to ${lead.contact.selected_email ?? '—'} · “${lead.delivery.subject ?? ''}”`}
                  </span>
                  {lead.delivery.state === 'failed' && (
                    <Button variant="primary" disabled={busy !== null} onClick={() => run('retry', () => retryDelivery(id).then(load))}>
                      {busy === 'retry' ? 'Retrying…' : 'Retry send'}
                    </Button>
                  )}
                  {followupDue && (
                    <>
                      <Button
                        variant="green"
                        disabled={busy !== null}
                        onClick={() => run('followup', () => sendFollowup(id).then(load))}
                        title="Send the next follow-up (different variant, “it’s me again” tone)"
                      >
                        {busy === 'followup' ? 'Sending…' : `Send follow-up ${lead.outreach.count + 1}/3`}
                      </Button>
                      <Button variant="ghost" disabled={busy !== null} onClick={() => run('fstop', () => stopFollowups(id).then(load))}>
                        Stop follow-ups
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
