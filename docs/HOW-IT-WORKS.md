# How SocialCrawl MCP Works

A technical overview of the architecture, data flow, and design decisions behind the SocialCrawl MCP server.

---

## Overview

The SocialCrawl MCP server is a bridge between AI agents and the SocialCrawl API. It runs locally on the user's machine, communicates over stdio with the AI client (Claude Desktop, Cursor, VS Code), and makes HTTP requests to the SocialCrawl API on behalf of the agent.

```
AI Agent (Claude, Cursor, etc.)
    |
    | MCP protocol (stdio)
    |
SocialCrawl MCP Server (local, npx)
    |
    | HTTPS (GET/POST/PATCH/DELETE)
    |
SocialCrawl API (www.socialcrawl.dev)
    |
    | (upstream)
    |
Data Platforms (48 platforms)
```

The MCP server exposes 9 tools. Four of them (list_platforms, list_endpoints, pricing, get_docs) query local bundled data and work without an API key or network connection. Four (request, check_balance, monitors, web) make actual API calls and need a key. The ninth, discover, calls the free `/v1/utility/*` self-description endpoints when a key is present and falls back to bundled data when it is not.

---

## Architecture

### Transport

**stdio** — the standard transport for locally-running MCP servers. The AI client spawns the MCP server as a subprocess and communicates via stdin/stdout using the MCP JSON-RPC protocol.

Installation is zero-friction: `npx -y socialcrawl-mcp` downloads and runs the server on demand. No global install or manual setup required.

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
├── client.ts             # HTTP client for SocialCrawl API calls
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
│   └── request.ts        # Pre-flight validation + API call execution (GET + POST batch)
├── data/                 # ALL GENERATED — see scripts/generate-data.ts
│   ├── platforms.ts      # 48 platforms with metadata, social flag, and category
│   ├── endpoints.ts      # 381 endpoints — params with bounds/couplings/CSV limits, the full
│   │                     #   pricing model, pagination, cache, delivery mode, upstream sources
│   ├── registry-meta.ts  # REGISTRY_STATS, CREDIT_LADDER, CACHE_TTLS
│   ├── docs-handwritten.ts # Cross-cutting contract topics (auth, credits, errors, paging, …)
│   └── docs.ts           # Generated per-platform, pricing, and full references
└── schemas/
    └── tools.ts          # Zod input validation schemas for all 9 tools
```

---

## The 9 Tools

### Tool Registration

Each tool is registered using the MCP SDK's `server.registerTool()` API with:

- **Name** — snake_case, prefixed with `socialcrawl_` (e.g., `socialcrawl_request`)
- **Input schema** — Zod schema for runtime validation. The MCP SDK converts Zod schemas to JSON Schema for the AI client.
- **Annotations** — MCP tool annotations that help the AI client understand the tool's behavior:
  - `readOnlyHint` — `true` for the read/discovery tools; `false` for `socialcrawl_monitors` and `socialcrawl_web`, which create and delete stateful resources
  - `destructiveHint` — `true` for `socialcrawl_monitors`/`socialcrawl_web` (they can delete monitors, cancel jobs, close sessions); `false` elsewhere
  - `idempotentHint` — `true` for the GET/read tools; `false` for the stateful write tools
  - `openWorldHint` — `true` for the tools that make external API calls (`request`, `check_balance`, `monitors`, `web`), `false` for the local-data discovery tools

### Tool Design Philosophy

The MCP exposes 9 workflow-oriented tools rather than 381 endpoint-specific tools. This mirrors SocialCrawl's core value proposition: **one API, every platform.** The agent doesn't need to know hundreds of tool names — it discovers what's available and makes calls through a single, unified interface. (Two surfaces that don't fit a stateless GET — the scheduled `monitors` wrapper and the stateful `web` platform — get their own action-based tools.)

The typical agent workflow is:

1. `socialcrawl_list_platforms` — "What platforms exist?"
2. `socialcrawl_list_endpoints` — "What can I do on TikTok?" or "which endpoints return transcripts?"
3. `socialcrawl_pricing` — "What will that cost me?"
4. `socialcrawl_request` — "Get me this specific data"
5. `socialcrawl_get_docs` — "I need help understanding something"

Smart agents learn the API structure after 1-2 discovery calls and skip straight to `socialcrawl_request` for subsequent queries.

---

## Data Layer

The MCP bundles all SocialCrawl knowledge as static TypeScript data. This means the discovery and documentation tools work without any network calls.

### `data/platforms.ts` — 48 Platforms

A static array of platform metadata:

```typescript
interface Platform {
  slug: string;           // "tiktok"
  name: string;           // "TikTok"
  endpointCount: number;  // 21
  description: string;    // "Profiles, videos, comments, ..."
  social: boolean;        // false for research / commerce / dev-ecosystem sources
  category?: string;      // "major" | "additional" | "commerce" | "adLibraries" | "linkPages" | "utility"
}
```

Queried by `socialcrawl_list_platforms` and used for pre-flight validation in `socialcrawl_request`.

### `data/endpoints.ts` — 381 Endpoints

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
# 1. In the backend repo — writes registry-dump.json (schema v2) here
cd codebase/packages/social-api && pnpm dlx tsx scripts/extract-mcp-data.ts

# 2. Here — regenerates platforms.ts, endpoints.ts, registry-meta.ts
npm run generate:data
```

The generator refuses a v1 dump rather than silently producing a thinner data layer, and fails loudly on a new platform that has no description. The hardcoded platform/endpoint totals in `data-integrity.test.ts` are deliberate drift guards: when the backend moves they go red, and that is the signal to re-run the pipeline.

### `data/docs.ts` — 61 Documentation Topics

Bundled llms.txt content from the SocialCrawl website, keyed by topic:

| Key | Source | Content |
|-----|--------|---------|
| `overview` | Hand-written | Compact API introduction |
| `full` | Generated | Comprehensive reference, every endpoint (~300K chars, paged) |
| `authentication` | Hand-written | How API keys work, local vs remote transport |
| `credits` | Hand-written | The three billing models, tiers, and what is never charged |
| `pricing` | Generated | Exact per-endpoint cost, flat overrides, metered bands + rules |
| `errors` | Hand-written | Error codes, statuses, retryable verdicts, refund matrix |
| `idempotency` | Hand-written | Retry-safe requests via `Idempotency-Key` |
| `pagination` | Hand-written | Universal `cursor`, `has_more`, `sc.` tokens, collect-until-N |
| `caching` | Hand-written | TTLs, free hits, cache-key rules, force-refresh |
| `response-schema` | Hand-written | Envelope, archetypes, `ext`, computed fields, headers |
| `limits` | Hand-written | Rate, concurrency, timeouts, circuit breaker, retry guidance |
| `monitors` | Hand-written | The scheduled-recipe wrapper (`/v1/monitors/*`) |
| `discovery` | Hand-written | The free self-describing `utility/*` endpoints |
| `tiktok`, `instagram`, … | Generated | One per platform (48), built from ENDPOINTS at module load |

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

- Bad platform → "Use `socialcrawl_list_platforms` to see available platforms"
- Bad resource → "Use `socialcrawl_list_endpoints` to see available endpoints for {platform}"
- Missing required params → Lists what's missing with examples
- Unsatisfied `oneOf` group → Lists the acceptable alternatives (e.g. "Provide one of: url, id")

### Error Mapping

The API client maps every HTTP error to an actionable message that tells the agent **what to do next**, not just what went wrong:

| Status | Response to Agent |
|--------|-------------------|
| 401 | "Invalid API key. Check your SOCIALCRAWL_API_KEY configuration." |
| 402 | "Insufficient credits (X remaining). Top up at socialcrawl.dev/billing." |
| 404 | "Endpoint not found. Use socialcrawl_list_endpoints..." |
| 503 | "Platform temporarily unavailable. Try again shortly." |
| 502 | "Upstream error. Credits have been auto-refunded." |

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

The envelope is stable across all 381 endpoints — only the shape of `data` varies. The inner `data` payload is typed per **archetype** (`Author`, `Post`, `PostList`, `CommentList`, `SearchResults`, etc.), so an agent that has learned what a `Post` looks like for TikTok can read an Instagram `Post` with the same mental model. The `cached` flag indicates whether the response came from SocialCrawl's upstream cache, and `credits_used` / `credits_remaining` let the agent track the balance after every call without a separate billing lookup.

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

The bundled data in `data/` is a snapshot of the SocialCrawl API at the time the MCP package version was published. When the main codebase adds or changes endpoints:

1. Developer runs `pnpm generate:docs` in the main SocialCrawl codebase (regenerates OpenAPI spec + llms.txt files)
2. Developer updates the MCP's `data/` files to match
3. Version bump + `npm publish`

Users get updates automatically via `npx -y socialcrawl-mcp` (always pulls the latest version).

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

252 unit tests across 16 test suites:

| Suite | Tests | What it verifies |
|-------|-------|------------------|
| Data integrity | 61 | All 48 platforms present, 381 endpoints valid, totals match `REGISTRY_STATS`, pricing models coherent (ladder endpoints charge their tier rate; every metered endpoint quotes a band or a rule), integer bounds sane, param couplings and CSV constraints only name declared params, every doc topic exists, no duplicates, counts match |
| Pricing | 24 | Band-not-base quoting, authored rule vs band fallback, price-driving params, the four `socialcrawl_pricing` actions, budget filters judged by the metered ceiling |
| Local validation + search | 23 | Enum, range, coupling, and CSV rejections without touching the network; cross-platform endpoint search; method/budget filters; full parameter-contract output |
| Web + method-aware request | 21 | `socialcrawl_web` action routing, path-id validation, GET-query vs POST-body split, `in:query` routing, JSON-array coercion, web→tool redirect, the free `job_errors` / `crawl_preview` actions, metered rule in the header |
| API client | 17 | URL building, API key handling, HTTP error mapping for all status codes |
| HTTP transport | 14 | Stateless per-request context, header auth, rate limiting, tool listing |
| Monitors | 13 | Action routing, create-body assembly, cadence mapping, id/required-field validation, 204 handling |
| Auth | 9 | Header extraction precedence, no env fallback on the HTTP transport |
| Check balance | 8 | Meta-endpoint call shape for both balance and the transactions ledger, query forwarding, 0-credit header, missing-key + error handling |
| Pre-flight validation | 8 | Bad platform/resource/params caught locally, no-param endpoints pass through |
| Discovery (`/v1/utility/*`) | 25 | Anonymous bundled fallback, live call shapes and id normalisation, metered-label preference, the freshness drift check, and the `setup` topic |
| Server | 4 | All 9 tools registered, anonymous discovery, per-context key |
| Surface coverage | 9 | Every endpoint callable through a tool, priced, documented, and listed with every one of its params and enum values — across pages |
| Pagination | 11 | Line-boundary splitting, nothing lost across pages, clamped page numbers, short output left unpaged |
| Response truncation | 3 | Under-limit untouched, over-limit truncated, full length reported |
| Context | 2 | Env parsing, base-URL normalisation |

Tests use vitest with `vi.stubGlobal("fetch", ...)` for HTTP mocking and `process.env` manipulation for API key testing.

---

## Design Decisions

### Why 9 tools instead of 381?

381 tools would flood the AI client's tool list and consume context window space. The agent would need to somehow know that `socialcrawl_get_tiktok_profile` exists. With a handful of workflow tools, the agent discovers capabilities dynamically — by platform, by free-text search, or by budget — matching SocialCrawl's "one API, every platform" philosophy.

### Why bundle data instead of fetching it?

Bundled data means:
- Discovery tools work offline (no network dependency)
- Zero additional latency for platform/endpoint lookups
- No extra API calls consuming credits
- Package version maps to API version (predictable behavior)

The trade-off is that data can become stale if the MCP package isn't updated. But since updates are a simple `npm publish`, this is manageable.

### Why pre-flight validation?

Making API calls costs credits. A typo like `platfrom: "tikktok"` would consume 1 credit just to get a 404. Pre-flight validation catches these errors locally — saving credits and providing better error messages than the API would.

### Why stdio transport?

stdio is the standard for local MCP servers. The AI client spawns the server as a subprocess — no port conflicts, no firewall issues, no separate server to manage. The user just adds a config block and it works.

### Why read env vars at call time?

`SOCIALCRAWL_API_KEY` and `SOCIALCRAWL_BASE_URL` are read via getter functions rather than module-level constants. This enables:
- Tests to override env vars per-test without module caching issues
- Runtime configuration changes (if the env var is updated while the server runs)
