/**
 * Matching a lead against a template's category list.
 *
 * A lead's category exists in two vocabularies: the catalog display name
 * discovery SEARCHED for ("Marketing agency" — the same list the header picker
 * shows) and the Places API primaryType stored on the lead
 * ("marketing_agency"). Both are compared as slugs, so one list of catalog
 * names on a template covers either spelling.
 *
 * WHICH categories a template serves is the owner's choice, kept on the
 * template document — there is no coded audience here, and no list of
 * categories that means anything special to the code.
 */

export function categorySlug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * The catalog category a lead was discovered under. Stored on new leads;
 * recovered from the search query ("<category> in <City, Country>") for the
 * ones queued before the field existed.
 */
export function searchedCategory(lead: {
  discovery?: { query?: string | null; search_category?: string | null } | null
}): string | null {
  const stored = lead.discovery?.search_category
  if (stored) return stored
  const query = lead.discovery?.query
  if (!query) return null
  // The place suffix never contains " in ", so the LAST separator is the one.
  const cut = query.lastIndexOf(' in ')
  return cut > 0 ? query.slice(0, cut).trim() : null
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
