/**
 * The Google Business Profile category catalog (server/seed/categories.json,
 * "Display Name" → slug) minus the owner-approved prune of 2026-08-16
 * (categories-excluded.json — 354 non-convertible entries: government/public
 * administration, public infrastructure, landmarks/public spaces, places of
 * worship, civic institutions, non-commercial points; rationale in
 * docs/category-prune-proposal.md). Discovery picks each batch's category by
 * weighted random ELECTION (see election.ts) — never in this file's
 * alphabetical order — optionally restricted to the owner's selection from
 * the header picker.
 */

import { readFileSync } from 'node:fs'

const raw = JSON.parse(
  readFileSync(new URL('../seed/categories.json', import.meta.url), 'utf8'),
) as Record<string, string>

const excluded = new Set(
  JSON.parse(
    readFileSync(new URL('../seed/categories-excluded.json', import.meta.url), 'utf8'),
  ) as string[],
)

export const ALL_CATEGORIES: readonly string[] = Object.keys(raw).filter((c) => !excluded.has(c))

export function categoryAt(index: number): string {
  return ALL_CATEGORIES[((index % ALL_CATEGORIES.length) + ALL_CATEGORIES.length) % ALL_CATEGORIES.length]
}
