import { useState } from 'react'
import type { AnalyticsOverview, CategoryLearningRow, VariantLearningRow } from '../api'
import { Chip, SectionLabel } from './ui'

const pct = (value: number) => `${value.toFixed(value >= 10 ? 0 : 1)}%`

function SignalTrack({ label, value, count, color }: { label: string; value: number; count: number; color: string }) {
  return (
    <div className="grid grid-cols-[54px_minmax(72px,1fr)_68px] items-center gap-2 text-[10.5px]">
      <span className="text-gray-2">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-paper-3">
        <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, value)}%`, background: color }} />
      </span>
      <span className="text-right font-mono tabular-nums text-gray-1">{count} · {pct(value)}</span>
    </div>
  )
}

function Evidence({ sent, eligible, minimum }: { sent: number; eligible: boolean; minimum: number }) {
  if (eligible) return <span className="text-[10px] text-gray-3">{sent} mature sends</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-gray-3">
      <span className="h-1 w-12 overflow-hidden rounded-full bg-paper-3">
        <span className="block h-full bg-gray-3" style={{ width: `${Math.min(100, (sent / minimum) * 100)}%` }} />
      </span>
      collecting {sent}/{minimum}
    </span>
  )
}

function Score({ value }: { value: number | null }) {
  return (
    <div className="min-w-[58px] text-right">
      <div className="text-[9px] uppercase tracking-[0.09em] text-gray-3">score</div>
      <div className={`font-mono text-[19px] font-semibold tabular-nums ${value == null ? 'text-gray-3' : 'text-brand-green'}`}>
        {value == null ? '—' : value.toFixed(1)}
      </div>
    </div>
  )
}

function VariantRow({ row, minimum }: { row: VariantLearningRow; minimum: number }) {
  return (
    <article className={`grid gap-3 border-b border-line/70 px-4 py-3.5 last:border-b-0 md:grid-cols-[minmax(220px,1.15fr)_minmax(230px,1fr)_auto] ${row.winner ? 'bg-brand-green-soft/40' : ''}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[12.5px] font-semibold text-ink">{row.template_name}</span>
          {row.winner && <Chip className="tint-good">best supported</Chip>}
          {row.band && <Chip>{row.band}</Chip>}
        </div>
        <div className="mt-1 truncate text-[11.5px] text-gray-1">{row.subject || `Variant ${row.variant + 1}`}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[9.5px] text-gray-3">
          <span>v{row.variant + 1}</span><span>·</span><span>{row.language}</span><span>·</span>
          <span>{row.followup ? `follow-up ${row.followup}` : 'initial'}</span><span>·</span><span>{row.fingerprint.slice(0, 8)}</span>
        </div>
      </div>
      <div className="grid content-center gap-2">
        <SignalTrack label="Replies" value={row.reply_rate} count={row.replied} color="var(--color-chart-replied)" />
        <SignalTrack label="Visits" value={row.visit_rate} count={row.visited} color="var(--color-chart-visited)" />
        <Evidence sent={row.sent} eligible={row.eligible} minimum={minimum} />
      </div>
      <Score value={row.score} />
    </article>
  )
}

function CategoryRow({ row, minimum }: { row: CategoryLearningRow; minimum: number }) {
  return (
    <article className={`border-b border-line/70 px-4 py-3 last:border-b-0 ${row.winner ? 'bg-brand-green-soft/40' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-ink">{row.key}</span>
            {row.winner && <Chip className="tint-good">top category</Chip>}
          </div>
          <div className="mt-2 grid gap-1.5">
            <SignalTrack label="Replies" value={row.reply_rate} count={row.replied} color="var(--color-chart-replied)" />
            <SignalTrack label="Visits" value={row.visit_rate} count={row.visited} color="var(--color-chart-visited)" />
          </div>
          <div className="mt-2"><Evidence sent={row.sent} eligible={row.eligible} minimum={minimum} /></div>
        </div>
        <Score value={row.score} />
      </div>
    </article>
  )
}

export function PerformanceLearning({ learning }: { learning: AnalyticsOverview['learning'] }) {
  const [view, setView] = useState<'variants' | 'categories'>('variants')
  const variants = learning.variants
  const categories = learning.categories
  return (
    <section className="brand-rise overflow-hidden rounded-3xl border border-line bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div>
          <SectionLabel>Learning board</SectionLabel>
          <p className="mt-0.5 text-[11.5px] text-gray-2">Replies carry 70% of the score; consented visits carry 30%.</p>
        </div>
        <div className="ml-auto flex rounded-xl border border-line bg-paper-2 p-0.5">
          {(['variants', 'categories'] as const).map((key) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`rounded-[9px] px-3 py-1.5 text-[11.5px] capitalize transition-colors ${view === key ? 'bg-card text-ink shadow-sm' : 'text-gray-2 hover:text-ink'}`}
            >
              {key}
            </button>
          ))}
        </div>
      </header>
      <div className="max-h-[440px] overflow-y-auto">
        {view === 'variants' ? (
          variants.length ? variants.map((row) => <VariantRow key={row.key} row={row} minimum={learning.minimum_sample} />) : (
            <div className="px-6 py-12 text-center text-[12px] text-gray-3">Variant learning begins after real tracked sends mature for {learning.attribution_window_days} days.</div>
          )
        ) : categories.length ? (
          categories.map((row) => <CategoryRow key={row.key} row={row} minimum={learning.minimum_sample} />)
        ) : (
          <div className="px-6 py-12 text-center text-[12px] text-gray-3">No mature category data in this period yet.</div>
        )}
      </div>
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-paper-2/40 px-4 py-2 text-[10px] text-gray-3">
        <span>{learning.attribution_window_days}-day attribution window</span>
        <span>{learning.minimum_sample} sends before a winner is named</span>
        <span>confidence-adjusted, not raw-rate sorted</span>
      </footer>
    </section>
  )
}
