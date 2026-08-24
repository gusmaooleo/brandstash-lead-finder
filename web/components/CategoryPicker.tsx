/**
 * Category multi-select — searchable, with chips for what is already picked.
 *
 * Two callers, one behaviour: the header restricts DISCOVERY to a set of
 * catalog categories, the lead lists FILTER by one. Both speak the catalog
 * vocabulary ("Marketing agency"), both apply on toggle, and neither filters
 * anything client-side — the caller decides what a selection means.
 *
 * The panel is rendered in a portal and positioned against the button, so it
 * is never clipped by a scrolling or rounded (`overflow-hidden`) panel, and it
 * flips above the button when there is more room there.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

const LIST_CAP = 160
const PANEL_WIDTH = 380

/** Fixed coordinates for the panel: below the button, or above when it fits better. */
function place(button: HTMLElement): CSSProperties {
  const r = button.getBoundingClientRect()
  const below = window.innerHeight - r.bottom - 16
  const above = r.top - 16
  const flip = below < 280 && above > below
  return {
    position: 'fixed',
    left: Math.max(12, Math.min(r.left, window.innerWidth - PANEL_WIDTH - 12)),
    width: PANEL_WIDTH,
    maxHeight: Math.max(220, flip ? above : below),
    ...(flip ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
  }
}

export function CategoryPicker({
  catalog,
  selected,
  onChange,
  counts,
  title = 'Restrict discovery to specific categories — the election draws randomly among them',
  footer = (n) => (n ? `Discovery draws only from these ${n}.` : 'Empty = the whole catalog.'),
}: {
  catalog: string[]
  selected: string[]
  onChange: (next: string[]) => void
  /** Leads per category, when the caller knows — shown next to each row. */
  counts?: Record<string, number>
  title?: string
  footer?: (selectedCount: number) => string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [style, setStyle] = useState<CSSProperties | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return setStyle(null)
    const reposition = () => buttonRef.current && setStyle(place(buttonRef.current))
    reposition()
    // Capture phase: the button may live inside a panel that scrolls on its own.
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const inside = (node: Node) =>
      buttonRef.current?.contains(node) || panelRef.current?.contains(node)
    const onDown = (e: MouseEvent) => !inside(e.target as Node) && setOpen(false)
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
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors ${
          selected.length
            ? 'border-brand-green-line bg-brand-green-soft text-brand-green'
            : 'border-line bg-paper-2 text-gray-2 hover:text-ink'
        }`}
        title={title}
      >
        {selected.length ? `${selected.length} categor${selected.length === 1 ? 'y' : 'ies'}` : 'Categories: all'}
        <span className="text-[9px]">{open ? '▴' : '▾'}</span>
      </button>

      {open && style &&
        createPortal(
          <div
            ref={panelRef}
            style={style}
            className="z-50 flex flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-2xl"
          >
            <div className="shrink-0 border-b border-line p-2.5">
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

            <div className="min-h-0 flex-1 overflow-y-auto py-1">
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
                    {counts?.[c] != null && (
                      <span className="ml-auto shrink-0 font-mono text-[10.5px] text-gray-3 tabular-nums">
                        {counts[c].toLocaleString()}
                      </span>
                    )}
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

            <div className="flex shrink-0 items-center justify-between border-t border-line px-3 py-2 text-[11.5px]">
              <span className="text-gray-3">{footer(selected.length)}</span>
              {selected.length > 0 && (
                <button className="text-gray-2 hover:text-ink" onClick={() => onChange([])}>
                  Clear all
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
