# Remote Streamable HTTP Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an industry-standard remote Streamable HTTP transport to `socialcrawl-mcp` so cloud AI clients (Claude Code web/cloud, Cursor, n8n, and later claude.ai connectors) can use the server at `https://mcp.socialcrawl.dev/mcp`, while keeping the existing stdio/npm experience byte-identical.

**Architecture:** One codebase, two entrypoints. All six tools move into a `createServer(ctx)` factory; the API key becomes per-request (`ApiContext` threaded explicitly — no more `process.env` reads in the tool layer). The stdio entry (`src/index.ts`) builds its context from env once, exactly as today. A new Express entry (`src/http.ts` / `src/app.ts`) builds a fresh server per POST in **stateless** Streamable HTTP mode (`sessionIdGenerator: undefined`, `enableJsonResponse: true`), extracting the key from `Authorization: Bearer` / `x-api-key` headers.

**Tech Stack:** TypeScript (strict, Node16 ESM — all relative imports need `.js` suffixes), `@modelcontextprotocol/sdk` v1.29.x, Express 5, express-rate-limit 8, zod 3, vitest 3, Docker (node:22-alpine).

**Spec:** `docs/specs/2026-07-02-remote-http-transport-upgrade.md` (in this repo). This plan implements spec Phases 0 and 1 fully, plus the repo-side artifacts of Phases 2 and 4 (Dockerfile, `server.json`, README, in-server docs). **Out of scope, by design:** spec Phase 3 (OAuth — lives in the main `codebase/` monorepo; write a separate plan when this ships) and the actual cloud deployment (ops checklist in the Appendix; blocked on the hosting-platform decision, spec Open Question 1).

## Global Constraints

- SDK: `@modelcontextprotocol/sdk` **v1.x only**, declared `^1.29.0`. Do NOT install any `@modelcontextprotocol/server` / v2-beta package.
- Transport: stateless Streamable HTTP — `sessionIdGenerator: undefined`, `enableJsonResponse: true`. `GET /mcp` and `DELETE /mcp` return `405`.
- **Security invariant:** the HTTP path must NEVER fall back to the process's own `SOCIALCRAWL_API_KEY` env var. Env reads for credentials are allowed ONLY in `src/context.ts` (`contextFromEnv`, used by the stdio entry) and nowhere else.
- API keys are never accepted via URL query strings, and never appear in logs (log a `sha256(key).slice(0, 8)` fingerprint instead).
- stdio behavior must remain byte-identical for existing npm users (same six tools, same descriptions, same error strings apart from the one reworded missing-key message defined in Task 2).
- Version bump: `1.6.0` → `1.7.0` in `package.json`, `src/constants.ts` (`SERVER_VERSION`), and `server.json` (both `version` fields).
- Module system is Node16 ESM: every relative import ends in `.js` (e.g. `import { buildApp } from "./app.js"`).
- Tests: vitest, config root is `src`, tests live in `src/__tests__/`. Run all: `npm test`. Run one file: `npx vitest run <name>.test` (substring filter).
- Commits: the plan includes per-task commit steps for autonomous execution. Note: the repo owner often prefers reviewing and committing in one batch at the end — if the session's user says so, skip the commit steps and leave the tree dirty.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/context.ts` | Create | `ApiContext` type, `DEFAULT_BASE_URL`, `contextFromEnv()` (stdio-only env reader) |
| `src/client.ts` | Modify | HTTP client to the SocialCrawl API; both functions gain a leading `ctx` param; env readers deleted |
| `src/tools/request.ts` | Modify | Gains leading `ctx` param, forwards to client |
| `src/tools/check-balance.ts` | Modify | Gains leading `ctx` param |
| `src/tools/monitors.ts` | Modify | Gains leading `ctx` param |
| `src/server.ts` | Create | `createServer(ctx)` factory — all six `registerTool` blocks (moved from `index.ts`) |
| `src/index.ts` | Modify | Shrinks to stdio bootstrap (env → ctx → factory → `StdioServerTransport`) |
| `src/auth.ts` | Create | `extractApiKey(headers)` — header parsing, no env access |
| `src/app.ts` | Create | `buildApp(config)` — Express app: CORS, rate limit, logging, `POST /mcp`, 405s, `/healthz` |
| `src/http.ts` | Create | HTTP bootstrap entry (`PORT`, `SOCIALCRAWL_BASE_URL`, `MCP_ALLOWED_HOSTS` env → `buildApp` → listen) |
| `src/data/docs.ts` | Modify | `authentication` topic documents both transports |
| `src/__tests__/context.test.ts` | Create | env → ctx behavior |
| `src/__tests__/auth.test.ts` | Create | header extraction incl. security invariant |
| `src/__tests__/server.test.ts` | Create | factory over `InMemoryTransport`: 6 tools, anonymous behavior |
| `src/__tests__/http.test.ts` | Create | end-to-end over real HTTP: SDK client ↔ Express app ↔ mock upstream |
| `src/__tests__/client.test.ts` | Modify | ctx fixtures instead of env mutation |
| `src/__tests__/truncation.test.ts` | Modify | same |
| `src/__tests__/preflight.test.ts` | Modify | same |
| `src/__tests__/check-balance.test.ts` | Modify | same |
| `src/__tests__/monitors.test.ts` | Modify | same |
| `Dockerfile`, `.dockerignore` | Create | container image for the HTTP entry |
| `package.json` | Modify | version, deps, scripts, second bin |
| `server.json` | Modify | add `remotes` array; bump versions |
| `README.md` | Modify | "Remote server" install section |
| `CHANGELOG.md` | Modify | 1.7.0 entry |

---

### Task 1: `ApiContext` module + dependency alignment

**Files:**
- Create: `src/context.ts`
- Test: `src/__tests__/context.test.ts`
- Modify: `package.json` (SDK range only — other changes come in Task 8)

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `interface ApiContext { apiKey: string; baseUrl: string }`, `const DEFAULT_BASE_URL = "https://www.socialcrawl.dev"`, `function contextFromEnv(): ApiContext`. Every later task imports these from `"../context.js"` / `"./context.js"`.

- [ ] **Step 1: Align the SDK version range**

In `package.json`, change the dependency line (v1.29.0 is already what's installed per the lockfile; this just makes the declared range honest):

```json
"@modelcontextprotocol/sdk": "^1.29.0",
```

Run: `npm install`
Expected: lockfile untouched or trivially updated; `npm ls @modelcontextprotocol/sdk` prints `@modelcontextprotocol/sdk@1.29.0`.

- [ ] **Step 2: Write the failing test**

Create `src/__tests__/context.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { contextFromEnv, DEFAULT_BASE_URL } from "../context.js";

describe("contextFromEnv (stdio entrypoint only)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SOCIALCRAWL_API_KEY;
    delete process.env.SOCIALCRAWL_BASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("defaults to empty key and the production base URL", () => {
    const ctx = contextFromEnv();
    expect(ctx.apiKey).toBe("");
    expect(ctx.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(DEFAULT_BASE_URL).toBe("https://www.socialcrawl.dev");
  });

  it("reads SOCIALCRAWL_API_KEY and SOCIALCRAWL_BASE_URL when set", () => {
    process.env.SOCIALCRAWL_API_KEY = "sc_env_key";
    process.env.SOCIALCRAWL_BASE_URL = "http://localhost:4000";
    const ctx = contextFromEnv();
    expect(ctx.apiKey).toBe("sc_env_key");
    expect(ctx.baseUrl).toBe("http://localhost:4000");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run context.test`
Expected: FAIL — `Cannot find module '../context.js'` (or equivalent resolve error).

- [ ] **Step 4: Write the implementation**

Create `src/context.ts`:

```ts
export const DEFAULT_BASE_URL = "https://www.socialcrawl.dev";

export interface ApiContext {
  /** Per-user SocialCrawl API key. Empty string = anonymous (discovery tools only). */
  apiKey: string;
  /** SocialCrawl API origin, no trailing slash. */
  baseUrl: string;
}

/**
 * Build the context for the stdio entrypoint from process env.
 * ONLY the stdio transport may use this — the HTTP transport builds its
 * context from request headers and must NEVER fall back to process env
 * (an anonymous HTTP caller must not inherit the operator's key).
 */
export function contextFromEnv(): ApiContext {
  return {
    apiKey: process.env.SOCIALCRAWL_API_KEY ?? "",
    baseUrl: process.env.SOCIALCRAWL_BASE_URL ?? DEFAULT_BASE_URL,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run context.test`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/context.ts src/__tests__/context.test.ts package.json package-lock.json
git commit -m "feat: add ApiContext module for per-request credentials"
```

---

### Task 2: Thread `ctx` through the API client

**Files:**
- Modify: `src/client.ts`
- Test: `src/__tests__/client.test.ts`, `src/__tests__/truncation.test.ts`
- Modify: `src/tools/request.ts:44`, `src/tools/check-balance.ts:8`, `src/tools/monitors.ts` (call-site signature only — full tool refactor is Task 3, but the build must stay green, see Step 4)

**Interfaces:**
- Consumes: `ApiContext` from Task 1.
- Produces:
  - `makeRequest(ctx: ApiContext, options: RequestOptions): Promise<string>` — `RequestOptions` unchanged: `{ platform: string; resource: string; params?: Record<string, string>; idempotencyKey?: string }`
  - `apiRequest(ctx: ApiContext, options: ApiRequestOptions): Promise<string>` — `ApiRequestOptions` unchanged: `{ method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; query?: Record<string, string>; body?: unknown }`
  - `export const NO_API_KEY_ERROR: string` (the exact reworded message below)

- [ ] **Step 1: Rewrite the client tests to the new signature**

In `src/__tests__/client.test.ts`, make these mechanical changes:

1. Add import: `import type { ApiContext } from "../context.js";`
2. Replace the env fixture block (lines 5–14: `const originalEnv…afterEach…})`) with:

```ts
const ctx: ApiContext = { apiKey: "sc_test_key", baseUrl: "https://www.socialcrawl.dev" };
const anonCtx: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };

afterEach(() => {
  vi.restoreAllMocks();
});
```

(Drop `beforeEach` and the `originalEnv` variable entirely; remove `beforeEach` from the vitest import.)

3. Every call `makeRequest({ ... })` becomes `makeRequest(ctx, { ... })` — EXCEPT the two no-key tests, which become:

```ts
it("returns the no-key error for an anonymous context", async () => {
  const result = await makeRequest(anonCtx, { platform: "tiktok", resource: "profile", params: { handle: "test" } });
  expect(result).toContain("No API key configured");
  expect(result).toContain("SOCIALCRAWL_API_KEY");   // stdio guidance still present
  expect(result).toContain("Authorization: Bearer"); // HTTP guidance now present
});
```

(Replace both "returns error when API key is empty" and "returns error when API key is not set" with this single test — with explicit ctx there is no set/unset distinction anymore.)

4. Add one new test at the end of the describe block — baseUrl comes from ctx:

```ts
it("uses ctx.baseUrl as the request origin", async () => {
  let capturedUrl = "";
  vi.stubGlobal("fetch", async (url: string) => {
    capturedUrl = url;
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
  });

  await makeRequest(
    { apiKey: "sc_test_key", baseUrl: "http://localhost:9999" },
    { platform: "tiktok", resource: "profile", params: { handle: "test" } },
  );
  expect(capturedUrl.startsWith("http://localhost:9999/v1/tiktok/profile")).toBe(true);
});
```

In `src/__tests__/truncation.test.ts`, same mechanical change: import `ApiContext`, replace the env fixture with the `ctx` constant + bare `afterEach(vi.restoreAllMocks)`, and change all three calls to `makeRequest(ctx, { ... })`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run client.test truncation.test`
Expected: FAIL — TypeScript/argument errors ("Expected 1 arguments, but got 2" surfaces as runtime signature mismatch: the options object lands in the `ctx` slot and requests error).

- [ ] **Step 3: Refactor `src/client.ts`**

1. Replace lines 1–9 (the import + the two env getters) with:

```ts
import { TIMEOUT_MS, CHARACTER_LIMIT } from "./constants.js";
import type { ApiContext } from "./context.js";

export const NO_API_KEY_ERROR =
  "Error: No API key configured. Local (stdio): set SOCIALCRAWL_API_KEY in your MCP client's env config. " +
  "Remote (HTTP): send an 'Authorization: Bearer <key>' or 'x-api-key: <key>' header. " +
  "Get a free key at socialcrawl.dev (100 credits, no credit card required).";
```

2. `makeRequest` becomes:

```ts
export async function makeRequest(ctx: ApiContext, options: RequestOptions): Promise<string> {
  if (!ctx.apiKey) {
    return NO_API_KEY_ERROR;
  }

  const url = buildUrl(ctx, options);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers: Record<string, string> = { "x-api-key": ctx.apiKey };
```

…rest of the function body unchanged, except the two `getBaseUrl()` calls in catch-block error messages become `ctx.baseUrl`.

3. `apiRequest` becomes `export async function apiRequest(ctx: ApiContext, options: ApiRequestOptions): Promise<string>` with the same three substitutions: the key check returns `NO_API_KEY_ERROR`; `let url = \`${ctx.baseUrl}${options.path}\`;`; headers use `ctx.apiKey`; the network-error message uses `ctx.baseUrl`.

4. `buildUrl` becomes:

```ts
function buildUrl(ctx: ApiContext, options: RequestOptions): string {
  const path =
    options.platform === "meta"
      ? `/v1/${options.resource}`
      : `/v1/${options.platform}/${options.resource}`;
  const base = `${ctx.baseUrl}${path}`;
  if (!options.params || Object.keys(options.params).length === 0) {
    return base;
  }
  const searchParams = new URLSearchParams(options.params);
  return `${base}?${searchParams.toString()}`;
}
```

Nothing else in the file changes (`formatHttpError`, `truncateResponse` stay as-is).

- [ ] **Step 4: Patch the three tool call sites so the repo still compiles**

The tools are fully refactored in Task 3; for now make the minimum edit so `tsc` stays green. In each file add `import { contextFromEnv } from "../context.js";` and pass a context at the call site:

- `src/tools/request.ts:44` → `const response = await makeRequest(contextFromEnv(), {`
- `src/tools/check-balance.ts:8` → `const response = await makeRequest(contextFromEnv(), { platform: "meta", resource: "credits/balance" });`
- `src/tools/monitors.ts` → all five `apiRequest({` call sites become `apiRequest(contextFromEnv(), {`

(This temporarily preserves today's env-based behavior for the tools — removed in Task 3.)

- [ ] **Step 5: Run the full suite**

Run: `npm run build && npm test`
Expected: build clean; `client.test` and `truncation.test` PASS. `preflight`/`check-balance`/`monitors` tests still PASS (they still work via the env bridge from Step 4).

- [ ] **Step 6: Commit**

```bash
git add src/client.ts src/tools src/__tests__/client.test.ts src/__tests__/truncation.test.ts
git commit -m "refactor: thread ApiContext through the API client"
```

---

### Task 3: Thread `ctx` through the keyed tools

**Files:**
- Modify: `src/tools/request.ts`, `src/tools/check-balance.ts`, `src/tools/monitors.ts`, `src/index.ts`
- Test: `src/__tests__/preflight.test.ts`, `src/__tests__/check-balance.test.ts`, `src/__tests__/monitors.test.ts`

**Interfaces:**
- Consumes: `ApiContext`, `makeRequest(ctx, options)`, `apiRequest(ctx, options)` from Tasks 1–2.
- Produces (Task 4 registers these):
  - `request(ctx: ApiContext, input: RequestParams): Promise<string>` — `RequestParams` unchanged
  - `checkBalance(ctx: ApiContext): Promise<string>`
  - `monitors(ctx: ApiContext, input: MonitorsParams): Promise<string>` — `MonitorsParams` unchanged
  - `listPlatforms()`, `listEndpoints(platform)`, `getDocs(topic)` stay ctx-free (no API calls).

- [ ] **Step 1: Rewrite the tool tests to the new signatures**

Common fixture for all three files (replace each file's `originalEnv`/`beforeEach`/`afterEach` env block):

```ts
import type { ApiContext } from "../context.js";

const ctx: ApiContext = { apiKey: "sc_test_key", baseUrl: "https://www.socialcrawl.dev" };
const anonCtx: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };

afterEach(() => {
  vi.restoreAllMocks();
});
```

Then, mechanically:

- `src/__tests__/preflight.test.ts` — every `request({ ... })` → `request(anonCtx, { ... })` in the "Pre-flight validation" describe (those tests intentionally hit the no-key stage or fail before it), and `request(ctx, { ... })` in the "idempotency forwarding" describe. The two assertions `expect(result).toContain("No API key configured")` stay valid.
- `src/__tests__/check-balance.test.ts` — every `checkBalance()` → `checkBalance(ctx)`. The test `"returns the No-API-key error when SOCIALCRAWL_API_KEY is missing"` becomes:

```ts
it("returns the No-API-key error for an anonymous context", async () => {
  const result = await checkBalance(anonCtx);
  expect(result).toContain("No API key configured");
});
```

- `src/__tests__/monitors.test.ts` — every `monitors({ ... })` → `monitors(ctx, { ... })`; the `"requires an API key"` test becomes `await monitors(anonCtx, { action: "list" })` with the same assertion.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run preflight.test check-balance.test monitors.test`
Expected: FAIL — argument-shape mismatches (input object read as ctx).

- [ ] **Step 3: Refactor the three tools**

- `src/tools/request.ts`: add `import type { ApiContext } from "../context.js";`, remove the `contextFromEnv` import from Task 2, and change the signature + client call:

```ts
export async function request(ctx: ApiContext, input: RequestParams): Promise<string> {
```

```ts
  const response = await makeRequest(ctx, {
    platform: input.platform,
    resource: input.resource,
    params: input.params,
    idempotencyKey: input.idempotencyKey,
  });
```

- `src/tools/check-balance.ts`:

```ts
import { makeRequest } from "../client.js";
import type { ApiContext } from "../context.js";

export async function checkBalance(ctx: ApiContext): Promise<string> {
  const response = await makeRequest(ctx, { platform: "meta", resource: "credits/balance" });
```

- `src/tools/monitors.ts`: add the `ApiContext` type import, remove `contextFromEnv`, change the signature to `export async function monitors(ctx: ApiContext, input: MonitorsParams): Promise<string>`, and all five `apiRequest(contextFromEnv(), {` call sites → `apiRequest(ctx, {`.

- [ ] **Step 4: Patch `src/index.ts` call sites (minimal, still green)**

At the top of `src/index.ts` add:

```ts
import { contextFromEnv } from "./context.js";

const ctx = contextFromEnv();
```

and update the three keyed handlers: `await request(ctx, { ... })`, `await checkBalance(ctx)`, `await monitors(ctx, params as MonitorsParams)`. (Full restructure lands in Task 4.)

- [ ] **Step 5: Run the full suite and verify no stray env reads**

Run: `npm run build && npm test`
Expected: all suites PASS.

Run: `npx rg -n "process\.env\.SOCIALCRAWL" src --glob "!__tests__/**"`
Expected: matches ONLY in `src/context.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/tools src/index.ts src/__tests__/preflight.test.ts src/__tests__/check-balance.test.ts src/__tests__/monitors.test.ts
git commit -m "refactor: thread ApiContext through keyed tools"
```

---

### Task 4: `createServer(ctx)` factory + stdio bootstrap

**Files:**
- Create: `src/server.ts`
- Modify: `src/index.ts` (shrinks to ~15 lines)
- Test: `src/__tests__/server.test.ts`

**Interfaces:**
- Consumes: all six tool functions (Task 3 signatures), the six input schemas from `src/schemas/tools.ts` (unchanged), `SERVER_NAME`/`SERVER_VERSION` from `src/constants.ts`.
- Produces: `createServer(ctx: ApiContext): McpServer` from `"./server.js"` — the ONLY way a transport obtains a server. Both `src/index.ts` (Task 4) and `src/app.ts` (Task 6) call it.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/server.test.ts` (uses the SDK's in-memory transport — no network, no process env):

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import type { ApiContext } from "../context.js";

async function connect(ctx: ApiContext): Promise<Client> {
  const server = createServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function firstText(result: { content?: unknown }): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
}

describe("createServer factory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers all six tools", async () => {
    const client = await connect({ apiKey: "", baseUrl: "https://www.socialcrawl.dev" });
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "socialcrawl_check_balance",
      "socialcrawl_get_docs",
      "socialcrawl_list_endpoints",
      "socialcrawl_list_platforms",
      "socialcrawl_monitors",
      "socialcrawl_request",
    ]);
    await client.close();
  });

  it("serves discovery tools anonymously", async () => {
    const client = await connect({ apiKey: "", baseUrl: "https://www.socialcrawl.dev" });
    const result = await client.callTool({ name: "socialcrawl_list_platforms", arguments: {} });
    expect(firstText(result)).toContain("tiktok");
    await client.close();
  });

  it("returns the friendly no-key error from keyed tools when anonymous", async () => {
    const client = await connect({ apiKey: "", baseUrl: "https://www.socialcrawl.dev" });
    const result = await client.callTool({ name: "socialcrawl_check_balance", arguments: {} });
    expect(firstText(result)).toContain("No API key configured");
    await client.close();
  });

  it("uses the per-context key for keyed tools", async () => {
    let capturedKey = "";
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedKey = (init.headers as Record<string, string>)["x-api-key"];
      return new Response(JSON.stringify({ success: true, data: { balance: 5 } }), { status: 200 });
    });
    const client = await connect({ apiKey: "sc_ctx_key", baseUrl: "https://www.socialcrawl.dev" });
    const result = await client.callTool({ name: "socialcrawl_check_balance", arguments: {} });
    expect(capturedKey).toBe("sc_ctx_key");
    expect(firstText(result)).toContain("5");
    await client.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server.test`
Expected: FAIL — `Cannot find module '../server.js'`.

- [ ] **Step 3: Create `src/server.ts`**

Move ALL six `registerTool` blocks from `src/index.ts` into the factory. Full content:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import type { ApiContext } from "./context.js";
import {
  ListPlatformsInputSchema,
  ListEndpointsInputSchema,
  RequestInputSchema,
  CheckBalanceInputSchema,
  MonitorsInputSchema,
  GetDocsInputSchema,
} from "./schemas/tools.js";
import { listPlatforms } from "./tools/list-platforms.js";
import { listEndpoints } from "./tools/list-endpoints.js";
import { request } from "./tools/request.js";
import { checkBalance } from "./tools/check-balance.js";
import { monitors } from "./tools/monitors.js";
import { getDocs } from "./tools/get-docs.js";
import type { MonitorsParams } from "./tools/monitors.js";
import { PLATFORMS } from "./data/platforms.js";
import { ENDPOINTS } from "./data/endpoints.js";

/**
 * Build a fully-wired McpServer bound to one caller's credentials.
 * stdio calls this once per process; the HTTP transport calls it once per
 * request (stateless mode), so construction must stay I/O-free and cheap.
 */
export function createServer(ctx: ApiContext): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    "socialcrawl_list_platforms",
    {
      title: "List SocialCrawl Platforms",
      description: `List all ${PLATFORMS.length} platforms available through SocialCrawl (${ENDPOINTS.length} endpoints — social media, commerce & reviews, app stores, places & travel, business reputation, web research, prediction markets, Naver, content analysis, universal meta-search). Returns platform names, endpoint counts, and descriptions. No API key required.`,
      inputSchema: ListPlatformsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const output = listPlatforms();
      return { content: [{ type: "text", text: output }] };
    },
  );

  server.registerTool(
    "socialcrawl_list_endpoints",
    {
      title: "List Endpoints for a Platform",
      description:
        "List all available endpoints for a specific platform with required + optional parameters, per-endpoint credit costs (pricing), and response types. No API key required.",
      inputSchema: ListEndpointsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const output = listEndpoints(params.platform);
      return { content: [{ type: "text", text: output }] };
    },
  );

  server.registerTool(
    "socialcrawl_request",
    {
      title: "Make a SocialCrawl API Request",
      description: `Make an API request to any SocialCrawl endpoint. Fetches real-time data (profiles, posts, comments, search results, products, reviews, apps, places, analytics) from ${PLATFORMS.length} platforms. Requires a valid SOCIALCRAWL_API_KEY. Validates platform, resource, and parameters before making the call to avoid wasting credits. Pass an optional idempotencyKey to make the request retry-safe (replays return the original response and deduct 0 credits).`,
      inputSchema: RequestInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const output = await request(ctx, {
        platform: params.platform,
        resource: params.resource,
        params: params.params,
        idempotencyKey: params.idempotencyKey,
      });
      return { content: [{ type: "text", text: output }] };
    },
  );

  server.registerTool(
    "socialcrawl_check_balance",
    {
      title: "Check SocialCrawl Credit Balance",
      description:
        "Check the remaining credit balance and recent deductions for the authenticated SocialCrawl account. Calls the meta endpoint GET /v1/credits/balance — costs 0 credits. Requires a valid SOCIALCRAWL_API_KEY.",
      inputSchema: CheckBalanceInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const output = await checkBalance(ctx);
      return { content: [{ type: "text", text: output }] };
    },
  );

  server.registerTool(
    "socialcrawl_monitors",
    {
      title: "Manage SocialCrawl Monitors",
      description:
        "Create and manage stateful monitors that re-run any SocialCrawl recipe (a registry endpoint or a Prism composite) on a cadence (hourly/daily/weekly/cron), deliver each result to a signed webhook, raise alerts on metric thresholds/changes, and accumulate a per-run time-series. 'Prism answers once; monitors watch it for you.' Actions: create, list, get, runs, timeseries, pause, resume, delete. Managing monitors costs 0 credits; each scheduled run bills the underlying recipe's normal cost plus a 1-credit scheduling premium. Requires a valid SOCIALCRAWL_API_KEY.",
      inputSchema: MonitorsInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      const output = await monitors(ctx, params as MonitorsParams);
      return { content: [{ type: "text", text: output }] };
    },
  );

  server.registerTool(
    "socialcrawl_get_docs",
    {
      title: "Get SocialCrawl Documentation",
      description:
        "Retrieve SocialCrawl API documentation. Topics: 'overview' (compact intro), 'full' (comprehensive reference), 'authentication', 'credits', 'errors', 'idempotency', 'monitors' (scheduled-recipe wrapper), 'pricing' (per-endpoint cost for every endpoint), or any platform slug (e.g., 'tiktok') for platform-specific docs. No API key required.",
      inputSchema: GetDocsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const output = getDocs(params.topic ?? "overview");
      return { content: [{ type: "text", text: output }] };
    },
  );

  return server;
}
```

(The tool metadata strings above are copied verbatim from today's `src/index.ts` — do not reword them.)

- [ ] **Step 4: Shrink `src/index.ts` to the stdio bootstrap**

Replace the entire file with:

```ts
#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { contextFromEnv } from "./context.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer(contextFromEnv());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error("Fatal error starting SocialCrawl MCP server:", error);
  process.exit(1);
});
```

- [ ] **Step 5: Run all tests + stdio smoke test**

Run: `npm run build && npm test`
Expected: all suites PASS (server.test: 4 tests).

Manual stdio smoke (proves npm users are unaffected):

```powershell
$env:SOCIALCRAWL_API_KEY = "sc_anything"
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' | node dist/index.js
```

Expected: a single JSON-RPC `InitializeResult` on stdout naming `socialcrawl-mcp`.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/index.ts src/__tests__/server.test.ts
git commit -m "refactor: extract createServer(ctx) factory; index.ts is stdio bootstrap only"
```

---

### Task 5: Header key extraction (`src/auth.ts`)

**Files:**
- Create: `src/auth.ts`
- Test: `src/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: nothing project-internal (only `node:http` types).
- Produces: `extractApiKey(headers: IncomingHttpHeaders): string` from `"./auth.js"` — returns `""` for anonymous. Task 6 (app) and Task 7 (rate-limit skip) consume it.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/auth.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extractApiKey } from "../auth.js";

describe("extractApiKey", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Poison the env to prove the extractor never reads it.
    process.env = { ...originalEnv, SOCIALCRAWL_API_KEY: "sc_operator_secret" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("reads Authorization: Bearer", () => {
    expect(extractApiKey({ authorization: "Bearer sc_abc123" })).toBe("sc_abc123");
  });

  it("is case-insensitive on the Bearer scheme and trims whitespace", () => {
    expect(extractApiKey({ authorization: "bearer   sc_abc123  " })).toBe("sc_abc123");
  });

  it("reads x-api-key", () => {
    expect(extractApiKey({ "x-api-key": "sc_xyz789" })).toBe("sc_xyz789");
  });

  it("prefers Authorization over x-api-key when both are present", () => {
    expect(extractApiKey({ authorization: "Bearer sc_a", "x-api-key": "sc_b" })).toBe("sc_a");
  });

  it("ignores non-Bearer Authorization schemes", () => {
    expect(extractApiKey({ authorization: "Basic dXNlcjpwYXNz" })).toBe("");
  });

  it("ignores a repeated x-api-key header (array form)", () => {
    expect(extractApiKey({ "x-api-key": ["sc_a", "sc_b"] as unknown as string })).toBe("");
  });

  it("SECURITY: returns empty string — never the process env key — when no headers are sent", () => {
    expect(extractApiKey({})).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run auth.test`
Expected: FAIL — `Cannot find module '../auth.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/auth.ts`:

```ts
import type { IncomingHttpHeaders } from "node:http";

/**
 * Extract the caller's SocialCrawl API key from HTTP request headers.
 * Accepts `Authorization: Bearer <key>` (preferred) or `x-api-key: <key>`.
 * SECURITY INVARIANT: never reads process.env — an HTTP caller that sends
 * no credentials must get an anonymous context, not the operator's key.
 */
export function extractApiKey(headers: IncomingHttpHeaders): string {
  const auth = headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const xKey = headers["x-api-key"];
  if (typeof xKey === "string") {
    return xKey.trim();
  }
  return "";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run auth.test`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts src/__tests__/auth.test.ts
git commit -m "feat: extract per-request API key from Authorization/x-api-key headers"
```

---

### Task 6: Express app with stateless Streamable HTTP (`src/app.ts`)

**Files:**
- Create: `src/app.ts`
- Test: `src/__tests__/http.test.ts`
- Modify: `package.json` (add express deps)

**Interfaces:**
- Consumes: `createServer(ctx)` (Task 4), `extractApiKey(headers)` (Task 5), `SERVER_NAME`/`SERVER_VERSION`.
- Produces: `buildApp(config: AppConfig): express.Express` from `"./app.js"` where `interface AppConfig { baseUrl: string; allowedHosts?: string[]; rateLimit?: { windowMs: number; limit: number } }` (the `rateLimit` field is wired in Task 7 but declared now so the type is stable). Task 7 modifies this file; Task 8's `http.ts` consumes it.

- [ ] **Step 1: Install Express**

```bash
npm install express@^5.1.0
npm install -D @types/express@^5.0.0
```

Expected: both appear in `package.json`; `npm ls express` resolves cleanly.

- [ ] **Step 2: Write the failing integration test**

Create `src/__tests__/http.test.ts`. It runs the real Express app on an ephemeral port, points `baseUrl` at a local **mock upstream** (so we never stub global `fetch` — the MCP client itself uses fetch), and talks to it with the SDK's real Streamable HTTP client:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildApp } from "../app.js";

interface UpstreamHit {
  path: string;
  apiKey: string | undefined;
}

let upstream: Server;
let hits: UpstreamHit[] = [];
let appServer: Server;
let origin: string;
let mcpUrl: string;

beforeAll(async () => {
  upstream = createHttpServer((req, res) => {
    hits.push({ path: req.url ?? "", apiKey: req.headers["x-api-key"] as string | undefined });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, data: { balance: 777 }, credits_used: 0, credits_remaining: 777 }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, resolve));
  const upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

  const app = buildApp({ baseUrl: upstreamUrl });
  appServer = app.listen(0);
  await new Promise<void>((resolve) => appServer.once("listening", resolve));
  origin = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
  mcpUrl = `${origin}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => appServer.close(() => resolve()));
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

beforeEach(() => {
  hits = [];
});

async function connect(headers?: Record<string, string>): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL(mcpUrl),
    headers ? { requestInit: { headers } } : undefined,
  );
  const client = new Client({ name: "http-test-client", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

function firstText(result: { content?: unknown }): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
}

describe("Streamable HTTP endpoint", () => {
  it("completes the MCP handshake and lists all six tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(6);
    await client.close();
  });

  it("serves discovery tools anonymously", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "socialcrawl_list_platforms", arguments: {} });
    expect(firstText(result)).toContain("tiktok");
    await client.close();
  });

  it("keyed tool errors for anonymous callers and never contacts the upstream", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "socialcrawl_check_balance", arguments: {} });
    expect(firstText(result)).toContain("No API key configured");
    expect(hits).toHaveLength(0);
    await client.close();
  });

  it("forwards the Authorization: Bearer key to the SocialCrawl API", async () => {
    const client = await connect({ Authorization: "Bearer sc_int_bearer" });
    const result = await client.callTool({ name: "socialcrawl_check_balance", arguments: {} });
    expect(hits.some((h) => h.apiKey === "sc_int_bearer" && h.path.includes("/v1/credits/balance"))).toBe(true);
    expect(firstText(result)).toContain("777");
    await client.close();
  });

  it("accepts x-api-key as an alternative header", async () => {
    const client = await connect({ "x-api-key": "sc_int_xkey" });
    await client.callTool({ name: "socialcrawl_check_balance", arguments: {} });
    expect(hits.some((h) => h.apiKey === "sc_int_xkey")).toBe(true);
    await client.close();
  });

  it("SECURITY: an anonymous caller never inherits the operator's env key", async () => {
    process.env.SOCIALCRAWL_API_KEY = "sc_operator_secret";
    try {
      const client = await connect();
      const result = await client.callTool({ name: "socialcrawl_check_balance", arguments: {} });
      expect(firstText(result)).toContain("No API key configured");
      expect(hits.some((h) => h.apiKey === "sc_operator_secret")).toBe(false);
      await client.close();
    } finally {
      delete process.env.SOCIALCRAWL_API_KEY;
    }
  });

  it("SECURITY: concurrent callers with different keys never bleed into each other", async () => {
    const clientA = await connect({ Authorization: "Bearer sc_tenant_a" });
    const clientB = await connect({ Authorization: "Bearer sc_tenant_b" });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        (i % 2 === 0 ? clientA : clientB).callTool({ name: "socialcrawl_check_balance", arguments: {} }),
      ),
    );
    const keys = hits.map((h) => h.apiKey);
    expect(keys.filter((k) => k === "sc_tenant_a")).toHaveLength(5);
    expect(keys.filter((k) => k === "sc_tenant_b")).toHaveLength(5);
    expect(keys.every((k) => k === "sc_tenant_a" || k === "sc_tenant_b")).toBe(true);
    await clientA.close();
    await clientB.close();
  });

  it("returns 405 for GET and DELETE on /mcp (stateless mode)", async () => {
    const getRes = await fetch(mcpUrl, { method: "GET" });
    expect(getRes.status).toBe(405);
    const delRes = await fetch(mcpUrl, { method: "DELETE" });
    expect(delRes.status).toBe(405);
  });

  it("answers CORS preflight", async () => {
    const res = await fetch(mcpUrl, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toContain("x-api-key");
  });

  it("serves /healthz", async () => {
    const res = await fetch(`${origin}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; name: string };
    expect(body.status).toBe("ok");
    expect(body.name).toBe("socialcrawl-mcp");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run http.test`
Expected: FAIL — `Cannot find module '../app.js'`.

- [ ] **Step 4: Write the implementation**

Create `src/app.ts`:

```ts
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { extractApiKey } from "./auth.js";
import { createServer } from "./server.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";

export interface AppConfig {
  /** SocialCrawl API origin the tools call, no trailing slash. */
  baseUrl: string;
  /** When set, enables the SDK's DNS-rebinding protection for these Host values. */
  allowedHosts?: string[];
  /** Wired in the rate-limiting task; declared here so the type is stable. */
  rateLimit?: { windowMs: number; limit: number };
}

export function buildApp(config: AppConfig): express.Express {
  const app = express();
  // Exactly one proxy hop (the platform load balancer) in production; harmless locally.
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));

  // CORS — required for browser-based MCP clients (incl. MCP Inspector).
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, x-api-key, mcp-protocol-version, mcp-session-id",
    );
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id, WWW-Authenticate");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.post("/mcp", async (req, res) => {
    // Stateless: fresh server + transport per request, key bound via closure.
    const ctx = { apiKey: extractApiKey(req.headers), baseUrl: config.baseUrl };
    const server = createServer(ctx);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      ...(config.allowedHosts
        ? { enableDnsRebindingProtection: true, allowedHosts: config.allowedHosts }
        : {}),
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
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

  app.get("/mcp", (_req, res) => {
    res.status(405).set("Allow", "POST").send();
  });
  app.delete("/mcp", (_req, res) => {
    res.status(405).set("Allow", "POST").send();
  });

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", name: SERVER_NAME, version: SERVER_VERSION });
  });

  return app;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && npx vitest run http.test`
Expected: build clean; all 10 tests PASS. Then `npm test` — everything else still green.

- [ ] **Step 6: Commit**

```bash
git add src/app.ts src/__tests__/http.test.ts package.json package-lock.json
git commit -m "feat: stateless Streamable HTTP endpoint with header auth"
```

---

### Task 7: Rate limiting + redacted request logging

**Files:**
- Modify: `src/app.ts`
- Test: `src/__tests__/http.test.ts` (append two describe blocks)
- Modify: `package.json` (add express-rate-limit)

**Interfaces:**
- Consumes: `buildApp(config)` from Task 6 — activates the already-declared `config.rateLimit` field (`{ windowMs: number; limit: number }`, default `{ windowMs: 60_000, limit: 60 }`).
- Produces: no new exports. Behavior: keyed requests bypass the limiter; every request logs one JSON line to stderr containing a key **fingerprint**, never the key.

- [ ] **Step 1: Install the limiter**

```bash
npm install express-rate-limit@^8.0.0
```

- [ ] **Step 2: Write the failing tests**

Append to `src/__tests__/http.test.ts` (top-level, after the existing describe):

```ts
describe("rate limiting", () => {
  it("throttles anonymous requests after the configured limit, keyed requests bypass", async () => {
    const upstream2 = createHttpServer((_req, res) => {
      res.end(JSON.stringify({ success: true, data: {} }));
    });
    await new Promise<void>((resolve) => upstream2.listen(0, resolve));
    const app = buildApp({
      baseUrl: `http://127.0.0.1:${(upstream2.address() as AddressInfo).port}`,
      rateLimit: { windowMs: 60_000, limit: 3 },
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;

    const initBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    const post = (headers: Record<string, string> = {}) =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...headers,
        },
        body: initBody,
      });

    const anon = [await post(), await post(), await post(), await post()];
    expect(anon[0].status).toBe(200);
    expect(anon[3].status).toBe(429);

    // Keyed requests skip the limiter even after the anonymous budget is spent.
    const keyed = await post({ "x-api-key": "sc_limit_bypass" });
    expect(keyed.status).toBe(200);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => upstream2.close(() => resolve()));
  });
});

describe("request logging", () => {
  it("logs a fingerprint, never the raw key", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const client = await connect({ Authorization: "Bearer sc_super_secret_key" });
      await client.callTool({ name: "socialcrawl_list_platforms", arguments: {} });
      await client.close();
      const logged = errSpy.mock.calls.map((args) => args.join(" ")).join("\n");
      expect(logged).toContain('"keyFp"');
      expect(logged).not.toContain("sc_super_secret_key");
    } finally {
      errSpy.mockRestore();
    }
  });
});
```

Also add `vi` to the vitest import at the top of the file: `import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";`

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run http.test`
Expected: the two new tests FAIL (no 429; no `"keyFp"` in logs). The Task 6 tests still PASS.

- [ ] **Step 4: Implement in `src/app.ts`**

Add imports at the top:

```ts
import { rateLimit } from "express-rate-limit";
import { createHash } from "node:crypto";
```

Insert AFTER the CORS middleware and BEFORE `app.post("/mcp", ...)`:

```ts
  // Light IP limiter — protects the anonymous discovery tools. Keyed traffic is
  // already limited upstream (per-key concurrency + credit billing), so it skips.
  const limits = config.rateLimit ?? { windowMs: 60_000, limit: 60 };
  app.use(
    "/mcp",
    rateLimit({
      windowMs: limits.windowMs,
      limit: limits.limit,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => extractApiKey(req.headers) !== "",
    }),
  );

  // One JSON log line per request on stderr. Never log key material — only a fingerprint.
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      const key = extractApiKey(req.headers);
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          method: req.method,
          path: req.path,
          rpc: (req.body as { method?: string } | undefined)?.method ?? null,
          status: res.statusCode,
          ms: Date.now() - startedAt,
          keyFp: key ? createHash("sha256").update(key).digest("hex").slice(0, 8) : null,
        }),
      );
    });
    next();
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && npm test`
Expected: everything PASS, including both new describe blocks.

- [ ] **Step 6: Commit**

```bash
git add src/app.ts src/__tests__/http.test.ts package.json package-lock.json
git commit -m "feat: anonymous-traffic rate limit and redacted request logging"
```

---

### Task 8: HTTP entrypoint, package wiring, version bump

**Files:**
- Create: `src/http.ts`
- Modify: `package.json`, `src/constants.ts`
- Test: manual curl smoke (no unit test — the file is glue over tested parts)

**Interfaces:**
- Consumes: `buildApp` (Tasks 6–7), `DEFAULT_BASE_URL` (Task 1).
- Produces: runnable entry `dist/http.js`; npm scripts `start:http` / `dev:http`; bin `socialcrawl-mcp-http`. Env contract: `PORT` (default 3000), `SOCIALCRAWL_BASE_URL` (default production), `MCP_ALLOWED_HOSTS` (comma-separated, optional).

- [ ] **Step 1: Create `src/http.ts`**

```ts
#!/usr/bin/env node

import { buildApp } from "./app.js";
import { DEFAULT_BASE_URL } from "./context.js";

const PORT = Number(process.env.PORT ?? 3000);

const app = buildApp({
  baseUrl: process.env.SOCIALCRAWL_BASE_URL ?? DEFAULT_BASE_URL,
  allowedHosts: process.env.MCP_ALLOWED_HOSTS
    ? process.env.MCP_ALLOWED_HOSTS.split(",").map((h) => h.trim())
    : undefined,
});

app.listen(PORT, () => {
  console.error(`SocialCrawl MCP (Streamable HTTP) listening on :${PORT}/mcp`);
});
```

- [ ] **Step 2: Wire `package.json` and bump versions**

In `package.json`:
- `"version": "1.7.0"`
- `bin` becomes:

```json
"bin": {
  "socialcrawl-mcp": "dist/index.js",
  "socialcrawl-mcp-http": "dist/http.js"
},
```

- add to `scripts`:

```json
"start:http": "node dist/http.js",
"dev:http": "tsx watch src/http.ts",
```

In `src/constants.ts`: `export const SERVER_VERSION = "1.7.0";`

- [ ] **Step 3: Build and smoke-test locally**

```powershell
npm run build; npm run start:http
```

In a second terminal:

```powershell
# 1) Handshake
curl.exe -s -X POST http://localhost:3000/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"curl\",\"version\":\"0\"}}}'
# Expected: JSON InitializeResult with serverInfo.name "socialcrawl-mcp", version "1.7.0"

# 2) Health
curl.exe -s http://localhost:3000/healthz
# Expected: {"status":"ok","name":"socialcrawl-mcp","version":"1.7.0"}

# 3) 405 on GET
curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/mcp
# Expected: 405
```

Optional richer smoke: `npx @modelcontextprotocol/inspector` → transport "Streamable HTTP" → `http://localhost:3000/mcp` → expect 6 tools, `socialcrawl_list_platforms` returns data anonymously. And with a real key: `claude mcp add --transport http socialcrawl-local http://localhost:3000/mcp --header "Authorization: Bearer sc_your_real_key"` then call `socialcrawl_check_balance` from Claude Code.

- [ ] **Step 4: Run the full suite once more**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/http.ts src/constants.ts package.json
git commit -m "feat: HTTP entrypoint, start:http script, second bin; bump to 1.7.0"
```

---

### Task 9: Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Consumes: `dist/http.js` (Task 8 build output), `/healthz` (Task 6).
- Produces: a container image whose default command serves the HTTP transport on `$PORT` (default 3000). The Appendix deploy checklist consumes this.

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
dist
.git
.github
docs
notes
src/__tests__
*.exe
.mcpregistry_*
*.tgz
.env
.env.local
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "dist/http.js"]
```

- [ ] **Step 3: Verify the image (requires Docker Desktop — if unavailable on this machine, mark this step deferred-to-CI and continue)**

```bash
docker build -t socialcrawl-mcp-http .
docker run --rm -p 3000:3000 socialcrawl-mcp-http
```

In another terminal: `curl.exe -s http://localhost:3000/healthz`
Expected: `{"status":"ok","name":"socialcrawl-mcp","version":"1.7.0"}`. Stop the container.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: container image for the Streamable HTTP entrypoint"
```

---

### Task 10: Distribution artifacts (server.json, README, in-server docs, CHANGELOG)

**Files:**
- Modify: `server.json`
- Modify: `README.md` (Installation section)
- Modify: `src/data/docs.ts` (authentication topic)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the public URL decision `https://mcp.socialcrawl.dev/mcp` (spec §4.6) and version `1.7.0`.
- Produces: registry/readme/docs copy other channels sync from. NOTE: `mcp-publisher publish` itself happens in the Appendix AFTER the endpoint is live — committing these files is safe now, publishing the registry entry before the URL resolves is not.

- [ ] **Step 1: Add the remote to `server.json`**

Bump both version fields to `1.7.0` and insert `remotes` between `"version"` and `"packages"`:

```json
  "version": "1.7.0",
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://mcp.socialcrawl.dev/mcp",
      "headers": [
        {
          "name": "Authorization",
          "description": "Bearer <SOCIALCRAWL_API_KEY>. Optional — discovery tools work without it. Get a free key at socialcrawl.dev (100 credits, no credit card required).",
          "isRequired": false,
          "isSecret": true
        }
      ]
    }
  ],
  "packages": [
```

(Also update `packages[0].version` to `"1.7.0"`.)

- [ ] **Step 2: Add the remote install section to `README.md`**

Insert directly after the `## Installation` heading (before `### npm`):

````markdown
### Remote server (hosted — no install)

Connect straight to the hosted Streamable HTTP endpoint — nothing to install or run:

**Claude Code** (works in the CLI *and* Claude Code on the web / cloud sandboxes)

```bash
claude mcp add --scope user --transport http socialcrawl https://mcp.socialcrawl.dev/mcp \
  --header "Authorization: Bearer sc_your_key_here"
```

**Any client that reads `.mcp.json`**

```json
{
  "mcpServers": {
    "socialcrawl": {
      "type": "http",
      "url": "https://mcp.socialcrawl.dev/mcp",
      "headers": { "Authorization": "Bearer ${SOCIALCRAWL_API_KEY}" }
    }
  }
}
```

**Cursor / Windsurf / VS Code** — choose the HTTP ("streamable-http") server type with the same URL and header. `x-api-key: sc_your_key_here` works as an alternative header.

The discovery tools (`socialcrawl_list_platforms`, `socialcrawl_list_endpoints`, `socialcrawl_get_docs`) work without a key, so you can explore before signing up. claude.ai custom connectors (Settings → Connectors) require OAuth, which ships in a follow-up release — use the header-based setup above in the meantime.

Prefer running it locally? Every stdio option below works exactly as before.
````

- [ ] **Step 3: Update the in-server authentication docs**

In `src/data/docs.ts`, replace this text inside the `authentication` topic template string:

```
## Environment variable

The MCP server reads \`SOCIALCRAWL_API_KEY\` from the environment of the MCP process. Set it in the MCP client config (Claude Desktop, Cursor, VS Code, etc.) or as a system environment variable.
```

with:

```
## Configuring the key in the MCP server

**Local (stdio, \`npx socialcrawl-mcp\`):** the server reads \`SOCIALCRAWL_API_KEY\` from the environment of the MCP process. Set it in the MCP client config (Claude Desktop, Cursor, VS Code, etc.) or as a system environment variable.

**Remote (Streamable HTTP, https://mcp.socialcrawl.dev/mcp):** send the key on every request as an \`Authorization: Bearer <key>\` or \`x-api-key: <key>\` header — in Claude Code: \`claude mcp add --transport http socialcrawl https://mcp.socialcrawl.dev/mcp --header "Authorization: Bearer sc_your_key"\`. Keys are never accepted in the URL or query string.
```

- [ ] **Step 4: Add the CHANGELOG entry**

Prepend a `1.7.0` section to `CHANGELOG.md`, matching the file's existing heading style, with this content:

```markdown
- **Remote Streamable HTTP transport.** New hosted endpoint `https://mcp.socialcrawl.dev/mcp` (spec rev 2025-11-25, stateless). Auth via `Authorization: Bearer <key>` or `x-api-key` header; the discovery tools work anonymously. New `socialcrawl-mcp-http` bin / `npm run start:http` for self-hosting, plus a Dockerfile.
- **Internal:** credentials are now per-request (`ApiContext`) instead of process-global env; stdio behavior is unchanged.
```

- [ ] **Step 5: Verify + full suite**

Run: `npm run build && npm test`
Expected: all PASS (docs.ts is compiled — a typo in the template string breaks the build).
Also run: `npx rg -n "mcp.socialcrawl.dev" README.md server.json src/data/docs.ts` — expect hits in all three.

- [ ] **Step 6: Commit**

```bash
git add server.json README.md src/data/docs.ts CHANGELOG.md
git commit -m "docs: remote endpoint in server.json, README, in-server docs; 1.7.0 changelog"
```

---

## Appendix A — Manual ops checklist (human decisions required; not agent tasks)

Execute after all ten tasks are merged. Blocked on spec Open Question 1 (hosting platform).

1. [ ] Pick the container host (recommendation: whatever already runs SocialCrawl production; else Railway/Fly.io). Deploy the Task 9 image with env `MCP_ALLOWED_HOSTS=mcp.socialcrawl.dev` and **no** `SOCIALCRAWL_API_KEY` set.
2. [ ] DNS: CNAME `mcp.socialcrawl.dev` → the service; platform-managed TLS; proxy idle timeout ≥ 120s, response buffering off.
3. [ ] Re-run the Task 8 curl smoke against `https://mcp.socialcrawl.dev/mcp` from an outside network.
4. [ ] Client-matrix check: Claude Code CLI (`claude mcp add --transport http … --header …`), Claude Code **web** (`.mcp.json` in a test repo), Cursor, MCP Inspector.
5. [ ] Publish npm 1.7.0 (`npm publish` via the existing `.github/workflows/publish.yml` flow) and re-publish the registry entry: `mcp-publisher publish` (validates the now-live remote URL). Confirm `.mcpregistry_*` tokens are still gitignored; rotate them if they ever appeared in git history.
6. [ ] Wire `/healthz` into uptime monitoring; alert on 5xx rate.
7. [ ] Sync downstream channels per the regen-pipeline conventions: socialcrawl-skills MCP-setup copy, Glama listing, docs site page `socialcrawl.dev/docs/mcp`.
8. [ ] Kick off the **OAuth plan** (spec Phase 3) as a separate plan in the `codebase/` monorepo — required before claude.ai connector support and Anthropic directory submission.

## Appendix B — Explicitly deferred

- OAuth 2.1 authorization server + 401/`WWW-Authenticate` flow (spec Phase 3) — separate subsystem, separate plan.
- Anthropic connectors directory submission (spec Phase 4.5) — depends on OAuth.
- SDK v2 / spec 2026-07-28 migration (spec Phase 5) — revisit ~Q4 2026; confined to `src/http.ts`/`src/app.ts`/`src/index.ts` because the tool layer is transport-agnostic behind `createServer(ctx)`.
