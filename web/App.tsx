import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getCategories,
  getLeads,
  getMarkets,
  getStatus,
  saveConfig,
  startDiscovery,
  stopDiscovery,
  type Lead,
  type MarketInfo,
  type Status,
} from './api'
import { Button, Chip, Input, Select, Stat, flagEmoji, langLabel, scoreColor } from './components/ui'
import { CategoryPicker } from './components/CategoryPicker'
import { CountryPicker, flagOf } from './components/CountryPicker'
import { LeadGlobe } from './components/Globe'
import { RowActions } from './components/RowActions'
import { ThemeToggle, useTheme } from './components/ThemeToggle'
import { EMAIL_LANGUAGES, type MarketScope } from '../shared/types'

const LOGO_URL = 'https://pub-62b9434b63214cb4b5b74cebb8d4c261.r2.dev/content/brandstash-icon-black.svg'

type TabKey = 'pending' | 'approved' | 'sent' | 'followup' | 'failed' | 'skipped' | 'do_not_contact' | 'archived'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'followup', label: 'Follow-up' },
  { key: 'approved', label: 'Approved' },
  { key: 'sent', label: 'Sent' },
  { key: 'failed', label: 'Failed' },
  { key: 'skipped', label: 'Skipped' },
  { key: 'do_not_contact', label: 'DNC' },
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

function useCountdown(target: string | null): string | null {
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  if (!target) return null
  const ms = new Date(target).getTime() - Date.now()
  if (ms <= 0) return 'now'
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}m ${String(s).padStart(2, '0')}s`
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null)
  const [markets, setMarkets] = useState<MarketInfo[]>([])
  const [tab, setTab] = useState<TabKey>('pending')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [leads, setLeads] = useState<Lead[]>([])
  const [leadsTotal, setLeadsTotal] = useState(0)
  const [page, setPage] = useState(1)
  /** Feed order — 'found' is newest-first, 'score' ranks by the profile analysis. */
  const [sort, setSort] = useState<'found' | 'score'>('found')
  const [loadingLeads, setLoadingLeads] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** `<leadId>:<action>` while an inline row action is in flight. */
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const [theme, toggleTheme] = useTheme()

  // "/" focuses the lead search from anywhere on the dashboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Discovery setup (header controls). The MARKET SELECT APPLIES IMMEDIATELY
  // on change — no separate Save. Only the test city keeps a draft + Apply
  // (it needs typing). Dirtiness lives in REFS read when a status poll
  // RESOLVES: the old `configDirty` state was captured at poll START, so an
  // in-flight response would silently snap the select back to the server
  // value — the owner picked "World", the select reverted, and discovery
  // kept searching the old market.
  const [scope, setScope] = useState<MarketScope>('portuguese')
  const [testCityDraft, setTestCityDraft] = useState('')
  const [cityDirty, setCityDirty] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [catalog, setCatalog] = useState<string[]>([])
  const [selectedCats, setSelectedCats] = useState<string[]>([])
  const [selectedCountries, setSelectedCountries] = useState<string[]>([])
  const scopePendingRef = useRef(false)
  const cityDirtyRef = useRef(false)
  const catsPendingRef = useRef(false)
  const catsSaveTimer = useRef<number | null>(null)
  const countriesPendingRef = useRef(false)
  const countriesSaveTimer = useRef<number | null>(null)

  const refreshStatus = useCallback(async () => {
    try {
      const s = await getStatus()
      setStatus(s)
      setError(null)
      if (!scopePendingRef.current) setScope(s.market_scope)
      if (!cityDirtyRef.current) setTestCityDraft(s.test_city ?? '')
      if (!catsPendingRef.current) setSelectedCats(s.selected_categories ?? [])
      if (!countriesPendingRef.current && !scopePendingRef.current) {
        setSelectedCountries(s.selected_countries ?? [])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const refreshLeads = useCallback(async () => {
    setLoadingLeads(true)
    try {
      const params: Record<string, string> = { status: tab, page: String(page), page_size: '50' }
      // Ranking runs in Mongo over the whole result set, not this page.
      if (sort === 'score') {
        params.sort = 'score'
        params.dir = 'desc'
      }
      for (const [k, v] of Object.entries(filters)) if (v) params[k] = v
      const res = await getLeads(params)
      setLeads(res.leads)
      setLeadsTotal(res.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingLeads(false)
    }
  }, [tab, filters, page, sort])

  // Changing tab, filters or order always restarts at page 1.
  useEffect(() => setPage(1), [tab, filters, sort])

  useEffect(() => {
    void refreshStatus()
    void getMarkets().then(setMarkets).catch(() => {})
    void getCategories().then((r) => setCatalog(r.categories)).catch(() => {})
    const t = setInterval(() => void refreshStatus(), 3000)
    return () => clearInterval(t)
  }, [refreshStatus])

  useEffect(() => {
    void refreshLeads()
    const t = setInterval(() => void refreshLeads(), 10_000)
    return () => clearInterval(t)
  }, [refreshLeads])

  const countdown = useCountdown(status?.next_run_at ?? null)

  const allCountries = useMemo(() => {
    const seen = new Map<string, string>()
    for (const m of markets) for (const cc of m.countries) seen.set(cc.code, cc.name)
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [markets])

  const currentMarket = markets.find((m) => m.scope === scope)
  /** What discovery will actually draw from: the market, narrowed to the picks. */
  const marketCountries = useMemo(() => {
    const all = currentMarket?.countries ?? []
    const picked = all.filter((cc) => selectedCountries.includes(cc.code))
    return picked.length ? picked : all
  }, [currentMarket, selectedCountries])
  const activeMarketLabel = markets.find((m) => m.scope === status?.market_scope)?.label ?? status?.market_scope

  /** Market select — applies immediately; reverts the select if the save fails. */
  const onPickScope = async (next: MarketScope) => {
    const previous = scope
    const previousCountries = selectedCountries
    setScope(next)
    // Country codes belong to the market they were picked in — the server
    // clears them on a scope change, so the picker resets with it.
    setSelectedCountries([])
    scopePendingRef.current = true
    try {
      await saveConfig({ market_scope: next })
      scopePendingRef.current = false
      await refreshStatus()
    } catch (e) {
      scopePendingRef.current = false
      setScope(previous)
      setSelectedCountries(previousCountries)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** Country chips — optimistic UI, saved debounced (latest selection wins). */
  const onChangeCountries = (next: string[]) => {
    setSelectedCountries(next)
    countriesPendingRef.current = true
    if (countriesSaveTimer.current) window.clearTimeout(countriesSaveTimer.current)
    countriesSaveTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          await saveConfig({ selected_countries: next })
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        } finally {
          countriesPendingRef.current = false
          await refreshStatus()
        }
      })()
    }, 350)
  }

  /** Category chips — optimistic UI, saved debounced (latest selection wins). */
  const onChangeCategories = (next: string[]) => {
    setSelectedCats(next)
    catsPendingRef.current = true
    if (catsSaveTimer.current) window.clearTimeout(catsSaveTimer.current)
    catsSaveTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          await saveConfig({ selected_categories: next })
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        } finally {
          catsPendingRef.current = false
          await refreshStatus()
        }
      })()
    }, 350)
  }

  const onApplyCity = async () => {
    setSavingConfig(true)
    try {
      await saveConfig({ test_city: testCityDraft.trim() || null })
      cityDirtyRef.current = false
      setCityDirty(false)
      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingConfig(false)
    }
  }

  const toggleActive = async () => {
    if (!status) return
    try {
      await (status.active ? stopDiscovery() : startDiscovery())
      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const setFilter = (key: keyof Filters, value: string) => setFilters((f) => ({ ...f, [key]: value }))
  const hasFilters = Object.values(filters).some(Boolean)

  const runRowAction = async (lead: Lead, action: string, fn: () => Promise<unknown>) => {
    setRowBusy(`${lead._id}:${action}`)
    setError(null)
    try {
      await fn()
      await Promise.all([refreshLeads(), refreshStatus()])
    } catch (e) {
      setError(`${lead.name}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRowBusy(null)
    }
  }

  return (
    // Viewport-locked: the page itself never scrolls on desktop — only the
    // lead feed does. Below xl the layout stacks and main scrolls instead.
    <div className="flex h-screen flex-col overflow-hidden bg-paper">
      {/* ── header: identity · discovery setup · status/actions ── */}
      <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1720px] items-center gap-3 px-5 py-2.5">
          {/* portrait SVG (302×464), black — inverted on the dark theme */}
          <img src={LOGO_URL} alt="" className={`h-6 w-auto ${theme === 'dark' ? 'invert' : ''}`} />
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-bold tracking-tight">Brandstash</span>
            <span className="hidden text-[13px] text-gray-2 sm:inline">Lead Finder</span>
          </div>

          <span className="mx-1 hidden h-5 w-px bg-line lg:block" />

          {/* discovery setup */}
          <div
            className="hidden items-center gap-1.5 lg:flex"
            title={
              marketCountries.length
                ? `${marketCountries.length} countr${marketCountries.length === 1 ? 'y' : 'ies'} · ${marketCountries
                    .reduce((n, cc) => n + cc.cities, 0)
                    .toLocaleString()} cities picked at random weighted by population · every Google Business category rotated${
                    status ? ` (${status.categories_total.toLocaleString()})` : ''
                  }`
                : undefined
            }
          >
            <Select
              className="max-w-[210px]"
              value={scope}
              title="Applies immediately — the next batch draws from this market"
              onChange={(e) => void onPickScope(e.target.value as MarketScope)}
            >
              {markets.map((m) => (
                <option key={m.scope} value={m.scope}>
                  {m.label}
                </option>
              ))}
            </Select>
            <CountryPicker
              countries={currentMarket?.countries ?? []}
              selected={selectedCountries}
              onChange={onChangeCountries}
            />
            <CategoryPicker catalog={catalog} selected={selectedCats} onChange={onChangeCategories} />
            <Input
              className="w-36"
              value={testCityDraft}
              placeholder="Test city (optional)"
              title="Fixed test city — empty = weighted random rotation"
              onChange={(e) => {
                setTestCityDraft(e.target.value)
                cityDirtyRef.current = true
                setCityDirty(true)
              }}
              onKeyDown={(e) => e.key === 'Enter' && cityDirty && void onApplyCity()}
            />
            {cityDirty && (
              <Button
                variant="primary"
                className="!px-3 !py-1.5 !text-[12px]"
                disabled={savingConfig}
                onClick={onApplyCity}
              >
                {savingConfig ? 'Applying…' : 'Apply city'}
              </Button>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2.5">
            {status?.email_mode === 'dry_run' && (
              <Chip className="tint-warn hidden md:inline-flex">email: dry run</Chip>
            )}
            <button
              onClick={() => navigate('/settings')}
              className="hidden rounded-lg border border-line bg-paper-2 px-2.5 py-1.5 text-[12px] text-gray-2 transition-colors hover:border-line-2 hover:text-ink sm:block"
              title="API keys, sender identity, delivery transport"
            >
              ⚙ Settings
            </button>
            <button
              onClick={() => navigate('/email-analytics')}
              className="hidden rounded-lg border border-line bg-paper-2 px-2.5 py-1.5 text-[12px] text-gray-2 transition-colors hover:border-line-2 hover:text-ink sm:block"
              title="Cold email performance — consented landing visits"
            >
              ▤ Analytics
            </button>
            <span className="flex items-center gap-1.5 text-[12px] text-gray-1">
              <span
                className={`size-2 rounded-full ${status?.active ? 'bg-brand-green pulse-dot' : 'bg-gray-3'}`}
              />
              {status?.active ? 'Discovering' : 'Idle'}
            </span>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <Button variant={status?.active ? 'ghost' : 'green'} onClick={toggleActive}>
              {status?.active ? 'Stop discovery' : 'Start discovery'}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-[1720px] flex-1 flex-col overflow-y-auto px-5 pb-4 pt-4 xl:overflow-hidden">
        {error && (
          <div className="tint-bad brand-rise mb-3 rounded-xl border px-4 py-2.5 text-[12.5px]">
            {error}
          </div>
        )}

        {/* ── hero: globe stage + lead feed ─────────────────────── */}
        <section className="brand-rise grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_500px] xl:grid-rows-[minmax(0,1fr)]">
          {/* globe stage */}
          <div className="relative h-[440px] overflow-hidden rounded-3xl border border-line bg-stage xl:h-auto">
            <LeadGlobe className="absolute inset-0" theme={theme} />

            {/* HUD: title + legend */}
            <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-col gap-2">
              <div className="hud flex items-center gap-2.5 rounded-xl px-3 py-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink">Lead atlas</span>
                <span className="h-3 w-px bg-line-2" />
                <span className="flex items-center gap-1.5 text-[11px] text-gray-1">
                  <span className="size-2 rounded-full bg-[#fbbf24]" /> discovered
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-gray-1">
                  <span className="size-2 rounded-full bg-brand-green" /> sent
                </span>
              </div>
            </div>

            {/* HUD: live stats */}
            <div className="pointer-events-none absolute right-4 top-4 z-10 grid w-[190px] gap-1.5">
              <Stat label="Rate / hour" value={`${status?.window_count ?? 0} / ${status?.leads_per_hour ?? '—'}`} />
              <Stat label="Next window" value={countdown ?? '—'} />
              <Stat label="Discovered" value={status?.counters.discovered ?? 0} accent />
              <Stat label="Duplicates" value={status?.counters.duplicates_skipped ?? 0} />
              <Stat label="Failures" value={status?.counters.failures ?? 0} />
              <Stat label="Queue" value={status?.queue_size ?? 0} />
            </div>

            {/* HUD: rotation ticker */}
            <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex max-w-[70%] flex-col items-start gap-1.5">
              <div className="hud flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] text-gray-1">
                <span
                  className={`size-1.5 shrink-0 rounded-full ${status?.active ? 'bg-brand-green pulse-dot' : 'bg-gray-3'}`}
                />
                <span className="truncate">
                  {status?.active ? (
                    <>
                      <span className="text-ink">{status.test_city ?? status.current_city ?? 'picking a city…'}</span>
                      {status.current_category && <span> · {status.current_category}</span>}
                      <span className="font-mono text-[10px] text-gray-3">
                        {' '}
                        {status.categories_explored.toLocaleString()}/{status.categories_total.toLocaleString()} explored
                      </span>
                    </>
                  ) : (
                    <>
                      idle — {activeMarketLabel}
                      {status?.selected_countries?.length ? (
                        <span> {status.selected_countries.map(flagOf).join(' ')}</span>
                      ) : null}
                      {status && (
                        <span className="text-gray-3">
                          {' '}
                          · {status.cities_total.toLocaleString()} cities ·{' '}
                          {status.categories_total.toLocaleString()} categories
                        </span>
                      )}
                    </>
                  )}
                </span>
              </div>
              {status?.last_error && (
                <div className="hud max-w-full truncate rounded-xl px-3 py-1.5 text-[11px] tint-bad-text" title={status.last_error}>
                  {status.last_error}
                </div>
              )}
            </div>

            {/* right-14 keeps clear of the globe zoom/reset controls */}
            <span className="pointer-events-none absolute bottom-3 right-14 z-10 text-[9.5px] text-gray-3">
              © CARTO · © OpenStreetMap · GeoNames
            </span>
          </div>

          {/* lead feed */}
          <div className="flex h-[560px] min-h-0 flex-col overflow-hidden rounded-3xl border border-line bg-card xl:h-auto">
            {/* tabs */}
            <div className="flex flex-wrap items-center gap-1 border-b border-line p-2">
              {TABS.map((t) => {
                const count =
                  t.key === 'pending'
                    ? status?.counts.pending
                    : t.key === 'followup'
                      ? status?.counts.followup
                      : t.key === 'approved'
                        ? status?.counts.approved
                        : t.key === 'sent'
                          ? status?.counts.sent
                          : t.key === 'failed'
                            ? status?.counts.failed
                            : t.key === 'archived'
                              ? status?.counts.archived
                              : undefined
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`rounded-lg px-2.5 py-1.5 text-[12px] transition-colors ${
                      tab === t.key ? 'bg-paper-2 font-medium text-ink' : 'text-gray-2 hover:text-ink'
                    }`}
                  >
                    {t.label}
                    {count != null && count > 0 && (
                      <span className="ml-1 rounded-full bg-paper-3 px-1.5 font-mono text-[10px] text-gray-2 tabular-nums">
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
              <button
                onClick={() => navigate(`/table?status=${tab}`)}
                className="ml-auto rounded-lg border border-line bg-paper-2 px-2.5 py-1.5 text-[12px] text-gray-2 transition-colors hover:border-line-2 hover:text-ink"
                title="Open the full-width table with every field"
              >
                ⤢ Full table
              </button>
            </div>

            {/* filters */}
            <div className="border-b border-line px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Input
                  ref={searchRef}
                  className="min-w-0 flex-1"
                  placeholder="Search name…  ( / )"
                  value={filters.q}
                  onChange={(e) => setFilter('q', e.target.value)}
                />
                <Select value={filters.has_email} onChange={(e) => setFilter('has_email', e.target.value)}>
                  <option value="">Email: any</option>
                  <option value="yes">Has email</option>
                  <option value="no">No email</option>
                </Select>
                <Select
                  value={sort}
                  title="Ranking runs over every matching lead, not just this page"
                  onChange={(e) => setSort(e.target.value as 'found' | 'score')}
                >
                  <option value="found">Newest first</option>
                  <option value="score">Best score first</option>
                </Select>
                <button
                  onClick={() => setFiltersOpen((v) => !v)}
                  className={`rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors ${
                    filtersOpen || hasFilters
                      ? 'border-brand-green-line bg-brand-green-soft text-brand-green'
                      : 'border-line bg-paper-2 text-gray-2 hover:text-ink'
                  }`}
                >
                  Filters {filtersOpen ? '▴' : '▾'}
                </button>
              </div>
              {filtersOpen && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
                    {EMAIL_LANGUAGES.map((l) => (
                      <option key={l} value={l}>
                        {langLabel(l)}
                      </option>
                    ))}
                  </Select>
                  <Input className="w-32" placeholder="Category…" value={filters.category} onChange={(e) => setFilter('category', e.target.value)} />
                  <span className="flex items-center gap-1">
                    <Input className="w-[70px]" type="number" min={0} max={10} step={0.5} placeholder="Score ≥" value={filters.score_min} onChange={(e) => setFilter('score_min', e.target.value)} />
                    <Input className="w-[70px]" type="number" min={0} max={10} step={0.5} placeholder="Score ≤" value={filters.score_max} onChange={(e) => setFilter('score_max', e.target.value)} />
                  </span>
                  <span className="flex items-center gap-1">
                    <Input className="w-[64px]" type="number" min={1} max={5} step={0.1} placeholder="★ ≥" value={filters.rating_min} onChange={(e) => setFilter('rating_min', e.target.value)} />
                    <Input className="w-[64px]" type="number" min={1} max={5} step={0.1} placeholder="★ ≤" value={filters.rating_max} onChange={(e) => setFilter('rating_max', e.target.value)} />
                  </span>
                  <span className="flex items-center gap-1">
                    <Input className="w-[126px]" type="date" value={filters.date_from} onChange={(e) => setFilter('date_from', e.target.value)} />
                    <span className="text-[11px] text-gray-3">→</span>
                    <Input className="w-[126px]" type="date" value={filters.date_to} onChange={(e) => setFilter('date_to', e.target.value)} />
                  </span>
                  {hasFilters && (
                    <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => setFilters(EMPTY_FILTERS)}>
                      Clear
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* lead rows */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {leads.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-8 py-14 text-center">
                  <span className="text-[24px]">🛰️</span>
                  <span className="text-[12.5px] text-gray-2">
                    {loadingLeads
                      ? 'Loading…'
                      : 'Nothing here yet. Start discovery and leads will land in this queue as the globe lights up.'}
                  </span>
                </div>
              ) : (
                leads.map((lead) => {
                  const emailCount = lead.contact.emails.length
                  return (
                    <div
                      key={lead._id}
                      onClick={() => navigate(`/leads/${lead._id}`)}
                      className="group flex cursor-pointer items-center gap-3 border-b border-line/60 px-4 py-2.5 transition-colors last:border-b-0 hover:bg-paper-2"
                    >
                      <span
                        className="w-9 shrink-0 text-right font-mono text-[14px] font-bold tabular-nums"
                        style={{ color: scoreColor(lead.score) }}
                      >
                        {lead.score.toFixed(1)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5">
                          <span className="truncate text-[13px] font-semibold text-ink">{lead.name}</span>
                          <span className="shrink-0 text-[11px]">{flagEmoji(lead.country)}</span>
                          {lead.google_rating != null && (
                            <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-gray-2">
                              ★{lead.google_rating.toFixed(1)}
                              {lead.review_count != null && lead.review_count > 0 && (
                                <span className="text-gray-3">·{lead.review_count}</span>
                              )}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-gray-2">
                          {tab === 'followup' && lead.outreach && (
                            <span className="text-brand-green">{lead.outreach.count}/3 sent · </span>
                          )}
                          {lead.city_label}
                          <span className="text-gray-3"> · {lead.category ?? lead.types[0] ?? '—'}</span>
                          {lead.contact.selected_email ? (
                            <span className="font-mono text-[10.5px] text-gray-3">
                              {' '}
                              · {lead.contact.selected_email}
                              {lead.contact.emails.find((e) => e.address === lead.contact.selected_email)?.kind ===
                                'third_party' && (
                                <span className="tint-warn-text" title="domain differs from the website">
                                  {' '}
                                  ⚠ may be third-party
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className={emailCount ? 'text-gray-3' : 'tint-warn-text'}>
                              {' '}
                              · {emailCount ? `${emailCount} emails` : 'no email'}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="hidden shrink-0 font-mono text-[10px] text-gray-3 sm:block">
                        {new Date(
                          tab === 'followup' && lead.outreach?.last_sent_at
                            ? lead.outreach.last_sent_at
                            : lead.discovery.discovered_at,
                        ).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
                      </span>
                      <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                        <RowActions lead={lead} tab={tab} rowBusy={rowBusy} run={runRowAction} />
                      </span>
                    </div>
                  )
                })
              )}
            </div>

            {/* feed footer — server-side pagination, 50 per page */}
            <div className="flex items-center justify-between border-t border-line px-4 py-1.5 text-[10.5px] text-gray-3">
              <span>
                {leadsTotal} lead{leadsTotal === 1 ? '' : 's'}
                {hasFilters && (
                  <button className="ml-2 text-gray-2 hover:text-ink" onClick={() => setFilters(EMPTY_FILTERS)}>
                    clear filters
                  </button>
                )}
              </span>
              {leadsTotal > 50 && (
                <span className="flex items-center gap-1.5">
                  <button
                    className="rounded border border-line bg-paper-2 px-1.5 py-0.5 text-gray-2 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    ←
                  </button>
                  <span className="font-mono tabular-nums">
                    {page}/{Math.max(1, Math.ceil(leadsTotal / 50))}
                  </span>
                  <button
                    className="rounded border border-line bg-paper-2 px-1.5 py-0.5 text-gray-2 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
                    disabled={page >= Math.ceil(leadsTotal / 50)}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    →
                  </button>
                </span>
              )}
            </div>
          </div>
        </section>

      </main>
    </div>
  )
}
