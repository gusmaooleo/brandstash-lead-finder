import { forwardRef, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes, type ButtonHTMLAttributes } from 'react'
import { searchedCategory, type EmailLanguage } from '../../shared/types'

export function scoreColor(score: number): string {
  if (score >= 7) return 'var(--color-ok)'
  if (score >= 4) return 'var(--color-warn)'
  return 'var(--color-bad)'
}

export const STATUS_STYLE: Record<'bom' | 'precisa_melhorar' | 'ausente', { label: string; cls: string; bar: string }> = {
  bom: { label: 'Good', cls: 'tint-good', bar: 'bg-emerald-400' },
  precisa_melhorar: { label: 'Needs work', cls: 'tint-warn', bar: 'bg-amber-400' },
  ausente: { label: 'Missing', cls: 'tint-bad', bar: 'bg-red-400' },
}

export function Chip({
  children,
  className = '',
  title,
}: {
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-paper-2 px-2 py-0.5 text-[11px] text-gray-1 ${className}`}
    >
      {children}
    </span>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-gray-2">{children}</div>
  )
}

export function Button({
  variant = 'ghost',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'green' }) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40'
  const variants = {
    primary: 'bg-ink text-paper hover:bg-ink-soft active:scale-[0.98]',
    green: 'bg-brand-green text-[#04150f] hover:brightness-110 active:scale-[0.98] font-semibold',
    ghost: 'border border-line bg-paper-2 text-gray-1 hover:border-line-2 hover:text-ink',
    danger: 'border tint-bad',
  }
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />
}

/** Compact round icon action (table rows): ✓ approve, → skip, ✕ do not contact. */
export function IconButton({
  tone = 'neutral',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'green' | 'neutral' | 'red' }) {
  const tones = {
    green: 'tint-good',
    neutral: 'border-line bg-paper-2 text-gray-1 hover:border-line-2 hover:text-ink',
    red: 'tint-bad',
  }
  return (
    <button
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${tones[tone]} ${className}`}
      {...props}
    />
  )
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`rounded-lg border border-line bg-paper-2 px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-line-2 ${className}`}
      {...props}
    />
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = '', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={`rounded-lg border border-line bg-paper-2 px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-gray-3 focus:border-line-2 ${className}`}
      {...props}
    />
  )
})

/** Compact HUD stat — floats over the globe stage on a frosted chip. */
export function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className="hud flex items-baseline justify-between gap-3 rounded-xl px-3 py-1.5">
      <span className="text-[9.5px] uppercase tracking-[0.09em] text-gray-2">{label}</span>
      <span className={`font-mono text-[14px] font-semibold tabular-nums ${accent ? 'text-brand-green' : 'text-ink'}`}>
        {value}
      </span>
    </div>
  )
}

/** Every language the markets can reach — see shared/types.ts. */
const LANG_LABEL: Record<EmailLanguage, string> = {
  en: 'English',
  pt: 'Português',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  'zh-TW': '中文（台灣）',
  'zh-HK': '中文（香港）',
  ja: '日本語',
  ko: '한국어',
}

export function langLabel(lang: string): string {
  return LANG_LABEL[lang as EmailLanguage] ?? lang
}

/**
 * What a lead's category IS to a human — the catalog name it was discovered
 * under, the same words the picker filters by. The Places primaryType is the
 * fallback only: it collapses agencies, consultants and marketers alike into
 * "service", so it can name a lead but never group one.
 */
export function leadCategoryLabel(lead: {
  category?: string | null
  types?: string[]
  discovery?: { query?: string | null; search_category?: string | null } | null
}): string {
  return searchedCategory(lead) ?? lead.category ?? lead.types?.[0] ?? '—'
}

export function flagEmoji(country: string): string {
  if (!/^[A-Z]{2}$/.test(country)) return '🌐'
  return String.fromCodePoint(...[...country].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65))
}
