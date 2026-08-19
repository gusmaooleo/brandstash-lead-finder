/**
 * Cold-email observability — route: /email-analytics
 *
 * Everything here measures CONSENTED LANDING VISITS (recipient clicked a
 * tracked link AND accepted cookies on the landing) — never "email opens";
 * there is no tracking pixel. Data comes from the lead finder's own
 * email_sends records; "Sync" reconciles them against the landing's
 * landing_visit_events store and persists the summaries locally, so history
 * survives the landing's 180-day event TTL. A failed sync is shown as its
 * own error state — it never masquerades as "no visits".
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getAnalyticsOverview,
  getAnalyticsSends,
  getSendDetail,
  runAnalyticsSync,
  sendsCsvUrl,
  type AnalyticsOverview,
  type BreakdownRow,
  type EmailSendRow,
  type SendLandingStatus,
  type SendTimelineEntry,
} from '../api'
import { Button, Chip, Input, Select, SectionLabel } from './ui'
import { ThemeToggle, useTheme } from './ThemeToggle'
import { SendsChart } from './SendsChart'

/* ── small formatters ─────────────────────────────────────────────────── */

const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—'

const fmtPct = (v: number) => `${v.toFixed(v >= 10 ? 0 : 1)}%`

function fmtHours(h: number | null): string {
  if (h == null) return '—'
  if (h < 1) return `${Math.round(h * 60)}min`
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)}h`
  return `${(h / 24).toFixed(1)}d`
}

/* ── badges (also the accessible text for each landing state) ─────────── */

const LANDING_BADGE: Record<SendLandingStatus, { label: string; cls: string }> = {
  visited: { label: 'Visited landing', cls: 'tint-good' },
  no_visit: { label: 'Sent · no visit', cls: 'border-line bg-paper-2 text-gray-1' },
  untracked: { label: 'Untracked', cls: 'border-line bg-paper-2 text-gray-3' },
  failed: { label: 'Send failed', cls: 'tint-bad' },
  queued: { label: 'Awaiting send', cls: 'tint-warn' },
}

function LandingBadge({ status }: { status: SendLandingStatus }) {
  const b = LANDING_BADGE[status]
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] ${b.cls}`}>
      {b.label}
    </span>
  )
}

function MetricCard({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.09em] text-gray-2">{label}</div>
      <div className={`mt-1 font-mono text-[22px] font-semibold tabular-nums leading-tight ${accent ? 'text-brand-green' : 'text-ink'}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-[10.5px] text-gray-3">{hint}</div>}
    </div>
  )
}

/* ── period selector ──────────────────────────────────────────────────── */

type Period = { kind: '7' | '30' | '90' | 'custom'; from: string; to: string }

function periodParams(p: Period): Record<string, string> {
  if (p.kind === 'custom') return { ...(p.from ? { from: p.from } : {}), ...(p.to ? { to: p.to } : {}) }
  return { days: p.kind }
}

/* ── send detail drawer ───────────────────────────────────────────────── */

const TIMELINE_LABEL: Record<string, string> = {
  record_created: 'Send record created',
  provider_accepted: 'Provider accepted the email',
  sent_dry_run: 'Rendered in dry-run mode (nothing sent)',
  send_failed: 'Provider failed',
  first_landing_visit: 'First consented landing visit',
  last_landing_visit: 'Most recent landing visit',
}

function SendDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<{ send: EmailSendRow; timeline: SendTimelineEntry[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDetail(null)
    getSendDetail(id).then(setDetail).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const s = detail?.send
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-label="Send details">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="brand-rise absolute inset-y-0 right-0 flex w-full max-w-[440px] flex-col border-l border-line bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <span className="text-[13.5px] font-semibold text-ink">{s?.lead_name ?? 'Loading…'}</span>
          {s && <LandingBadge status={s.landing_status} />}
          <button onClick={onClose} className="ml-auto rounded-lg border border-line bg-paper-2 px-2 py-1 text-[12px] text-gray-2 hover:text-ink">
            Esc ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && <div className="tint-bad rounded-xl border px-3 py-2 text-[12px]">{error}</div>}
          {s && (
            <>
              <SectionLabel>Send</SectionLabel>
              <div className="mt-2 space-y-1.5 text-[12.5px] text-gray-1">
                <div className="flex justify-between gap-3"><span className="text-gray-2">Recipient</span><span className="truncate font-mono text-[11.5px] text-ink">{s.recipient}</span></div>
                <div className="flex justify-between gap-3"><span className="text-gray-2">Type · template</span><span className="text-ink">{s.style ?? '—'} · {s.template_id ?? '—'}</span></div>
                <div className="flex justify-between gap-3"><span className="text-gray-2">Variant</span><span className="text-ink">{s.variant != null ? `v${s.variant + 1}` : '—'}</span></div>
                <div className="flex justify-between gap-3"><span className="text-gray-2">Campaign</span><span className="truncate text-ink">{s.campaign ?? '—'}</span></div>
                <div className="flex justify-between gap-3"><span className="text-gray-2">Attempt</span><span className="text-ink">{s.attempt}/3{s.followup > 0 ? ` (follow-up ${s.followup})` : ''}</span></div>
                <div className="flex justify-between gap-3"><span className="text-gray-2">Status</span><span className="text-ink">{s.status}</span></div>
                {s.error && <div className="tint-bad rounded-lg border px-2.5 py-1.5 text-[11.5px]">{s.error}</div>}
                <div className="flex justify-between gap-3">
                  <span className="text-gray-2">Tracking</span>
                  <span className="font-mono text-[11px] text-gray-2">{s.tracked ? s.tracking_hash_masked : 'untracked'}</span>
                </div>
              </div>

              <div className="mt-5"><SectionLabel>Landing visits (consented)</SectionLabel></div>
              <div className="mt-2 space-y-1.5 text-[12.5px] text-gray-1">
                <div className="flex justify-between gap-3"><span className="text-gray-2">Sessions</span><span className="font-mono tabular-nums text-ink">{s.landing_visit.event_count}</span></div>
                <div className="flex justify-between gap-3"><span className="text-gray-2">First visit</span><span className="text-ink">{fmtDateTime(s.landing_visit.first_observed_at)}</span></div>
                <div className="flex justify-between gap-3"><span className="text-gray-2">Last visit</span><span className="text-ink">{fmtDateTime(s.landing_visit.last_observed_at)}</span></div>
                <div className="flex justify-between gap-3"><span className="text-gray-2">Last synced</span><span className="text-ink">{fmtDateTime(s.landing_visit.synced_at)}</span></div>
              </div>

              <div className="mt-5"><SectionLabel>Timeline</SectionLabel></div>
              <ol className="mt-2 space-y-0">
                {detail!.timeline.map((t, i) => (
                  <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                    <span className="relative flex w-3 shrink-0 justify-center">
                      {i < detail!.timeline.length - 1 && <span className="absolute bottom-0 top-3 w-px bg-line-2" />}
                      <span className={`mt-1.5 size-2 rounded-full ${t.event.includes('visit') ? 'bg-brand-green' : t.event === 'send_failed' ? 'bg-bad' : 'bg-gray-3'}`} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] text-ink">{TIMELINE_LABEL[t.event] ?? t.event}</span>
                      <span className="block truncate text-[11px] text-gray-3">
                        {fmtDateTime(t.at)}{t.detail ? ` · ${t.detail}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── page ─────────────────────────────────────────────────────────────── */

type SendFilters = { q: string; landing: string; style: string; attempt: string; status: string }
const EMPTY_SEND_FILTERS: SendFilters = { q: '', landing: '', style: '', attempt: '', status: '' }

const GROUPS: Array<{ key: keyof AnalyticsOverview['breakdowns']; label: string }> = [
  { key: 'template', label: 'Template' },
  { key: 'variant', label: 'Variant' },
  { key: 'style', label: 'Email type' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'attempt', label: 'Attempt' },
]

const PAGE_SIZE = 25
const LOW_SAMPLE = 5

export function AnalyticsPage() {
  const navigate = useNavigate()
  const [theme, toggleTheme] = useTheme()

  const [period, setPeriod] = useState<Period>({ kind: '30', from: '', to: '' })
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [syncBusy, setSyncBusy] = useState(false)
  const [syncNote, setSyncNote] = useState<string | null>(null)

  const [groupBy, setGroupBy] = useState<keyof AnalyticsOverview['breakdowns']>('template')

  const [filters, setFilters] = useState<SendFilters>(EMPTY_SEND_FILTERS)
  const [page, setPage] = useState(1)
  const [sends, setSends] = useState<{ total: number; rows: EmailSendRow[] }>({ total: 0, rows: [] })
  const [sendsError, setSendsError] = useState<string | null>(null)
  const [drawerId, setDrawerId] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && drawerId == null && navigate('/')
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, drawerId])

  const loadOverview = useCallback(async () => {
    setLoading(true)
    try {
      setOverview(await getAnalyticsOverview(periodParams(period)))
      setOverviewError(null)
    } catch (e) {
      setOverviewError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [period])

  const sendParams = useMemo(
    () => ({
      ...periodParams(period),
      ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
      page: String(page),
      page_size: String(PAGE_SIZE),
    }),
    [period, filters, page],
  )

  const loadSends = useCallback(async () => {
    try {
      const res = await getAnalyticsSends(sendParams)
      setSends({ total: res.total, rows: res.sends })
      setSendsError(null)
    } catch (e) {
      setSendsError(e instanceof Error ? e.message : String(e))
    }
  }, [sendParams])

  useEffect(() => void loadOverview(), [loadOverview])
  useEffect(() => void loadSends(), [loadSends])
  useEffect(() => setPage(1), [filters, period])

  const onSync = async () => {
    setSyncBusy(true)
    setSyncNote(null)
    try {
      const result = await runAnalyticsSync()
      setSyncNote(
        result.ok
          ? `Synced: ${result.events_seen} event${result.events_seen === 1 ? '' : 's'} across ${result.sends_with_tracking} tracked sends.`
          : null,
      )
      await Promise.all([loadOverview(), loadSends()])
    } catch (e) {
      setOverviewError(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncBusy(false)
    }
  }

  const totals = overview?.totals
  const sync = overview?.sync
  const breakdownRows: BreakdownRow[] = overview?.breakdowns[groupBy] ?? []
  const pages = Math.max(1, Math.ceil(sends.total / PAGE_SIZE))
  const setFilter = (key: keyof SendFilters, value: string) => setFilters((f) => ({ ...f, [key]: value }))

  return (
    <div className="flex h-screen flex-col bg-paper">
      {/* header */}
      <div className="shrink-0 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1480px] flex-wrap items-center gap-3 px-5 py-3">
          <Button variant="ghost" onClick={() => navigate('/')} className="!px-3.5" title="Back to the dashboard (Esc)">
            <span aria-hidden>←</span> Back
          </Button>
          <div className="flex items-baseline gap-2">
            <h1 className="text-[15px] font-bold tracking-tight">Cold email performance</h1>
            <span className="hidden text-[12px] text-gray-2 md:inline">consented landing visits · no open pixel</span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            {sync?.last_sync_ok === false && (
              <span title={sync.last_sync_error ?? undefined}>
                <Chip className="tint-bad">last sync failed</Chip>
              </span>
            )}
            <span className="text-[11.5px] text-gray-3">
              {syncBusy ? 'Syncing landing data…' : sync?.last_synced_at ? `synced ${fmtDateTime(sync.last_synced_at)}` : 'never synced'}
            </span>
            <Button variant="green" onClick={onSync} disabled={syncBusy} className="!px-3.5 !py-1.5 !text-[12.5px]">
              {syncBusy ? 'Syncing…' : '⟳ Sync landing data'}
            </Button>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1480px] space-y-4 px-5 py-4">
          {overviewError && (
            <div className="tint-bad brand-rise rounded-xl border px-4 py-2.5 text-[12.5px]">
              Failed to load analytics: {overviewError}
            </div>
          )}
          {sync?.last_sync_ok === false && (
            <div className="tint-warn brand-rise rounded-xl border px-4 py-2.5 text-[12.5px]">
              The last landing sync failed ({sync.last_sync_error ?? 'unknown error'}). Numbers below come from the
              last successful reconciliation — missing visits here mean "not synced yet", not "no visits".
            </div>
          )}
          {syncNote && <div className="tint-good brand-rise rounded-xl border px-4 py-2.5 text-[12.5px]">{syncNote}</div>}

          {/* period selector */}
          <div className="brand-rise flex flex-wrap items-center gap-1.5">
            {(['7', '30', '90'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setPeriod({ kind: d, from: '', to: '' })}
                className={`rounded-lg border px-3 py-1.5 text-[12px] transition-colors ${
                  period.kind === d
                    ? 'border-brand-green-line bg-brand-green-soft text-brand-green'
                    : 'border-line bg-paper-2 text-gray-2 hover:text-ink'
                }`}
              >
                {d} days
              </button>
            ))}
            <button
              onClick={() => setPeriod((p) => ({ ...p, kind: 'custom' }))}
              className={`rounded-lg border px-3 py-1.5 text-[12px] transition-colors ${
                period.kind === 'custom'
                  ? 'border-brand-green-line bg-brand-green-soft text-brand-green'
                  : 'border-line bg-paper-2 text-gray-2 hover:text-ink'
              }`}
            >
              Custom
            </button>
            {period.kind === 'custom' && (
              <span className="flex items-center gap-1">
                <Input type="date" className="w-[128px]" value={period.from} onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))} />
                <span className="text-[11px] text-gray-3">→</span>
                <Input type="date" className="w-[128px]" value={period.to} onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))} />
              </span>
            )}
            {overview && (
              <span className="ml-auto text-[11.5px] text-gray-3">
                {fmtDateTime(overview.range.from)} → {fmtDateTime(overview.range.to)}
              </span>
            )}
          </div>

          {/* metric cards */}
          <section className="brand-rise grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard label="Emails sent" value={loading && !totals ? '…' : String(totals?.emails_sent ?? 0)}
              hint={totals ? `${totals.untracked_sends} untracked · ${totals.failed_sends} failed` : undefined} />
            <MetricCard label="Sends with visit" value={loading && !totals ? '…' : String(totals?.visited_sends ?? 0)}
              hint="each send counts once" accent />
            <MetricCard label="Landing visit rate" value={loading && !totals ? '…' : fmtPct(totals?.landing_visit_rate ?? 0)} accent />
            <MetricCard label="Unique visited leads" value={loading && !totals ? '…' : String(totals?.unique_visited_leads ?? 0)} />
            <MetricCard label="Consented sessions" value={loading && !totals ? '…' : String(totals?.consented_sessions ?? 0)}
              hint="cookie-accepted only" />
            <MetricCard label="Median send → visit" value={loading && !totals ? '…' : fmtHours(totals?.median_hours_to_first_visit ?? null)} />
          </section>

          {/* chart */}
          <section className="brand-rise rounded-3xl border border-line bg-card p-4">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <SectionLabel>Daily sends & landing visits</SectionLabel>
              <span className="ml-auto flex items-center gap-3 text-[11px] text-gray-1">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: 'var(--color-chart-sent)' }} /> sent
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: 'var(--color-chart-visited)' }} /> visited landing
                </span>
              </span>
            </div>
            {overview && overview.timeseries.some((p) => p.sent > 0) ? (
              <SendsChart data={overview.timeseries} />
            ) : (
              <div className="flex h-[200px] items-center justify-center text-[12.5px] text-gray-3">
                {loading ? 'Loading…' : 'No sends in this period yet.'}
              </div>
            )}
          </section>

          {/* comparatives */}
          <section className="brand-rise rounded-3xl border border-line bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center gap-1">
              <SectionLabel>Compare</SectionLabel>
              <span className="mx-1.5 h-4 w-px bg-line" />
              {GROUPS.map((g) => (
                <button
                  key={g.key}
                  onClick={() => setGroupBy(g.key)}
                  className={`rounded-lg px-2.5 py-1 text-[12px] transition-colors ${
                    groupBy === g.key ? 'bg-paper-2 font-medium text-ink' : 'text-gray-2 hover:text-ink'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
            {breakdownRows.length === 0 ? (
              <div className="py-6 text-center text-[12.5px] text-gray-3">Nothing sent in this period.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-gray-2">
                      <th className="px-3 py-2 font-medium">{GROUPS.find((g) => g.key === groupBy)?.label}</th>
                      <th className="px-3 py-2 text-right font-medium">Sent</th>
                      <th className="px-3 py-2 text-right font-medium">Visited</th>
                      <th className="px-3 py-2 font-medium">Visit rate</th>
                      <th className="px-3 py-2 text-right font-medium">Sessions</th>
                      <th className="px-3 py-2 text-right font-medium">Median → visit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdownRows.map((b) => (
                      <tr key={b.key} className="border-b border-line/60 last:border-b-0">
                        <td className="px-3 py-2 font-mono text-[11.5px] text-ink">{b.key}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-1">{b.sent}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-1">{b.visited}</td>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-paper-3">
                              <span
                                className="block h-full rounded-full"
                                style={{ width: `${Math.min(100, b.rate)}%`, background: 'var(--color-chart-visited)' }}
                              />
                            </span>
                            <span className={`font-mono text-[11.5px] tabular-nums ${b.sent < LOW_SAMPLE ? 'text-gray-3' : 'text-ink'}`}>
                              {fmtPct(b.rate)}
                            </span>
                            {b.sent < LOW_SAMPLE && (
                              <span className="text-[10px] text-gray-3" title={`Fewer than ${LOW_SAMPLE} sends — read with care`}>
                                low sample
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-1">{b.sessions}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-1">{fmtHours(b.median_hours_to_first_visit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* sends table */}
          <section className="brand-rise rounded-3xl border border-line bg-card">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
              <SectionLabel>All sends</SectionLabel>
              <span className="mx-1.5 h-4 w-px bg-line" />
              <Input className="w-52" placeholder="Search lead or recipient…" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} />
              <Select value={filters.landing} onChange={(e) => setFilter('landing', e.target.value)}>
                <option value="">Landing: all</option>
                <option value="visited">Visited landing</option>
                <option value="no_visit">Sent, no visit</option>
                <option value="untracked">Untracked</option>
              </Select>
              <Select value={filters.style} onChange={(e) => setFilter('style', e.target.value)}>
                <option value="">Type: all</option>
                <option value="note">Personal note</option>
                <option value="dashboard">Dashboard</option>
              </Select>
              <Select value={filters.attempt} onChange={(e) => setFilter('attempt', e.target.value)}>
                <option value="">Attempt: all</option>
                <option value="1">1 · initial</option>
                <option value="2">2 · bump</option>
                <option value="3">3 · breakup</option>
              </Select>
              <Select value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
                <option value="">Status: all</option>
                <option value="sent">Sent</option>
                <option value="sent_dry_run">Dry run</option>
                <option value="failed">Failed</option>
                <option value="queued">Queued</option>
              </Select>
              <a
                href={sendsCsvUrl(sendParams)}
                download
                className="ml-auto rounded-lg border border-line bg-paper-2 px-2.5 py-1.5 text-[12px] text-gray-2 transition-colors hover:border-line-2 hover:text-ink"
              >
                ⇩ Export CSV
              </a>
            </div>

            {sendsError && <div className="tint-bad m-3 rounded-xl border px-4 py-2.5 text-[12.5px]">{sendsError}</div>}

            {sends.rows.length === 0 && !sendsError ? (
              <div className="px-6 py-10 text-center text-[12.5px] text-gray-3">
                No sends match — approve a lead and its email lands here with its own tracking id.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-gray-2">
                      <th className="px-4 py-2.5 font-medium">Lead</th>
                      <th className="px-3 py-2.5 font-medium">Recipient</th>
                      <th className="px-3 py-2.5 font-medium">Type</th>
                      <th className="px-3 py-2.5 font-medium">Template</th>
                      <th className="px-3 py-2.5 font-medium">Campaign</th>
                      <th className="px-3 py-2.5 text-center font-medium">Att.</th>
                      <th className="px-3 py-2.5 font-medium">Sent at</th>
                      <th className="px-3 py-2.5 font-medium">Landing</th>
                      <th className="px-3 py-2.5 font-medium">First visit</th>
                      <th className="px-3 py-2.5 text-right font-medium">Sessions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sends.rows.map((s) => (
                      <tr
                        key={s.id}
                        onClick={() => setDrawerId(s.id)}
                        className="cursor-pointer border-b border-line/60 transition-colors last:border-b-0 hover:bg-paper-2"
                      >
                        <td className="max-w-[220px] truncate px-4 py-2.5 font-medium text-ink">{s.lead_name}</td>
                        <td className="max-w-[200px] truncate px-3 py-2.5 font-mono text-[11px] text-gray-2">{s.recipient}</td>
                        <td className="px-3 py-2.5 text-gray-1">{s.style ?? '—'}</td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-gray-2">{s.template_id ?? '—'}</td>
                        <td className="max-w-[160px] truncate px-3 py-2.5 font-mono text-[11px] text-gray-2">{s.campaign ?? '—'}</td>
                        <td className="px-3 py-2.5 text-center font-mono tabular-nums text-gray-1">{s.attempt}/3</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-gray-1">{fmtDateTime(s.sent_at)}</td>
                        <td className="px-3 py-2.5"><LandingBadge status={s.landing_status} /></td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-gray-1">{fmtDateTime(s.landing_visit.first_observed_at)}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-gray-1">{s.landing_visit.event_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11.5px] text-gray-3">
              <span>
                {sends.total} send{sends.total === 1 ? '' : 's'}
                {Object.values(filters).some(Boolean) && (
                  <button className="ml-2 text-gray-2 hover:text-ink" onClick={() => setFilters(EMPTY_SEND_FILTERS)}>
                    clear filters
                  </button>
                )}
              </span>
              <span className="flex items-center gap-1.5">
                <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ← Prev
                </Button>
                <span className="font-mono tabular-nums">{page}/{pages}</span>
                <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  Next →
                </Button>
              </span>
            </div>
          </section>

          <p className="pb-4 text-center text-[10.5px] text-gray-3">
            Visits require the recipient to click a tracked link AND accept cookies on the landing — a click without
            consent is never counted. Landing events expire after 180 days; summaries persist here.
          </p>
        </div>
      </main>

      {drawerId && <SendDrawer id={drawerId} onClose={() => setDrawerId(null)} />}
    </div>
  )
}
