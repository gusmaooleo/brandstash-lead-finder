/** Score ring — r=40, stroke 8. */

import { scoreColor } from './ui'

const CIRCUMFERENCE = 2 * Math.PI * 40

export function ScoreRing({ score, size = 104 }: { score: number; size?: number }) {
  const color = scoreColor(score)
  const offset = CIRCUMFERENCE * (1 - score / 10)
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r="40" fill="none" stroke="var(--color-line)" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-[22px] font-bold tabular-nums leading-none" style={{ color }}>
          {score.toFixed(1)}
        </span>
        <span className="mt-1 text-[9px] uppercase tracking-[0.18em] text-gray-2">/ 10</span>
      </div>
    </div>
  )
}
