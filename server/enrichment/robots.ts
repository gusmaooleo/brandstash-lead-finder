/**
 * Minimal, conservative robots.txt support. We only ever fetch a handful of
 * pages per site, but we still honor Disallow rules for `*` and for our own
 * user-agent. Unreachable/malformed robots.txt → allow (standard convention);
 * network-level failure fetching robots is treated as allow but the page fetch
 * itself will surface real availability.
 */

export const CRAWLER_USER_AGENT =
  'BrandstashLeadFinder/0.1 (local business research; contact via sender identity in outreach)'

const UA_TOKEN = 'brandstashleadfinder'

type RobotsRules = { allow: string[]; disallow: string[] }

const cache = new Map<string, RobotsRules | null>()

export async function fetchRobots(origin: string, timeoutMs = 8000): Promise<RobotsRules | null> {
  if (cache.has(origin)) return cache.get(origin) ?? null
  let rules: RobotsRules | null = null
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': CRAWLER_USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    })
    if (res.ok) {
      const text = (await res.text()).slice(0, 100_000)
      rules = parseRobots(text)
    }
  } catch {
    rules = null
  }
  cache.set(origin, rules)
  return rules
}

/** Rules for our UA if a specific group exists, else the `*` group. */
export function parseRobots(text: string): RobotsRules {
  const star: RobotsRules = { allow: [], disallow: [] }
  const own: RobotsRules = { allow: [], disallow: [] }
  let currentAgents: string[] = []
  let sawRuleSinceAgents = true

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const sep = line.indexOf(':')
    if (sep === -1) continue
    const field = line.slice(0, sep).trim().toLowerCase()
    const value = line.slice(sep + 1).trim()

    if (field === 'user-agent') {
      if (sawRuleSinceAgents) currentAgents = []
      sawRuleSinceAgents = false
      currentAgents.push(value.toLowerCase())
      continue
    }
    if (field === 'allow' || field === 'disallow') {
      sawRuleSinceAgents = true
      for (const agent of currentAgents) {
        const target = agent === '*' ? star : agent.includes(UA_TOKEN) ? own : null
        if (!target || !value) continue
        target[field].push(value)
      }
    }
  }
  return own.allow.length || own.disallow.length ? own : star
}

/** Longest-match wins; Allow beats Disallow on equal length (Google semantics). */
export function isPathAllowed(rules: RobotsRules | null, path: string): boolean {
  if (!rules) return true
  const match = (patterns: string[]): number => {
    let best = -1
    for (const p of patterns) {
      const re = new RegExp(
        '^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'),
      )
      if (re.test(path)) best = Math.max(best, p.length)
    }
    return best
  }
  const allow = match(rules.allow)
  const disallow = match(rules.disallow)
  if (disallow === -1) return true
  return allow >= disallow
}
