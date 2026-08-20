# Changelog

All notable changes to `socialcrawl-mcp` are documented here. The format
loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.9.0] - 2026-08-18

Re-sync with the backend registry (**44 platforms / 357 endpoints → 48 platforms /
381 active endpoints**, +28/-4) *and* a rebuild of what the MCP knows about each
one. The old extract threw away most of the registry: pricing was a single
integer, optional params carried no bounds or couplings, and pagination, cache,
delivery mode, and upstream sourcing were absent entirely. The dump is now
**schema v2** and carries all of it, so the server can price, validate, and
explain a call the way the backend actually behaves.

Two headline tools: **`socialcrawl_discover`**, which drives the API's own free
`/v1/utility/*` self-description family (and checks whether this server's bundled
catalogue has fallen behind the live API), and **`socialcrawl_pricing`**. Quoting a metered
endpoint's base cost understates every call — `/v1/search/news` has a 1cr base
and really charges 2-14cr — so pricing is now modelled as ladder / flat /
metered, and a metered endpoint is always quoted as a band with its rule.

### Added

- **New `socialcrawl_pricing` tool (tool count 7 → 8).** Four actions:
  `overview` (the tier ladder, every free endpoint, every flat override, all 26
  metered endpoints with their min-max band and exact charging rule, cache TTLs,
  and the full refund matrix), `endpoint` (one endpoint's price, rule,
  price-driving parameters, paging cost, and worst case), `platform` (a whole
  platform's cost table), and `list` (rank/filter across platforms by
  `maxCost`/`minCost`/`model`/`search`/`sort` — "everything I can call for 1
  credit", "the 10 most expensive endpoints"). No API key required.
- **New `socialcrawl_discover` tool (tool count 8 → 9) — the `/v1/utility/*`
  family.** Four endpoints, all **0 credits**, served in-process from the live
  endpoint registry (no upstream, no network hop), so they can never drift from
  what is actually callable. Five actions:
  - `quickstart` (`GET /v1/utility/quickstart`) — auth, base URL, a runnable
    first call, the success and error envelopes, the billing model, the **full
    error taxonomy** with statuses and meanings, rate limits, and the paging
    contract, in one response.
  - `catalog` (`GET /v1/utility/endpoints`) — every endpoint with its live
    metered-aware price label, params, `oneOf` groups, and paging flag. The tool
    prefers `credits_label` over the bare `credits` base, so `web/search` reads
    `2-120 (metered)` rather than `2`. Filter by platform / search / method.
  - `endpoint` (`GET /v1/utility/endpoint`) — the deepest per-endpoint object the
    API exposes: every parameter with type and example, the exact pricing rule,
    cache TTL, paging recipe, an example response with its schema URL, a
    copy-paste curl, and related endpoints. Accepts an id, a path, or a full URL.
  - `llms` (`GET /v1/utility/llms`) — the agent context corpus for the whole API
    or one platform, as markdown or JSON.
  - `freshness` — compares the live registry totals against this server's bundled
    catalogue and says whether to upgrade. Probes with a filter that matches
    nothing, because the `stats` block is whole-registry regardless of filter —
    a few hundred bytes instead of all 381 rows.

  Without an API key every action except `llms` still answers from bundled data,
  clearly labelled: discovery has to work before a key exists.
- **New `setup` docs topic** — how to configure SocialCrawl correctly and drive it
  well: per-client key configuration (Claude Code/Desktop, Cursor, VS Code,
  Windsurf, remote HTTP, plain curl), per-key spend caps, how to verify the setup,
  when bundled data is not enough, and the operating rules that decide what you
  actually pay (read `credits_used` not the sticker price; let the cache work;
  page on `has_more`; make retries idempotent; prefer one composite call to a
  hand-rolled fan-out).
- **Four new platforms:** `walmart` (5), `target` (5), `home_depot` (2),
  `ebay` (2) — product details, reviews, keyword/category search, seller offers,
  store lookup, and eBay sold/completed listings with realised prices.
- **Free API self-discovery endpoints** now in the catalogue: `utility/endpoints`,
  `utility/endpoint`, `utility/quickstart`, `utility/llms`. The `discovery` docs
  topic is a full reference for the family — every parameter, every response
  field worth reading, and when to prefer the live answer over bundled data.
- **New endpoints on existing platforms:** `reddit/post` (post detail),
  `threads/post/comments`, `tiktok/video/screen-text` (on-screen text),
  `facebook/profile/reels/full`, `search/news` (metered multi-country news lane),
  and the Naver Data Lab family (`naver/search-trend`,
  `naver/shopping-insight/category`, `naver/shopping-insight/keyword`) plus
  `naver/errata` and `naver/adult`.
- **Credit ledger in `socialcrawl_check_balance`.** `view: "transactions"` calls
  the `GET /v1/credits/transactions` meta endpoint (0 credits) for itemised,
  dispute-grade receipts — every deduction and refund with `amount`,
  `balance_after`, `endpoint`, and `request_id`, filterable by `requestId` and
  pageable with `limit`/`cursor`. This is how you confirm what a metered
  endpoint actually settled at after its upfront hold was refunded down.
- **Cross-platform endpoint search.** `socialcrawl_list_endpoints` now takes an
  optional `search` term (with `platform` omitted, it searches all 381
  endpoints), plus `method`, `maxCost`, and `detail` filters. Finding "the
  transcript endpoints" no longer means guessing a platform first.
- **Two free `socialcrawl_web` actions:** `job_errors` (a crawl/batch job's
  per-page failure feed) and `crawl_preview` (dry-run a crawl's parameters
  before paying for it). Both are stateful-router routes with no registry row,
  so neither was reachable before.
- **Seven new docs topics:** `setup`, `discovery`, `pagination` (the universal `cursor` contract,
  `has_more`, `sc.` tokens, the free anti-burn 400, page-size vs
  collect-until-N), `caching` (TTL table, free hits, cache-key rules,
  `Cache-Control: no-cache`), `response-schema` (the envelope, archetypes,
  `ext`, computed fields, response headers), and `limits` (600/min rate, 50
  concurrent, timeouts, circuit breaker, retry guidance).

### Changed

- **Dump schema v1 → v2** (`extract-mcp-data.ts` in the backend). Now emits the
  full pricing model (ladder/flat/metered + the `PRICING` min-max band + the
  registry's authored `creditCostDescription`), optional-param `minimum` /
  `maximum` / `requires` / `couplesWith`, `csvConstraints`, the pagination
  descriptor plus `paginatable` / `singlePage` / `collectUntilN`, cache category
  and resolved TTL, `execution` / `streaming`, upstream kind and fallback kinds,
  `emptyOn404`, `family`, `actionLabel`, `group`, `tags`, `contractDetails`, and
  per-platform `social` / `category`. The generator refuses a v1 dump rather
  than silently producing a thinner data layer. New `src/data/registry-meta.ts`
  carries `REGISTRY_STATS`, `CREDIT_LADDER`, and `CACHE_TTLS`.
- **`socialcrawl_request` validates values, not just presence.** It now mirrors
  the backend's pre-billing validator: enum membership, integer ranges,
  `requires` and `couplesWith` couplings, and CSV entry limits — each a free 400
  at the API, now an instant local error instead of a wasted round trip.
  Undeclared params are reported rather than silently forwarded, and an unknown
  resource suggests near matches.
- **Every price quote goes through one formatter** (`src/pricing.ts`), so
  `list_endpoints`, `request`, `web`, `pricing`, and the docs can never
  disagree — and a metered endpoint is never quoted as its base cost.
  `socialcrawl_web`'s response header now shows the band and the registry's own
  rule (e.g. crawl: "1 credit per page crawled… unused portion refunded").
- **`socialcrawl_get_docs` pages instead of truncating.** The `full` reference is
  ~300k characters; it used to be cut at 25k with advice to pick a narrower
  topic, which for a platform topic did not exist. Long topics are now split at
  line boundaries with a `page` parameter and a "page N of M" footer, so every
  endpoint is reachable. The `pricing` topic was compacted (price-grouped rows
  per platform) to fit on one page while gaining the metered bands and rules.
- **`socialcrawl_list_endpoints` prints the full parameter contract** — integer
  ranges, enum sets, CSV limits, param couplings, paging style and native
  cursor, cache TTL, async/streaming mode, upstream fallbacks, and
  `emptyOn404` semantics.
- **`socialcrawl_list_platforms` groups by category** (major social, additional
  social, commerce, ad libraries, link pages, research/web/composites) and shows
  each platform's credit range.
- **Docs refreshed against the current backend**: the `credits` topic covers all
  three billing models and the metered settle-down mechanic; `errors` adds
  `RATE_LIMITED`, `KEY_BUDGET_EXCEEDED`, and `PAYLOAD_TOO_LARGE` with a
  retryable column; the 405 row no longer claims `/v1/*` is GET-only.
- **Price-driving parameters are matched on word boundaries.** A substring test
  reported `to` as a price driver on `search/news`, because its pricing rule says
  "settles down to the actual charge". Names shorter than three characters are
  excluded outright.
- The hand-maintained `isFlatPriced` exemption list in the data-integrity tests
  is gone — `pricing.model` comes from the registry, so the ladder rule is now
  asserted for exactly the endpoints that claim it.

### Removed

- `utility/age-gender` and the Naver `book/search`, `shop/search`, `doc/search`
  endpoints (withdrawn upstream).
- The hand-copied `CREDIT_COSTS` literal in `constants.ts`, superseded by the
  generated `CREDIT_LADDER`.

### Tests

127 → **252 tests**, all green. New coverage for the pricing tool and helpers,
the local value validator (enums, ranges, couplings, CSV limits), cross-platform
endpoint search, the credit ledger view, the two new web actions, paging, and the
`/v1/utility/*` discovery family (anonymous fallback, live call shapes, id
normalisation, metered-label preference, and the freshness drift check).
New drift guards assert every metered endpoint quotes a band or a rule, that
ladder-priced endpoints charge their tier rate, and that param couplings and CSV
constraints only name params the endpoint actually declares. A new
**surface-coverage** suite asserts that every one of the 381 endpoints is
callable through some tool, priced by `socialcrawl_pricing`, present in its
platform docs, and listed with every one of its params and enum values across
the paged listing — so an endpoint added upstream cannot go silently unreachable.

## [1.8.0] - 2026-07-10

Re-sync with the backend registry, bringing coverage from 42 platforms /
323 endpoints to **44 platforms / 357 active endpoints** (+34). This wave adds
the first **non-GET** endpoints to the surface, so the data layer and request
path are now **method-aware** (GET/POST/PATCH/DELETE), and the stateful web
platform gets its own tool. Data regenerated via the standard pipeline (the
backend's `extract-mcp-data.ts` → `npm run generate:data`).

### Added

- **New `socialcrawl_web` tool → the `web` platform (22 endpoints).** Full web
  scraping, search, and browser automation (Firecrawl-backed), driven by one
  `action` parameter. Sync reads (`scrape`, `search`, `map`, `extract`); async
  jobs with a poll/cancel lifecycle (`crawl`, `batch_scrape`, `agent` →
  `job_get`/`job_list`/`job_cancel`); stateful change **monitors**
  (`monitor_create`/`list`/`get`/`update`/`delete`/`checks`); and interactive
  browser **sessions** (`session_create`/`list`/`get`/`execute`/`close`). Path
  ids are validated and URL-encoded (same hardening as `socialcrawl_monitors`).
  `web/parse` (multipart upload) is documented but served directly via REST.
- **New `google_trends` platform (2 endpoints):** `explore` (interest-over-time)
  and `rising` (breakout related queries), DataForSEO-backed.
- **Batch POST endpoints on `socialcrawl_request`.** New `body` parameter carries
  the JSON body for POST batch endpoints — `youtube/videos`, `youtube/channels`,
  `youtube/transcripts`, `prism/comment-lookup`, `prism/profiles` (plus the
  existing `prism/post-stats`). Array/object params (ids/urls/items) go in
  `body`; scalar query params (e.g. YouTube `hl`, marked `in: "query"` in the
  registry) are auto-routed to the query string. JSON-string arrays are coerced
  to real arrays.
- **New endpoints on existing platforms:** `tiktok/comment` and
  `instagram/comment` (single-comment lookup), `youtube/videos` /
  `youtube/channels` / `youtube/transcripts` (batch), `google_play/search-suggestions`,
  `app_store/search-suggestions`, and `prism/handle-audit`.
- **`get_docs` `web` topic** and a `[query param]` marker in `list_endpoints`
  for `in:query` params on POST endpoints.

### Changed

- **Data layer is now method-aware.** `Endpoint.method` is a
  `GET | POST | PATCH | DELETE` union (was the literal `"GET"`); optional params
  can carry an `in: "query" | "body"` marker; `findEndpoint(platform, resource,
  method?)` disambiguates the stateful web resources that share a resource path
  across methods. The extract script (`extract-mcp-data.ts`) now emits the `in`
  marker; `generate-data.ts` emits the real method.
- **`socialcrawl_request` is method-aware** and refuses the `web` platform with a
  pointer to `socialcrawl_web`. GET endpoints are unchanged (query params).
- **Pricing surfaces are method-aware.** The `pricing` doc, `list_endpoints`, and
  per-endpoint doc blocks all show the HTTP method; the pricing table is grouped
  by platform with the shared `/v1/{slug}/…` base in the section header (keeping
  the doc under the 25k truncation limit as the endpoint count grew).
- **Repriced (backend):** `instagram/post/comments`, `reddit/post/comments`,
  `instagram/search/hashtag`, and `twitter/ai-search` moved from standard (1cr)
  to advanced (5cr). Tier split is now standard/advanced/premium = 210/117/30.
- Bumped to **1.8.0** across `package.json`, `server.json`, `constants.ts`,
  README, and the in-server docs; tool count is now **7**.

## [1.7.0] - 2026-07-02

### Added

- **Remote Streamable HTTP transport.** New hosted endpoint `https://mcp.socialcrawl.dev/mcp` (spec rev 2025-11-25, stateless). Auth via `Authorization: Bearer <key>` or `x-api-key` header; the discovery tools work anonymously. New `socialcrawl-mcp-http` bin / `npm run start:http` for self-hosting, plus a Dockerfile.
- **Internal:** credentials are now per-request (`ApiContext`) instead of process-global env; stdio behavior is unchanged.

## [1.6.0] - 2026-06-26

Re-sync with the backend registry, bringing coverage from 42 platforms /
264 endpoints to **42 platforms / 323 active endpoints** (+59). No new
platforms — the growth lands on existing surfaces via new upstreams and
composites. Data layer regenerated via the standard pipeline (the backend's
`extract-mcp-data.ts` → `npm run generate:data`).

### Added

- **LinkedIn expansion → 44 endpoints** (was 9). Re-sourced to the Fresh
  LinkedIn Scraper upstream with a unified-schema port: canonical profiles &
  company pages, `post`, `profile/posts`, `profile/reactions`,
  `post/reposts`, `group/posts`, `company/posts`, `post/comments` +
  `/replies`, people & company-people search, `company/affiliated-pages`,
  the new **`Job`/`JobList`** archetype (`search/jobs`, `company/jobs`,
  `job`), structured profile sub-resources (experiences, educations, skills,
  honors, certifications, publications, volunteers, recommendations,
  interests, images, videos), company insights & job-count, groups, and
  location/school/industry search.
- **Instagram expansion → 32 endpoints** (was 16). New private-API-backed
  capabilities: `followers`, `following`, `similar`, `post/likers`,
  `tagged`, `location/posts`, `stories`, `story/download`, `engagement`
  analytics, `post/stats` (reshare counts), `search/location`,
  `search/music`, `username-suggestions`, and `music/trending`; plus two
  flat-5cr composites — **`profile/reels/full`** and **`profile/posts/full`**
  — that return a creator's whole reels/posts page *with* the per-item share
  count in one call (previously one `post/stats` call per item), each
  reporting a `shares_coverage` fraction and per-leg transparency.
- **YouTube expansion → 25 endpoints** (was 17). New second-upstream
  capabilities: `videos/trending`, `search/advanced`, `playlist/items`,
  `search/suggestions` (autocomplete), and the new **`MediaList`**
  archetype for downloadable media — `video/audio`, `video/files`,
  `video/subtitles`, `video/thumbnails`.

### Changed

- Bumped to **1.6.0**. Tool descriptions, README, badges, `server.json`,
  `package.json`, and the platform table now report 42 platforms /
  323 endpoints.
- **`youtube/video/transcript` re-sourced & repriced — 10cr → 3cr.** Richer
  per-segment data; the segment fields changed from `startMs`/`endMs` to
  `offset`/`duration` (both in seconds). This is the one customer-facing
  shape change. `data-integrity.test.ts` exempts it from the 1/5/10 tier
  ladder (flat 3cr override).
- **Content Analysis aggregates repriced — flat 20cr.** The six
  `content_analysis` data endpoints (`search`, `summary`, `sentiment`,
  `rating-distribution`, `phrase-trends`, `category-trends`) moved off the
  5cr advanced tier to a flat 20cr (`CONTENT_ANALYSIS_COST`); the
  `languages`/`locations`/`categories`/`filters` reference endpoints stay at
  1cr. Credits/overview docs and the tier table updated accordingly.
- `data-integrity.test.ts` — endpoint count → 323; the credit-cost ladder
  exemption now also covers `youtube/video/transcript` and the flat-priced
  `content_analysis` aggregates.
- Platform descriptions for LinkedIn, Instagram, and YouTube refreshed in
  the generator to reflect the new capabilities.

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
