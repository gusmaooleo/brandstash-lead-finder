/**
 * Daily cold-email chart: two vertically stacked panels sharing ONE x-axis
 * (never a dual-axis chart):
 *  - top: emails sent per day (bars) with the visited subset drawn INSIDE
 *    each bar from the baseline (visited ⊆ sent), separated by a surface ring;
 *  - bottom: landing-visit rate per day (single-series line, own % scale).
 *
 * Colors come from the theme tokens --color-chart-sent/-visited (CVD-validated
 * pairs per surface). Hover shows a shared crosshair + tooltip.
 */

import { useMemo, useRef, useState } from 'react'

export type ChartPoint = { day: string; sent: number; visited: number; rate: number }

const PAD_L = 34
const PAD_R = 10
const BARS_H = 170
const GAP_H = 26
const RATE_H = 56
const PAD_T = 8
const PAD_B = 20
const HEIGHT = PAD_T + BARS_H + GAP_H + RATE_H + PAD_B

function niceMax(n: number): number {
  if (n <= 4) return 4
  const pow = 10 ** Math.floor(Math.log10(n))
  for (const m of [1, 2, 2.5, 5, 10]) if (n <= m * pow) return m * pow
  return 10 * pow
}

export function SendsChart({ data }: { data: ChartPoint[] }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(720)
  const [hover, setHover] = useState<number | null>(null)

  // Track container width (responsive without a chart library).
  const roRef = useRef<ResizeObserver | null>(null)
  const setContainer = (el: HTMLDivElement | null) => {
    ref.current = el
    roRef.current?.disconnect()
    if (el) {
      roRef.current = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width
        if (w) setWidth(Math.max(320, w))
      })
      roRef.current.observe(el)
    }
  }

  const plotW = width - PAD_L - PAD_R
  const maxSent = niceMax(Math.max(1, ...data.map((d) => d.sent)))
  const maxRate = Math.max(20, Math.min(100, niceMax(Math.max(...data.map((d) => d.rate), 0))))
  const slot = data.length ? plotW / data.length : plotW
  const barW = Math.max(3, Math.min(26, slot - 2))

  const x = (i: number) => PAD_L + slot * i + slot / 2
  const ySent = (v: number) => PAD_T + BARS_H - (v / maxSent) * BARS_H
  const rateTop = PAD_T + BARS_H + GAP_H
  const yRate = (v: number) => rateTop + RATE_H - (v / maxRate) * RATE_H

  const ratePath = useMemo(() => {
    const pts = data.map((d, i) => `${x(i).toFixed(1)},${yRate(d.rate).toFixed(1)}`)
    return pts.length ? `M${pts.join('L')}` : ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, width, maxRate])

  // Sparse x labels: first, last and ~5 in between.
  const labelEvery = Math.max(1, Math.ceil(data.length / 7))
  const fmtDay = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', timeZone: 'UTC' })

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * width
    const i = Math.round((px - PAD_L - slot / 2) / slot)
    setHover(i >= 0 && i < data.length ? i : null)
  }

  const h = hover != null ? data[hover] : null

  return (
    <div ref={setContainer} className="relative w-full">
      <svg
        role="img"
        aria-label="Emails sent, sends with a landing visit, and visit rate per day"
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="block w-full"
        style={{ height: HEIGHT }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* recessive horizontal grid — bars panel */}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD_L} x2={width - PAD_R}
              y1={ySent(maxSent * f)} y2={ySent(maxSent * f)}
              stroke="var(--color-line)" strokeWidth={1}
            />
            <text x={PAD_L - 6} y={ySent(maxSent * f) + 3} textAnchor="end" fontSize={9.5} fill="var(--color-gray-3)">
              {Math.round(maxSent * f)}
            </text>
          </g>
        ))}
        {/* rate panel grid: 0 and max */}
        {[0, 1].map((f) => (
          <g key={`r${f}`}>
            <line
              x1={PAD_L} x2={width - PAD_R}
              y1={yRate(maxRate * f)} y2={yRate(maxRate * f)}
              stroke="var(--color-line)" strokeWidth={1}
            />
            <text x={PAD_L - 6} y={yRate(maxRate * f) + 3} textAnchor="end" fontSize={9.5} fill="var(--color-gray-3)">
              {Math.round(maxRate * f)}%
            </text>
          </g>
        ))}

        {/* crosshair */}
        {h && hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={rateTop + RATE_H} stroke="var(--color-line-2)" strokeWidth={1} />
        )}

        {/* bars: sent, with the visited subset inside (2px surface ring) */}
        {data.map((d, i) => {
          const bx = x(i) - barW / 2
          const sentY = ySent(d.sent)
          const visY = ySent(d.visited)
          const r = Math.min(4, barW / 2)
          return (
            <g key={d.day} opacity={hover == null || hover === i ? 1 : 0.55}>
              {d.sent > 0 && (
                <rect x={bx} y={sentY} width={barW} height={PAD_T + BARS_H - sentY} rx={r} fill="var(--color-chart-sent)" />
              )}
              {d.visited > 0 && (
                <rect
                  x={bx + 2} y={visY} width={Math.max(1, barW - 4)} height={PAD_T + BARS_H - visY}
                  rx={Math.max(1, r - 1)}
                  fill="var(--color-chart-visited)"
                  stroke="var(--color-card)" strokeWidth={2}
                />
              )}
            </g>
          )
        })}

        {/* rate line (single series — % scale of its own panel) */}
        {ratePath && <path d={ratePath} fill="none" stroke="var(--color-chart-visited)" strokeWidth={2} strokeLinejoin="round" />}
        {h && hover != null && (
          <circle cx={x(hover)} cy={yRate(h.rate)} r={4} fill="var(--color-chart-visited)" stroke="var(--color-card)" strokeWidth={2} />
        )}

        {/* x labels (shared axis) */}
        {data.map((d, i) =>
          i % labelEvery === 0 || i === data.length - 1 ? (
            <text key={d.day} x={x(i)} y={HEIGHT - 6} textAnchor="middle" fontSize={9.5} fill="var(--color-gray-3)">
              {fmtDay(d.day)}
            </text>
          ) : null,
        )}
        {/* panel captions */}
        <text x={PAD_L} y={rateTop - 8} fontSize={9.5} fill="var(--color-gray-2)" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          visit rate
        </text>
      </svg>

      {/* tooltip */}
      {h && hover != null && (
        <div
          className="hud pointer-events-none absolute z-10 rounded-xl px-3 py-2 text-[11px] leading-relaxed"
          style={{
            left: `${Math.min(92, Math.max(2, (x(hover) / width) * 100))}%`,
            top: 0,
            transform: `translateX(${x(hover) / width > 0.75 ? '-105%' : '8px'})`,
          }}
        >
          <div className="font-medium text-ink">{fmtDay(h.day)}</div>
          <div className="flex items-center gap-1.5 text-gray-1">
            <span className="size-2 rounded-full" style={{ background: 'var(--color-chart-sent)' }} /> sent
            <span className="ml-auto pl-3 font-mono tabular-nums text-ink">{h.sent}</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-1">
            <span className="size-2 rounded-full" style={{ background: 'var(--color-chart-visited)' }} /> visited
            <span className="ml-auto pl-3 font-mono tabular-nums text-ink">{h.visited}</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-1">
            rate<span className="ml-auto pl-3 font-mono tabular-nums text-ink">{h.rate.toFixed(0)}%</span>
          </div>
        </div>
      )}
    </div>
  )
}
