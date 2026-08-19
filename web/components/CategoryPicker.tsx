/**
 * Header category picker — searchable dropdown with chips. The owner selects
 * specific business categories before a run; discovery's election then draws
 * randomly only among them (empty selection = the whole ~3.7k catalog).
 * Selection applies immediately on toggle, like the market select.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

const LIST_CAP = 160

export function CategoryPicker({
  catalog,
  selected,
  onChange,
}: {
  catalog: string[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
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
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return catalog
    return catalog.filter((c) => c.toLowerCase().includes(q))
  }, [catalog, query])

  const toggle = (category: string) => {
    onChange(
      selectedSet.has(category) ? selected.filter((c) => c !== category) : [...selected, category],
    )
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors ${
          selected.length
            ? 'border-brand-green-line bg-brand-green-soft text-brand-green'
            : 'border-line bg-paper-2 text-gray-2 hover:text-ink'
        }`}
        title="Restrict discovery to specific categories — the election draws randomly among them"
      >
        {selected.length ? `${selected.length} categor${selected.length === 1 ? 'y' : 'ies'}` : 'Categories: all'}
        <span className="text-[9px]">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[380px] rounded-2xl border border-line bg-card shadow-2xl">
          <div className="border-b border-line p-2.5">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${catalog.length.toLocaleString()} categories…`}
              className="w-full rounded-lg border border-line bg-paper-2 px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-gray-3 focus:border-line-2"
            />
            {selected.length > 0 && (
              <div className="mt-2 flex max-h-[92px] flex-wrap gap-1 overflow-y-auto">
                {selected.map((c) => (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1 rounded-full border border-brand-green-line bg-brand-green-soft px-2 py-0.5 text-[11px] text-brand-green"
                  >
                    {c}
                    <button
                      onClick={() => toggle(c)}
                      className="text-[12px] leading-none opacity-70 hover:opacity-100"
                      aria-label={`Remove ${c}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="max-h-[300px] overflow-y-auto py-1">
            {filtered.slice(0, LIST_CAP).map((c) => {
              const on = selectedSet.has(c)
              return (
                <button
                  key={c}
                  onClick={() => toggle(c)}
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
                  <span className="truncate">{c}</span>
                </button>
              )
            })}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-[12px] text-gray-3">No category matches.</div>
            )}
            {filtered.length > LIST_CAP && (
              <div className="px-3 py-2 text-center text-[11px] text-gray-3">
                {(filtered.length - LIST_CAP).toLocaleString()} more — keep typing to narrow.
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[11.5px]">
            <span className="text-gray-3">
              {selected.length ? `Discovery draws only from these ${selected.length}.` : 'Empty = the whole catalog.'}
            </span>
            {selected.length > 0 && (
              <button className="text-gray-2 hover:text-ink" onClick={() => onChange([])}>
                Clear all
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
