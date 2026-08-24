/**
 * Matching a lead against a template's category list — and selecting leads BY
 * that category.
 *
 * A lead's category exists in two vocabularies: the catalog display name
 * discovery SEARCHED for ("Marketing agency" — the same list the header picker
 * and the table filter show) and the Places API primaryType stored on the lead
 * ("marketing_agency", but also the useless catch-all "service"). Both are
 * compared as slugs, so one list of catalog names on a template covers either
 * spelling. The catalog name is the one a human reads, and it is the one
 * `searchedCategory` (shared/types.ts) resolves.
 *
 * WHICH categories a template serves is the owner's choice, kept on the
 * template document — there is no coded audience here, and no list of
 * categories that means anything special to the code.
 */

import { searchedCategory } from '../../shared/types'

export { searchedCategory }

export function categorySlug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** Every category key a lead can be matched by (catalog name + primaryType). */
export function leadCategoryKeys(lead: {
  category?: string | null
  discovery?: { query?: string | null; search_category?: string | null } | null
}): string[] {
  const keys = new Set<string>()
  const searched = searchedCategory(lead)
  if (searched) keys.add(categorySlug(searched))
  if (lead.category) keys.add(categorySlug(lead.category))
  return [...keys]
}

/**
 * `searchedCategory` written as a Mongo condition: the leads discovered under
 * any of these catalog categories. Two branches, the same two the function
 * has — the stored field when the lead carries it, the query prefix when it
 * does not. Empty selection = no condition at all (every category), never a
 * clause that would match nothing.
 *
 * Every name comes back from the facet endpoint, i.e. from `searchedCategory`
 * itself, so a name and the queries it was read from always agree.
 */
export function catalogCategoryQuery(categories: string[]): Record<string, unknown> | null {
  const names = [...new Set(categories.map((c) => c.trim()).filter(Boolean))]
  if (!names.length) return null
  const escaped = names.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} in `))
  return {
    $or: [
      { 'discovery.search_category': { $in: names } },
      // null also matches a missing field — the legacy leads, which kept the
      // category only inside their query.
      { 'discovery.search_category': null, 'discovery.query': { $in: escaped } },
    ],
  }
}
