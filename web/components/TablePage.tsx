/**
 * Full-width lead table — route: /table?status=<tab>
 * Every field of a lead as a column, all filters visible, sortable columns.
 * The dashboard feed panel links here ("Expand"); Esc or ← goes back.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getLeads, getMarkets, getStatus, type Lead, type MarketInfo, type Status } from '../api'
import { Button, Chip, Input, Select, flagEmoji, langLabel, scoreColor } from './ui'
import { RowActions, type LeadTabKey } from './RowActions'
import { ThemeToggle, useTheme } from './ThemeToggle'

const TABS: Array<{ key: LeadTabKey; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'followup', label: 'Follow-up' },
  { key: 'approved', label: 'Approved' },
  { key: 'sent', label: 'Sent' },
  { key: 'failed', label: 'Failed' },
  { key: 'skipped', label: 'Skipped' },
  { key: 'do_not_contact', label: 'Do not contact' },
  { key: 'archived', label: 'Archived' },
]

type Filters = {
  country: string
  language: string
  category: string
  score_min: string
  score_max: string
  rating_min: string
  rating_max: string
  has_email: string
  date_from: string
  date_to: string
  q: string
}

const EMPTY_FILTERS: Filters = {
  country: '', language: '', category: '', score_min: '', score_max: '',
  rating_min: '', rating_max: '', has_email: '', date_from: '', date_to: '', q: '',
}

/** Sorting happens in Mongo (whole result set, not just this page) — these
    keys are sent to GET /api/leads as ?sort=&dir=. */
type SortKey = 'score' | 'name' | 'rating' | 'reviews' | 'emails' | 'found'

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export function TablePage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('status') as LeadTabKey | null
  const tab: LeadTabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as LeadTabKey) : 'pending'

  const [status, setStatus] = useState<Status | null>(null)
  const [markets, setMarkets] = useState<MarketInfo[]>([])
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [leads, setLeads] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null)
  const [theme, toggleTheme] = useTheme()

  const goBack = useCallback(() => navigate('/'), [navigate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && goBack()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goBack])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = { status: tab, page: String(page), page_size: '50' }
      if (sort) {
        params.sort = sort.key
        params.dir = sort.dir === -1 ? 'desc' : 'asc'
      }
      for (const [k, v] of Object.entries(filters)) if (v) params[k] = v
      const res = await getLeads(params)
      setLeads(res.leads)
      setTotal(res.total)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tab, filters, page, sort])

  // Changing tab, filters or sort always restarts at page 1.
  useEffect(() => setPage(1), [tab, filters, sort])

  useEffect(() => {
    void refresh()
    void getStatus().then(setStatus).catch(() => {})
    void getMarkets().then(setMarkets).catch(() => {})
    const t = setInterval(() => void refresh(), 15_000)
    return () => clearInterval(t)
  }, [refresh])

  const allCountries = useMemo(() => {
    const seen = new Map<string, string>()
    for (const m of markets) for (const cc of m.countries) seen.set(cc.code, cc.name)
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [markets])

  const setFilter = (key: keyof Filters, value: string) => setFilters((f) => ({ ...f, [key]: value }))
  const hasFilters = Object.values(filters).some(Boolean)

  const runRowAction = async (lead: Lead, action: string, fn: () => Promise<unknown>) => {
    setRowBusy(`${lead._id}:${action}`)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(`${lead.name}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRowBusy(null)
    }
  }

  const th = (label: string, key?: SortKey, extra = '') => (
    <th
      className={`truncate px-3 py-2.5 font-medium ${key ? 'cursor-pointer select-none hover:text-ink' : ''} ${extra}`}
      onClick={key ? () => setSort((s) => (s?.key === key ? (s.dir === -1 ? { key, dir: 1 } : null) : { key, dir: -1 })) : undefined}
      title={key ? 'Sort' : undefined}
    >
      {label}
      {sort != null && sort.key === key && (
        <span className="ml-1 text-brand-green">{sort.dir === -1 ? '▾' : '▴'}</span>
      )}
    </th>
  )

  const counts = status?.counts

  return (
    <div className="flex h-screen flex-col bg-paper">
      {/* header */}
      <div className="shrink-0 border-b border-line bg-paper/85 backdrop-blur">
        <div className="flex items-center gap-3 px-5 py-3">
          <Button variant="ghost" onClick={goBack} className="!px-3.5" title="Back to the dashboard (Esc)">
            <span aria-hidden>←</span> Back
          </Button>
          <h1 className="text-[15px] font-bold tracking-tight">All leads</h1>
          <span className="text-[12px] text-gray-2">full table · every field</span>
          <span className="ml-auto flex items-center gap-2 text-[11.5px] text-gray-3">
            <span>
              {total} row{total === 1 ? '' : 's'}
            </span>
            {total > 50 && (
              <span className="flex items-center gap-1.5">
                <Button variant="ghost" className="!px-2 !py-0.5 !text-[11px]" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ← Prev
                </Button>
                <span className="font-mono tabular-nums">
                  {page}/{Math.max(1, Math.ceil(total / 50))}
                </span>
                <Button
                  variant="ghost"
                  className="!px-2 !py-0.5 !text-[11px]"
                  disabled={page >= Math.ceil(total / 50)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next →
                </Button>
              </span>
            )}
          </span>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </div>

      {/* tabs + filters */}
      <div className="shrink-0 border-b border-line px-5 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {TABS.map((t) => {
            const count =
              t.key === 'pending' ? counts?.pending
              : t.key === 'followup' ? counts?.followup
              : t.key === 'approved' ? counts?.approved
              : t.key === 'sent' ? counts?.sent
              : t.key === 'failed' ? counts?.failed
              : t.key === 'archived' ? counts?.archived
              : undefined
            return (
              <button
                key={t.key}
                onClick={() => setSearchParams({ status: t.key })}
                className={`rounded-lg px-3 py-1.5 text-[12.5px] transition-colors ${
                  tab === t.key ? 'bg-paper-2 font-medium text-ink' : 'text-gray-2 hover:text-ink'
                }`}
              >
                {t.label}
                {count != null && count > 0 && (
                  <span className="ml-1.5 rounded-full bg-paper-3 px-1.5 font-mono text-[10.5px] text-gray-2 tabular-nums">
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Input className="w-48" placeholder="Search name…" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} />
          <Select value={filters.country} onChange={(e) => setFilter('country', e.target.value)}>
            <option value="">Country: all</option>
            {allCountries.map(([code, name]) => (
              <option key={code} value={code}>
                {flagEmoji(code)} {name}
              </option>
            ))}
          </Select>
          <Select value={filters.language} onChange={(e) => setFilter('language', e.target.value)}>
            <option value="">Language: all</option>
            {['en', 'pt', 'es', 'fr', 'de', 'it', 'zh-TW', 'zh-HK', 'ja', 'ko'].map((l) => (
              <option key={l} value={l}>
                {langLabel(l)}
              </option>
            ))}
          </Select>
          <Select value={filters.has_email} onChange={(e) => setFilter('has_email', e.target.value)}>
            <option value="">Email: any</option>
            <option value="yes">Has public email</option>
            <option value="no">No public email</option>
          </Select>
          <Input className="w-36" placeholder="Category…" value={filters.category} onChange={(e) => setFilter('category', e.target.value)} />
          <span className="flex items-center gap-1">
            <Input className="w-[74px]" type="number" min={0} max={10} step={0.5} placeholder="Score ≥" value={filters.score_min} onChange={(e) => setFilter('score_min', e.target.value)} />
            <Input className="w-[74px]" type="number" min={0} max={10} step={0.5} placeholder="Score ≤" value={filters.score_max} onChange={(e) => setFilter('score_max', e.target.value)} />
          </span>
          <span className="flex items-center gap-1">
            <Input className="w-[68px]" type="number" min={1} max={5} step={0.1} placeholder="★ ≥" value={filters.rating_min} onChange={(e) => setFilter('rating_min', e.target.value)} />
            <Input className="w-[68px]" type="number" min={1} max={5} step={0.1} placeholder="★ ≤" value={filters.rating_max} onChange={(e) => setFilter('rating_max', e.target.value)} />
          </span>
          <span className="flex items-center gap-1">
            <Input className="w-[128px]" type="date" value={filters.date_from} onChange={(e) => setFilter('date_from', e.target.value)} />
            <span className="text-[11px] text-gray-3">→</span>
            <Input className="w-[128px]" type="date" value={filters.date_to} onChange={(e) => setFilter('date_to', e.target.value)} />
          </span>
          {hasFilters && (
            <Button variant="ghost" className="!px-3 !py-1.5 !text-[12px]" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear
            </Button>
          )}
        </div>
        {error && (
          <div className="tint-bad mt-2 rounded-lg border px-3 py-1.5 text-[12px]">{error}</div>
        )}
      </div>

      {/* table — vertical scroll only; fixed layout keeps every column on screen */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {leads.length === 0 ? (
          <div className="px-8 py-20 text-center text-[13px] text-gray-2">{loading ? 'Loading…' : 'No leads match.'}</div>
        ) : (
          <table className="w-full table-fixed border-collapse text-left text-[12.5px]">
            <colgroup>
              <col style={{ width: '4.5%' }} /> {/* score */}
              <col style={{ width: '15.5%' }} /> {/* business */}
              <col style={{ width: '9%' }} /> {/* website */}
              <col style={{ width: '9%' }} /> {/* location */}
              <col style={{ width: '8%' }} /> {/* category */}
              <col style={{ width: '6.5%' }} /> {/* market */}
              <col style={{ width: '4.5%' }} /> {/* rating */}
              <col style={{ width: '4.5%' }} /> {/* reviews */}
              <col style={{ width: '4%' }} /> {/* emails */}
              <col style={{ width: '6.5%' }} /> {/* found */}
              <col style={{ width: '6.5%' }} /> {/* approved */}
              <col style={{ width: '6.5%' }} /> {/* sent */}
              <col style={{ width: '6.5%' }} /> {/* delivery */}
              <col style={{ width: '8.5%' }} /> {/* actions */}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-paper">
              <tr className="border-b border-line text-[10.5px] uppercase tracking-[0.08em] text-gray-2">
                {th('Score', 'score', 'pl-5')}
                {th('Business', 'name')}
                {th('Website')}
                {th('Location')}
                {th('Category')}
                {th('Market')}
                {th('Rating', 'rating')}
                {th('Reviews', 'reviews')}
                {th('Emails', 'emails')}
                {th('Found', 'found')}
                {th('Approved')}
                {th('Sent')}
                {th('Delivery')}
                <th className="truncate px-3 py-2.5 pr-5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr
                  key={lead._id}
                  onClick={() => navigate(`/leads/${lead._id}`)}
                  className="cursor-pointer border-b border-line/60 transition-colors last:border-b-0 hover:bg-paper-2"
                >
                  <td className="py-2.5 pl-5 pr-3">
                    <span className="font-mono text-[13.5px] font-bold tabular-nums" style={{ color: scoreColor(lead.score) }}>
                      {lead.score.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="block truncate font-semibold text-ink">{lead.name}</span>
                    <span
                      className="block truncate font-mono text-[10.5px] text-gray-3"
                      title={
                        lead.contact.selected_email &&
                        lead.contact.emails.find((e) => e.address === lead.contact.selected_email)?.kind ===
                          'third_party'
                          ? 'may be third-party — domain differs from the website'
                          : undefined
                      }
                    >
                      {lead.contact.selected_email ?? lead.place_id}
                      {lead.contact.selected_email &&
                        lead.contact.emails.find((e) => e.address === lead.contact.selected_email)?.kind ===
                          'third_party' && <span className="ml-1 tint-warn-text">⚠ may be third-party</span>}
                    </span>
                  </td>
                  <td className="truncate px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    {lead.website ? (
                      <a
                        href={lead.website}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-brand-green underline-offset-2 hover:underline"
                      >
                        {lead.normalized_domain ?? lead.website}
                      </a>
                    ) : (
                      <span className="text-gray-3">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-gray-1">
                    <span className="block truncate">{lead.city_label}</span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-1">
                    <span className="block truncate">{lead.category ?? lead.types[0] ?? '—'}</span>
                  </td>
                  <td className="truncate px-3 py-2.5 text-gray-1">
                    {flagEmoji(lead.country)} {lead.country} · {langLabel(lead.language)}
                  </td>
                  <td className="truncate px-3 py-2.5 font-mono tabular-nums text-gray-1">
                    {lead.google_rating != null ? `★ ${lead.google_rating.toFixed(1)}` : '—'}
                  </td>
                  <td className="truncate px-3 py-2.5 font-mono tabular-nums text-gray-2">
                    {lead.review_count ?? '—'}
                  </td>
                  <td className="truncate px-3 py-2.5">
                    <span className={lead.contact.emails.length ? 'text-ok' : 'text-gray-3'}>
                      {lead.contact.emails.length || 'none'}
                    </span>
                  </td>
                  <td className="truncate px-3 py-2.5 font-mono text-[11px] text-gray-3">
                    {fmtDate(lead.discovery.discovered_at)}
                  </td>
                  <td className="truncate px-3 py-2.5 font-mono text-[11px] text-gray-3">
                    {fmtDate(lead.approved_at)}
                  </td>
                  <td className="truncate px-3 py-2.5 font-mono text-[11px] text-gray-3">
                    {fmtDate(lead.delivery.sent_at)}
                  </td>
                  <td className="truncate px-3 py-2.5">
                    {lead.delivery.state !== 'not_sent' ? (
                      <Chip
                        className={
                          lead.delivery.state === 'failed'
                            ? 'tint-bad'
                            : 'tint-good'
                        }
                      >
                        {lead.delivery.state.replace(/_/g, ' ')}
                      </Chip>
                    ) : (
                      <span className="text-[11px] text-gray-3">{lead.status.replace(/_/g, ' ')}</span>
                    )}
                  </td>
                  <td className="truncate px-3 py-2.5 pr-5 text-right" onClick={(e) => e.stopPropagation()}>
                    <RowActions lead={lead} tab={tab} rowBusy={rowBusy} run={runRowAction} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
