/**
 * Generates server/seed/city-plans.json from GeoNames (no hand-written city
 * lists). Run with `pnpm seed:cities` — the seed is committed, so this only
 * needs to run again to refresh populations or after editing coverage.ts.
 *
 * Source: GeoNames cities5000 dump (all places with population > 5 000),
 * licensed CC BY 4.0 — attribution lives in the README and in the seed
 * header. cities5000 (not cities15000) so small US states can still fill
 * their top-20; every other country keeps its coverage.ts `cityCount` most
 * populous cities.
 *
 * Usage: tsx scripts/build-city-plans.ts [path/to/cities5000.txt]
 *   With no argument the dump is downloaded to a temp dir and unzipped via
 *   the system `unzip`.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COUNTRIES } from '../server/markets/coverage'

const DUMP_URL = 'https://download.geonames.org/export/dump/cities5000.zip'

/** The 50 US states (GeoNames admin1 code → name). DC and territories are out of plan scope. */
const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}

/**
 * Abandoned / destroyed / historical places never enter a plan, and neither
 * do PPLX "sections of a populated place" (Paris arrondissements, São Paulo
 * neighborhoods…) — they'd eat their metro's plan slots. NYC boroughs are
 * coded PPL, so US granularity is unaffected.
 */
const EXCLUDED_FEATURE_CODES = new Set(['PPLQ', 'PPLW', 'PPLH', 'PPLCH', 'PPLX'])

type SeedCity = { name: string; admin1?: string; lat: number; lng: number; population: number }

async function loadDump(argPath: string | undefined): Promise<string> {
  if (argPath) return readFileSync(argPath, 'utf8')
  console.log(`downloading ${DUMP_URL}…`)
  const res = await fetch(DUMP_URL)
  if (!res.ok) throw new Error(`GeoNames download failed: ${res.status}`)
  const dir = mkdtempSync(path.join(tmpdir(), 'geonames-'))
  const zipPath = path.join(dir, 'cities5000.zip')
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()))
  return execFileSync('unzip', ['-p', zipPath, 'cities5000.txt'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
}

function build(dump: string): Record<string, { cities: SeedCity[] }> {
  const covered = new Set(Object.keys(COUNTRIES))
  // country → dedup key → city (keeps the most populous on name collisions,
  // e.g. homonym towns — the search query is only "<city>, <country>").
  const byCountry = new Map<string, Map<string, SeedCity>>()

  for (const line of dump.split('\n')) {
    if (!line) continue
    const cols = line.split('\t')
    const [, name, , , latRaw, lngRaw, fclass, fcode, country] = cols
    if (fclass !== 'P' || EXCLUDED_FEATURE_CODES.has(fcode) || !covered.has(country)) continue
    const population = Number(cols[14]) || 0
    if (population <= 0) continue

    let admin1: string | undefined
    if (country === 'US') {
      admin1 = US_STATES[cols[10]]
      if (!admin1) continue // DC + territories
    }

    const map = byCountry.get(country) ?? new Map<string, SeedCity>()
    byCountry.set(country, map)
    const key = admin1 ? `${admin1}|${name}` : name
    const existing = map.get(key)
    if (!existing || existing.population < population) {
      map.set(key, {
        name,
        ...(admin1 ? { admin1 } : {}),
        lat: Number(latRaw),
        lng: Number(lngRaw),
        population,
      })
    }
  }

  const out: Record<string, { cities: SeedCity[] }> = {}
  for (const code of Object.keys(COUNTRIES).sort()) {
    const def = COUNTRIES[code]
    const all = [...(byCountry.get(code)?.values() ?? [])]
    let cities: SeedCity[]
    if (def.perStateCities) {
      cities = Object.values(US_STATES)
        .sort()
        .flatMap((state) =>
          all
            .filter((c) => c.admin1 === state)
            .sort((a, b) => b.population - a.population)
            .slice(0, def.perStateCities),
        )
    } else {
      cities = all.sort((a, b) => b.population - a.population).slice(0, def.cityCount)
    }
    if (!cities.length) throw new Error(`no GeoNames cities for covered country ${code}`)
    out[code] = { cities }
  }
  return out
}

async function main(): Promise<void> {
  const dump = await loadDump(process.argv[2])
  const countries = build(dump)
  const seed = {
    source: 'GeoNames cities5000 (https://download.geonames.org) — CC BY 4.0',
    generated_at: new Date().toISOString(),
    countries,
  }
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const outPath = path.resolve(__dirname, '../server/seed/city-plans.json')
  writeFileSync(outPath, `${JSON.stringify(seed, null, 1)}\n`)

  const total = Object.values(countries).reduce((n, c) => n + c.cities.length, 0)
  for (const [code, { cities }] of Object.entries(countries)) {
    console.log(`${code}: ${cities.length} cities`)
  }
  console.log(`wrote ${outPath} — ${total} cities across ${Object.keys(countries).length} countries`)
}

void main()
