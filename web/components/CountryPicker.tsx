/**
 * Header country picker — the countries discovery may search INSIDE the
 * selected market ("English-speaking markets, but only US + Australia").
 * Multi-select with flags; empty = every country of the market. Selection
 * applies immediately on toggle, like the market select and the category
 * chips. Switching markets clears it (the codes belong to that market).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { MarketInfo } from '../api'

type Country = MarketInfo['countries'][number]

/** ISO 3166-1 alpha-2 → flag emoji (regional indicator letters). */
export function flagOf(code: string): string {
  const cc = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return '🏳'
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

export function CountryPicker({
  countries,
  selected,
  onChange,
}: {
  countries: Country[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selectedSet = useMemo(() => new Set(selected), [selected])
  // Only codes the current market actually has — a leftover from another
  // market must not be counted or shown.
  const picked = useMemo(
    () => countries.filter((cc) => selectedSet.has(cc.code)),
    [countries, selectedSet],
  )
  const cities = (picked.length ? picked : countries).reduce((n, cc) => n + cc.cities, 0)

  const toggle = (code: string) =>
    onChange(selectedSet.has(code) ? selected.filter((c) => c !== code) : [...selected, code])

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={!countries.length}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors ${
          picked.length
            ? 'border-brand-green-line bg-brand-green-soft text-brand-green'
            : 'border-line bg-paper-2 text-gray-2 hover:text-ink'
        }`}
        title={`Restrict discovery to specific countries of this market — ${cities.toLocaleString()} cities in the draw`}
      >
        {picked.length ? (
          <span className="flex items-center gap-1">
            <span className="text-[13px] leading-none">
              {picked.slice(0, 3).map((cc) => flagOf(cc.code)).join(' ')}
            </span>
            {picked.length > 3 ? `+${picked.length - 3}` : null}
          </span>
        ) : (
          'Countries: all'
        )}
        <span className="text-[9px]">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[290px] rounded-2xl border border-line bg-card shadow-2xl">
          <div className="max-h-[320px] overflow-y-auto py-1">
            {countries.map((cc) => {
              const on = selectedSet.has(cc.code)
              return (
                <button
                  key={cc.code}
                  onClick={() => toggle(cc.code)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors hover:bg-paper-2 ${
                    on ? 'text-brand-green' : 'text-gray-1'
                  }`}
                >
                  <span
                    className={`flex size-3.5 shrink-0 items-center justify-center rounded border text-[9px] leading-none ${
                      on ? 'border-brand-green-line bg-brand-green text-[#04150f]' : 'border-line-2'
                    }`}
                  >
                    {on ? '✓' : ''}
                  </span>
                  <span className="text-[14px] leading-none">{flagOf(cc.code)}</span>
                  <span className="truncate">{cc.name}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-gray-3">
                    {cc.cities.toLocaleString()} cities
                  </span>
                </button>
              )
            })}
            {countries.length === 0 && (
              <div className="px-3 py-4 text-center text-[12px] text-gray-3">No country in this market.</div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[11.5px]">
            <span className="text-gray-3">
              {picked.length
                ? `${picked.length} of ${countries.length} · ${cities.toLocaleString()} cities`
                : 'Empty = every country of the market.'}
            </span>
            {picked.length > 0 && (
              <button className="text-gray-2 hover:text-ink" onClick={() => onChange([])}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
