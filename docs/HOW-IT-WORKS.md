# How SocialCrawl MCP Works

A technical overview of the architecture, data flow, and design decisions behind the SocialCrawl MCP server.

---

## Overview

The SocialCrawl MCP server is a bridge between AI agents and the SocialCrawl API. It runs either locally over stdio (the AI client - Claude Desktop, Cursor, VS Code - spawns it) or as a hosted Streamable HTTP endpoint (`https://mcp.socialcrawl.dev/mcp`), and makes HTTP requests to the SocialCrawl API on behalf of the agent.

```
AI Agent (Claude, Cursor, etc.)
    |
    | MCP protocol (stdio, or Streamable HTTP)
    |
SocialCrawl MCP Server (local npx, or hosted)
    |
    | HTTPS (GET/POST/PATCH/DELETE)
    |
SocialCrawl API (www.socialcrawl.dev)
    |
    | (upstream)
    |
Data Platforms (67 platforms)
```

Since 2.0.0 the MCP server exposes 7 tools. Three of them (find, endpoint, estimate) answer from local bundled data without an API key or network connection; with a key they first ask the free `/v1/utility/*` routes (`find`, `resolve`, `plan`, `endpoint`, `estimate`) and fall back to the bundled answer when a route is not deployed (the router's ENDPOINT_NOT_FOUND for the route itself is remembered for 10 minutes; a 404 for an unknown id is not; each call times out after 5 s). Four (request, collect, account, manage) make API calls and need a key, except account's `status` view, which reads the public `/v1/status` route. `SOCIALCRAWL_LEGACY_TOOLS=1` also registers the nine retired 1.x names (`src/tools/legacy.ts`).

---

## Architecture

### Transport

The same `createServer(ctx)` (`src/server.ts`) serves two transports:

- **stdio** (`src/index.ts`, `socialcrawl-mcp`) — the AI client spawns the server as a subprocess and talks MCP JSON-RPC over stdin/stdout. No port, no firewall, no separate service; `npx -y socialcrawl-mcp` runs it on demand. One process serves one user, so the key comes from `SOCIALCRAWL_API_KEY`.
- **Streamable HTTP** (`src/app.ts` / `src/http.ts`, `socialcrawl-mcp-http`) — a hosted, stateless endpoint (`POST /mcp`): a fresh server and transport per request, with the caller's key taken from `Authorization: Bearer` or `x-api-key`. It never falls back to the operator's environment key. An optional OAuth 2.1 resource-server mode (preview, off unless `SOCIALCRAWL_OAUTH=1`) gates `tools/call` by scope (`src/oauth/scopes.ts`); see `docs/REMOTE-STREAMABLE-HTTP.md`.

### ApiContext

Every API-calling tool takes an `ApiContext` (`src/context.ts`): `{ apiKey, baseUrl, confirm? }`. The transport builds it (stdio from env via `contextFromEnv()`, HTTP from request headers) and `createServer` adds `confirm`, which asks the user to approve a spend through MCP elicitation when the client supports it. Tools never read `process.env` for the key themselves, which is what lets one HTTP process serve many callers safely. Results are built in one place (`src/result.ts` `toResult`): text for older clients, `structuredContent` for tools with an `outputSchema`, `isError` on failures, and `resource_link` blocks for stored bodies (`socialcrawl://results/<request_id>`, kept 30 minutes per key).

### Runtime

- **Language:** TypeScript, compiled to JavaScript
- **Target:** ES2022 with Node16 module resolution
- **Dependencies:** `@modelcontextprotocol/sdk` (MCP framework) + `zod` (input validation)
- **HTTP client:** Node.js built-in `fetch` — no axios or other HTTP libraries

### Project Structure

```
src/
├── index.ts              # stdio entrypoint
├── server.ts             # Server creation + tool registration
├── app.ts / http.ts      # Streamable HTTP transport (stateless, per-request context)
├── client.ts             # HTTP client for SocialCrawl API calls (per-endpoint timeouts, SSE via sse.ts)
├── context.ts            # ApiContext: key, base URL, spend-approval hook
├── result.ts             # toResult: text + structuredContent + isError + resource links
├── freshness.ts          # Once-per-process check that the bundled catalogue is not behind the API
├── cost-guard.ts         # max_credits / confirm quoting before a spend
├── oauth/                # Optional OAuth 2.1 resource-server mode (scopes, JWT verification)
├── pricing.ts            # Single source of price formatting — every surface routes through it
├── types.ts              # TypeScript interfaces
├── constants.ts          # Timeouts, character limits, server metadata
├── tools/
│   ├── list-platforms.ts # Platform catalogue, grouped by category, with credit ranges
│   ├── list-endpoints.ts # Endpoint catalogue + cross-platform search + full param contract
│   ├── pricing.ts        # Credit pricing: overview / endpoint / platform / ranked list
│   ├── discover.ts       # The free /v1/utility/* self-description family + freshness check
│   ├── get-docs.ts       # Bundled documentation, paged rather than truncated
│   ├── check-balance.ts  # /v1/credits/balance and /v1/credits/transactions
│   ├── monitors.ts       # Stateful /v1/monitors/* CRUD (POST/GET/PATCH/DELETE)
│   ├── web.ts            # Stateful /v1/web/* surface — scrape/crawl/agent/jobs/monitors/sessions
│   ├── cohorts.ts        # Stateful /v1/cohorts/* + /v1/cohort-queries/* audience-filtered search
│   ├── collect.ts        # Walks a paged endpoint to N rows / a credit budget; stores rows as a result resource
│   └── request.ts        # Pre-flight validation + API call execution (GET + POST batch), shaping, cost guard
├── data/                 # ALL GENERATED — see scripts/generate-data.ts
│   ├── platforms.ts      # 67 platforms with metadata, social flag, and category
│   ├── endpoints.ts      # 631 endpoints — params with bounds/couplings/CSV limits, the full
│   │                     #   pricing model, pagination, cache, delivery mode, upstream sources
│   ├── registry-meta.ts  # REGISTRY_FINGERPRINT, REGISTRY_STATS, CREDIT_LADDER, CACHE_TTLS
│   ├── docs-handwritten.ts # Cross-cutting contract topics (auth, credits, errors, paging, …)
│   └── docs.ts           # Generated per-platform, pricing, and full references
└── schemas/
    ├── tools.ts          # Zod input schemas: the 7 tools and the 1.x legacy names
    └── outputs.ts        # outputSchema shapes (request, collect, check_balance, pricing)
```

---

## The 7 Tools

### Tool Registration

Each tool is registered using the MCP SDK's `server.registerTool()` API with:

- **Name** — snake_case, prefixed with `socialcrawl_` (e.g., `socialcrawl_request`)
- **Input schema** — Zod schema for runtime validation. The MCP SDK converts Zod schemas to JSON Schema for the AI client.
- **Annotations** — MCP tool annotations that help the AI client understand the tool's behavior:
  - `readOnlyHint` — `true` for `socialcrawl_find`, `socialcrawl_endpoint`, `socialcrawl_estimate` and `socialcrawl_account`; `false` for `socialcrawl_request` and `socialcrawl_collect` (billable) and for `socialcrawl_manage`, which creates and deletes stateful resources
  - `destructiveHint` — `true` for `socialcrawl_manage` (it can delete monitors, cancel jobs, close sessions, drop a cohort and everything under it); `false` elsewhere
  - `idempotentHint` — `true` for the read tools; `false` for request, collect and manage
  - `openWorldHint` — `true` for every tool (each may call the API; the discovery tools fall back to bundled data)

### Tool Design Philosophy

The MCP exposes 7 workflow-oriented tools rather than 633 endpoint-specific tools. This mirrors SocialCrawl's core value proposition: **one API, every platform.** The agent doesn't need to know hundreds of tool names — it discovers what's available and makes calls through a single, unified interface. (The surfaces that don't fit a stateless GET — the scheduled `monitors` wrapper, the stateful `web` platform, the `cohorts` audience-filtered search and Prism background jobs — share one action-based tool, `socialcrawl_manage`.)

The typical agent workflow is:

1. `socialcrawl_find` — "Which endpoint does this job?" (a task in plain words; ranked by `src/search/rank.ts`, with params filled from URLs and handles)
2. `socialcrawl_endpoint` — "What do I send and what comes back?" (params, response fields, paging, latency, next steps; also guide topics)
3. `socialcrawl_estimate` — "What will that cost me?"
4. `socialcrawl_request` — "Get me this specific data" (or `socialcrawl_collect` for many pages in one call)
5. `socialcrawl_account` / `socialcrawl_manage` — balance and status / monitors, cohorts, web, jobs

Smart agents learn the API structure after 1-2 discovery calls and skip straight to `socialcrawl_request` for subsequent queries.

---

## Data Layer

The MCP bundles all SocialCrawl knowledge as static TypeScript data. This means the discovery and documentation tools work without any network calls.

### `data/platforms.ts` — 67 Platforms

A static array of platform metadata:

```typescript
interface Platform {
  slug: string;           // "tiktok"
  name: string;           // "TikTok"
  endpointCount: number;  // 33
  description: string;    // "Profiles, videos, comments, ..."
  social: boolean;        // false for research / commerce / dev-ecosystem sources
  category?: string;      // "major" | "additional" | "commerce" | "adLibraries" | "linkPages" | "utility"
}
```

Listed by `socialcrawl_find` and used for pre-flight validation in `socialcrawl_request`.

### `data/endpoints.ts` — 631 Endpoints

A static array of every endpoint definition:

```typescript
interface Endpoint {
  platform: string;                // "tiktok"
  resource: string;                // "profile" (embeds {path} params, e.g. "jobs/{job_id}")
  method: HttpMethod;              // "GET" | "POST" | "PATCH" | "DELETE"
  params: ParamDef[];              // required params, each with a description and example
  optionalParams: OptionalParam[]; // type, enumValues, minimum/maximum, requires, couplesWith, in
  oneOfGroups: string[][];         // e.g. [["url", "id"]] — at least one member required
  csvConstraints?: Record<string, CsvConstraint>; // per-entry enum + max entry count
  creditTier: CreditTier;          // "standard" | "advanced" | "premium"
  creditCost: number;              // static cost — only the BASE for a metered endpoint
  pricing: Pricing;                // model (ladder|flat|metered), minCost/maxCost band, rule text
  hydration?: HydrationLane[];     // opt-in include= row joins: sibling, fills, per-row rate, row cap
  archetype: string;               // "Author", "Post", "PostList", etc.
  summary: string;
  description: string;
  execution?: "sync" | "sse" | "async";
  streaming?: string;              // "accept-header" | "always" | "<param>=<value>"
  pagination?: PaginationInfo;     // style, native cursor param, limit param + max
  paginatable?: boolean;           // walks every page server-side in one call
  singlePage?: string;             // a list endpoint that genuinely does not paginate — why
  collectUntilN?: string;          // `limit` is collect-until-N, not a page size — why
  emptyOn404?: boolean;            // upstream 404 means zero items → 200 {items:[]} + refund
  cache: CacheInfo;                // category + resolved TTL seconds
  upstream: UpstreamInfo;          // dispatch kind + ordered fallback kinds
  family?: string;                 // "prism" for server-side composites
  contractDetails?: string[];      // extra contract facts a caller must know
}
```

**Why so much metadata.** Everything here exists so the server can answer a question locally that would otherwise cost a round trip or a credit: what a call really charges (`pricing`), whether it will 400 before billing (`optionalParams` bounds and couplings, `csvConstraints`), how to get page two (`pagination`), whether a repeat is free (`cache`), and whether an empty answer is a failure or a legitimate zero (`emptyOn404`).

`oneOfGroups` express "at least one of these mutually-substitutable identifiers" (e.g. a post endpoint that accepts either `url` or `id`). Optional parameters are forwarded whenever the agent supplies them and never block a call for being absent — but their *values* are checked against the same rules the API enforces.

**None of this is hand-written.** It is generated from the main SocialCrawl codebase's endpoint registry (`packages/social-api/src/registry/config/`), the single source of truth, via a two-step pipeline:

```bash
# 1. In the backend repo — writes registry-dump.json (schema v3) here
cd codebase/packages/social-api && pnpm dlx tsx scripts/extract-mcp-data.ts

# 2. Here — regenerates platforms.ts, endpoints.ts, registry-meta.ts, docs.ts
npm run generate:data   # tsx scripts/generate-data.ts
```

In CI this runs without a human: the backend's `sync-downstream.yml` regenerates the dump on a registry change, runs this repo's tests against the new data, bumps the patch version and pushes; `publish.yml` then publishes to npm and the MCP Registry.

The generator refuses a dump older than schema v3 (judgments, featured params, related endpoints) or one without a `registryFingerprint`, rather than silently producing a thinner data layer, and fails loudly on a new platform that has no description. Platform descriptions are maintained in `scripts/generate-data.ts`, and everything an agent reads is vendor-neutral: upstream supplier names never appear in tool descriptions, docs or results (`opacity.test.ts`). The hardcoded platform/endpoint totals in `data-integrity.test.ts` are deliberate drift guards: when the backend moves they go red, and that is the signal to re-run the pipeline.

### `data/docs.ts` — 61 Documentation Topics

Bundled llms.txt content from the SocialCrawl website, keyed by topic:

| Key | Source | Content |
|-----|--------|---------|
| `overview` | Hand-written | Compact API introduction |
| `full` | Generated | Comprehensive reference, every endpoint (~300K chars, paged) |
| `authentication` | Hand-written | How API keys work, local vs remote transport |
| `credits` | Hand-written | The three billing models, tiers, and what is never charged |
| `pricing` | Generated | Exact per-endpoint cost, flat overrides, metered bands + rules, the row-join summary |
| `hydration` | Generated | Every opt-in `include=` row join: sibling, fields filled, per-row rate, row cap, `data.hydration` contract |
| `errors` | Hand-written | Error codes, statuses, retryable verdicts, refund matrix |
| `idempotency` | Hand-written | Retry-safe requests via `Idempotency-Key` |
| `pagination` | Hand-written | Universal `cursor`, `has_more`, `sc.` tokens, collect-until-N |
| `caching` | Hand-written | TTLs, free hits, cache-key rules, force-refresh |
| `response-schema` | Hand-written | Envelope, archetypes, `ext`, computed fields, headers |
| `limits` | Hand-written | Rate, concurrency, timeouts, circuit breaker, retry guidance |
| `monitors` | Hand-written | The scheduled-recipe wrapper (`/v1/monitors/*`) |
| `discovery` | Hand-written | The free self-describing `utility/*` endpoints |
| `tiktok`, `instagram`, … | Generated | One per platform, built from ENDPOINTS at module load |

The split matters: the hand-written topics cover cross-cutting contracts that are *not* derivable from per-endpoint registry data, and live in `data/docs-handwritten.ts`. Everything endpoint-specific is generated at module load from ENDPOINTS, so a platform doc can never drift from the registry.

Topics longer than one response are **paged**, not truncated — `getDocs(topic, page)` splits at line boundaries and appends a "page N of M" footer, so every endpoint in the `full` reference stays reachable.

---

## Request Flow

When the agent calls `socialcrawl_request`, here's what happens:

```
Agent calls socialcrawl_request({
  platform: "tiktok",
  resource: "profile",
  params: { handle: "charlidamelio" }
})
  |
  |  1. Zod validates input schema
  |
  |  2. Pre-flight validation (local, no network)
  |     a. Platform "tiktok" exists? → Yes (found in platforms.ts)
  |     b. Resource "profile" exists for tiktok? → Yes (found in endpoints.ts)
  |     c. Required params present? → Yes
  |     d. Each oneOf group satisfied by at least one provided param? → Yes
  |     e. Optional params (if any) forwarded through as-is
  |
  |  3. Build URL: https://www.socialcrawl.dev/v1/tiktok/profile?handle=charlidamelio
  |
  |  4. HTTP GET with x-api-key header (30s timeout)
  |
  |  5. Response handling:
  |     - Success (200): unified envelope with data + metadata, truncate if >25K chars
  |     - Error (4xx/5xx): map to actionable error message
  |     - Network failure: return descriptive error
  |
  |  6. Format response with endpoint context header
  |
  ← Returns formatted markdown with JSON data
```

### Pre-Flight Validation

The most important design decision: **validate locally before making the API call.** This prevents:

- Wasted credits on typos (e.g., `platfrom: "tikktok"`)
- Unnecessary network calls for invalid parameters
- Confusing upstream error messages

Pre-flight runs four checks against the bundled endpoint registry:

1. **Platform exists** — slug is a known platform
2. **Resource exists** — resource is defined on that platform
3. **Required params present** — every `required: true` param is provided
4. **`oneOf` groups satisfied** — for each declared group of mutually-substitutable identifiers (e.g. `["url", "id"]`), at least one member is present in `params`

Optional params (`optional: true`, neither required nor part of a `oneOf` group) are forwarded through to the API whenever supplied — pre-flight never blocks a call for missing them.

If pre-flight validation fails, the error message directs the agent to the right discovery tool:

- Bad platform → "Use `socialcrawl_find` to see the platforms" plus a did-you-mean
- Bad resource → closest matches (ranked) and "Use `socialcrawl_find` with platform {platform}"
- Missing required params → Lists what's missing with examples
- Unsatisfied `oneOf` group → Lists the acceptable alternatives (e.g. "Provide one of: url, id")

### Error Mapping

The API client (`formatHttpError` in `src/client.ts`) maps every HTTP error to an actionable message that tells the agent **what to do next**, not just what went wrong. A short fixed lead-in names the category where it helps, and the server's `error.message` follows it; the server's message is never replaced. Two lines follow: `reason: …` from `error.details.reason` when present, and `request_id: req-…` from the body's top-level `request_id`, or from the `X-Request-Id` header when the body is missing or not JSON. The fixed wording below is used only when the server sent no message.

| Status | Response to Agent |
|--------|-------------------|
| 400 | The server's validation message |
| 401 | "Invalid API key. {server message} Check your SOCIALCRAWL_API_KEY configuration." |
| 402 | "Insufficient credits (X remaining). {server message} Top up at socialcrawl.dev/dashboard/billing." (`KEY_BUDGET_EXCEEDED`: the server message only, since topping up does not clear a per-key cap) |
| 404 `RESOURCE_NOT_FOUND` | "Resource not found ({platform}). {server message}" |
| 404 other | "Endpoint /v1/... not found. {server message} Use socialcrawl_find..." |
| 405 | "Method not allowed. {server message}" |
| 429 | The server message, which names the limit hit (600/minute or 50 in flight) |
| 502 | "Upstream error. {server message}" (fallback: "Upstream error fetching data. Credits have been auto-refunded.") |
| 503 | "Service unavailable. {server message}" |
| other | "Error ({status}): {type} {message}", plus the `doc_url` when present |

### Unified Response Envelope

Every successful `socialcrawl_request` call returns the same top-level shape, regardless of platform or endpoint:

```json
{
  "success": true,
  "platform": "tiktok",
  "endpoint": "profile",
  "data": { ... },
  "credits_used": 1,
  "credits_remaining": 9847,
  "request_id": "req_...",
  "cached": false
}
```

The envelope is stable across all 631 endpoints — only the shape of `data` varies. The inner `data` payload is typed per **archetype** (`Author`, `Post`, `PostList`, `CommentList`, `SearchResults`, etc.), so an agent that has learned what a `Post` looks like for TikTok can read an Instagram `Post` with the same mental model. The `cached` flag indicates whether the response came from SocialCrawl's upstream cache, and `credits_used` / `credits_remaining` let the agent track the balance after every call without a separate billing lookup.

### Response Truncation

Responses exceeding 25,000 characters are truncated with a note indicating the full size. This prevents overwhelming the AI client's context window while still delivering useful data.

---

## Configuration

The server reads two environment variables at runtime (not at module load time, for testability):

| Variable | Required | Default |
|----------|----------|---------|
| `SOCIALCRAWL_API_KEY` | Yes (for `request` tool) | Empty string |
| `SOCIALCRAWL_BASE_URL` | No | `https://www.socialcrawl.dev` |

If no API key is set, the server still starts and the discovery/docs tools work normally. Only `socialcrawl_request` requires the key — it returns a clear error message with instructions when the key is missing.

---

## Data Sync Strategy

The bundled data in `data/` is a snapshot of the SocialCrawl API at the time the MCP package version was published. When the registry in the main codebase changes:

1. `scripts/extract-mcp-data.ts` (backend) writes `registry-dump.json` (schema v3, with a `registryFingerprint`).
2. `npm run generate:data` regenerates `data/` from it.
3. The backend's `sync-downstream.yml` does both steps on every registry change on `main`, runs this repo's tests, bumps the patch version and pushes; `publish.yml` publishes.

Users on `npx -y socialcrawl-mcp` pick it up on the next launch. A long-running or pinned install can fall behind, which is what the freshness check is for.

### Freshness check

`src/freshness.ts` compares the bundled `REGISTRY_FINGERPRINT` with the live registry once per process (stdio: at startup; HTTP: on the first request, shared by every later request to the same base URL). It calls `GET /v1/utility/endpoints?fingerprint=1` and, because that route is not deployed everywhere, falls back on a 404 or any error to the endpoint/platform count comparison that `socialcrawl_discover` `action: "freshness"` uses. The probe has a 2.5 s timeout and never delays a tool call (a result that is ready within 250 ms is used, otherwise the next call picks it up). When the catalogue is behind, one line is appended to the next tool result and added to the structured `warnings`; offline, keyless or any failure is silent. Set `SOCIALCRAWL_FRESHNESS_CHECK=off` to disable it.

---

## Distribution

### npm

Published as `socialcrawl-mcp`. The npm package contains only the compiled `dist/` directory, README, and LICENSE. Source code, tests, and docs are excluded to keep the package small (~36 KB packed).

The `bin` entry in package.json enables `npx socialcrawl-mcp` execution:

```json
{
  "bin": {
    "socialcrawl-mcp": "dist/index.js"
  }
}
```

The entry point includes a `#!/usr/bin/env node` shebang for direct execution.

### MCP Registry

The `server.json` file in the repo root contains metadata for the MCP registry (modelcontextprotocol.io) and other directories (Glama):

```json
{
  "name": "io.github.ridiocompany/socialcrawl",
  "packages": [{
    "registryType": "npm",
    "identifier": "socialcrawl-mcp",
    "transport": "stdio"
  }],
  "environmentVariables": [{
    "name": "SOCIALCRAWL_API_KEY",
    "required": true
  }]
}
```

The registry doesn't host code — it hosts metadata that points to the npm package. Namespace verification is tied to the GitHub repository owner.

---

## Testing

Around 690 tests across 31 suites (`npm test`). The main ones:

| Suite | Tests | What it verifies |
|-------|-------|------------------|
| Data integrity | 63 | All 67 platforms present, 631 endpoints valid, totals match `REGISTRY_STATS`, pricing models coherent (ladder endpoints charge their tier rate; every metered endpoint quotes a band or a rule), integer bounds sane, param couplings and CSV constraints only name declared params, every doc topic exists, no duplicates, counts match |
| Pricing | 24 | Band-not-base quoting, authored rule vs band fallback, price-driving params, the five `socialcrawl_pricing` actions, budget filters judged by the metered ceiling |
| Local validation + search | 23 | Enum, range, coupling, and CSV rejections without touching the network; cross-platform endpoint search; method/budget filters; full parameter-contract output |
| Web + method-aware request | 21 | `socialcrawl_web` action routing, path-id validation, GET-query vs POST-body split, `in:query` routing, JSON-array coercion, web→tool redirect, the free `job_errors` / `crawl_preview` actions, metered rule in the header |
| API client | 17 | URL building, API key handling, HTTP error mapping for all status codes |
| HTTP transport | 14 | Stateless per-request context, header auth, rate limiting, tool listing |
| Monitors | 13 | Action routing, create-body assembly, cadence mapping, id/required-field validation, 204 handling |
| Auth | 9 | Header extraction precedence, no env fallback on the HTTP transport |
| Check balance | 8 | Meta-endpoint call shape for both balance and the transactions ledger, query forwarding, 0-credit header, missing-key + error handling |
| Pre-flight validation | 8 | Bad platform/resource/params caught locally, no-param endpoints pass through |
| Discovery (`/v1/utility/*` + `/v1/status`) | 27 | Anonymous bundled fallback, live call shapes and id normalisation, metered-label preference, the freshness drift check, the keyless platform-status read, and the `setup` topic |
| Cohorts | 26 | The full lifecycle across all eight routes, generated-vs-supplied `Idempotency-Key` (echoed so a retry replays), the local credit-ceiling calculation, every contract bound rejected without a network call, path-traversal id rejection, and cohort 409s not mislabelled as idempotency errors |
| Server | 4 | The 7 tools registered, anonymous discovery, per-context key |
| Freshness | 16 | Fingerprint match/mismatch, count fallback on 404, silent when offline or keyless, timeout, once-per-process, stale line in the next result and `warnings` |
| Vendor neutrality | 90 | `tools/list`, instructions, every `get_docs` topic and `list_endpoints` detail output name no upstream supplier |
| Surface coverage | 9 | Every endpoint callable through a tool, priced, documented, and listed with every one of its params and enum values — across pages |
| Pagination | 11 | Line-boundary splitting, nothing lost across pages, clamped page numbers, short output left unpaged |
| Response truncation | 3 | Under-limit untouched, over-limit truncated, full length reported |
| Context | 2 | Env parsing, base-URL normalisation |

Tests use vitest with `vi.stubGlobal("fetch", ...)` for HTTP mocking and `process.env` manipulation for API key testing.

---

## Design Decisions

### Why 7 tools instead of 633?

633 tools would flood the AI client's tool list and consume context window space. The agent would need to somehow know that `socialcrawl_get_tiktok_profile` exists. With a handful of workflow tools, the agent discovers capabilities dynamically — by a task in plain words, by platform, or by budget. Version 2.0.0 cut the surface from 11 tools to 7 so `tools/list` costs about 4.7k tokens instead of 12.8k — matching SocialCrawl's "one API, every platform" philosophy.

### Why bundle data instead of fetching it?

Bundled data means:
- Discovery tools work offline (no network dependency)
- Zero additional latency for platform/endpoint lookups
- No extra API calls consuming credits
- Package version maps to API version (predictable behavior)

The trade-off is that data can become stale if the MCP package isn't updated. But since updates are a simple `npm publish`, this is manageable.

### Why pre-flight validation?

Making API calls costs credits. A typo like `platfrom: "tikktok"` would consume 1 credit just to get a 404. Pre-flight validation catches these errors locally — saving credits and providing better error messages than the API would.

### Why both stdio and Streamable HTTP?

stdio is the standard for local MCP servers: the client spawns the server, so there is no port, no firewall and nothing to host, and the key stays on the user's machine. It cannot serve clients that only speak remote MCP (web chat apps), so the same server is also offered over stateless Streamable HTTP, with the key bound per request. Keeping the tools transport-agnostic behind `ApiContext` means neither transport has its own copy of the logic.

### Why read env vars at call time?

On stdio, `SOCIALCRAWL_API_KEY` and `SOCIALCRAWL_BASE_URL` are read by `contextFromEnv()` when the server is built rather than held in module-level constants. This enables:
- Tests to override env vars per-test without module caching issues
- Runtime configuration changes (if the env var is updated while the server runs)
