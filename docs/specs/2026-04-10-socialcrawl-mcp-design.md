# SocialCrawl MCP Server — Design Spec

> Date: 2026-04-10
> Status: Draft
> Repo: `socialcrawl-mcp` (public)
> Package: `socialcrawl-mcp` on npm

---

## Overview

An MCP (Model Context Protocol) server that gives any AI agent access to 21 social media platforms through SocialCrawl's unified API. Users configure their SocialCrawl API key once, and the MCP handles discovery, documentation, and API execution — so the agent can fetch profiles, posts, comments, search results, and analytics from TikTok, Instagram, YouTube, Twitter, LinkedIn, Reddit, and 15 more platforms.

**Core principle:** Mirror SocialCrawl's "one API, every platform" philosophy. The agent doesn't need to know 105 endpoint names — it discovers what's available, picks the right platform and resource, and makes the call.

---

## Architecture

### Transport & Runtime

- **Transport:** stdio (standard for local MCP servers)
- **Runtime:** Node.js (TypeScript compiled to JS)
- **Installation:** `npx socialcrawl-mcp` (zero-install from npm)
- **SDK:** MCP TypeScript SDK with `server.registerTool()` and Zod schemas
- **All tools are read-only** — SocialCrawl is entirely GET requests

### Project Structure

```
socialcrawl-mcp/
├── src/
│   ├── index.ts              # Entry point — creates MCP server, registers tools
│   ├── client.ts             # SocialCrawl API HTTP client
│   ├── types.ts              # Shared TypeScript types
│   ├── constants.ts          # Base URL, character limits, timeouts
│   ├── tools/
│   │   ├── request.ts        # socialcrawl_request
│   │   ├── list-platforms.ts # socialcrawl_list_platforms
│   │   ├── list-endpoints.ts # socialcrawl_list_endpoints
│   │   └── get-docs.ts       # socialcrawl_get_docs
│   ├── data/
│   │   ├── platforms.ts      # 21 platforms with metadata
│   │   ├── endpoints.ts      # 105 endpoints with params, tiers, descriptions
│   │   └── docs.ts           # Bundled llms.txt documentation content
│   └── schemas/
│       └── tools.ts          # Zod input validation schemas for all 4 tools
├── server.json               # MCP registry metadata
├── package.json              # npm package config with mcpName, bin
├── tsconfig.json
├── README.md                 # Registry-facing documentation
├── LICENSE                   # MIT
└── docs/
    └── specs/                # This file
```

---

## Tools (4 total)

### 1. `socialcrawl_list_platforms`

**Purpose:** Agent discovers what platforms are available.

**Input schema:** None (no parameters).

**Output:** Markdown-formatted list of all 21 platforms with:
- Platform name and slug
- Number of endpoints
- Brief description
- Example resources (e.g., "profiles, posts, comments, search")

**Annotations:**
- `readOnlyHint: true`
- `destructiveHint: false`
- `idempotentHint: true`
- `openWorldHint: false`

**Does not require API key.** Queries local bundled data only.

---

### 2. `socialcrawl_list_endpoints`

**Purpose:** Agent discovers endpoints and required parameters for a specific platform.

**Input schema:**
```
platform: string (required) — one of 21 platform slugs
```

Validated via Zod enum of all platform slugs.

**Output:** Markdown-formatted table of endpoints for that platform:
- Resource path (e.g., `profile`, `profile/videos`, `post/comments`)
- Required parameters with descriptions and examples
- Credit tier and cost (standard 1cr, advanced 5cr, premium 10cr)
- Response archetype (Author, Post, PostList, etc.)
- Brief summary

**Annotations:**
- `readOnlyHint: true`
- `destructiveHint: false`
- `idempotentHint: true`
- `openWorldHint: false`

**Does not require API key.** Queries local bundled data only.

---

### 3. `socialcrawl_request`

**Purpose:** Make any SocialCrawl API call.

**Input schema:**
```
platform: string (required) — platform slug
resource: string (required) — resource path (e.g., "profile", "post/comments")
params: object (optional) — key-value query parameters
```

**Output:** The full SocialCrawl API response, formatted as markdown with:
- Success/failure status
- Platform and endpoint info
- Data payload (the actual social media data)
- Credits used and remaining
- Cache status
- Request ID

**Annotations:**
- `readOnlyHint: true`
- `destructiveHint: false`
- `idempotentHint: true`
- `openWorldHint: true`

**Requires API key.** Makes HTTP call to `https://api.socialcrawl.com/v1/{platform}/{resource}`.

**Validation:** Before making the API call, validates that:
1. The platform exists in the local registry
2. The resource exists for that platform
3. All required parameters are present
This catches errors locally without consuming credits.

---

### 4. `socialcrawl_get_docs`

**Purpose:** Agent retrieves detailed documentation on demand.

**Input schema:**
```
topic: string (optional, default: "overview")
```

Valid topics:
- `"overview"` — compact API introduction (from llms.txt)
- `"full"` — comprehensive reference (from llms-full.txt)
- `"authentication"` — how to authenticate
- `"credits"` — credit tiers and pricing
- `"errors"` — error codes and handling
- Any platform slug (e.g., `"tiktok"`) — platform-specific docs (from llms-{platform}.txt)

**Output:** Markdown documentation for the requested topic.

**Annotations:**
- `readOnlyHint: true`
- `destructiveHint: false`
- `idempotentHint: true`
- `openWorldHint: false`

**Does not require API key.** Returns bundled documentation.

---

## API Client (`client.ts`)

Thin HTTP client wrapping `fetch`:

- **Base URL:** `https://api.socialcrawl.com` (overridable via `SOCIALCRAWL_BASE_URL` env var)
- **Auth:** `x-api-key` header from `SOCIALCRAWL_API_KEY` env var
- **Timeout:** 30 seconds (matching SocialCrawl's upstream timeout)
- **Method:** GET only (all SocialCrawl endpoints are GET)
- **Response truncation:** Truncate at 25,000 characters with note

No retries — the agent decides whether to retry.

---

## Data Layer

### Source of Truth

The MCP's bundled data is derived from the same source as the main SocialCrawl codebase:
- **Endpoint registry** → `data/endpoints.ts` and `data/platforms.ts`
- **Generated llms.txt files** → `data/docs.ts`

### `data/platforms.ts`

Static array of all 21 platforms:
```typescript
interface Platform {
  slug: string;           // "tiktok"
  name: string;           // "TikTok"
  endpointCount: number;  // 24
  description: string;    // "Profiles, videos, comments, followers, search, trending, live streams"
}
```

### `data/endpoints.ts`

Static array of all 105 endpoints:
```typescript
interface Endpoint {
  platform: string;         // "tiktok"
  resource: string;         // "profile"
  method: "GET";
  params: ParamDef[];       // [{ name: "handle", required: true, description: "...", example: "charlidamelio" }]
  creditTier: string;       // "standard" | "advanced" | "premium"
  creditCost: number;       // 1, 5, or 10
  archetype: string;        // "Author" | "Post" | "PostList" | etc.
  summary: string;          // "Get TikTok user profile"
  description: string;      // Longer description
}
```

### `data/docs.ts`

Bundled documentation content keyed by topic:
```typescript
const DOCS: Record<string, string> = {
  overview: "...",           // llms.txt content
  full: "...",               // llms-full.txt content
  authentication: "...",     // Extracted section
  credits: "...",            // Extracted section
  errors: "...",             // Extracted section
  tiktok: "...",             // llms-tiktok.txt
  instagram: "...",          // llms-instagram.txt
  // ... all 21 platforms
};
```

### Sync Strategy

When the main SocialCrawl codebase adds or changes endpoints:
1. Developer runs `pnpm generate:docs` in the main codebase (updates OpenAPI spec + llms.txt files)
2. Developer runs a sync script in `socialcrawl-mcp` that reads the generated files and updates `data/`
3. Bump version, publish to npm

This is a manual but straightforward step tied to the existing generation workflow.

---

## Configuration

### User Setup

Single environment variable:

```json
{
  "mcpServers": {
    "socialcrawl": {
      "command": "npx",
      "args": ["-y", "socialcrawl-mcp"],
      "env": {
        "SOCIALCRAWL_API_KEY": "sc_xxxxx"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `SOCIALCRAWL_API_KEY` | Yes (for `socialcrawl_request`) | — | SocialCrawl API key |
| `SOCIALCRAWL_BASE_URL` | No | `https://api.socialcrawl.com` | Custom API base URL |

Discovery and documentation tools work without an API key. Only `socialcrawl_request` requires it.

---

## Error Handling

### Missing API Key

Server starts successfully. Discovery tools work. `socialcrawl_request` returns:
> "No API key configured. Set SOCIALCRAWL_API_KEY in your MCP server environment. Get a free key at socialcrawl.com (100 credits, no credit card required)."

### HTTP Error Mapping

Every error tells the agent what to do next:

| HTTP Status | SocialCrawl Error | MCP Message |
|-------------|-------------------|-------------|
| 401 | `INVALID_API_KEY` | "Invalid API key. Check your SOCIALCRAWL_API_KEY configuration." |
| 402 | `INSUFFICIENT_CREDITS` | "Insufficient credits ({remaining} remaining, {required} required). Top up at socialcrawl.com/billing." |
| 404 | `ENDPOINT_NOT_FOUND` | "Endpoint not found. Use socialcrawl_list_endpoints to see available endpoints for {platform}." |
| 400 | `MISSING_PARAMETER` | "Missing required parameter: {param}. This endpoint requires: {param_list}." |
| 503 | `PLATFORM_UNAVAILABLE` | "Platform {name} is temporarily unavailable. Try again shortly." |
| 502 | `UPSTREAM_ERROR` | "Upstream error fetching data. Credits have been auto-refunded." |

### Local Validation (Pre-Flight)

`socialcrawl_request` validates before making the HTTP call:
1. Platform exists in local registry → error if not, suggests `socialcrawl_list_platforms`
2. Resource exists for that platform → error if not, suggests `socialcrawl_list_endpoints`
3. Required parameters are present → error if not, lists what's missing with examples

This prevents wasted API calls and credit consumption.

### Response Truncation

Responses exceeding 25,000 characters are truncated with:
> "[Response truncated at 25,000 characters. Full response was {N} characters.]"

### Network Failures

- Connection refused / DNS failure: "Could not reach SocialCrawl API at {base_url}. Check your network connection."
- Timeout (30s): "Request timed out after 30 seconds. The platform may be experiencing delays."

---

## Distribution & Registry

### npm

- **Package name:** `socialcrawl-mcp`
- **bin entry:** `socialcrawl-mcp` → `dist/index.js`
- **mcpName:** `io.github.ridiocompany/socialcrawl`
- **keywords:** `mcp`, `social-media`, `api`, `ai-agents`, `socialcrawl`, `tiktok`, `instagram`, `youtube`, `twitter`, `linkedin`, `reddit`
- **license:** MIT
- **files:** `dist/` only (keeps package small)

### MCP Registry (`server.json`)

```json
{
  "name": "io.github.ridiocompany/socialcrawl",
  "description": "Access 21+ social media platforms through one unified API. Get profiles, posts, comments, search results, and analytics from TikTok, Instagram, YouTube, Twitter, LinkedIn, Reddit, and more.",
  "repository": {
    "type": "git",
    "url": "https://github.com/ridiocompany/socialcrawl-mcp"
  },
  "packages": [
    {
      "registryType": "npm",
      "identifier": "socialcrawl-mcp",
      "transport": "stdio"
    }
  ],
  "environmentVariables": [
    {
      "name": "SOCIALCRAWL_API_KEY",
      "description": "Your SocialCrawl API key. Get a free key at socialcrawl.com (100 credits, no credit card required).",
      "required": true
    }
  ]
}
```

### Registry Submission

| Registry | Submit via | What's needed |
|----------|-----------|---------------|
| npm | `npm publish` | `package.json` with bin, files, keywords |
| modelcontextprotocol.io | Web form (Server tab) | Name, description, GitHub URL |
| Glama | Web form | Name, description, GitHub URL |

### README.md (Registry-Facing)

Sections in order:
1. Hero — one-liner + npm/license badges
2. What it does — 2-3 sentences, platform/endpoint counts
3. Quick setup — JSON config blocks for Claude Desktop, Cursor, VS Code
4. Available tools — table of 4 tools with descriptions
5. Example agent conversation — natural language → tool calls → results
6. Supported platforms — table of all 21 platforms with endpoint counts
7. Get your API key — link to socialcrawl.com, free tier callout
8. License — MIT

---

## Future Phases (Out of Scope)

1. **CLI tool** — `socialcrawl fetch tiktok/profile --handle charlidamelio` — wraps the same API client with a command interface. Separate package, shared `client.ts`.
2. **Streamable HTTP transport** — for remote MCP hosting (currently stdio only).
3. **Automated data sync** — CI pipeline that regenerates `data/` from main codebase on endpoint registry changes.
4. **MCP Resources** — expose llms.txt files as MCP Resources in addition to the `get_docs` tool (when client support matures).

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP server framework |
| `zod` | Input schema validation |

No other runtime dependencies. The API client uses Node.js built-in `fetch`.

---

## Agent Workflow

Typical flow when an AI agent uses the MCP:

```
Agent: "I need TikTok data for charlidamelio"

1. socialcrawl_list_platforms → sees TikTok has 24 endpoints
2. socialcrawl_list_endpoints(platform: "tiktok") → sees profile needs "handle" param
3. socialcrawl_request(platform: "tiktok", resource: "profile", params: { handle: "charlidamelio" })
   → returns unified profile data with followers, bio, engagement, etc.

If confused at any point:
4. socialcrawl_get_docs(topic: "tiktok") → reads platform-specific documentation
```

Smart agents may skip steps 1-2 after learning the API structure from initial calls.
