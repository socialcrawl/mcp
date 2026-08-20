import { PLATFORMS } from "./platforms.js";
import { ENDPOINTS } from "./endpoints.js";
import { CACHE_TTLS, CREDIT_LADDER, REGISTRY_STATS } from "./registry-meta.js";

/**
 * Hand-written documentation blocks — the cross-cutting contracts (auth,
 * billing, errors, paging, caching, limits, response shape) that are not
 * derivable from the per-endpoint registry data. Everything endpoint-specific
 * is generated in `docs.ts` from ENDPOINTS / PLATFORMS instead, so it can never
 * drift from the backend.
 */

const free = ENDPOINTS.filter((e) => e.pricing.cost === 0);
const metered = ENDPOINTS.filter((e) => e.pricing.model === "metered");

export const HANDWRITTEN: Record<string, string> = {
  overview: `# SocialCrawl API

Unified social, commerce, and research data API. One API key, one response envelope, ${PLATFORMS.length} platforms, ${ENDPOINTS.length} endpoints — social media, commerce & product reviews, retail (Amazon, Walmart, Target, Home Depot, eBay, Google Shopping), app stores, places & travel, business reputation, news & finance, web research plus full web scraping & browser automation, prediction markets, search trends, Korean search (Naver), content/sentiment analysis, and cross-platform Prism composites.

The web-scraping/crawling/browser-automation surface (the \`web\` platform) is driven by the dedicated \`socialcrawl_web\` tool; the stateful monitors wrapper by \`socialcrawl_monitors\`. Everything else goes through \`socialcrawl_request\`.

## Base URL

https://www.socialcrawl.dev/v1

## Authentication

Pass your API key in the \`x-api-key\` header with every request. See the \`authentication\` topic.

## Platforms

${PLATFORMS.map((p) => `- ${p.slug} (${p.endpointCount} endpoint${p.endpointCount === 1 ? "" : "s"})`).join("\n")}

## Credits

Three billing models:

- **Ladder** — the tier rate per request: standard ${CREDIT_LADDER.standard}, advanced ${CREDIT_LADDER.advanced}, premium ${CREDIT_LADDER.premium} credits.
- **Flat** — a per-endpoint override (e.g. \`GET /v1/search/everywhere\` at 20cr; the ${free.length} free endpoints at 0cr).
- **Metered** (${metered.length} endpoints) — the charge depends on the request. An upfront ceiling is deducted and automatically refunded down to the work actually done.

Cache hits, idempotent replays, empty results, and upstream failures all cost 0 credits. Use the \`socialcrawl_pricing\` tool (or the \`pricing\` docs topic) for the exact cost of every endpoint.

## Free API discovery

\`utility/endpoints\`, \`utility/endpoint\`, \`utility/quickstart\`, and \`utility/llms\` describe the API from inside the API at 0 credits — see the \`discovery\` topic.

## Meta Endpoints

API-key-authed endpoints that return account metadata at 0 credit cost:

- \`GET /v1/credits/balance\` — current credit balance and recent deduction summary.
- \`GET /v1/credits/transactions\` — the itemised credit ledger (deductions and refunds, keyed by \`request_id\`).

Both are served by the \`socialcrawl_check_balance\` tool.

## Full Reference

For complete endpoint documentation with parameters, examples, and response schemas:
https://www.socialcrawl.dev/llms-full.txt

## OpenAPI Spec

https://www.socialcrawl.dev/v1/openapi.json`,

  authentication: `# SocialCrawl API — Authentication

Every request requires an \`x-api-key\` header with your API key. Keys start with \`sc_\`.

\`\`\`
curl https://www.socialcrawl.dev/v1/tiktok/profile?handle=charlidamelio \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

## Where to get a key

Sign up at https://www.socialcrawl.dev — every account starts with 100 free credits, no credit card required.

## Key management

- Keys can be rotated from the dashboard at any time.
- Maximum 5 active keys per account.
- Revoked keys stop working immediately.
- A key can carry its own \`credit_limit\`. When that per-key cap is spent while the account still has credits, requests fail with \`KEY_BUDGET_EXCEEDED\` (402) — raise the key's cap rather than topping up the balance.

## Configuring the key in the MCP server

**Local (stdio, \`npx socialcrawl-mcp\`):** the server reads \`SOCIALCRAWL_API_KEY\` from the environment of the MCP process. Set it in the MCP client config (Claude Desktop, Cursor, VS Code, etc.) or as a system environment variable.

**Remote (Streamable HTTP, https://mcp.socialcrawl.dev/mcp):** send the key on every request as an \`Authorization: Bearer <key>\` or \`x-api-key: <key>\` header — in Claude Code: \`claude mcp add --transport http socialcrawl https://mcp.socialcrawl.dev/mcp --header "Authorization: Bearer sc_your_key"\`. Keys are never accepted in the URL or query string.

The discovery tools (\`socialcrawl_list_platforms\`, \`socialcrawl_list_endpoints\`, \`socialcrawl_pricing\`, \`socialcrawl_get_docs\`) work without a key — only calls that hit the API need one.`,

  credits: `# SocialCrawl API — Credits

Every request costs credits. The MCP server validates and prices a call locally before making it, and the response envelope reports both \`credits_used\` and \`credits_remaining\`.

## The three billing models

| Model | Endpoints | How it charges |
|-------|-----------|----------------|
| ladder | ${ENDPOINTS.filter((e) => e.pricing.model === "ladder").length} | The tier rate, charged per request. |
| flat | ${ENDPOINTS.filter((e) => e.pricing.model === "flat").length} | A per-endpoint override off the ladder (includes the ${free.length} free endpoints). |
| metered | ${metered.length} | Query-dependent: an upfront ceiling is deducted, then refunded down to the work actually done. |

### Tiers

| Tier | Cost per request | Typical use |
|------|------------------|-------------|
| standard | ${CREDIT_LADDER.standard} credit | Profile, post, comment, and search endpoints; static reference data (app-store and Target categories, locations, languages) |
| advanced | ${CREDIT_LADDER.advanced} credits | Trending feeds, audience analytics, ad transparency, GitHub composites, Polymarket research, retail product/review data (Amazon, Walmart, Target, Home Depot, eBay, Google Shopping), Trustpilot and Google Business reviews, hotel details, app-store search/info/reviews/charts |
| premium | ${CREDIT_LADDER.premium} credits | AI-powered utilities (transcript generation), LinkedIn people/job search, GitHub profile-velocity, and the app-store listings-search databases |

Counting every endpoint under its declared tier: standard ${REGISTRY_STATS.standardEndpoints}, advanced ${REGISTRY_STATS.advancedEndpoints}, premium ${REGISTRY_STATS.premiumEndpoints}.

### Metered endpoints

A metered endpoint's real charge is decided by your query — quoting its base cost under-reports what you will pay. The router deducts a worst-case ceiling up front and refunds the difference when the work settles, so \`credits_used\` in the response envelope (and the \`X-Credits-Used\` header) is always the truth. Examples: \`prism/comments\` bills 1 credit per comment page scanned; \`search/news\` bills 2 credits plus 1 per country leg that returned articles; \`web/crawl\` holds \`limit\` credits and refunds every page it did not crawl.

Use the \`socialcrawl_pricing\` tool with \`action: "endpoint"\` for any endpoint's exact band, rule, and price-driving parameters.

## What is never charged

- **Cache hits** (BIL-03) — the envelope includes \`"cached": true\` and no credits are deducted. TTLs run from 2 minutes (search) to 30 days (transcripts); see the \`caching\` topic.
- **Idempotent replays** (BIL-02) — a repeat with the same \`Idempotency-Key\` returns the stored response, deducts 0, and sets \`X-Idempotent-Replay: true\`. 24h TTL.
- **Empty results** (BIL-01) — an empty single-object lookup returns 404 \`RESOURCE_NOT_FOUND\` and an empty list returns 200 \`{items: []}\`; both auto-refund. You are never billed for a resource that does not exist or a search that matched nothing.
- **Upstream and internal failures** — 502 \`UPSTREAM_ERROR\`, 503 \`SERVICE_UNAVAILABLE\`, 500 \`INTERNAL_ERROR\`, and request-deadline 504s all reverse the charge.
- **Rejected requests** — 400/401/402/405/409/413/422/429 never deduct: validation runs before billing.
- **The meta and discovery endpoints** — \`/v1/credits/balance\`, \`/v1/credits/transactions\`, the four \`utility/*\` discovery endpoints, and all monitor and web job/monitor/session management.

## Partial-coverage refund on universal search

\`GET /v1/search/everywhere\` (flat 20cr) fans out across many sources. If no usable items come back at all you are fully refunded; if coverage falls below 50% of the sources actually called, half the fee is refunded (10cr charged). The response's \`coverage\`, \`sources_called\`, \`sources_failed\`, \`sources_pruned\`, and \`partial_failure\` fields show exactly what happened.

## Verifying a charge

\`socialcrawl_check_balance\` with \`view: "transactions"\` returns the credit ledger: every deduction and refund with \`amount\`, \`balance_after\`, \`endpoint\`, and \`request_id\`. Deductions are negative and refunds positive, so a page of amounts sums to the balance delta. Look up a specific call with \`requestId\` to see exactly what a metered endpoint settled at.

## Advisory warnings (ENV-03)

Successful responses may include an optional \`data._warnings\` string array — non-fatal notices from the transform pipeline (e.g. an engagement-rate clamp, or \`walk_deadline_reached\` on a server-side page walk). Treat as observability hints, not as failures.

## Insufficient credits

Out of credits returns \`INSUFFICIENT_CREDITS\` (402) with \`credits_remaining: 0\`. A per-key spending cap returns \`KEY_BUDGET_EXCEEDED\` (402) instead — a different fix (raise the key's cap, don't top up). Neither is retryable; waiting does not clear them.`,

  errors: `# SocialCrawl API — Errors

All errors follow the same envelope — every \`/v1\` exit is JSON, never a bare gateway page:

\`\`\`json
{
  "success": false,
  "error": {
    "type": "INVALID_REQUEST",
    "message": "Missing required parameter: handle",
    "status": 400,
    "doc_url": "https://www.socialcrawl.dev/docs/errors/invalid-request"
  },
  "credits_used": 0,
  "credits_remaining": 99,
  "request_id": "req-XXXXX"
}
\`\`\`

## Error types

| Type | Status | Retryable | Meaning |
|------|--------|-----------|---------|
| \`MISSING_API_KEY\` | 401 | no | No \`x-api-key\` header supplied |
| \`INVALID_API_KEY\` | 401 | no | Key does not exist or has been revoked |
| \`INSUFFICIENT_CREDITS\` | 402 | no | Account balance too low for this endpoint |
| \`KEY_BUDGET_EXCEEDED\` | 402 | no | This key's own \`credit_limit\` is spent while the account still has credits — raise the key's cap, don't top up |
| \`INVALID_REQUEST\` | 400 | no | Missing/invalid parameter, bad enum value, broken param coupling, over-long CSV, bad handle/URL format, or a mangled text encoding (ERR-01) |
| \`METHOD_NOT_ALLOWED\` | 405 | no | Wrong HTTP method for this route (ERR-02). Response includes \`Allow\` |
| \`ENDPOINT_NOT_FOUND\` | 404 | no | Unknown platform+resource combination |
| \`RESOURCE_NOT_FOUND\` | 404 | no | Upstream resource does not exist or returned an empty body (BIL-01) — credits auto-refunded |
| \`IDEMPOTENCY_KEY_CONFLICT\` | 409 | no | \`Idempotency-Key\` already used by another account (BIL-02) |
| \`IDEMPOTENCY_KEY_PAYLOAD_MISMATCH\` | 422 | no | Same \`Idempotency-Key\` reused with different parameters (BIL-02) |
| \`PAYLOAD_TOO_LARGE\` | 413 | no | Request body over the JSON size cap (rejected before parse) |
| \`RATE_LIMITED\` | 429 | **yes** | Over the 600 requests/minute per-key window (AIP-09). Unbilled |
| \`CONCURRENCY_LIMIT\` | 429 | **yes** | More than 50 simultaneous requests on the same key |
| \`UPSTREAM_ERROR\` | 502 | **yes** | Upstream source failed — credits refunded automatically |
| \`SERVICE_UNAVAILABLE\` | 503 | **yes** | Circuit breaker open — credits refunded, response includes \`Retry-After: 30\` |
| \`INTERNAL_ERROR\` | 500 | **yes** | Bug on our side — credits refunded; the request ID is the fastest way to report it |

A request that hits the request-scoped deadline returns a JSON 504 with the credit refunded before the serverless kill.

## Auto-refund matrix

Credits are refunded automatically on: 404 \`RESOURCE_NOT_FOUND\` (empty upstream — BIL-01), an empty list result (200 \`{items: []}\`), 502, 503, 500, and 504. Cache hits, 400, 401, 402, 405, 409, 413, 422, and 429 never deduct credits in the first place.

## Retry guidance

Retry only the four transient classes (429/500/502/503). Honour \`Retry-After\` when present, then back off with jitter. Every other code is a client-side fix — retrying it loops forever. To make a retry billing-safe, pass an \`Idempotency-Key\` (see the \`idempotency\` topic).

## Client-side validation

Before making any request, this MCP server validates locally that the platform exists, the resource exists, all required parameters and \`oneOf\` groups are satisfied, enum values are legal, integers are in range, parameter couplings hold, and CSV lists are within their limits. That turns a round-trip 400 into an instant free error.`,

  idempotency: `# SocialCrawl API — Idempotent Requests (BIL-02)

Any \`/v1/*\` request can be made retry-safe by supplying an \`Idempotency-Key\` header. Network blips, agent retries, and redelivery from a queue stop being a billing risk.

## How to use it

The \`socialcrawl_request\` tool (and \`socialcrawl_web\` for the async job submitters) accepts an optional \`idempotencyKey\` parameter:

- Use a UUIDv4 (or any opaque 16+ character string) the agent can regenerate on retry.
- Reuse the same key across retries of the same logical operation.
- Generate a fresh key for each new logical operation.

## What the server does

\`lookupIdempotency(userId, key, requestHash)\` returns one of four verdicts:

| Outcome | HTTP | Body | Credits |
|---------|------|------|---------|
| \`proceed\` | (continues normal flow) | — | normal cost |
| \`replay\` | 200 (original status) | stored response verbatim, with \`X-Idempotent-Replay: true\` header | 0 deducted |
| \`conflict\` | 409 | \`IDEMPOTENCY_KEY_CONFLICT\` | 0 |
| \`payload_mismatch\` | 422 | \`IDEMPOTENCY_KEY_PAYLOAD_MISMATCH\` | 0 |

The \`requestHash\` is a stable hash of \`(method, path, sorted query params)\`.

## TTL

Idempotency rows live for **24h**. After that the key is reusable.

## Credits and cache

Replays cost **0 credits** — same as cache hits. Idempotency lookup runs *before* the cache check, so a replay wins over a \`Cache-Control: no-cache\` force-refresh: exactly-once semantics beat freshness.

## Streaming caveat

A streamed (SSE) response is not stored for replay — idempotency applies to the JSON envelope path.`,

  pagination: `# SocialCrawl API — Pagination

Every list endpoint speaks one client contract, whatever its upstream calls its cursor.

## The universal \`cursor\` param

The registry declares 11 different native cursor names (\`max_cursor\`, \`next_max_id\`, \`continuationToken\`, \`after\`, \`next_page_id\`, …) plus \`page\` and \`offset\` styles. **Every paginatable endpoint also accepts \`cursor\`**, rewritten to that endpoint's native param before validation, caching, and dispatch. The native names still work; \`cursor\` is the one you should write.

\`socialcrawl_list_endpoints\` prints each endpoint's paging style and native param.

## The \`pagination\` envelope block

Every list response carries a top-level:

\`\`\`json
"pagination": { "next_cursor": "sc.…", "has_more": true, "page_size": 20 }
\`\`\`

**Stop on \`has_more === false\`**, not on cursor absence. A zero-item page never advances (\`next_cursor\` is dropped), so an empty page is an honest end rather than an infinite loop. The legacy \`data.next_cursor\` is retained for one deprecation cycle.

## The \`sc.\` token

\`next_cursor\` is an opaque \`sc.<base64url>\` token that packs the native param, the inner cursor, and any source pin. Treat it as opaque: pass it back verbatim. Page/offset styles encode the next number inside the token and advance server-side, so you never compute an offset yourself.

## Anti-burn 400 (free)

Sending a *known* cursor name that is not this endpoint's native param (or \`cursor\`) is rejected with \`INVALID_REQUEST\` + \`error.details.did_you_mean: "cursor"\` at **0 credits**. This exists because the old failure mode was silent: the wrong name was ignored, page 1 came back again, \`next_cursor\` looked null, and you paid for it.

## \`limit\`: page size vs collect-until-N

For most endpoints \`limit\` is a **page size** mapped to the upstream's native limit param (with an endpoint-specific max).

For a handful it is **collect-until-N**: the endpoint walks upstream pages itself until it has N unique items, de-duplicating server-side, and bills per page actually consumed with the unused budget refunded. \`socialcrawl_list_endpoints\` flags these explicitly — the name of the native param cannot tell you which is which.

## Composites that walk for you

Server-side composites marked *paginatable* (e.g. \`prism/comments\`) walk every page in one call and fold the results together. One call, one metered charge covering the whole walk — do not page these yourself.

## Billing while paging

Each page of an ordinary list endpoint is a separate billed request. A repeat of the same page inside the cache TTL is free. An empty page is refunded.`,

  caching: `# SocialCrawl API — Caching

**A cache hit costs 0 credits.** We already paid the upstream for the call that produced the cached body; billing you a second time for the same bytes would be double-charging. The envelope reports \`"cached": true\` and the response carries \`X-Cache: HIT\`.

## TTL by category

| Category | TTL | Typical endpoints |
|----------|-----|-------------------|
| profile | ${CACHE_TTLS.profile}s (15 min) | Profile / author lookups |
| post | ${CACHE_TTLS.post}s (10 min) | Post and video detail |
| comments | ${CACHE_TTLS.comments}s (5 min) | Comment and reply lists |
| search | ${CACHE_TTLS.search}s (2 min) | Search and feed endpoints |
| analytics | ${CACHE_TTLS.analytics}s (30 min) | Analytics, aggregates, reference data |
| immutable | ${CACHE_TTLS.immutable}s (30 days) | Single-video transcripts — a published transcript never changes |

Each endpoint's exact category and TTL is shown by \`socialcrawl_list_endpoints\` and \`socialcrawl_pricing\`. An endpoint may declare its own TTL override; \`0\` means it is never cached and every call is live and billed.

## The cache key

Deterministic from \`platform + resource + sorted query params\`, plus a version segment. Two consequences worth knowing:

- **Adding junk query params does NOT bypass the cache** — unknown params are stripped from the key (BIL-06). They also never reach upstream.
- Parameter order does not matter.

## Forcing a fresh fetch

Send \`Cache-Control: no-cache\`. The lookup is skipped (guaranteed-live fetch, billed at the normal rate) but the fresh result is still written back, so the next plain caller gets a free hit. \`X-Cache\` reports \`MISS\`.

An \`Idempotency-Key\` replay runs *before* the cache check, so a replay beats a force-refresh.

## Streaming

A streamed (SSE) response never shares a cache slot with the sync JSON variant: both the lookup and the write are skipped for a streaming request. A prior sync result can never be replayed as a stream, and a stream never seeds a sync envelope.`,

  "response-schema": `# SocialCrawl API — Response Schema

## The envelope

Every successful \`/v1\` response:

\`\`\`json
{
  "success": true,
  "platform": "tiktok",
  "endpoint": "/v1/tiktok/profile",
  "data": { "...": "..." },
  "credits_used": 1,
  "credits_remaining": 4999,
  "request_id": "req-XXXXX",
  "cached": false
}
\`\`\`

\`credits_used\` is the **settled** charge — for a metered endpoint that is the post-refund number, not the upfront hold. Errors use the same envelope with \`success: false\` and an \`error\` object (see the \`errors\` topic).

## List responses

A list archetype's \`data\` is normalised to \`{ items, total?, next_cursor?, dropped }\` plus the top-level \`pagination\` block. An empty list is \`200 { items: [], total: 0 }\` with the credit refunded — a valid "zero matches", not an error. A single-object lookup that finds nothing is a refunded \`404 RESOURCE_NOT_FOUND\` instead.

## \`data.dropped\` — the integrity counter

Every list response carries \`data.dropped\`: the count of upstream items discarded because they could not be repaired to the endpoint schema. \`0\` is a positive assertion that the page is complete, not a default — check it on every page of a drain, because \`items.length\` cannot distinguish a lossy page from a genuinely small one.

\`\`\`json
"data": { "items": ["..."], "total": 42, "dropped": 0 }
\`\`\`

**It lives inside \`data\`, not at the envelope root** — unlike \`pagination\`, which is a root sibling of \`data\`. Reading \`response.dropped\` yields \`undefined\`, which a lenient client misreads as zero and a strict one misreads as an outage. Read \`response.data.dropped\`. Singular (non-list) responses omit it entirely; there is no list to lose rows from.

The published OpenAPI declared this field at the envelope root between 2026-07-09 and 2026-08-10. That was a spec error, not a wire change: no response has ever carried a root-level \`dropped\`. See GitHub socialcrawl/mcp#2.

## \`data._warnings\` — non-fatal notices

An optional \`string[]\` appended to \`data\` when the transform pipeline reports drift (unresolved field-map paths, clamped computed values). Advisory only: never flip success, gate a retry, or treat it as an error on its presence. Omitted entirely when empty, so absent means "no warnings".

## The canonical schema

Every endpoint declaring an archetype is validated against one canonical Zod schema at the wire, so the same field means the same thing on every platform. Archetype families:

- **Social** — \`Author\`/\`AuthorList\`, \`Post\`/\`PostList\`, \`Comment\`/\`CommentList\`, \`Audience\`, \`Transcript\`, \`SearchResult\`, \`Analytics\`, \`MediaList\`.
- **Commerce** — \`Product\`/\`ProductList\`, \`Review\`/\`ReviewList\`, \`Seller\`/\`SellerList\`.
- **Places, apps, news, finance, jobs** — \`Place\`/\`PlaceList\`, \`App\`/\`AppList\`, \`NewsArticleList\`, \`QuoteList\`, \`JobList\`.
- **Web** — \`WebPage\`/\`WebPageList\`.

\`socialcrawl_list_endpoints\` shows each endpoint's archetype in its Response column.

## Platform-specific fields: \`ext\`

Data that does not fit a canonical field lives in a typed, optional \`ext\` sub-object on the post/comment/author/product/review/app objects. Keys are declared per platform — anything undeclared is stripped by the schema gate, so \`ext\` is a contract, not a free-form bag.

One join key worth memorising: the stable cross-endpoint YouTube creator key is \`post.ext.channel_id\` (the bare \`UC…\` id), never \`post.author.username\`, which is the \`@handle\` or \`null\`.

## Computed fields

Where the inputs are present, responses add a \`computed\` block: \`engagement_rate\`, \`language\`, \`content_category\`, \`estimated_reach\`. Unknown values are \`null\`, never zero.

## Response headers

| Header | Value |
|--------|-------|
| \`X-Request-Id\` | Unique request identifier (\`req-XXXXX\`) — quote it in any support report |
| \`X-Credits-Used\` | Settled credits for this request (0 on a cache hit, refund, or replay) |
| \`X-Credits-Remaining\` | Balance after deduction |
| \`X-Cache\` | \`HIT\` or \`MISS\` |
| \`X-RateLimit-Limit\` / \`-Remaining\` / \`-Reset\` | Per-key request-rate window |
| \`X-Concurrency-Limit\` / \`-Remaining\` | Per-key concurrency headroom |
| \`X-Idempotent-Replay\` | \`true\` when the body was replayed from an idempotency record |

## Advisory warnings

\`data._warnings\` is an optional string array of non-fatal notices from the transform pipeline. Treat as observability hints, not failures.`,

  limits: `# SocialCrawl API — Rate Limits, Concurrency & Timeouts

| Limit | Value | On breach |
|-------|-------|-----------|
| Request rate | 600 requests / minute / key (sliding window) | \`RATE_LIMITED\` 429, **unbilled**. Fail-open: a degraded limiter lets traffic through rather than blocking it |
| Concurrency | 50 simultaneous requests / key | \`CONCURRENCY_LIMIT\` 429, unbilled |
| Active API keys | 5 per account | Key creation refused |
| Request body | JSON size cap | \`PAYLOAD_TOO_LARGE\` 413, rejected before parse |
| Idempotency records | 24h TTL | Key becomes reusable |

## Headers to steer by

Every \`/v1/*\` response carries \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, and \`X-RateLimit-Reset\` (unix epoch seconds; omitted when the limiter is degraded), plus \`X-Concurrency-Limit\` and \`X-Concurrency-Remaining\` — including on a 429. Read \`X-RateLimit-Remaining\` and pace yourself instead of discovering the wall.

The two are deliberately separate and never aliased: 600/min is a *rate*, 50-at-once is a *depth*. A batch job can breach the second without approaching the first.

## Timeouts and deadlines

- Each request runs under a **request-scoped deadline**. If it is about to expire, the API returns a JSON 504 with the credit refunded rather than being killed mid-flight by the platform.
- Upstream calls have a per-attempt timeout with retries on transient 5xx and network failures, bounded by a per-endpoint total budget. Slow upstreams (retail providers in particular) carry tighter budgets so a hung call still leaves room to refund.
- This MCP client aborts a request after 30 seconds and reports the timeout.

## Circuit breaker

A distributed breaker keyed by platform + upstream opens after repeated failures. While open, single-source endpoints return \`SERVICE_UNAVAILABLE\` (503) with \`Retry-After: 30\` and a full refund; multi-source endpoints route around the open source instead. One degraded platform never takes down its neighbours.

## Retrying well

Retry only 429/500/502/503 (and 504). Honour \`Retry-After\`, back off with jitter, and attach an \`Idempotency-Key\` so a retry can never double-charge.`,

  setup: `# SocialCrawl — Setup & Correct Use

How to configure SocialCrawl, and how to drive it well once it is configured. Everything on this page is free to verify: \`socialcrawl_discover\` calls the API's own \`/v1/utility/*\` endpoints at 0 credits.

## 1. Get a key

Sign up at https://www.socialcrawl.dev — 100 free credits, no credit card. Keys start with \`sc_\`. Up to 5 active keys per account, rotatable from the dashboard at any time.

A key can carry its own \`credit_limit\`. That cap is separate from the account balance: when it is spent you get \`KEY_BUDGET_EXCEEDED\` (402) while the account still has credits. Give each integration its own capped key and a runaway agent can only spend its own budget.

## 2. Configure the key

**Local (stdio) — \`npx socialcrawl-mcp\`.** The server reads \`SOCIALCRAWL_API_KEY\` from its own process environment, which your MCP client supplies:

\`\`\`json
{
  "mcpServers": {
    "socialcrawl": {
      "command": "npx",
      "args": ["-y", "socialcrawl-mcp"],
      "env": { "SOCIALCRAWL_API_KEY": "sc_your_key_here" }
    }
  }
}
\`\`\`

- **Claude Code:** \`claude mcp add socialcrawl -e SOCIALCRAWL_API_KEY=sc_… -- npx -y socialcrawl-mcp\`
- **Claude Desktop:** \`claude_desktop_config.json\` (macOS \`~/Library/Application Support/Claude/\`, Windows \`%APPDATA%\\Claude\\\`)
- **Cursor / VS Code / Windsurf:** the same \`mcpServers\` block in that client's MCP config file.

**Remote (Streamable HTTP) — no install.** Send the key as a header on every request; it is never accepted in a URL or query string:

\`\`\`
claude mcp add --transport http socialcrawl https://mcp.socialcrawl.dev/mcp \\
  --header "Authorization: Bearer sc_your_key_here"
\`\`\`

\`x-api-key: sc_…\` works too. The remote transport is stateless and builds its context per request — it never falls back to a server-side environment key, so an anonymous caller cannot inherit the operator's credits.

**Direct HTTP, no MCP.** \`x-api-key: sc_…\` on every \`/v1/*\` request against \`https://www.socialcrawl.dev\`.

## 3. Verify the setup

\`\`\`
socialcrawl_check_balance
\`\`\`

0 credits, and it proves auth end to end. If it fails, the message names the cause: \`MISSING_API_KEY\` means the env var never reached the process; \`INVALID_API_KEY\` means it is malformed, revoked, or from another environment.

Then confirm this server's catalogue is current:

\`\`\`
socialcrawl_discover  action: "freshness"
\`\`\`

This is the one check people skip. The MCP ships a catalogue generated when it was built; the API keeps moving. \`freshness\` compares the two and tells you whether to upgrade (\`npx -y socialcrawl-mcp@latest\`). Calls always hit the live API and keep working — but discovery, pricing, and local validation answer from the snapshot, so a newer endpoint looks unknown until you upgrade.

## 4. Pick the right tool

| You want to… | Tool |
|--------------|------|
| See what platforms exist | \`socialcrawl_list_platforms\` |
| Find an endpoint | \`socialcrawl_list_endpoints\` with \`search\` |
| Know what a call costs | \`socialcrawl_pricing\` |
| Learn one endpoint completely | \`socialcrawl_discover\` \`action: "endpoint"\` |
| Fetch data | \`socialcrawl_request\` |
| Scrape / crawl / browse the open web | \`socialcrawl_web\` |
| Schedule a recipe on a cadence | \`socialcrawl_monitors\` |
| Check balance or explain a charge | \`socialcrawl_check_balance\` |
| Read a contract (paging, caching, errors…) | \`socialcrawl_get_docs\` |
| Get the live, authoritative answer | \`socialcrawl_discover\` |

Two surfaces do **not** go through \`socialcrawl_request\`: the \`web\` platform (action-based, mixes GET/POST/PATCH/DELETE and async jobs) and monitors (\`/v1/monitors/*\`, not registry endpoints).

## 5. Bundled vs live — which to trust

This server answers most questions from a catalogue generated from the backend registry at build time. That is fast, works without a key, and is right almost always.

The \`/v1/utility/*\` endpoints answer from the live registry at request time. They are the authority when the two disagree.

Prefer bundled (the default) for browsing and planning. Reach for \`socialcrawl_discover\` when:

- an endpoint you expect is missing, or a parameter is rejected that the docs say exists;
- you need the exact live price of a metered endpoint;
- you are generating code or docs that must match production today;
- you are not using MCP at all — \`/v1/utility/*\` is the same information over plain HTTP.

## 6. Use it well

**Discover before you spend.** \`list_endpoints\` and \`pricing\` cost nothing. A call that fails validation costs nothing either — this server checks required params, \`oneOf\` groups, enum values, integer ranges, parameter couplings, and CSV limits locally first.

**Read \`credits_used\`, not the sticker price.** 26 endpoints are metered: an upfront ceiling is deducted and refunded down to the work actually done. \`/v1/search/news\` advertises a 1-credit base and really charges 2–14. The envelope's \`credits_used\` is the settled number.

**Let the cache work.** Identical calls inside the TTL are free (2 minutes for search, up to 30 days for transcripts). Do not add junk query params to force freshness — unknown params are stripped from the cache key and never reach upstream. Send \`Cache-Control: no-cache\` if you genuinely need a live fetch.

**Page correctly.** Pass \`cursor\` back verbatim and stop on \`pagination.has_more === false\`. Never build or decode a cursor. Sending a *different* endpoint's native cursor name is a free 400 with a \`did_you_mean\` hint rather than a silently re-billed page 1.

**Make retries safe.** Pass an \`idempotencyKey\` (UUIDv4) on anything you might resend. Replays within 24h return the original response for 0 credits. Retry only 429/500/502/503; everything else is a client-side fix that will fail again.

**Prefer one call to many.** \`search/everywhere\` fans out across 14 sources for a flat 20 credits. A Prism composite fans out across several detail endpoints and folds the legs into one report. Both beat orchestrating the fan-out yourself, in latency and usually in credits.

**Respect the limits.** 600 requests/minute and 50 concurrent per key, both unbilled when exceeded. Every response carries \`X-RateLimit-Remaining\` and \`X-Concurrency-Remaining\` — pace off those rather than discovering the wall.

**Keep the request id.** Every response has \`request_id\`. It is the key into the credit ledger (\`socialcrawl_check_balance\` with \`view: "transactions"\`) and the fastest way to get a charge or a bug looked at.

## 7. Staying up to date

- \`socialcrawl_discover\` \`action: "freshness"\` — is this server's catalogue current?
- \`npx -y socialcrawl-mcp@latest\` — upgrade the local server.
- \`GET /v1/utility/llms\` (or \`socialcrawl_discover\` \`action: "llms"\`) — refresh an agent's context corpus in one call instead of scraping docs pages.
- https://www.socialcrawl.dev/llms.txt · \`llms-full.txt\` · \`llms-{platform}.txt\` — the same corpus as static files.
- https://www.socialcrawl.dev/v1/openapi.json — the OpenAPI spec.
`,

  discovery: `# SocialCrawl API — Self-Describing Discovery (\`/v1/utility/*\`)

Four endpoints let any client — an AI agent, a script, a third-party integration — learn the entire API from inside the API. All four are **free (0 credits)**, api-key-authed, and served **in-process from the endpoint registry**: no upstream call, no network hop, no retries, and therefore no drift. Whatever they say is exactly what is callable right now.

Because \`cost: 0\` takes a read-only billing path, they succeed even at a zero balance and write no ledger rows. They are safe to call in a loop, on startup, or before every request.

In this MCP server they are driven by the **\`socialcrawl_discover\`** tool, which renders each payload as readable markdown instead of raw JSON.

---

## \`GET /v1/utility/quickstart\` — get started in one call

Everything needed for a first successful request, in one response: authentication (header name and where to get a key), the base URL, a ready-to-run first call with curl, the success and error envelope shapes, the credit model with tier rates and billing rules, the **full error taxonomy** (every code with its HTTP status and what it means), the pagination contract, rate limits, live platform/endpoint counts, and a \`next_steps\` block linking onward.

| Param | Type | Notes |
|-------|------|-------|
| \`platform\` | string | Optional. Tailors the first-call example and links to one platform slug. |

MCP: \`socialcrawl_discover\` with \`action: "quickstart"\`.

Reach for it when bootstrapping a new integration, or when an agent needs the error taxonomy in one payload rather than a docs crawl.

---

## \`GET /v1/utility/endpoints\` — the endpoint catalogue

A machine-readable row for every active endpoint: \`id\` (\`platform/resource\`), \`path\`, \`method\`, \`platform\`, \`summary\`, \`credits\` **and \`credits_label\`**, \`archetype\`, \`required_params\`, \`one_of\` groups, \`optional_params\`, a \`paginated\` flag, a \`how_to_use\` link to its guide, and a \`docs_url\`.

Read **\`credits_label\`**, not \`credits\`. \`credits\` is the static base; the label carries the real shape — \`"1 (standard)"\`, \`"20 (override; tier standard)"\`, \`"2-120 (metered)"\`. For a metered endpoint the base number understates every call.

The response also carries a \`stats\` block with the **live** registry totals. Those totals are whole-API regardless of any filter, which makes a deliberately non-matching filter the cheapest possible freshness probe.

| Param | Type | Notes |
|-------|------|-------|
| \`platform\` | string | Exact slug. An unknown slug, or a platform whose endpoints are all withdrawn, returns 404 rather than an empty list that would read as "this platform has nothing". |
| \`search\` | string | Case-insensitive substring over \`platform/resource\` and the summary. |
| \`method\` | enum | \`GET\` or \`POST\`. |

The array key is \`endpoints\`, deliberately not \`items\`, so the response envelope never stamps a pagination block onto a fixed list.

MCP: \`socialcrawl_discover\` with \`action: "catalog"\` (plus \`platform\` / \`search\` / \`method\`).

---

## \`GET /v1/utility/endpoint\` — how to use one endpoint

The deepest per-endpoint object the API exposes, and the one to reach for before calling something unfamiliar:

- **\`credits\`** — cost, label, tier, \`pricing_notes\` (the exact metered rule), and the standing billing rules.
- **\`params\`** — \`required\`, \`one_of\` groups with their rule, and \`optional\`, each with type, description, example, and any \`requires\` coupling.
- **\`pagination\`** — the paging style and the universal param names, or \`null\`.
- **\`cache\`** — TTL in seconds plus the note that identical calls inside it are free.
- **\`response\`** — archetype, schema URL, and a real example response.
- **\`request\`** — a ready-to-run URL and curl.
- **\`links\`** — endpoint docs, platform docs, the platform's \`llms-*.txt\`, and the filtered catalogue.
- **\`related\`** — sibling endpoints with their own guide links, so an agent can walk a platform.

| Param | Type | Notes |
|-------|------|-------|
| \`id\` | string | \`platform/resource\`, e.g. \`tiktok/profile\`. |
| \`url\` | string | Path form (\`/v1/tiktok/profile\`) or a full URL. |
| \`method\` | enum | Disambiguates a resource registered under more than one method (the stateful \`web\` family). |

\`id\` or \`url\` is required — one of the two, not both. Omitting both is a 400; an unknown endpoint is a 404 pointing back at the catalogue. Disabled endpoints resolve like unknowns, matching the catalogue.

MCP: \`socialcrawl_discover\` with \`action: "endpoint"\` and \`id\`. The tool accepts an id, a path, or a full URL and normalises it for you.

---

## \`GET /v1/utility/llms\` — agent context payload

The SocialCrawl context corpus, served through the API: the same content as \`llms.txt\` for the whole API or one platform. An agent with a key can bootstrap itself in one call instead of scraping documentation pages.

| Param | Type | Notes |
|-------|------|-------|
| \`platform\` | string | Scope the corpus to one platform slug. |
| \`format\` | enum | \`markdown\` (default) returns the corpus text; \`json\` returns a structured context object. |

The markdown is produced by the *same* builders that write the static \`llms.txt\` files, never a parallel formatter, so the API-served context and the static files cannot disagree.

MCP: \`socialcrawl_discover\` with \`action: "llms"\`.

---

## When to use these instead of the MCP's own tools

\`socialcrawl_list_platforms\`, \`socialcrawl_list_endpoints\`, \`socialcrawl_pricing\`, and \`socialcrawl_get_docs\` answer the same questions **without an API key and without a network round trip**, from a catalogue generated from the same registry. Prefer them for browsing and planning — they are faster and always available.

Use \`/v1/utility/*\` when you need the **live** answer:

- An endpoint you expect is missing, or a parameter is rejected that the bundled docs say exists — the bundled catalogue is a build-time snapshot and this server may simply be behind.
- You need the exact live price of a metered endpoint.
- You are generating code, docs, or a client that must match production today.
- You are not going through MCP at all — this is the same information over plain HTTP, for any language or agent framework.

**Check which situation you are in:** \`socialcrawl_discover\` with \`action: "freshness"\` compares the live registry totals against this server's bundled catalogue and tells you whether to upgrade (\`npx -y socialcrawl-mcp@latest\`). Data calls always hit the live API and keep working regardless — it is discovery, pricing, and local validation that age.

## Other machine-readable surfaces

- \`https://www.socialcrawl.dev/v1/openapi.json\` (and \`.yaml\`) — the full OpenAPI spec.
- \`https://www.socialcrawl.dev/llms.txt\`, \`llms-full.txt\`, \`llms-{platform}.txt\` — the same corpus as static files.
- \`GET /v1/credits/balance\` and \`GET /v1/credits/transactions\` — account metadata, also 0 credits.
`,

  monitors: `# SocialCrawl API — Monitors

Monitors are the **stateful, scheduled wrapper** around any SocialCrawl recipe. A monitor re-runs a registered endpoint or a Prism composite on a cadence, delivers each result to a signed webhook, evaluates alert rules, and accumulates a per-run time-series you can read back. *"Prism answers once; monitors watch it for you."*

Monitors are **not** registry endpoints — they live at \`/v1/monitors/*\` and are managed through the \`socialcrawl_monitors\` tool, not \`socialcrawl_request\`. Auth is the same \`x-api-key\`.

(Not to be confused with **web monitors**, \`/v1/web/monitors/*\` — those watch a single URL for content changes and are driven by \`socialcrawl_web\` with the \`monitor_*\` actions.)

## Operations (\`socialcrawl_monitors\` actions)

| Action | HTTP | What it does |
|--------|------|--------------|
| \`create\` | \`POST /v1/monitors\` | Create a monitor. Validates the recipe, enforces a plan slot cap, backfills one run, returns the monitor + \`estimated_cost_per_run\`/\`estimated_monthly_cost\` and (once) the webhook signing secret. |
| \`list\` | \`GET /v1/monitors\` | Owner-scoped, cursor-paginated list. Filter with \`status\` = active \| paused \| all. |
| \`get\` | \`GET /v1/monitors/:id\` | A single monitor (404 if not owned — never leaks existence or the secret). |
| \`runs\` | \`GET /v1/monitors/:id/runs\` | Reverse-chron run history, each with its \`legs[]\` envelope + \`alerts_fired\`. \`include=result\` adds the full stored result. |
| \`timeseries\` | \`GET /v1/monitors/:id/timeseries\` | The headline read — each stored run's stable computed keys projected into a \`{ t, metrics }\` series (reads snapshots, no live API calls). |
| \`pause\` / \`resume\` | \`PATCH /v1/monitors/:id\` | Pause or resume scheduling. |
| \`delete\` | \`DELETE /v1/monitors/:id\` | Unschedule + cascade-delete runs and the webhook. |

## Create parameters

- \`recipe\` (required) — any registered endpoint or Prism composite as \`platform/resource\` (e.g. \`prism/brand-mentions\`, \`tiktok/profile\`).
- \`cadence\` (required) — \`hourly\` \| \`daily\` \| \`weekly\`, or a cron expression.
- \`webhook_url\` (required) — HTTPS endpoint that receives each run, signed with \`x-socialcrawl-signature\` (HMAC-SHA256, timestamped).
- \`params\` — parameters passed to the recipe every run.
- \`alert_rules\` — \`[{ metric, op, value, window? }]\`. Ops: \`gt\`, \`lt\`, \`gte\`, \`lte\`, \`abs_change_gt\`, \`pct_change_gt\`, \`pct_change_lt\` (the change ops compare a run to the previous comparable run; \`window\` is \`1d\` \| \`1w\`).
- \`suppress_webhook_unless_alert\` — only deliver the webhook when a rule trips.
- \`name\`, \`output_schema\`, \`webhook_secret\` — optional.

## Billing

Managing monitors (create/list/get/runs/timeseries/pause/delete) costs **0 credits**. Each *scheduled run* bills the underlying recipe's normal cost **plus a 1-credit scheduling premium** — so a daily \`prism/reputation\` monitor costs 30 + 1 = 31 credits per run. Runs skipped for insufficient balance are never charged, and a run whose recipe fails is fully refunded. Use \`estimated_cost_per_run\` / \`estimated_monthly_cost\` (returned by \`create\`) to budget, and \`socialcrawl_pricing\` with \`action: "endpoint"\` to price the recipe first. The webhook auto-pauses after 10 consecutive delivery failures.`,
};
