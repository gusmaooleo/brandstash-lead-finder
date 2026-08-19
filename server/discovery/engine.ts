/**
 * Autonomous batch discovery.
 *
 * A single self-rescheduling loop:
 *  - honors the hourly leads-per-hour window from Settings (persisted —
 *    restart-safe);
 *  - picks the city for each batch at RANDOM, weighted by population
 *    (see sampler.ts): bigger countries naturally get proportionally more
 *    batches (portuguese ≈ 8 Brazil : 2 Portugal out of 10). Each city's
 *    category rotation + page token persist in `city_progress`, so a
 *    re-drawn city resumes exactly where it left off and a fully-exhausted
 *    city drops out of the draw until the whole market wraps;
 *  - the fixed test-city mode (MVP validation) still walks a sequential
 *    category cursor in `discovery_state.cursor`;
 *  - consults the `discovered_places` registry (Place ID primary, normalized
 *    domain secondary) BEFORE any Details call, so a business is never
 *    re-analyzed or re-queued, across restarts included;
 *  - never advances progress past a page it hasn't fully consumed, so
 *    stopping mid-page (window full / stop button / crash) resumes safely.
 */

import { settings } from '../settings/settings'
import { analyzePlaceProfile } from '../scoring/analyze'
import { inspectWebsite, isPlatformHost } from '../enrichment/website-inspector'
import { annotateMx, recoverGluedEmails } from '../enrichment/mx'
import { electRecipient } from '../enrichment/recipient-election'
import { blockedAddresses } from '../email/blocked'
import { normalizeDomain } from '../leads/normalize-domain'
import {
  AnalysisData,
  ApprovalList,
  Approved,
  CategoryUsage,
  CityProgress,
  DiscoveredPlace,
  getDiscoveryState,
} from '../leads/models'
import { buildSummary, getPlaceDetails, searchPlaceIds } from '../places/client'
import { ALL_CATEGORIES } from './categories'
import { isBlockedPlaceType } from './type-blocklist'
import { cityKey, pickCityWeighted } from './sampler'
import { eligibleCategories, pickCategoryElection } from './election'
import { MARKETS, PLACES_LANGUAGE, scopedMarket } from '../markets/markets'
import type { EmailLanguage, MarketScope } from '../../shared/types'

const HOUR_MS = 3_600_000
const TICK_IDLE_MS = 10_000
const TICK_ACTIVE_MS = 4_000

let timer: NodeJS.Timeout | null = null
let running = false

type EngineState = Awaited<ReturnType<typeof getDiscoveryState>>

/**
 * Transient MongoDB connectivity blips — typically the Mac sleeping and the
 * driver's server monitor timing out on wake. Mongoose reconnects by itself,
 * so these are logged but never stored in `last_error` nor counted as
 * failures (they'd otherwise stick in the UI until the next successful batch).
 */
export function isTransientDbError(err: unknown): boolean {
  const name = err instanceof Error ? err.constructor.name : ''
  if (/^Mongo(Network|ServerSelection|Topology|NotConnected|PoolCleared)/.test(name)) return true
  const message = err instanceof Error ? err.message : String(err)
  return /server monitor timeout|interrupted at shutdown|topology (was )?(destroyed|closed)|server selection timed out|ECONNREFUSED|ECONNRESET|connection .* closed|client must be connected/i.test(
    message,
  )
}

export function startEngineLoop(): void {
  schedule(1_500)
}

function schedule(ms: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void tick(), ms)
}

async function tick(): Promise<void> {
  if (running) return schedule(TICK_ACTIVE_MS)
  running = true
  let delay = TICK_IDLE_MS
  try {
    const state = await getDiscoveryState()
    if (!state.active) {
      running = false
      return schedule(TICK_IDLE_MS)
    }

    const now = Date.now()
    const startedAt = state.window.started_at?.getTime() ?? 0
    if (!startedAt || now - startedAt >= HOUR_MS) {
      state.window.started_at = new Date(now)
      state.window.count = 0
      state.next_run_at = null
    }

    // Sleeping — either the window filled with NEW leads or the whole rotation
    // wrapped (see runBatch). Duplicates never fill the window: window.count is
    // incremented only when a brand-new lead is queued.
    if (state.next_run_at && state.next_run_at.getTime() > now) {
      await state.save()
      running = false
      return schedule(Math.min(Math.max(state.next_run_at.getTime() - now, 5_000), 60_000))
    }

    if (state.window.count >= settings().leadsPerHour) {
      const nextRun = new Date((state.window.started_at?.getTime() ?? now) + HOUR_MS)
      state.next_run_at = nextRun
      await state.save()
      running = false
      return schedule(Math.min(Math.max(nextRun.getTime() - now, 5_000), 60_000))
    }

    await runBatch(state)
    state.last_error = null
    await state.save()
    delay = TICK_ACTIVE_MS
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (isTransientDbError(err)) {
      console.warn('[discovery] transient db interruption (auto-reconnects):', message)
    } else {
      console.error('[discovery]', message)
      try {
        const state = await getDiscoveryState()
        state.last_error = message
        state.counters.failures += 1
        await state.save()
      } catch {
        /* db down — retry on next tick */
      }
    }
    delay = TICK_IDLE_MS
  } finally {
    running = false
    schedule(delay)
  }
}

function backoffUntilNextWindow(state: EngineState): void {
  const base = state.window.started_at?.getTime() ?? Date.now()
  state.next_run_at = new Date(base + HOUR_MS)
}

/** Everything one Text Search page needs, plus how to persist its progress. */
type BatchPlan = {
  language: EmailLanguage
  countryCode: string
  region: string
  marketScope: string
  cityLabel: string
  query: string
  category: string
  pageToken: string | null
  /** Plan-city coordinates — lead fallback when Places returns no geometry. */
  fallbackLocation: { lat: number; lng: number } | null
  /** Called once the page is fully consumed. null token = category done. */
  commit: (nextPageToken: string | null) => Promise<void>
}

type CityProgressDoc = Awaited<ReturnType<typeof cityProgressRow>>

function cityProgressRow(country: string, city: string, admin1: string) {
  return CityProgress.findOneAndUpdate(
    { country, city, admin1 },
    { $setOnInsert: {} },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
}

async function loadCategoryUses(): Promise<Map<string, number>> {
  const rows = await CategoryUsage.find({}, { category: 1, uses: 1 }).lean()
  return new Map(rows.map((r) => [r.category, r.uses]))
}

type CityBatchInput = {
  language: EmailLanguage
  countryCode: string
  region: string
  cityLabel: string
  /** "City[, State], Country" — appended to the category for the text query. */
  queryPlace: string
  fallbackLocation: { lat: number; lng: number } | null
}

/**
 * One city's next batch under the category ELECTION: resume the open page
 * chain if its category is still eligible, otherwise draw a category at
 * random (globally-unused ones weighted up — election.ts) from the owner's
 * selection minus what this city already searched. Returns null when the
 * city has nothing eligible left (full-catalog exhaustion is flagged here;
 * callers decide whether to redraw another city or wrap).
 */
async function buildCityBatch(
  state: EngineState,
  input: CityBatchInput,
  progress: CityProgressDoc,
): Promise<BatchPlan | null> {
  const selection = (state.selected_categories ?? []) as string[]
  const done = progress.categories_done ?? []

  const resume =
    progress.page_token &&
    progress.current_category &&
    (!selection.length || selection.includes(progress.current_category)) &&
    !done.includes(progress.current_category)
      ? progress.current_category
      : null

  let category = resume
  if (!category) {
    const eligible = eligibleCategories(ALL_CATEGORIES, selection, done)
    if (!eligible.length) {
      // Exhausted for the FULL catalog → out of the draw until the market
      // wraps. A merely selection-done city stays eligible for other subsets.
      if (!selection.length || done.length >= ALL_CATEGORIES.length) {
        progress.exhausted_at = new Date()
        progress.current_category = null
        progress.page_token = null
        await progress.save()
      }
      return null
    }
    category = pickCategoryElection(eligible, await loadCategoryUses())
    if (!category) return null
  }

  const chosen = category
  return {
    language: input.language,
    countryCode: input.countryCode,
    region: input.region,
    marketScope: state.market_scope,
    cityLabel: input.cityLabel,
    query: `${chosen} in ${input.queryPlace}`,
    category: chosen,
    pageToken: resume ? (progress.page_token ?? null) : null,
    fallbackLocation: input.fallbackLocation,
    commit: async (nextPageToken) => {
      if (nextPageToken) {
        progress.current_category = chosen
        progress.page_token = nextPageToken
      } else {
        progress.current_category = null
        progress.page_token = null
        if (!progress.categories_done.includes(chosen)) progress.categories_done.push(chosen)
        // Global usage counter — lowers this category's election odds everywhere.
        await CategoryUsage.updateOne(
          { category: chosen },
          { $inc: { uses: 1 }, $set: { last_used_at: new Date() } },
          { upsert: true },
        )
        if (progress.categories_done.length >= ALL_CATEGORIES.length) {
          progress.exhausted_at = new Date()
        }
      }
      await progress.save()
    },
  }
}

/** The market as configured: its scope narrowed to the picked countries. */
function activeMarket(state: EngineState) {
  const market = MARKETS[state.market_scope as MarketScope] ?? MARKETS.portuguese
  return scopedMarket(market, (state.selected_countries ?? []) as string[])
}

/** Fixed test-city mode (MVP validation) — same election, city forced. */
async function testCityPlan(state: EngineState): Promise<BatchPlan | null> {
  const market = activeMarket(state)
  const country = market.countries[0]
  const city = (state.test_city as string).trim()
  const progress = await cityProgressRow(country.code, city, '')
  const plan = await buildCityBatch(
    state,
    {
      language: country.language,
      countryCode: country.code,
      region: country.region,
      cityLabel: city,
      queryPlace: `${city}, ${country.name}`,
      fallbackLocation: null,
    },
    progress,
  )
  if (plan) return plan
  // Every eligible category searched in the fixed city — wrap and back off
  // until the next hourly window (mirrors the old sequential behavior).
  progress.categories_done = []
  progress.current_category = null
  progress.page_token = null
  progress.exhausted_at = null
  await progress.save()
  backoffUntilNextWindow(state)
  return null
}

/** Weighted random city pick + per-city persisted progress. */
async function weightedPlan(state: EngineState): Promise<BatchPlan | null> {
  // Only the picked countries are in the draw — and only their cities are
  // ever reset when the rotation wraps.
  const market = activeMarket(state)
  const codes = market.countries.map((country) => country.code)

  const exhaustedRows = await CityProgress.find(
    { country: { $in: codes }, exhausted_at: { $ne: null } },
    { country: 1, city: 1, admin1: 1 },
  ).lean()
  const exhausted = new Set(exhaustedRows.map((r) => `${r.country}|${r.admin1 ?? ''}|${r.city}`))
  /** Cities with nothing left under the CURRENT category selection. */
  const skipped = new Set<string>()

  for (let attempt = 0; attempt < 40; attempt++) {
    const pick = pickCityWeighted(market, (key) => exhausted.has(key) || skipped.has(key))
    if (!pick) {
      if (!skipped.size) {
        // Every city in the market exhausted the full catalog — reset the
        // flags and back off until the next hourly window. Deliberately does
        // NOT touch window.count: the rate window only ever counts brand-new
        // leads, never duplicates or exhausted sweeps.
        await CityProgress.updateMany({ country: { $in: codes } }, { $set: { exhausted_at: null } })
      }
      backoffUntilNextWindow(state)
      return null
    }

    const progress = await cityProgressRow(pick.country.code, pick.city.name, pick.city.admin1 ?? '')
    const inState = pick.city.admin1 ? `${pick.city.name}, ${pick.city.admin1}` : pick.city.name
    const plan = await buildCityBatch(
      state,
      {
        language: pick.country.language,
        countryCode: pick.country.code,
        region: pick.country.region,
        cityLabel: pick.city.admin1 ? inState : `${pick.city.name}, ${pick.country.name}`,
        queryPlace: `${inState}, ${pick.country.name}`,
        fallbackLocation: { lat: pick.city.lat, lng: pick.city.lng },
      },
      progress,
    )
    if (plan) return plan
    skipped.add(cityKey(pick.country.code, pick.city))
  }

  backoffUntilNextWindow(state)
  return null
}

async function runBatch(state: EngineState): Promise<void> {
  const plan = state.test_city ? await testCityPlan(state) : await weightedPlan(state)
  if (!plan) return

  const languageCode = PLACES_LANGUAGE[plan.language]
  state.current_city = plan.cityLabel
  state.current_category = plan.category

  const { ids, nextPageToken } = await searchPlaceIds({
    textQuery: plan.query,
    languageCode,
    regionCode: plan.region,
    pageToken: plan.pageToken,
  })

  let pageFullyConsumed = true

  for (const placeId of ids) {
    if (state.window.count >= settings().leadsPerHour) {
      pageFullyConsumed = false
      break
    }

    const seen = await DiscoveredPlace.exists({ place_id: placeId })
    if (seen) {
      state.counters.duplicates_skipped += 1
      continue
    }

    try {
      const details = await getPlaceDetails(placeId, languageCode, plan.region)
      const summary = buildSummary(details)

      const register = async (outcome: string, domain: string | null) =>
        DiscoveredPlace.create({
          place_id: placeId,
          normalized_domain: domain,
          name: summary.name,
          outcome,
          first_seen_at: new Date(),
        })

      if (summary.business_status === 'CLOSED_PERMANENTLY') {
        await register('closed', null)
        continue
      }
      // Layer-2 prune: public bodies/infrastructure/worship returned by
      // Google's query fallback are discarded by their primaryType.
      if (isBlockedPlaceType(details.primaryType, summary.types)) {
        await register('blocked_type', null)
        continue
      }
      // A social/aggregator link (Instagram, iFood…) is not an official
      // website: nothing to inspect, and its shared domain must stay out of
      // the dedup signal.
      const rawDomain = normalizeDomain(summary.website)
      if (!summary.website || (rawDomain && isPlatformHost(rawDomain))) {
        await register('no_website', null)
        continue
      }

      const domain = rawDomain
      if (domain) {
        const domainSeen = await DiscoveredPlace.exists({ normalized_domain: domain })
        if (domainSeen) {
          await register('duplicate_domain', domain)
          state.counters.duplicates_skipped += 1
          continue
        }
      }

      const audit = await inspectWebsite(summary.website)
      if (!audit.reachable) {
        await register('enrich_failed', domain)
        state.counters.failures += 1
        continue
      }
      // One DNS query per unique domain: 'no_mx' = guaranteed bounce, badge
      // in the approval UI, never the default recipient. Glued extractions
      // ("…@gmail.comVisit") get their real address recovered when DNS
      // proves the cut candidate right.
      await annotateMx(audit.emails)
      await recoverGluedEmails(audit.emails, audit.normalized_domain)

      const scoring = analyzePlaceProfile(summary, { industry: plan.category })

      const analysis = await AnalysisData.create({
        place_id: placeId,
        summary,
        scoring,
        website_audit: audit,
        briefing_industry: plan.category,
      })

      const location =
        details.location?.latitude != null && details.location?.longitude != null
          ? { lat: details.location.latitude, lng: details.location.longitude }
          : plan.fallbackLocation

      await ApprovalList.create({
        place_id: placeId,
        analysis_id: analysis._id,
        normalized_domain: domain,
        name: summary.name,
        address: summary.address,
        city_label: plan.cityLabel,
        country: plan.countryCode,
        language: plan.language,
        market_scope: plan.marketScope,
        website: summary.website,
        google_rating: summary.rating,
        review_count: summary.total_ratings,
        category: details.primaryType ?? summary.types[0] ?? null,
        types: summary.types,
        score: scoring.overallScore,
        location,
        contact: {
          emails: audit.emails,
          // One recipient is ELECTED among every candidate found (see
          // enrichment/recipient-election.ts) so "Approve & send" works
          // straight from the list; the owner can still switch to any other
          // candidate in the lead page. Addresses that cannot be mailed —
          // no MX, suppressed, dead — are never elected, and a lead with
          // nothing electable keeps demanding a manual choice.
          selected_email: electRecipient(audit.emails, {
            blocked: await blockedAddresses(audit.emails.map((e) => e.address)),
            ownDomain: domain,
          }),
          forms: audit.forms,
          phones: [...new Set([summary.phone, ...audit.phones].filter((p): p is string => Boolean(p)))],
        },
        status: 'pending',
        discovery: {
          query: plan.query,
          city_label: plan.cityLabel,
          discovered_at: new Date(),
          search_category: plan.category,
        },
        audit_trail: [{ at: new Date(), event: 'discovered', detail: plan.query }],
      })

      await register('queued', domain)
      state.window.count += 1
      state.counters.discovered += 1
    } catch (err) {
      state.counters.failures += 1
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[discovery] place ${placeId}: ${message}`)
    }

    await state.save() // persist progress after every place — restart-safe
  }

  if (!pageFullyConsumed) return // same query + token resumes next window

  await plan.commit(nextPageToken)
}

export async function discoveryStatus() {
  const state = await getDiscoveryState()
  const queueSize = await ApprovalList.countDocuments({ status: 'pending' })
  return { state, queueSize }
}

export async function queueCounts() {
  const { followupDueQuery } = await import('../leads/followup')
  const [pending, approvedCount, sent, failed, archived, followup] = await Promise.all([
    ApprovalList.countDocuments({ status: 'pending' }),
    Approved.countDocuments({}),
    Approved.countDocuments({ 'delivery.state': { $in: ['sent', 'sent_dry_run'] } }),
    Approved.countDocuments({ 'delivery.state': 'failed' }),
    ApprovalList.countDocuments({ status: 'archived' }),
    Approved.countDocuments(followupDueQuery()),
  ])
  return { pending, approved: approvedCount, sent, failed, archived, followup }
}
