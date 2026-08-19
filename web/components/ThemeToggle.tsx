/**
 * Dark/light mode. The `html.light` class flips every token in styles.css;
 * the choice persists in localStorage and is applied pre-paint by the inline
 * script in index.html. Each page mounts its own toggle — state always derives
 * from the documentElement class, so they stay in sync.
 */

import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'

export type AppTheme = 'dark' | 'light'

export function useTheme(): [AppTheme, () => void] {
  const [theme, setTheme] = useState<AppTheme>(() =>
    document.documentElement.classList.contains('light') ? 'light' : 'dark',
  )
  const toggle = () =>
    setTheme((current) => {
      const next: AppTheme = current === 'dark' ? 'light' : 'dark'
      document.documentElement.classList.toggle('light', next === 'light')
      try {
        localStorage.setItem('bs-theme', next)
      } catch {
        /* private mode — session-only toggle */
      }
      return next
    })
  return [theme, toggle]
}

export function ThemeToggle({ theme, onToggle }: { theme: AppTheme; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      className="flex size-8 items-center justify-center rounded-full border border-line bg-paper-2 text-gray-1 transition-colors hover:border-line-2 hover:text-ink"
    >
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  )
}
