# Brandstash Lead Finder

Personal, local-first lead finder for Brandstash prospecting. Discovers local businesses through
the **Google Places API (New)**, scores them with the **exact Brandstash business-score rules**
(ported verbatim — the parity suite in `server/scoring/scoring.spec.ts` is the contract), inspects
each business's official public website for legitimate contact channels, and lets you approve every outreach email by hand before
it is sent. One Node/TypeScript app + MongoDB, run with Docker Compose. No cloud, no queues, no
auth.

## Quick start

```bash
cp .env.example .env          # 3 lines: port, mongo URI, and an encryption key
                              # (openssl rand -base64 32) — everything else is set in the app

# Everything in containers (app on :4000, mongo on host :27018):
docker compose up --build

# — or local dev (mongo in docker, app with hot reload):
docker compose up -d mongo
pnpm install
pnpm dev                      # API on :4000, UI on :4001 (proxied)
```

Open the UI, pick a **market scope** (applies immediately), optionally restrict the run to
specific **categories** (header chips picker — empty = the whole ~3.7k-category catalog) or pin a
**fixed test city** (MVP validation mode), and press **Start discovery**. Each batch's category is
drawn at random by a weighted **election**: any category can win any round, but the less one has
been searched anywhere, the higher its odds — so every kind of business gets explored over time,
never in alphabetical order. The queue fills as batches run; open a lead to review its analysis,
pick the recipient, preview the localized email and **Approve & send**.

```bash
pnpm test                     # vitest — includes the 36-test Brandstash scoring parity suite
pnpm build                    # typecheck + production frontend build
```

## Configuration

Three variables live in `.env`, and only because they must:

| Var | Meaning |
|---|---|
| `APP_PORT` | Express port (default 4000) |
| `MONGODB_URI` | Where the lead finder's own Mongo is — you cannot read the database to learn where it is. Defaults to `mongodb://localhost:27018/brandstash_leads` (compose maps 27018→27017 so the Brandstash dev mongo on 27017 is untouched) |
| `APP_ENCRYPTION_KEY` | 32 bytes (`openssl rand -base64 32`) that unlock every credential stored in the settings document. Never commit it; losing it costs no lead data, only re-entering the credentials |

**Everything else is configured in the app** (⚙ Settings) and stored in MongoDB with every secret
encrypted (AES-256-GCM, fresh IV per value, auth tag verified on read — `server/settings/`). The
browser only ever receives masks:

| Settings | What it holds |
|---|---|
| **Offer** | Brand name, site URL, logo and the "what you sell" paragraph — the app is not wired to one company. Also decides whether generated copy may lean on the built-in Google-profile analysis |
| **Claude** | Anthropic key + model (the dropdown lists what that key can actually use). Writes email templates in Settings → Generate |
| **Google Places** | Places API (New) key, used server-side only |
| **Landing database** | Read-only connection to the store where the landing writes `landing_visit_events` (Atlas in production). Empty = local-dev fallback to the lead finder's own Mongo |
| **Discovery** | Leads per hour (discovery pauses when the window fills), follow-up delay, and how long a pending lead waits before being soft-archived (hidden, reopenable, never deleted) |
| **Sender identity** | Name + address, concatenated into the `Name <email@domain>` both transports send. Reply-To optional |
| **Delivery** | `dry_run` (renders/records, sends nothing), `resend` or `smtp` — one contract, two implementations (`server/email/provider.ts`). Resend retries carry an idempotency key, so a network hiccup can never double-send |
| **Email templates** | Which copy each lead gets: generic, or bound to Google Business categories (most specific wins). Built-in packs ship localized in 10 languages; custom ones are written by Claude or by hand |

## How it works

**Discovery.** An autonomous loop picks the city for each batch at **random, weighted by
population** (√-weighted at both the country and city stage — e.g. the Portuguese market lands
≈ 8 Brazilian picks for every 2 Portuguese ones, never a 5/5 split). City pools come from the
committed GeoNames seed (`server/seed/city-plans.json`, regenerated with `pnpm seed:cities`):
the top-20 cities of each of the 50 US states plus a population-scaled top-N for every other
covered country — 1,642 cities total. Which countries a language market may search is governed by
the allowlist + documented blacklist in `server/markets/coverage.ts` (French → France only, no
Francophone Africa; German → DE/CH/AT only; Mandarin → TW; Cantonese → HK+MO; …). The category
axis is the full pruned Google Business catalog (~3.7k categories), drawn per batch by a weighted
random **election** (`server/discovery/election.ts`): weight = 1/(1+global uses), so unexplored
categories are favored while any category can still win any round; the header picker can restrict
the pool to a hand-picked subset. One Places Text Search page per batch; each city's completed
categories + open page token persist in `city_progress`, so a re-drawn city resumes exactly where
it left off, restarts included, never re-queries a (city, category) pair it finished, and an
exhausted city drops out of the draw until the whole market wraps. The hourly window
(`LEADS_PER_HOUR`) counts **only brand-new queued leads** — a business already in the dedup
registry never consumes rate, and a fully exhausted market backs off until the next window
without touching the count (`next_run_at` is shown in the UI).

**Deduplication.** `discovered_places` is a permanent registry keyed by **Google Place ID**
(unique index) with the **normalized website domain** as a second signal (also indexed). Every
place from a search is checked against the registry *before* any Details call, and a domain
already seen marks the new place as a duplicate. `approval_list`/`approved` keep their own unique
`place_id` as a backstop. A business is never analyzed or emailed twice, across restarts included.

**Website enrichment.** Only the business's official site is visited: homepage + up to six
same-domain contact/about/legal/privacy pages (localized variants; a `sitemap.xml` peek when the
menu hides the contact page), honoring `robots.txt`, with timeouts and size caps. Emails come from
`mailto:` links, **visible text only** (scripts, styles and form-placeholder attributes are never
scanned), schema.org JSON-LD contact data, and lightly obfuscated spellings the site shows humans
(`info [at] x.com`). Compliance/no-reply/HR inboxes (privacy@, dpo@, noreply@, jobs@…) and known
web-vendor domains (site platforms, agencies) are dropped outright; every kept address is
classified **own-domain / freemail / third-party** — freemail is first-class (many small
businesses run on gmail), while third-party addresses rank last, wear a warning badge and are
never auto-selected. Each unique recipient domain also gets a cached **MX lookup** (pure DNS):
no MX = guaranteed bounce, so the address wears a "no MX" badge, is never the default recipient,
and a live send against it fails before touching the provider (transient DNS answers never
block anything). Contact-form pages and public phone numbers are also recorded. Social
platforms are never scraped; unreachable sites are recorded as failures.

**Scoring.** `server/scoring/` is a verbatim port of the Brandstash GBP rules engine
(`RULES_VERSION 1.3.0`) with a ported 36-test parity suite. Full analysis is stored in
`analysis_data`; each `approval_list` record holds an ObjectId reference to it.

**Approval & delivery.** Approving a lead (recipient selection is mandatory when several public
emails were found) *moves* it from `approval_list` to `approved` — audit trail preserved — and
sends the localized email immediately. The suppression list (`suppression_list`) is checked right
before every send; unsubscribes (link in every email + RFC 8058 one-click header) land there
automatically, and "Do not contact" suppresses all of a lead's addresses. Delivery states are
explicit (`not_sent` / `sent` / `sent_dry_run` / `failed` + attempt count); a failed send never
auto-retries — retry is a button — so a crash can never double-send. Bounces feed back
permanently: an SMTP hard bounce (permanent 5xx "no such mailbox") dead-lists the address in
`dead_addresses`, and on the Resend transport a background loop polls recent sends for terminal
events — `bounced` dead-lists the recipient, `complained` additionally suppresses it like an
unsubscribe. Dead addresses are never offered again and every send is blocked against the
registry right before delivery.

**Email.** Two formats per lead, rendered in the lead's market language
(en/pt/es/fr/de/it/zh-TW/zh-HK/ja/ko):

- **Personal note (default)** — a short, plain-looking cold email (Arial, no images, multipart
  with a text/plain alternative) that leads with 1–2 concrete findings pulled from the lead's
  REAL public profile data (missing photos/hours/description, thin reviews). 3 variants per
  language with different sales angles (findings / lost-customer / compliment ladder), picked
  deterministically by Place-ID hash; every send records its variant. Footer carries the same
  public-information disclaimer + unsubscribe as the dashboard email.
- **Dashboard** — the visual Brandstash report (score ring, category bars, opportunities, CTA
  card). Opt-in per lead via the style tab on the lead page.

**Tracking & attribution.** Every individual send (initial, each follow-up, each retry) gets its
own random `rid` (24 bytes → 32 URL-safe chars). Only its SHA-256 (`tracking_id_hash`, unique
partial index) is persisted — on a per-send record in `email_sends`, written BEFORE the provider
is called; the raw rid goes into the email's landing links and is then discarded (never stored,
never logged). Every link to the landing carries the exact contract
(`utm_source=cold_email&utm_medium=email&utm_campaign=…&utm_content=<template_variant>&utm_term=attempt_N&rid=…`,
built with `URL`/`URLSearchParams` — see `server/tracking/landing-url.ts`), in both the HTML and
the plain-text part. When a recipient opens the link AND accepts cookies, the landing writes a
`landing_visit_events` document with the same hash; the **/email-analytics** dashboard reconciles
the two sides in hash batches (read-only, projection-limited) and persists per-send visit
summaries locally — so metrics survive the landing's 180-day event TTL, and re-syncing never
duplicates counts. This measures **consented landing visits** — there is no open pixel, and a
click without cookie consent is never counted. Sends that predate tracking stay visible as
"untracked"; hashes are never invented retroactively.

**Follow-ups.** `FOLLOWUP_AFTER_DAYS` (default 3) after a send, leads with 1–2 sends surface in
the **Follow-up** tab; ✓ sends the next touch (always a personal note, always a variant not yet
used — #2 in "it's me again" tone, #3 as a warm breakup), → stops the sequence, ✕ suppresses.
Hard cap: 3 sends per lead. Subject bands on the dashboard style: rating < 4 → improvement tone,
≥ 4 → retention tone. The lead page previews everything inside a Gmail-fidelity frame.

## Data model

| Collection | Purpose | Key indexes |
|---|---|---|
| `approval_list` | Leads awaiting human review (with `location` for the globe, `archived_at`) | `place_id` unique, `analysis_id`, `status`, `country`, `language`, `score`, `created_at` |
| `approved` | Approved leads (moved here; `approved_at` + delivery state live here) | same as above + `approved_at`, `delivery.state`, `delivery.unsubscribe_token` |
| `analysis_data` | Full scoring result + place summary + website audit | `place_id` unique |
| `discovered_places` | Permanent dedup registry — never pruned | `place_id` unique, `normalized_domain` |
| `email_sends` | One record per individual send (initial / follow-up / retry) with `tracking_id_hash` + persisted landing-visit summary | `tracking_id_hash` unique partial, `place_id`, `status`, `sent_at`, `created_at` |
| `tracking_state` | Singleton: last landing-sync outcome (time, ok/error, counts) | — |
| `city_progress` | Per-city search progress (completed categories, open page token, exhaustion) | `(country, admin1, city)` unique |
| `category_usage` | Global per-category usage counts — the election's weights | `category` unique |
| `suppression_list` | Unsubscribed / do-not-contact / complained addresses — never pruned | `email` unique |
| `dead_addresses` | Addresses that provably don't accept mail (hard bounce / provider bounce / complaint) — never pruned, never mailed again | `email` unique |
| `discovery_state` | Singleton: config, hourly window, test-city cursor, counters | — |

Dates are first-class everywhere: `discovery.discovered_at`, analysis `created_at`, explicit
`approved_at` on approval, `delivery.sent_at` on send, `archived_at` on retention — plus
`created_at`/`updated_at` timestamps on every collection.

## Dashboard globe & data attribution

The dashboard's centerpiece is an auto-rotating globe built on
[mapcn](https://mapcn.vercel.app) (`web/components/ui/map.tsx`, installed from the `@mapcn/map`
shadcn registry — `components.json` + the `@/` alias are configured, so
`pnpm dlx shadcn@latest add @mapcn/...` works for future components). Yellow dots are discovered
leads, green dots are sent leads (Places-API geometry, plan-city coordinates as fallback);
hovering shows the business + score, clicking opens the lead, dragging spins the globe by hand.
The full-width table with every field lives at `/table` ("Full table" button on the feed panel).

- Basemap: CARTO dark-matter tiles (© [CARTO](https://carto.com),
  © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors) via mapcn's defaults.
- The MapLibre worker is self-hosted (`public/maplibre/`, per mapcn's docs) so the bundle never
  depends on unpkg at runtime.
- City plans & coordinates: [GeoNames](https://www.geonames.org) `cities5000` dump, licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Regenerate with `pnpm seed:cities`.

## Project layout

```
server/   scoring (Brandstash parity) · places client · markets/city plans ·
          discovery engine · website enrichment · email (locales, renderer, sender) · API
web/      Vite + React + Tailwind 4 UI (Brandstash warm-paper light theme)
shared/   types shared by both
```

## Scope guardrails

Places API only (no scraping of Google pages) · official business sites only, robots-aware ·
public business contact channels only · every email individually human-approved · honest copy
based on public information · suppression respected on every send.

## License

[MIT](LICENSE). Third-party material keeps its own terms: GeoNames city data is CC BY 4.0,
MapLibre GL JS is 3-Clause BSD, and the CARTO/OpenStreetMap basemap is used under the
attributions printed above.
