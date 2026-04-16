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
    | HTTPS (GET requests)
    |
SocialCrawl API (www.socialcrawl.dev)
    |
    | (upstream)
    |
Social Media Platforms (21 platforms)
```

The MCP server exposes 4 tools. Three of them (list_platforms, list_endpoints, get_docs) query local bundled data and work without an API key or network connection. One tool (request) makes actual API calls.

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
├── index.ts              # Server creation, tool registration, stdio transport
├── client.ts             # HTTP client for SocialCrawl API calls
├── types.ts              # TypeScript interfaces
├── constants.ts          # Timeouts, character limits, server metadata
├── tools/
│   ├── list-platforms.ts # Formats platform discovery output
│   ├── list-endpoints.ts # Formats endpoint discovery output
│   ├── get-docs.ts       # Retrieves bundled documentation
│   └── request.ts        # Pre-flight validation + API call execution
├── data/
│   ├── platforms.ts      # 21 platforms with metadata
│   ├── endpoints.ts      # 108 endpoints with full parameter definitions
│   └── docs.ts           # Bundled llms.txt documentation (26 topics)
└── schemas/
    └── tools.ts          # Zod input validation schemas for all 4 tools
```

---

## The 4 Tools

### Tool Registration

Each tool is registered using the MCP SDK's `server.registerTool()` API with:

- **Name** — snake_case, prefixed with `socialcrawl_` (e.g., `socialcrawl_request`)
- **Input schema** — Zod schema for runtime validation. The MCP SDK converts Zod schemas to JSON Schema for the AI client.
- **Annotations** — MCP tool annotations that help the AI client understand the tool's behavior:
  - `readOnlyHint: true` — all tools are read-only (SocialCrawl is entirely GET requests)
  - `destructiveHint: false` — no tool modifies or deletes data
  - `idempotentHint: true` — calling the same tool with the same params produces the same result
  - `openWorldHint` — `true` for `socialcrawl_request` (makes external API calls), `false` for the other 3 (local data only)

### Tool Design Philosophy

The MCP exposes 4 workflow-oriented tools rather than 108 endpoint-specific tools. This mirrors SocialCrawl's core value proposition: **one API, every platform.** The agent doesn't need to know 108 tool names — it discovers what's available and makes calls through a single, unified interface.

The typical agent workflow is:

1. `socialcrawl_list_platforms` — "What platforms exist?"
2. `socialcrawl_list_endpoints` — "What can I do on TikTok?"
3. `socialcrawl_request` — "Get me this specific data"
4. `socialcrawl_get_docs` — "I need help understanding something"

Smart agents learn the API structure after 1-2 discovery calls and skip straight to `socialcrawl_request` for subsequent queries.

---

## Data Layer

The MCP bundles all SocialCrawl knowledge as static TypeScript data. This means the discovery and documentation tools work without any network calls.

### `data/platforms.ts` — 21 Platforms

A static array of platform metadata:

```typescript
interface Platform {
  slug: string;           // "tiktok"
  name: string;           // "TikTok"
  endpointCount: number;  // 26
  description: string;    // "Profiles, videos, comments, ..."
}
```

Queried by `socialcrawl_list_platforms` and used for pre-flight validation in `socialcrawl_request`.

### `data/endpoints.ts` — 108 Endpoints

A static array of every endpoint definition:

```typescript
interface Endpoint {
  platform: string;         // "tiktok"
  resource: string;         // "profile"
  method: "GET";
  params: ParamDef[];       // [{ name: "handle", required: true, optional: false, description: "...", example: "charlidamelio" }]
  oneOf?: string[][];       // e.g. [["url", "id"]] — at least one of each group must be provided
  creditTier: string;       // "standard" | "advanced" | "premium"
  creditCost: number;       // 1, 5, or 10
  archetype: string;        // "Author", "Post", "PostList", etc.
  summary: string;          // "Get TikTok user profile"
  description: string;      // Longer description
}
```

Each `ParamDef` carries both `required` and `optional` flags. Optional parameters are forwarded to the API whenever the agent supplies them, but pre-flight validation never blocks a call for missing them. `oneOf` groups express "at least one of these mutually-substitutable identifiers" (e.g. a post endpoint that accepts either `url` or `id`) — pre-flight enforces these locally before any network call is made.

This data is derived from the main SocialCrawl codebase's endpoint registry (`packages/social-api/src/registry/config.ts`), which is the single source of truth for all endpoint definitions.

### `data/docs.ts` — 26 Documentation Topics

Bundled llms.txt content from the SocialCrawl website, keyed by topic:

| Key | Source | Content |
|-----|--------|---------|
| `overview` | `llms.txt` | Compact API introduction |
| `full` | `llms-full.txt` | Comprehensive reference (~35K chars) |
| `authentication` | Hardcoded | How to use API keys |
| `credits` | Hardcoded | Credit tiers and pricing |
| `errors` | Hardcoded | Error codes and handling |
| `tiktok` | `llms-tiktok.txt` | TikTok-specific endpoint reference |
| `instagram` | `llms-instagram.txt` | Instagram-specific endpoint reference |
| ... | ... | 19 more platform-specific docs |

The llms.txt files are generated by the main SocialCrawl codebase from its endpoint registry. They are AI-optimized documentation designed to be consumed by language models.

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

The envelope is stable across all 108 endpoints — only the shape of `data` varies. The inner `data` payload is typed per **archetype** (`Author`, `Post`, `PostList`, `CommentList`, `SearchResults`, etc.), so an agent that has learned what a `Post` looks like for TikTok can read an Instagram `Post` with the same mental model. The `cached` flag indicates whether the response came from SocialCrawl's upstream cache, and `credits_used` / `credits_remaining` let the agent track the balance after every call without a separate billing lookup.

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

35 unit tests across 4 test suites:

| Suite | Tests | What it verifies |
|-------|-------|------------------|
| Data integrity | 18 | All 21 platforms present, 108 endpoints valid, 26 doc topics exist, no duplicates, counts match |
| Pre-flight validation | 5 | Bad platform/resource/params caught locally, no-param endpoints pass through |
| API client | 9 | URL building, API key handling, HTTP error mapping for all status codes |
| Response truncation | 3 | Under-limit untouched, over-limit truncated, full length reported |

Tests use vitest with `vi.stubGlobal("fetch", ...)` for HTTP mocking and `process.env` manipulation for API key testing.

---

## Design Decisions

### Why 4 tools instead of 108?

108 tools would flood the AI client's tool list and consume context window space. The agent would need to somehow know that `socialcrawl_get_tiktok_profile` exists. With 4 workflow tools, the agent discovers capabilities dynamically — matching SocialCrawl's "one API, every platform" philosophy.

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
