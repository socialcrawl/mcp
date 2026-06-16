# Changelog

All notable changes to `socialcrawl-mcp` are documented here. The format
loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-06-16

Re-sync with the backend registry, bringing coverage from 39 platforms /
221 endpoints to **42 platforms / 264 active endpoints**. Headlined by the
new cross-platform **Prism** composite family. Data layer regenerated via
the standard pipeline (the backend's `extract-mcp-data.ts` →
`npm run generate:data`).

### Added

- **Prism** (30 endpoints) — server-side composite intelligence that fans
  out across many platforms and folds the legs into one unified report,
  each with a per-leg transparency array. Includes universal URL `lookup`
  (0cr), full `comments` harvesting, `brand-mentions`, `demand-signals`,
  `ai-visibility` (AI share-of-voice / GEO), `crisis-radar` +
  `crisis-postmortem`, `reputation`, `share-of-voice`, `creator-vet`,
  `review-integrity`, multi-engine AI consensus `answers`, `video-intel`,
  `app-reviews`, `apps-lookup`, `product-reviews`, `post-stats`,
  `creator-card`, `voice`, and more. Pricing is flat or metered per
  recipe (0–50cr) rather than the 1/5/10 tier ladder.
- **Per-platform Prism composites** — `profile/full` "profile-360" cards
  on TikTok, Instagram, YouTube, Twitter/X, Facebook, and LinkedIn (5cr),
  and `reddit/omni-search` VoC sweep. These keep their platform path and
  carry a `family: "prism"` flag in the backend.
- **Google News** (1: `search`) — real-time Google News SERP search.
- **Google Finance** (3: `quote`, `markets`, `ticker-search`) — financial
  instrument quotes, markets overview, and ticker search.
- **New meta-search lane** — `search/forums` (10cr) alongside
  `search/everywhere`; `naver/brief` (10cr) summary endpoint.
- **`socialcrawl_monitors` tool (new)** — first-class coverage for the
  stateful monitors family (`/v1/monitors/*`), which is deliberately
  **not** a registry endpoint and so isn't reachable through
  `socialcrawl_request` (GET-only). Actions: `create`, `list`, `get`,
  `runs`, `timeseries`, `pause`, `resume`, `delete`. A monitor re-runs any
  registered endpoint or Prism composite on a cadence
  (hourly/daily/weekly/cron), delivers each result to an HMAC-signed
  webhook, evaluates alert rules, and accumulates a per-run time-series.
  Managing monitors costs 0 credits; each scheduled run bills the recipe's
  normal cost. Backed by a new generic `apiRequest` client helper that
  speaks POST/GET/PATCH/DELETE with JSON bodies and `:id` path params.
- **`monitors` docs topic** — `socialcrawl_get_docs` now serves the full
  monitors contract (operations table, create params, alert DSL, billing).
- **Endpoint additions on existing platforms** — Facebook (now 22),
  TikTok (19), YouTube (17), Instagram (16), Naver (12), LinkedIn (9),
  Twitter/X (8), Reddit (7) — largely the `profile/full` / `omni-search`
  composites listed above.

### Changed

- Bumped to **1.5.0**. Tool descriptions, README, badges, `server.json`,
  `package.json`, and the platform table now report 42 platforms /
  264 endpoints.
- `data-integrity.test.ts` — platform count → 42, endpoint count → 264,
  and the credit-cost assertions now recognize flat/metered composite
  pricing (Prism, `profile/full`, `search/*`, `naver/brief`) as
  intentional overrides of the 1/5/10 ladder via an `isFlatPriced`
  exemption; all other endpoints still must follow the ladder.
- `pricing` docs topic now lists every Prism/composite cost as a flat
  override (computed from the endpoint data, so it can never drift).
- Platform descriptions added for `prism`, `google_news`, and
  `google_finance` in `scripts/generate-data.ts`.

### Notes

- **Count scope:** the 42 platforms / 264 endpoints headline counts the
  registry data surface only. Monitors are a stateful resource family, not
  registry rows, so they don't change that headline — they're exposed as
  the separate `socialcrawl_monitors` tool (7 operations).
- Prism composites that stream (`prism/comments`, `reddit/omni-search`)
  are read as JSON through the `socialcrawl_request` tool — SSE chunks
  require calling the HTTP endpoint directly with `Accept:
  text/event-stream`. Metered endpoints display their base cost in the
  request header; actual billing (with auto-refunds) is reported in the
  response envelope's `credits_used`.

## [1.4.0] - 2026-06-12

Full re-sync with the backend registry, bringing total coverage from
27 platforms / 133 endpoints to **39 platforms / 221 active endpoints**.
The data layer is now generated straight from the backend registry via a
durable pipeline (`scripts/generate-data.ts` + the backend's
`extract-mcp-data.ts`) instead of one-off extraction scripts.

### Added

- **Commerce & product reviews** — Amazon (5: product search, ASIN
  detail, reviews, sellers, shop pages) and Google Shopping (4: product
  search, product detail, cross-retailer reviews, sellers).
- **App stores** — Google Play (8) and Apple App Store (8): app search,
  full app details, reviews, store charts, the premium listings-search
  database, and categories/locations/languages reference data.
- **Places & travel** — Tripadvisor (2: place search, traveler reviews)
  and Google Business Profile / Travel under `google` (info, extended
  reviews, owner updates, Q&A, hotel search, hotel details).
- **Business reputation** — Trustpilot (2: business search, company
  reviews).
- **Naver** (11) — Korea's #1 search portal: blog, news, book,
  encyclopedia, cafe article, KiN, local, shopping, doc, image, web.
- **Content Analysis** (10) — cross-web brand mentions with 6-axis
  sentiment, summaries, rating distributions, phrase/category trends,
  and reference data.
- **New social platforms** — Kwai (3), Bluesky (3), Rumble (5),
  Spotify (6), TikTok Shop (5, split out of `tiktok`).
- **Many endpoint additions on existing platforms** — Facebook events +
  Marketplace + ad transcripts (now 21), TikTok comment replies / songs
  / profile region (18), Instagram trending reels + hashtag/profile
  search (15), YouTube sponsors / playlists / lives / community posts
  (16), LinkedIn post search + transcripts (8), Pinterest url-stats (5),
  Twitch videos + schedules (4).
- **`pricing` docs topic** — `socialcrawl_get_docs` now serves a
  generated per-endpoint pricing reference: tier ladder with live
  counts, flat overrides, and the cost of every endpoint grouped by
  platform. Computed from the endpoint data so it can never drift.
- **`npm run generate:data`** — regenerates `src/data/endpoints.ts` and
  `src/data/platforms.ts` from `registry-dump.json` (produced by the
  backend's `packages/social-api/scripts/extract-mcp-data.ts`).

### Changed

- Tool descriptions, README, badges, `server.json`, and the platform
  table now report 39 platforms / 221 endpoints, with counts computed
  from the bundled data instead of hardcoded strings.
- `credits` docs topic expanded: tier examples cover the commerce /
  app-store / content-analysis surfaces and point to the new `pricing`
  topic.
- Endpoint data now reflects current registry semantics — e.g.
  `tiktok/profile` accepts `handle` OR `user_id` (oneOf group).

### Removed

- Soft-disabled endpoints are no longer advertised (they 503 at the
  router): TikTok Creative Center (`songs/popular`, `creators/popular`,
  `hashtags/popular`, `videos/popular`), `reddit/ad` + `reddit/ads/search`
  (dropped upstream), SoundCloud (all 3, broken upstream), and
  `polymarket/search`.

## [1.3.0] - 2026-05-05

Adds 6 new platforms and 25 new endpoints, bringing total coverage to
**27 platforms / 133 endpoints**. Mirrors the backend additions shipped
on 2026-04-28.

### Added

- **GitHub** (12 endpoints) — `profile`, `profile/repos`, `repo`,
  `repo/readme`, `repo/releases`, `repo/issues`, `issue`,
  `issue/comments`, `search`, plus three server-side composite endpoints
  (`repo/top-issues` 5cr, `repo/dossier` 5cr, `user/profile-velocity`
  10cr). Backed by the official GitHub REST API.
- **Hacker News** (4 endpoints) — `search`, `story`, `story/comments`,
  `profile`. Backed by the public Algolia HN API; no upstream auth.
- **Polymarket** (2 endpoints) — `search` (1cr) and `research` (5cr,
  multi-query fan-out + ranking).
- **Tavily** (4 endpoints) — `search` (with optional LLM-synthesised
  answer), `extract`, `map`, `crawl`. All standard tier.
- **Perplexity** (1 endpoint) — `research` via Sonar with cited sources.
- **Universal Search** (1 endpoint) — `GET /v1/search/everywhere`. Fans
  one query out across 12 platforms in parallel with LLM-planned,
  RRF-fused, LLM-reranked results. Flat **20 credits** per call (the
  first endpoint to override the 1/5/10 tier ladder).
- **Twitter `ai-search`** — natural-language X search via xAI Grok with
  `from_handles` / `exclude_handles` / `from_date` / `to_date` filters.
  Returns `{ answer, sources, tool_calls_count }`. Twitter platform now
  has 7 endpoints (was 6).

### Changed

- README, badges, and platform table updated to reflect 27 platforms /
  133 endpoints.
- `server.json` and `package.json` descriptions broadened to mention web
  research, prediction markets, and universal meta-search.
- `getDoc("credits")` now documents the flat 20cr `search/everywhere`
  override.
- `data-integrity.test.ts` adjusted: platform count → 27, endpoint count
  → 133, allowed credit costs include 20 for the universal-search
  override.

### Notes

- Streaming SSE on `/v1/search/everywhere` is not exposed through the
  MCP tool — the `socialcrawl_request` tool always reads JSON. Agents
  who want live chunks should call the HTTP endpoint directly with
  `Accept: text/event-stream`.
- No new MCP tool was added; the new endpoints flow through the
  existing `socialcrawl_request` tool. They are discoverable via
  `socialcrawl_list_platforms` / `socialcrawl_list_endpoints`.

## [1.2.0] - prior release

Initial published baseline tracked in this changelog. See git history
for details.
