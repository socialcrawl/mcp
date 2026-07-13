# SocialCrawl MCP — Remote Transport Upgrade Plan (Streamable HTTP + Web Connector)

**Status:** Approved plan — not yet implemented
**Date:** 2026-07-02
**Owner:** Ridio Company / SocialCrawl
**Repo:** `socialcrawl-mcp` (github.com/RidioDevelopment/socialcrawl-mcp)
**Audience:** Any engineer or AI agent executing this upgrade. This document is self-contained — it includes the research findings, architecture decisions, reference code, phase-by-phase tasks, test plan, and acceptance criteria.

---

## 1. Executive Summary

The SocialCrawl MCP server (`socialcrawl-mcp` v1.6.0 on npm) currently supports **stdio transport only**. That works for local clients (Claude Desktop, Claude Code CLI, Cursor, VS Code) but cannot be used by:

- **claude.ai web custom connectors** (Settings → Connectors → "Add custom connector")
- **Claude Code on the web / cloud sandboxes**
- **ChatGPT connectors, and other cloud-hosted AI agents**
- Any client that cannot spawn a local Node process

This plan upgrades the server to the **industry-standard remote transport: Streamable HTTP** (the MCP spec's only current HTTP transport — the old standalone HTTP+SSE transport was **deprecated in spec revision 2025-03-26** and must NOT be the primary target of new work). The upgrade keeps the existing stdio transport fully intact for the npm package, adds a hosted endpoint at **`https://mcp.socialcrawl.dev/mcp`**, and rolls out in phases:

| Phase | Deliverable | Unlocks |
|---|---|---|
| 0 | Multi-tenant refactor (per-request API key, server factory) | Prerequisite for everything below |
| 1 | Streamable HTTP transport + header auth (`Authorization: Bearer` / `x-api-key`) | Claude Code (CLI **and** web/cloud), Cursor, Windsurf, VS Code, n8n, any header-capable client |
| 2 | Production deployment at `mcp.socialcrawl.dev` (Docker, TLS, observability, rate limits) | Public availability |
| 3 | OAuth 2.1 authorization (RFC 9728 + 8414 + PKCE + DCR/CIMD) | claude.ai web connectors with per-user auth, ChatGPT connectors, Anthropic connectors directory eligibility |
| 4 | Distribution updates (MCP Registry `remotes`, README, docs, skill repo, directory submission) | Discoverability |
| 5 | Future-proofing (SDK v2 / 2026-07-28 stateless spec) | Longevity |

**Key architecture decisions (detailed in §4):**
1. **One codebase, two entrypoints** — `src/index.ts` (stdio, unchanged behavior) and `src/http.ts` (Express + Streamable HTTP). All six tools, data files, and formatting logic are shared.
2. **Stateless Streamable HTTP** (`sessionIdGenerator: undefined`) with a **fresh `McpServer` instance per request**, the API key bound via closure. No session store, no sticky routing, horizontally scalable, and aligned with where the protocol is going (the 2026-07-28 spec revision removes sessions entirely).
3. **Dual auth**: request headers for developer clients (Phase 1) + OAuth 2.1 façade over SocialCrawl API keys for browser clients (Phase 3). **No API keys in query strings** (violates the MCP auth spec and doesn't work in claude.ai anyway).
4. **The HTTP server must NEVER fall back to the process's own `SOCIALCRAWL_API_KEY` env var** for a caller that didn't supply credentials — that would let anonymous users burn the operator's credits. Env fallback remains valid ONLY in the stdio entrypoint.

---

## 2. Current State (What Exists Today)

### 2.1 The server

- `socialcrawl-mcp` v1.6.0, published on npm, `bin: dist/index.js`, MIT.
- SDK: `@modelcontextprotocol/sdk` declared `^1.6.1`; **v1.29.0 actually installed** (lockfile). v1.29.0 already ships `StreamableHTTPServerTransport` and `webStandardStreamableHttp` — **no SDK upgrade is strictly required**, but the declared range should be bumped (see Phase 0).
- Six tools registered on a single module-level `McpServer` in `src/index.ts`:
  - `socialcrawl_list_platforms` — no key required
  - `socialcrawl_list_endpoints` — no key required
  - `socialcrawl_get_docs` — no key required
  - `socialcrawl_request` — requires key
  - `socialcrawl_check_balance` — requires key
  - `socialcrawl_monitors` — requires key (only tool with `destructiveHint: true`)
- All tools already carry `title` + full safety annotations (`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`) — this matters for Anthropic directory submission (Phase 4) and is already done. ✅
- Response truncation at 25,000 chars (`CHARACTER_LIMIT`), 30s upstream timeout (`TIMEOUT_MS`).

### 2.2 The single-tenant problem (the core refactor driver)

`src/client.ts` reads credentials from **process-global environment**:

```ts
function getBaseUrl(): string {
  return process.env.SOCIALCRAWL_BASE_URL ?? "https://www.socialcrawl.dev";
}
function getApiKey(): string {
  return process.env.SOCIALCRAWL_API_KEY ?? "";
}
```

Every keyed tool funnels through `makeRequest()` / `apiRequest()` in this file. For stdio (one process per user) this is fine. For a hosted HTTP server (one process, many users), **the API key must be per-request**, not per-process. This is the only genuinely invasive change in the whole plan; everything else is additive.

### 2.3 Registry / distribution state

- `server.json` (MCP Registry): `io.github.RidioDevelopment/socialcrawl`, currently `packages` (npm/stdio) only — **no `remotes` array yet**.
- Published to the official MCP Registry (registry.modelcontextprotocol.io) via `mcp-publisher` (tokens `.mcpregistry_*` are in the repo root — **note: these should be gitignored/rotated; verify during Phase 4**).
- Also listed on Glama (`glama.json`).
- Tests (`src/__tests__/*`) mutate `process.env` in `beforeEach` — they will need the same context refactor (Phase 0).

---

## 3. Research Findings — What "Industry Standard" Means in Mid-2026

*(Verified 2026-07-02 against modelcontextprotocol.io, claude.com/docs, code.claude.com/docs, support.claude.com, and the TypeScript SDK repo. Citations inline.)*

### 3.1 Transport

- **Current MCP spec revision: 2025-11-25.** Streamable HTTP is the standard (and only) HTTP transport: a single endpoint (e.g. `/mcp`) accepting `POST` (JSON-RPC messages; server responds with `application/json` or an SSE stream), optional `GET` (opens a server-push SSE stream), and `DELETE` (session termination). https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- **HTTP+SSE (the old two-endpoint `/sse` + `/messages` transport) has been deprecated since revision 2025-03-26.** The user's request says "SSE or Streamable HTTP" — the correct reading in 2026 is: **build Streamable HTTP**. Claude Code's own docs state "The SSE transport is deprecated. Use HTTP servers instead" (https://code.claude.com/docs/en/mcp), and Anthropic's connector-building guide says HTTP+SSE "is being deprecated in favor of Streamable HTTP" (https://claude.com/docs/connectors/building). Do **not** build a legacy `/sse` endpoint unless a concrete customer need appears (§9, Open Question 3).
- **Important terminology note for implementers:** Streamable HTTP *uses* SSE internally as one of its response framings — a client that says it needs "SSE support" is almost always satisfied by a spec-compliant Streamable HTTP endpoint. Don't confuse "SSE the deprecated transport" with "SSE the response content-type inside Streamable HTTP."
- **Next spec revision (2026-07-28, currently RC):** removes the `initialize` handshake and `Mcp-Session-Id` entirely — the protocol goes stateless. https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/ — This strongly validates choosing **stateless** mode now (§4.3).

### 3.2 Claude client requirements

| Client | Transport | Auth it can send | Notes |
|---|---|---|---|
| **claude.ai web / Desktop custom connector** | Streamable HTTP (SSE deprecated) | **OAuth 2.1 or no-auth only. NO custom headers. NO query-string tokens.** | Available on Free (1 connector), Pro, Max, Team, Enterprise. Server must be publicly reachable (traffic originates from Anthropic's cloud). OAuth callback: `https://claude.ai/api/mcp/auth_callback`. Tool result limit ~150k chars; 5-min tool timeout. Sources: https://support.claude.com/en/articles/11175166, https://claude.com/docs/connectors/building |
| **Claude Code CLI** | `claude mcp add --transport http <name> <url> [--header "x-api-key: ..."]` or `.mcp.json` `{"type": "http", "url": ..., "headers": {...}}` | Headers ✅ (Bearer, x-api-key, anything), OAuth ✅ (auto-discovery on 401, `/mcp` command / `claude mcp login`) | `${ENV_VAR}` expansion in `.mcp.json`. https://code.claude.com/docs/en/mcp |
| **Claude Code on the web / cloud sandbox** | Same `.mcp.json` HTTP config | Headers ✅, OAuth ✅ | MCP connector traffic is proxied through Anthropic's servers, so it works **without** adding the host to the sandbox's allowed-domains list. https://code.claude.com/docs/en/claude-code-on-the-web |
| **ChatGPT connectors** | Streamable HTTP | OAuth (DCR) or no-auth | Same dual pattern applies |

**Consequence:** header auth (Phase 1) immediately serves every developer-tool client including Claude Code web/cloud — which is what the user specifically asked for. claude.ai browser connectors additionally need OAuth (Phase 3).

### 3.3 Authorization spec (2025-11-25)

https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization

- Auth is **optional** in MCP, but when you gate an HTTP server you should follow the spec so OAuth-capable clients can discover the flow:
  - **RFC 9728 Protected Resource Metadata** — the MCP server **MUST** serve `/.well-known/oauth-protected-resource` and return `401` with `WWW-Authenticate: Bearer resource_metadata="…"` to point clients at it.
  - **RFC 8414 Authorization Server Metadata** (or OIDC discovery) — the AS **MUST** serve one.
  - **OAuth 2.1 authorization-code + PKCE (S256)** — mandatory.
  - **RFC 8707 Resource Indicators** — clients send `resource=`; the server **MUST validate token audience** (a token minted for another MCP server must be rejected).
  - **Dynamic Client Registration (RFC 7591) is no longer mandatory** — demoted to MAY in 2025-11-25. The new SHOULD-level default is **Client ID Metadata Documents (CIMD)** where `client_id` is an HTTPS URL to a JSON metadata document. **Claude supports all three: DCR, CIMD, and pre-registered client credentials** (https://claude.com/docs/connectors/building/authentication). **Implement DCR + CIMD** for maximum client compatibility (ChatGPT still uses DCR).
  - **Tokens MUST travel in the `Authorization` header — never in URI query strings.**

### 3.4 What comparable API companies ship (validated patterns)

| Company | Remote MCP auth | Assessment |
|---|---|---|
| **Apify** | `https://mcp.apify.com` — OAuth (browser flow) **or** `Authorization: Bearer <token>` header | ✅ The gold-standard dual pattern. Copy this. |
| **Context7** | `https://mcp.context7.com/mcp` — header key for dev clients + OAuth for browser clients | ✅ Same dual pattern |
| **Firecrawl** | OAuth (recommended) + key-in-URL-**path** fallback (`https://mcp.firecrawl.dev/{KEY}/v2/mcp`) | ⚠️ Path-key is a pragmatic workaround for header-less clients; officially discouraged (keys leak into logs/history) |
| **Exa** | `?exaApiKey=` query string | ❌ Non-compliant with the MCP auth spec; flagged as a security issue in their own repo; doesn't work in claude.ai anyway. **Do not copy.** |

**SocialCrawl's target pattern = Apify's:** headers first, OAuth second, no query-string keys, path-key fallback only as an explicitly-decided optional extra (§9, Open Question 2).

### 3.5 TypeScript SDK status

- Latest stable: **`@modelcontextprotocol/sdk` v1.29.0** (already in our lockfile). `McpServer` + `registerTool()` remain the high-level API — no rewrite needed.
- **SDK v2 is in beta** (`@modelcontextprotocol/server`, `/client`, `/express`, `/node`, `/hono` split packages), targeting the 2026-07-28 stateless spec. **Do NOT build on v2 beta now** — ship on v1.29.x and plan the v2 migration as Phase 5. https://github.com/modelcontextprotocol/typescript-sdk
- v1 Streamable HTTP server options we will use: `sessionIdGenerator: undefined` (stateless), `enableJsonResponse: true` (plain JSON responses — friendlier to proxies/serverless than SSE-framed responses), `enableDnsRebindingProtection` / `allowedHosts` / `allowedOrigins`.

### 3.6 Hosting patterns

- **Long-lived Node container** (Fly.io / Railway / Render / own infra): no SSE-timeout issues, simplest stateless or stateful operation. This is what Apify/Firecrawl/Exa-class API companies run. ← **Recommended (§4.5).**
- **Vercel `mcp-handler`** (successor to `@vercel/mcp-adapter`): good if embedding in the existing Next.js `apps/web`; Fluid Compute mitigates SSE timeouts.
- **Cloudflare Workers `McpAgent`**: excellent edge story, built-in OAuth provider library, but Durable Objects (paid plan) and a different codebase shape — poor fit for reusing this repo as-is.
- Classic serverless (Lambda + API Gateway) is awkward for SSE streaming — avoid.

### 3.7 MCP Registry `remotes` format

```json
"remotes": [{ "type": "streamable-http", "url": "https://mcp.socialcrawl.dev/mcp" }]
```

`remotes` and `packages` can coexist in one `server.json`. Note: under the `io.github.RidioDevelopment/*` namespace there is **no domain restriction on remote URLs**, but if we ever migrate the registry name to `dev.socialcrawl/*` (DNS-verified namespace), remote URLs must live on that domain — `mcp.socialcrawl.dev` satisfies both. https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/generic-server-json.md

---

## 4. Target Architecture

### 4.1 Overview

```
                                ┌──────────────────────────────────────────────┐
 stdio clients                  │  socialcrawl-mcp repo (one codebase)         │
 (Claude Desktop, Cursor,       │                                              │
  npx socialcrawl-mcp)          │  src/server.ts   ← createServer(ctx) factory │
        │                       │  src/context.ts  ← ApiContext type           │
        ▼                       │  src/tools/*     ← unchanged tool logic      │
  src/index.ts ── stdio ───────▶│  src/client.ts   ← ctx-aware (no env reads   │
  (env key, unchanged UX)       │                     outside stdio entry)     │
                                │  src/http.ts     ← Express + Streamable HTTP │
                                └──────────────────────────────────────────────┘
                                                     ▲
 HTTP clients                                        │
 (claude.ai, Claude Code web,    POST /mcp           │  per-request:
  ChatGPT, n8n, curl) ──────────  Authorization: ────┘  key → createServer(ctx)
                                  Bearer sc_...          → StreamableHTTPServerTransport
                                                         → handleRequest → dispose
```

### 4.2 One codebase, two entrypoints

- `src/index.ts` — stdio entry. **Behavior-identical to today** for existing npm users: reads `SOCIALCRAWL_API_KEY` / `SOCIALCRAWL_BASE_URL` from env, builds the context once, calls the shared factory, connects `StdioServerTransport`. Stays the package `bin`.
- `src/http.ts` — new HTTP entry. Express app exposing `/mcp` + `/healthz` (+ OAuth discovery endpoints in Phase 3). New npm script `start:http`; optionally a second bin `socialcrawl-mcp-http` so self-hosters can run it via `npx`.
- `src/server.ts` — new. All six `registerTool` blocks move here into `createServer(ctx: ApiContext): McpServer`. This file is the single source of truth for tool definitions; both transports call it.

### 4.3 Stateless Streamable HTTP (decision + rationale)

**Decision: stateless mode.** `sessionIdGenerator: undefined`, a fresh `McpServer` + `StreamableHTTPServerTransport` per incoming POST, `enableJsonResponse: true`.

Why:
1. **Our tools are pure request/response API calls.** Nothing needs server-initiated messages (no sampling, no subscriptions, no progress streams). A session map buys us nothing.
2. **Horizontal scalability with zero coordination** — any replica can serve any request; no sticky sessions, no Redis event store.
3. **Future-proof** — the 2026-07-28 spec revision deletes sessions from the protocol. Stateless code will migrate to SDK v2 nearly unchanged; stateful code would be a rewrite.
4. `enableJsonResponse: true` returns plain `application/json` bodies for tool calls, which avoids idle-SSE-stream problems behind proxies/load balancers entirely.

Consequences to implement:
- `GET /mcp` → `405 Method Not Allowed` (no standalone push stream in stateless mode).
- `DELETE /mcp` → `405` (no sessions to terminate).
- Every POST constructs the server via the factory and **closes the transport when the response finishes** (`res.on("close", ...)`) to avoid leaks.
- Per-request server construction cost is trivial: `registerTool` × 6 over in-memory data. No I/O at construction time. (The `PLATFORMS`/`ENDPOINTS`/docs data modules are imported once at process start as today.)

### 4.4 Multi-tenant auth context (the Phase 0 refactor)

**Decision: explicit context threading via a server factory** (not `AsyncLocalStorage`). ALS would minimize the diff, but explicit context is easier to test, impossible to leak across requests, and matches how every reference implementation does it.

New types:

```ts
// src/context.ts
export interface ApiContext {
  /** Per-user SocialCrawl API key. Empty string = anonymous (discovery tools only). */
  apiKey: string;
  /** API origin. Env-overridable in stdio; fixed (or env-set once) in HTTP mode. */
  baseUrl: string;
}
```

Change surface (mechanical, ~10 files):

| File | Change |
|---|---|
| `src/client.ts` | `makeRequest(ctx, options)` / `apiRequest(ctx, options)` — delete `getApiKey()`/`getBaseUrl()` env readers. The "no API key" early-return stays, keyed off `ctx.apiKey === ""`. |
| `src/tools/request.ts`, `check-balance.ts`, `monitors.ts` | Accept and forward `ctx` (first parameter). |
| `src/tools/list-platforms.ts`, `list-endpoints.ts`, `get-docs.ts` | No change (no API calls). |
| `src/server.ts` (new) | `createServer(ctx)` — moves all `registerTool` calls out of `index.ts`; handlers close over `ctx`. |
| `src/index.ts` | Shrinks to: build ctx from env → `createServer(ctx)` → connect stdio. |
| `src/__tests__/*` | Replace `process.env` mutation with explicit `ctx` fixtures (`{ apiKey: "sc_test_key", baseUrl: "https://www.socialcrawl.dev" }`). Tests get *simpler*. |
| `src/data/docs.ts` | Update the authentication doc text to describe both transports (stdio env var; HTTP header). |

**Security invariant (write a test for this):** in HTTP mode, a request with no credentials yields `ctx.apiKey === ""` — never the process env value. The keyed tools then return their existing friendly "No API key configured" message (reworded for HTTP, see §5 Phase 1 step 6).

### 4.5 Hosting recommendation

**Recommended: standalone Node/Express container built from this repo, deployed to a long-lived-container host (Fly.io / Railway / Render / existing SocialCrawl infra), fronted at `https://mcp.socialcrawl.dev/mcp`.**

Rationale:
- All tool/data/formatting logic lives in *this* repo (which also generates the npm package). Embedding the remote server in the main `codebase/` Next.js monorepo would either duplicate that logic or create an awkward cross-repo dependency; the existing MCP-data regen pipeline (`extract-mcp-data.ts` → `generate:data`) already targets this repo.
- A long-lived container sidesteps every serverless SSE/timeout caveat and keeps ops trivially simple (it's a tiny stateless HTTP service).
- The npm package and the hosted endpoint ship from one build, one version, one changelog — they can never drift.

Acceptable alternative (document the choice in §9, Open Question 1): if the team strongly prefers a single deploy surface on the main site's platform, use `mcp-handler` inside `codebase/apps/web` at `/api/mcp` and rewrite `mcp.socialcrawl.dev → /api/mcp`; the cost is vendoring/importing this repo's tool layer into the monorepo and keeping it in sync each registry wave.

### 4.6 Endpoint & URL design

| URL | Method | Purpose |
|---|---|---|
| `https://mcp.socialcrawl.dev/mcp` | POST | The MCP endpoint (JSON-RPC) |
| `https://mcp.socialcrawl.dev/mcp` | GET, DELETE | `405` (stateless) |
| `https://mcp.socialcrawl.dev/healthz` | GET | Liveness — `200 {"status":"ok","version":"1.7.0"}` |
| `https://mcp.socialcrawl.dev/.well-known/oauth-protected-resource` | GET | Phase 3 (RFC 9728) |
| `https://mcp.socialcrawl.dev/` | GET | Redirect to docs page (`socialcrawl.dev/docs/mcp`) — nice-to-have |

Use a dedicated subdomain (not `www.socialcrawl.dev/api/mcp`) so the MCP service scales, deploys, and rate-limits independently of the web app, and so the RFC 9728 well-known URI sits cleanly at the resource origin.

---

## 5. Implementation Plan — Phase by Phase

> Each phase ends with its own verification steps and is independently shippable. Do them in order.

### Phase 0 — Multi-tenant refactor (prerequisite, no behavior change)

1. **Bump declared SDK range** in `package.json`: `"@modelcontextprotocol/sdk": "^1.29.0"` (matches lockfile reality; guarantees `StreamableHTTPServerTransport` availability). Stay on v1.x — do NOT adopt the v2 beta.
2. **Add `express`** (`^5.x`) and `@types/express` to dependencies. (The SDK's Express-style transport examples use it; the SDK already transitively contains what it needs, but our HTTP entry needs its own server framework. Alternative: the SDK's `webStandardStreamableHttp` transport with a fetch-style server — Express is chosen for familiarity and middleware ecosystem.)
3. Create `src/context.ts` (`ApiContext`, plus `contextFromEnv(): ApiContext` used only by the stdio entry).
4. Refactor `src/client.ts` and the three keyed tools to take `ctx` per §4.4.
5. Create `src/server.ts` with `createServer(ctx)`; shrink `src/index.ts` to the stdio bootstrap.
6. Refactor tests to context fixtures; add the **no-env-fallback security test** (§4.4).
7. Run `npm test` and a manual stdio smoke test (point Claude Desktop/Code at the local build; call `socialcrawl_check_balance`).

**Exit criteria:** all tests green; stdio behavior byte-identical (same tool list, same error strings for missing key); zero references to `process.env.SOCIALCRAWL_API_KEY` outside `src/index.ts` (and `SOCIALCRAWL_BASE_URL` outside `index.ts`/`http.ts`).

### Phase 1 — Streamable HTTP transport + header auth

1. **Create `src/http.ts`** — reference implementation (adapt as needed):

```ts
#!/usr/bin/env node
import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { SERVER_VERSION } from "./constants.js";

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.SOCIALCRAWL_BASE_URL ?? "https://www.socialcrawl.dev";

const app = express();
app.use(express.json({ limit: "1mb" }));

// --- CORS: required for browser-based MCP clients (incl. MCP Inspector) ---
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // tighten later if desired
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-api-key, mcp-protocol-version, mcp-session-id",
  );
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id, WWW-Authenticate");
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

/** Extract the caller's SocialCrawl API key. NEVER falls back to process env. */
function extractApiKey(req: express.Request): string {
  const auth = req.headers.authorization;
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const xKey = req.headers["x-api-key"];
  if (typeof xKey === "string" && xKey.trim() !== "") return xKey.trim();
  return ""; // anonymous — discovery tools still work
}

app.post("/mcp", async (req, res) => {
  const ctx = { apiKey: extractApiKey(req), baseUrl: BASE_URL };
  const server = createServer(ctx);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,     // stateless
    enableJsonResponse: true,          // plain JSON responses; proxy-friendly
  });
  res.on("close", () => { void transport.close(); void server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless mode: no server-push stream, no sessions to delete.
app.get("/mcp", (_req, res) => { res.status(405).set("Allow", "POST").send(); });
app.delete("/mcp", (_req, res) => { res.status(405).set("Allow", "POST").send(); });

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", name: "socialcrawl-mcp", version: SERVER_VERSION });
});

app.listen(PORT, () => console.error(`SocialCrawl MCP (Streamable HTTP) on :${PORT}/mcp`));
```

2. **Anonymous-access policy (decided):** mirror stdio behavior — do **not** hard-401 keyless requests in Phase 1. The three discovery tools (`list_platforms`, `list_endpoints`, `get_docs`) work anonymously (great "try before you key" funnel, matches the current npm UX); the three keyed tools return the friendly error. In Phase 3 this changes for OAuth-capable clients only via the 401/WWW-Authenticate dance on a *dedicated check*, see Phase 3 step 1 note.
3. **Update the missing-key error message** in `client.ts` to be transport-aware. Since `client.ts` no longer knows the transport, make the message generic and complete:
   > `Error: No API key configured. Local (stdio): set SOCIALCRAWL_API_KEY in your MCP client's env config. Remote (HTTP): send 'Authorization: Bearer <key>' or 'x-api-key: <key>' header. Get a free key at socialcrawl.dev (100 credits, no credit card required).`
4. **DNS-rebinding protection:** in production behind TLS on a real domain the risk is minimal, but set it anyway when env `MCP_ALLOWED_HOSTS` is provided: pass `enableDnsRebindingProtection: true, allowedHosts: [...]` to the transport options. For local dev: `allowedHosts: ["127.0.0.1:3000", "localhost:3000"]`.
5. **package.json:** add scripts `"start:http": "node dist/http.js"`, `"dev:http": "tsx watch src/http.ts"`; add bin `"socialcrawl-mcp-http": "dist/http.js"`; keep `main`/existing bin untouched.
6. **Do NOT log API keys.** Request logging must redact `Authorization`/`x-api-key`. Log: method, path, tool name (from parsed body if cheap), status, latency, and a `sha256(key).slice(0,8)` key-fingerprint for per-user debugging.
7. **Version bump:** minor (`1.7.0`) — additive feature.

**Phase 1 verification:**
```bash
npm run build && npm run start:http

# 1) initialize handshake
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# 2) anonymous tools/list (expect all 6 tools)
# 3) anonymous tools/call socialcrawl_list_platforms (expect platform list)
# 4) anonymous tools/call socialcrawl_check_balance (expect friendly no-key error, NOT operator data)
# 5) keyed tools/call with -H "Authorization: Bearer sc_live_..." (expect real balance)
# 6) MCP Inspector: npx @modelcontextprotocol/inspector → Streamable HTTP → http://localhost:3000/mcp
# 7) Claude Code local:
claude mcp add --transport http socialcrawl-local http://localhost:3000/mcp \
  --header "Authorization: Bearer $SOCIALCRAWL_API_KEY"
```
Also add automated integration tests using the SDK's own `Client` + `StreamableHTTPClientTransport` against an in-process Express instance (supertest or an ephemeral port): handshake, tools/list, anonymous-vs-keyed behavior, oversized-response truncation, and the env-fallback security test.

### Phase 2 — Production deployment (`mcp.socialcrawl.dev`)

1. **Dockerfile** (multi-stage: `node:22-alpine`, `npm ci` → `npm run build` → runtime image with `dist/` + prod deps only; `CMD ["node", "dist/http.js"]`; `HEALTHCHECK` on `/healthz`; run as non-root user).
2. **Platform:** pick per §4.5 (Fly.io / Railway / Render / existing infra — Open Question 1). Requirements whichever is picked:
   - HTTPS with a valid cert on `mcp.socialcrawl.dev` (platform-managed TLS + DNS CNAME).
   - **No response buffering** on the proxy path and **idle timeout ≥ 120s** (tool calls can run up to our 30s upstream timeout; leave headroom; if a future change enables SSE-framed responses, buffering would break them).
   - ≥ 2 instances or platform autorestart; stateless mode makes replicas free.
3. **Env:** `PORT`, `SOCIALCRAWL_BASE_URL` (prod default fine), `MCP_ALLOWED_HOSTS=mcp.socialcrawl.dev`. **Do NOT set `SOCIALCRAWL_API_KEY` on the HTTP service at all** — defense in depth for the no-fallback invariant.
4. **Rate limiting / abuse:** the SocialCrawl API already enforces per-key limits (50 concurrent) and credit billing, so keyed traffic is self-limiting. Add a light IP-based limiter (e.g. `express-rate-limit`, ~60 req/min/IP) mainly to protect the **anonymous** discovery tools from scraping/DoS. Return `429` with `Retry-After`.
5. **Observability:** structured JSON logs (redacted per Phase 1 step 6); uptime check on `/healthz`; alert on 5xx rate. If the team uses Datadog (a `leads_datadog.json` exists in the main repo), wire the container logs in.
6. **CI/CD:** GitHub Actions in this repo — on tag: run tests → build → publish npm (existing flow) → build/push Docker image → deploy. One version, both artifacts.

**Phase 2 verification:** repeat all Phase 1 curl/Inspector/Claude Code checks against `https://mcp.socialcrawl.dev/mcp`; verify from a network that is NOT the office/home IP (public reachability); confirm TLS grade (ssllabs) and that `/healthz` monitoring alerts fire on an induced failure.

### Phase 3 — OAuth 2.1 (claude.ai web connectors + directory eligibility)

Goal: a user adds `https://mcp.socialcrawl.dev/mcp` in claude.ai → clicks Connect → browser opens `socialcrawl.dev` → logs in (or pastes an API key) → approves → Claude holds a token that maps to their SocialCrawl account. This is an **OAuth façade over the existing API-key system** — no change to the core API's auth.

Components:

1. **Protected Resource Metadata (RFC 9728)** on the MCP host:
   - `GET https://mcp.socialcrawl.dev/.well-known/oauth-protected-resource` →
     ```json
     {
       "resource": "https://mcp.socialcrawl.dev/mcp",
       "authorization_servers": ["https://www.socialcrawl.dev"],
       "bearer_methods_supported": ["header"],
       "scopes_supported": ["socialcrawl:read", "socialcrawl:monitors"]
     }
     ```
   - **401 behavior change (OAuth-capable clients only):** claude.ai discovers OAuth by probing and receiving `401` + `WWW-Authenticate: Bearer resource_metadata="https://mcp.socialcrawl.dev/.well-known/oauth-protected-resource"`. Decision: once Phase 3 ships, **`POST /mcp` without credentials returns 401 with that header** (this replaces the Phase 1 anonymous mode at the HTTP layer). Anonymous discovery UX is preserved for OAuth clients because after connecting they're authed anyway, and for header clients nothing changes. *(If keeping keyless curl access to discovery tools matters, the alternative is a hybrid: 401 only on `initialize` requests lacking credentials — but this is non-standard; default to the plain 401.)*
2. **Authorization Server** on `www.socialcrawl.dev` (the main Next.js app — it already owns login/sessions/dashboard):
   - `/.well-known/oauth-authorization-server` (RFC 8414) advertising: `authorization_endpoint`, `token_endpoint`, `registration_endpoint` (DCR), `code_challenge_methods_supported: ["S256"]`, `client_id_metadata_document_supported: true` (CIMD), `grant_types: ["authorization_code", "refresh_token"]`.
   - **Authorize endpoint** (`/oauth/authorize`): requires an active SocialCrawl session (reuse existing auth); shows a consent screen ("Claude wants to access your SocialCrawl account — scopes: …"); on approve, issues a short-lived code bound to `{ user, client_id, PKCE challenge, resource, scopes }`.
   - **Token endpoint** (`/oauth/token`): code + PKCE verifier → access token (+ refresh token). **Token format decision: opaque tokens stored in the existing DB** (`mcp_oauth_tokens` table: token-hash, user/API-key reference, client_id, resource, scopes, expiry) rather than JWTs — instantly revocable, no key-distribution problem, and the MCP host validates via one internal lookup call (add an internal endpoint or shared-DB access; internal validation must check **expiry + audience (`resource === "https://mcp.socialcrawl.dev/mcp"`, RFC 8707) + scopes**). Access-token TTL ~1h; refresh-token TTL ~90 days, rotating.
   - **DCR endpoint** (`/oauth/register`, RFC 7591): open registration, store `client_name`, `redirect_uris`; validate redirect URIs are HTTPS (or loopback for dev clients). Expect and allow `https://claude.ai/api/mcp/auth_callback` (and its `claude.com` successor).
   - **CIMD support**: if `client_id` is an HTTPS URL, fetch it (SSRF-guard: public IPs only, size/time caps), use the metadata document as the client registration.
   - Implementation note: check whether the auth library already used in `codebase/packages/auth` (e.g. better-auth) ships an OIDC-provider/MCP plugin before hand-rolling — several 2026 auth libraries do, and Anthropic's docs bless standard providers. Hand-rolling the four endpoints is also viable (they're small), but library-first.
3. **MCP host token validation:** extend `extractApiKey` → `resolveContext(req)`: Bearer values that look like SocialCrawl API keys (`sc_…` prefix) are used directly (Phase 1 path unchanged); other Bearer values are treated as OAuth access tokens and resolved to the linked account's API context. Cache validations ~60s in-memory to keep latency flat.
4. **Scope→tool mapping:** `socialcrawl:read` covers `request`/`check_balance`; `socialcrawl:monitors` additionally required for the `monitors` tool (it's the only destructive tool). Tools called without the needed scope return a clear error naming the missing scope.
5. **Security checklist for this phase:** PKCE S256 enforced (reject plain); exact-match redirect URIs; single-use short-lived codes (≤60s); refresh-token rotation with reuse detection; token audience validation; consent screen shows client name + scopes; revocation UI in the SocialCrawl dashboard ("Connected apps" — list + revoke).

**Phase 3 verification:** claude.ai → Settings → Connectors → Add custom connector → `https://mcp.socialcrawl.dev/mcp` → complete OAuth → run all six tools from a claude.ai chat (incl. a monitors create/delete round-trip); `claude mcp add --transport http socialcrawl https://mcp.socialcrawl.dev/mcp` **without** `--header`, then `/mcp` → authenticate in Claude Code (exercises the same OAuth path); revoke from dashboard → confirm Claude gets 401 and re-prompts.

### Phase 4 — Distribution & discoverability

1. **`server.json`:** add the `remotes` array (§3.7) alongside the existing `packages`; bump `version`; republish via `mcp-publisher`. **While in there: confirm `.mcpregistry_github_token` / `.mcpregistry_registry_token` are gitignored; rotate them if they were ever committed.**
2. **README.md** (drives npm + GitHub + most aggregators): add a "Remote server (no install)" section as the FIRST install option:
   - claude.ai: Settings → Connectors → `https://mcp.socialcrawl.dev/mcp` (Connect → OAuth)
   - Claude Code: `claude mcp add --transport http socialcrawl https://mcp.socialcrawl.dev/mcp --header "Authorization: Bearer YOUR_KEY"` (or header-less + OAuth after Phase 3)
   - `.mcp.json` snippet:
     ```json
     { "mcpServers": { "socialcrawl": { "type": "http", "url": "https://mcp.socialcrawl.dev/mcp",
       "headers": { "Authorization": "Bearer ${SOCIALCRAWL_API_KEY}" } } } }
     ```
   - Cursor / Windsurf / VS Code equivalents; keep the existing stdio instructions below it.
3. **Update in-server docs** (`src/data/docs.ts` authentication topic) and the **docs site** (`socialcrawl.dev/docs/mcp` in the main repo) with the remote option.
4. **Sync the ecosystem** (per the existing regen-pipeline conventions): the public skill (`socialcrawl-skills` — 3 synced copies + .skill zip) mentions MCP setup → update; Glama (`glama.json`) supports remote URLs → update; n8n catalog is unaffected (it's REST-based) but its README cross-references may mention MCP.
5. **Anthropic connectors directory submission** (after Phase 3 has soaked):
   - Requirements checklist (from https://claude.com/docs/connectors/building): OAuth ✅ (Phase 3), callback registered ✅, every tool has `title` + correct annotations ✅ (already true), public docs with setup steps **and ≥3 example prompts** (write these), **privacy policy at a stable URL** (confirm socialcrawl.dev has one), support contact, **test account with realistic data + credits for Anthropic reviewers** (provision one), branding assets (logo).
   - Known rejection causes to pre-empt: vague tool descriptions (ours are detailed ✅), oversized unfiltered responses (25k truncation ✅), missing annotations (✅).

### Phase 5 — Future-proofing (tracking item, no immediate work)

- **SDK v2 / spec 2026-07-28** (stateless protocol, `Mcp-Method` routing headers, package split into `@modelcontextprotocol/server` + `/express`): revisit ~Q4 2026 once v2 is stable. Because we chose stateless + factory-per-request, the migration should be confined to `src/http.ts` and `src/index.ts` (transport wiring), not the tool layer.
- Watch: list-response caching (`ttlMs`) — our discovery tools are perfect candidates; Tasks primitive for long-running Prism composites; deprecation timeline for `initialize` (old clients will need the compat behavior v2 SDKs provide).

---

## 6. Testing Plan (consolidated)

| Layer | What | How |
|---|---|---|
| Unit | ctx threading, no-env-fallback invariant, key extraction (Bearer/x-api-key/missing/malformed), error strings | vitest (refactor existing suites) |
| Integration | Full MCP handshake + tools/list + tools/call over HTTP | SDK `Client` + `StreamableHTTPClientTransport` against in-process app |
| Protocol | Spec conformance eyeball | MCP Inspector (`npx @modelcontextprotocol/inspector`) against local + prod |
| Client-matrix | Claude Code CLI (header + OAuth), Claude Code web (`.mcp.json` in a test repo), claude.ai connector (OAuth), Cursor | Manual checklist before each release |
| Security | Anonymous request cannot reach operator credits; keys never logged; OAuth: PKCE-plain rejected, wrong-audience token rejected, revoked token 401s | vitest + manual |
| Load (light) | 50 concurrent mixed anonymous/keyed POSTs; no cross-request key bleed (assert distinct balances for distinct keys under concurrency) | k6 or a simple script — **the cross-tenant bleed test is mandatory** |

---

## 7. Security Checklist (sign off before public announcement)

- [ ] HTTP service has NO `SOCIALCRAWL_API_KEY` in its environment (Phase 2.3)
- [ ] Anonymous request → keyed tool returns error, never operator data (tested)
- [ ] No API key or token appears in any log line (grep the log pipeline)
- [ ] No API keys accepted via query string (never implemented)
- [ ] TLS only; HSTS on `mcp.socialcrawl.dev`
- [ ] Origin/Host validation configured (`MCP_ALLOWED_HOSTS`)
- [ ] IP rate limit on anonymous traffic
- [ ] (Phase 3) PKCE S256 enforced; audience validated; codes single-use; refresh rotation; consent screen; dashboard revocation
- [ ] `.mcpregistry_*` tokens gitignored + rotated if ever committed
- [ ] Dependency audit (`npm audit`) clean at release

---

## 8. Acceptance Criteria (definition of done, per the original request)

1. `https://mcp.socialcrawl.dev/mcp` serves spec-compliant **Streamable HTTP** (spec rev 2025-11-25).
2. **Claude Code on the web** can use the server via a `.mcp.json` `{"type":"http"}` entry with a header key — verified in a real cloud session.
3. **claude.ai** can add the server as a **custom connector** and complete OAuth — all six tools callable from a chat (Phase 3).
4. Existing npm/stdio users are completely unaffected (same version stream, same behavior).
5. MCP Registry entry lists both the npm package and the remote (`remotes` + `packages`).
6. Security checklist (§7) fully checked.

---

## 9. Open Questions (decide before/while executing — recommendations included)

1. **Hosting platform** for the container (Fly.io vs Railway vs Render vs existing SocialCrawl infra). *Recommendation: whatever already hosts SocialCrawl production services, to reuse the team's ops muscle; otherwise Railway or Fly.io for fastest path.* Affects Phase 2 only.
2. **Firecrawl-style key-in-URL-path fallback** (`/mcp/{key}` for header-less non-OAuth clients)? *Recommendation: NO for launch — OAuth (Phase 3) covers header-less clients properly; path keys leak into logs/chat history. Revisit only on real user demand.*
3. **Legacy `/sse` endpoint** for pre-2025 clients? *Recommendation: NO — deprecated for over a year; no evidence of demand; every current Claude/ChatGPT/Cursor client speaks Streamable HTTP.*
4. **OAuth AS placement** — implement the four endpoints inside `codebase/apps/web` (recommended: reuses login/session/DB) vs a separate auth service. Check first whether `codebase/packages/auth`'s library ships an OAuth-provider/MCP plugin.
5. **Anonymous discovery after Phase 3** — plain 401-when-keyless (spec-standard; recommended) vs hybrid 401-on-initialize-only. See Phase 3 step 1.

---

## 10. References

- MCP spec (current, 2025-11-25) — transports: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP spec — authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP spec versioning: https://modelcontextprotocol.io/specification/versioning
- 2026-07-28 release candidate (stateless protocol): https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
- Anthropic — building connectors: https://claude.com/docs/connectors/building
- Anthropic — connector authentication (DCR/CIMD/pre-registered): https://claude.com/docs/connectors/building/authentication
- Anthropic — custom connectors help: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- Claude Code MCP docs (`--transport http`, `.mcp.json`, OAuth): https://code.claude.com/docs/en/mcp
- Claude Code on the web (connector traffic proxied): https://code.claude.com/docs/en/claude-code-on-the-web
- TypeScript SDK (v1.29.0, v2 beta): https://github.com/modelcontextprotocol/typescript-sdk
- MCP Registry `server.json` reference (`remotes`): https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/generic-server-json.md
- Reference peers: Apify (https://docs.apify.com/platform/integrations/mcp), Firecrawl OAuth guide (https://docs.firecrawl.dev/developer-guides/mcp-setup-guides/oauth)
