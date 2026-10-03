# Remote Streamable HTTP Transport — Developer Guide

> **Audience:** a developer joining `socialcrawl-mcp` with no prior context on this
> work. Read this top-to-bottom and you will understand *what* was built, *why*,
> *how it works*, and *where to change things*. Shipped in **v1.7.0**.

---

## 1. TL;DR

The MCP server used to run **only** over stdio (`npx socialcrawl-mcp`), reading a
single `SOCIALCRAWL_API_KEY` from `process.env`. That works for local desktop
clients (Claude Desktop, Cursor, VS Code) but **not** for cloud AI clients that
can't spawn a local process (Claude Code on the web, hosted n8n, remote sandboxes).

v1.7.0 adds a second, **remote** way to reach the exact same six tools: a hosted
HTTP endpoint at **`https://mcp.socialcrawl.dev/mcp`** speaking the MCP
**Streamable HTTP** transport. Each HTTP request carries its own API key in a
header (`Authorization: Bearer <key>` or `x-api-key: <key>`), so one shared server
process serves many users without any of them sharing credentials.

**The stdio experience is byte-identical to before** — existing npm users are
unaffected. This was a hard requirement, not a nice-to-have.

Nothing here touches OAuth or the actual cloud deployment — those are explicitly
deferred (see [§11](#11-whats-intentionally-not-here-deferred)).

---

## 2. The core idea: one codebase, two entrypoints

The whole design collapses to one sentence:

> **All tool logic lives in a `createServer(ctx)` factory. The credential is a
> per-request value (`ApiContext`) threaded explicitly — never read from
> `process.env` in the tool, client, or transport layers. Each entrypoint builds
> that `ctx` its own way and hands it to the same factory.**

```
                        ┌───────────────────────────────┐
   stdio user           │  createServer(ctx): McpServer  │
   (npx socialcrawl-mcp)│   ── the 8 tools live here ──  │
        │               │  list_platforms  list_endpoints│
        ▼               │  request  check_balance        │
  src/index.ts          │  monitors  get_docs            │
  contextFromEnv() ────▶│                                │◀──── src/app.ts (buildApp)
  (reads process.env    └───────────────────────────────┘      fresh ctx PER POST from
   ONCE at startup)              ▲                              extractApiKey(req.headers)
        │                        │                                     ▲
        ▼                        │                                     │
  StdioServerTransport     ApiContext{apiKey,baseUrl}          StreamableHTTPServerTransport
                                                               (stateless, one per request)
                                                                     ▲
                                                                     │
                                                               src/http.ts (listen on :PORT)
```

Before v1.7.0 the tools called module-private `getApiKey()` / `getBaseUrl()`
helpers that read `process.env`. Those are **gone**. Credentials now flow as an
explicit function argument from the entrypoint all the way down to the `fetch`
call. That single change is what makes safe multi-tenant HTTP possible.

---

## 3. `ApiContext` — the credential-carrying value

Defined in **`src/context.ts`**:

```ts
export const DEFAULT_BASE_URL = "https://www.socialcrawl.dev";

export interface ApiContext {
  apiKey: string;   // "" = anonymous (discovery tools only)
  baseUrl: string;  // SocialCrawl API origin, no trailing slash
}

// stdio-ONLY env reader. The HTTP path must never call this.
export function contextFromEnv(): ApiContext {
  return {
    apiKey: process.env.SOCIALCRAWL_API_KEY ?? "",
    baseUrl: process.env.SOCIALCRAWL_BASE_URL ?? DEFAULT_BASE_URL,
  };
}
```

- `apiKey: ""` is the **anonymous** state. It is not an error — the three
  discovery tools work fine anonymously; only the three keyed tools return a
  friendly "no key" message.
- `contextFromEnv()` is the **only** place in the codebase (outside tests) that
  reads a credential from `process.env`. This is enforced and tested — see
  [§8, security invariants](#8-security-model-the-three-invariants).

---

## 4. The `createServer(ctx)` factory

Defined in **`src/server.ts`**. It builds a fully-wired `McpServer` bound to one
caller's `ctx`, registering all six tools. It is the **only** way any transport
obtains a server.

- **stdio** calls it **once** per process.
- **HTTP** calls it **once per POST** (stateless mode). So construction must stay
  cheap and I/O-free — it is: just `new McpServer(...)` plus six `registerTool`
  calls over in-memory data.

The six tools:

| Tool | Keyed? | Handler passes `ctx`? | What it does |
|---|---|---|---|
| `socialcrawl_list_platforms` | no | no | Lists all platforms (static data) |
| `socialcrawl_list_endpoints` | no | no | Lists a platform's endpoints (static data) |
| `socialcrawl_get_docs` | no | no | Returns doc topics (static data) |
| `socialcrawl_request` | **yes** | `request(ctx, …)` | Any registry API call |
| `socialcrawl_check_balance` | **yes** | `checkBalance(ctx)` | Credit balance (meta endpoint) |
| `socialcrawl_monitors` | **yes** | `monitors(ctx, …)` | Stateful monitors CRUD |

The keyed tools thread `ctx` into `makeRequest(ctx, …)` / `apiRequest(ctx, …)` in
**`src/client.ts`**, which early-returns `NO_API_KEY_ERROR` when `ctx.apiKey` is
empty — so an anonymous caller gets a clean message instead of a failed HTTP call.

> The six tool metadata strings (titles/descriptions/annotations) were moved
> **verbatim** from the old `index.ts` into `server.ts`. They are the single
> source of truth now — there is no duplicated copy to drift.

---

## 5. The two entrypoints

### 5a. stdio — `src/index.ts` (unchanged behavior)

Shrank from ~180 lines to a 14-line shim:

```ts
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { contextFromEnv } from "./context.js";
import { createServer } from "./server.js";

async function main() {
  const server = createServer(contextFromEnv());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch((e) => { console.error("Fatal error starting SocialCrawl MCP server:", e); process.exit(1); });
```

Same six tools, same metadata, same error strings — the only user-visible change
is the reworded `NO_API_KEY_ERROR` (it now mentions the HTTP header option too).

### 5b. HTTP — `src/http.ts` + `src/app.ts`

`src/http.ts` is thin glue: read config env, build the app, listen.

```ts
const PORT = Number(process.env.PORT ?? 3000);
const app = buildApp({
  baseUrl: process.env.SOCIALCRAWL_BASE_URL ?? DEFAULT_BASE_URL,
  allowedHosts: process.env.MCP_ALLOWED_HOSTS?.split(",").map(h => h.trim()),
});
app.listen(PORT, () => console.error(`… listening on :${PORT}/mcp`));
```

> Note the config env vars here (`PORT`, `SOCIALCRAWL_BASE_URL`,
> `MCP_ALLOWED_HOSTS`) are **not credentials** — reading them at the entrypoint is
> fine. The invariant is specifically about the *API key*, which `http.ts` never
> touches.

`src/app.ts` is the Express app (`buildApp(config)`). The important part is the
`POST /mcp` handler:

```ts
app.post("/mcp", async (req, res) => {
  // STATELESS: fresh ctx + server + transport for THIS request only.
  const ctx = { apiKey: extractApiKey(req.headers), baseUrl: config.baseUrl };
  const server = createServer(ctx);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,   // stateless
    enableJsonResponse: true,        // plain JSON responses (no SSE session)
    ...(config.allowedHosts ? { enableDnsRebindingProtection: true, allowedHosts: config.allowedHosts } : {}),
  });
  res.on("close", () => { void transport.close(); void server.close(); }); // cleanup
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
```

Everything else in `app.ts`:
- **CORS** — `Access-Control-Allow-Origin: *`, allows `Authorization` / `x-api-key`
  headers; `OPTIONS` → 204. (Wildcard origin is safe: auth is header-bearer, not
  cookie-based, so a cross-origin page can't retrieve a key it doesn't have.)
- **`GET /mcp` and `DELETE /mcp` → 405** (stateless mode has no session to
  resume or delete).
- **Rate limit + logging** — see [§7](#7-rate-limiting--redacted-logging).
- **`GET /healthz`** → `{ status: "ok", name, version }` (used by Docker/uptime).

**Why stateless?** No `mcp-session-id` to track, no per-session server to keep
alive, no memory to leak across requests. Each request is fully self-contained:
its own key, its own server, its own transport, torn down on response close. This
is what structurally guarantees that concurrent users can't bleed into each other
(no shared mutable state to leak through).

---

## 6. Auth — `src/auth.ts`

```ts
export function extractApiKey(headers: IncomingHttpHeaders): string {
  const auth = headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();       // "Bearer " / "bearer " is exactly 7 chars
  }
  const xKey = headers["x-api-key"];
  if (typeof xKey === "string") return xKey.trim();   // rejects array (repeated) form
  return "";                            // anonymous — NEVER process.env
}
```

- Prefers `Authorization: Bearer` over `x-api-key`.
- Scheme match is case-insensitive; the value is trimmed.
- A whitespace-only Bearer value falls through to `x-api-key` (a caller sending
  both headers is not silently downgraded to anonymous).
- Non-Bearer schemes (`Basic …`) and repeated (array-form) `x-api-key` headers are
  ignored → `""`.
- **It never reads `process.env`.** That is the whole point of the module: an
  HTTP caller who sends no key gets anonymous access, *not* the operator's key.

---

## 7. Rate limiting & redacted logging

Both middlewares live in `src/app.ts`, mounted **after CORS, before `POST /mcp`**.

**Rate limiting is two-tier** (`express-rate-limit`):

1. **Global per-IP ceiling** — applies to **all** `/mcp` traffic, keyed or not
   (default `600/min`, `AppConfig.globalRateLimit` / `MCP_GLOBAL_RATE_LIMIT`).
   Without it, any garbage `x-api-key` would bypass rate limiting entirely
   (invalid keys aren't throttled upstream — they just 401).
2. **Strict anonymous limiter** — protects the discovery tools (default
   `60/min`, `AppConfig.rateLimit` / `MCP_RATE_LIMIT`). Keyed traffic skips
   this tier only: valid keys are limited upstream by per-key concurrency and
   credit billing, and invalid keys are caught by tier 1.

`trust proxy` is **off by default** — when the app isn't actually behind a
proxy, trusting `X-Forwarded-For` would let clients spoof their IP past both
limiters. Set `MCP_TRUST_PROXY=1` (hop count) when deploying behind a load
balancer.

**Redacted logging** — one JSON line per request to **stderr** (`console.error`):
```json
{"ts":"…","method":"POST","path":"/mcp","rpc":"initialize","status":200,"ms":42,"keyFp":"a1b2c3d4"}
```
The key is **never** logged raw — only `keyFp = sha256(key).slice(0,8)`, or `null`
when anonymous. This lets you correlate a user's requests in logs without exposing
their credential.

---

## 8. Security model: the three invariants

These are enforced in code **and** covered by dedicated adversarial tests. If you
change auth/transport code, keep them true.

1. **The HTTP path never falls back to the operator's `SOCIALCRAWL_API_KEY`.**
   An anonymous HTTP caller gets `""` → discovery tools only.
   - Enforced by: `SOCIALCRAWL_API_KEY` is read **only** in `src/context.ts`
     (`contextFromEnv`, stdio-only). `auth.ts`, `app.ts`, `http.ts` never read it.
   - Verify with: `grep -rn "SOCIALCRAWL_API_KEY" src --include="*.ts" | grep -v __tests__`
     → should match only `src/context.ts`.
   - Tested by `http.test.ts` → *"an anonymous caller never inherits the
     operator's env key"* (sets the env key, asserts the upstream never sees it).

2. **Concurrent callers with different keys never bleed.**
   - Enforced by: fresh `ctx` + `createServer(ctx)` + transport **per POST**; no
     module-level mutable state (`PLATFORMS`/`ENDPOINTS` are read-only data).
   - Tested by `http.test.ts` → *"concurrent callers with different keys never
     bleed"* (10 interleaved A/B calls → asserts an exact 5/5 split, no third key).

3. **Keys never appear in logs and are never accepted via URL/query.**
   - Enforced by: `keyFp` fingerprint only; `extractApiKey` reads headers only.
   - Tested by `http.test.ts` → *"logs a fingerprint, never the raw key"*.

---

## 9. File map

| File | Status | Responsibility |
|---|---|---|
| `src/context.ts` | new | `ApiContext`, `DEFAULT_BASE_URL`, `contextFromEnv()` (stdio-only env reader) |
| `src/client.ts` | modified | HTTP client to SocialCrawl API; `makeRequest`/`apiRequest` gained leading `ctx`; env readers deleted; `NO_API_KEY_ERROR` exported |
| `src/tools/request.ts` | modified | `request(ctx, input)` |
| `src/tools/check-balance.ts` | modified | `checkBalance(ctx)` |
| `src/tools/monitors.ts` | modified | `monitors(ctx, input)` — 7 `apiRequest` call-sites now pass `ctx` |
| `src/server.ts` | new | `createServer(ctx)` factory — the six `registerTool` blocks |
| `src/index.ts` | modified | stdio bootstrap (env → ctx → factory → `StdioServerTransport`) |
| `src/auth.ts` | new | `extractApiKey(headers)` — header parsing, no env access |
| `src/app.ts` | new | `buildApp(config)` — Express: CORS, rate limit, logging, `POST /mcp`, 405s, `/healthz` |
| `src/http.ts` | new | HTTP bootstrap entry (config env → `buildApp` → listen) |
| `src/data/docs.ts` | modified | `authentication` topic documents both transports |
| `Dockerfile`, `.dockerignore` | new | container image for the HTTP entry |
| `package.json` | modified | version 1.7.0, `express`/`express-rate-limit` deps, `start:http`/`dev:http` scripts, second bin `socialcrawl-mcp-http` |
| `server.json` | modified | `remotes` array + version bumps (MCP Registry entry) |
| `README.md` | modified | "Remote server (hosted — no install)" install section |
| `CHANGELOG.md` | modified | 1.7.0 entry |

**Tests** (all under `src/__tests__/`, run with `npm test`):

| Test file | Covers |
|---|---|
| `context.test.ts` | `contextFromEnv` env → ctx behavior |
| `auth.test.ts` | header extraction incl. the no-env security invariant |
| `server.test.ts` | `createServer` over `InMemoryTransport`: 8 tools, anonymous behavior, per-ctx key |
| `http.test.ts` | end-to-end over real HTTP: SDK client ↔ Express app ↔ mock upstream, incl. the 3 security invariants, 405s, CORS, `/healthz`, rate limit, logging |
| `client.test.ts`, `truncation.test.ts`, `preflight.test.ts`, `check-balance.test.ts`, `monitors.test.ts` | migrated from env-mutation fixtures to explicit `ctx` fixtures |

`http.test.ts` is worth reading first if you want to understand the runtime: it
spins the **real** Express app on an ephemeral port and points `baseUrl` at a
local mock upstream (a `node:http` server), then drives it with the SDK's real
`StreamableHTTPClientTransport`. No `fetch` stubbing — it's a true integration
test.

---

## 10. Running it

### Tech stack
TypeScript (strict, **Node16 ESM — every relative import ends in `.js`**),
`@modelcontextprotocol/sdk` v1.29.x, Express 5, express-rate-limit 8, zod 3,
vitest 3, Docker (node:22-alpine).

### stdio (unchanged)
```bash
SOCIALCRAWL_API_KEY=sc_xxx npx socialcrawl-mcp
# or, in a client's .mcp.json, the same stdio config as before
```

### HTTP locally
```bash
npm run build
npm run start:http          # node dist/http.js — listens on :3000/mcp
# dev with reload:
npm run dev:http            # tsx watch src/http.ts
```
Smoke it:
```bash
# handshake
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
# health
curl -s http://localhost:3000/healthz        # {"status":"ok","name":"socialcrawl-mcp","version":"1.7.0"}
# 405
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/mcp   # 405
```

Config env vars for the HTTP entry:
| Var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Listen port (validated; the process exits with a clear error on garbage) |
| `SOCIALCRAWL_BASE_URL` | production | Upstream API origin (trailing slashes normalized away) |
| `MCP_ALLOWED_HOSTS` | *(unset)* | Comma-separated Host allow-list → enables SDK DNS-rebinding protection |
| `MCP_TRUST_PROXY` | `false` | Proxy hop count for `X-Forwarded-For` (set `1` behind a load balancer; `true` maps to `1`) |
| `MCP_RATE_LIMIT` | `60` | Anonymous requests/min per IP |
| `MCP_GLOBAL_RATE_LIMIT` | `600` | Total requests/min per IP (keyed included) |

### Docker
```bash
docker build -t socialcrawl-mcp-http .
docker run --rm -p 3000:3000 socialcrawl-mcp-http
curl -s http://localhost:3000/healthz
```
Two-stage `node:22-alpine` build; runs as non-root `USER node`; has a Docker
`HEALTHCHECK` hitting `/healthz`; `CMD ["node","dist/http.js"]`.

### Connecting a client to the hosted endpoint
```bash
claude mcp add --scope user --transport http socialcrawl https://mcp.socialcrawl.dev/mcp \
  --header "Authorization: Bearer sc_your_key"
```
Or any `.mcp.json`-reading client:
```json
{ "mcpServers": { "socialcrawl": {
  "type": "http",
  "url": "https://mcp.socialcrawl.dev/mcp",
  "headers": { "Authorization": "Bearer ${SOCIALCRAWL_API_KEY}" }
}}}
```
Discovery tools work with no key, so you can explore before signing up.

---

## 10a. OAuth (preview)

> **Status: preview, off by default.** Set `SOCIALCRAWL_OAUTH=1` to turn it on.
> With the flag off, every behaviour in this guide is unchanged.

claude.ai custom connectors and the connector directory only talk to remote MCP
servers that follow the MCP authorization spec (revision 2026-07-28). In that
spec the MCP server is an **OAuth 2.1 resource server**: it never issues tokens.
It names its authorization server, checks the tokens it is handed, and refuses
the rest. This section covers what the MCP server does, and what the owner has
to provide so it can work: an authorization server and one backend endpoint.

### What the server does when the flag is on

| Request | Response |
|---|---|
| `GET /.well-known/oauth-protected-resource/mcp` (and the root `/.well-known/oauth-protected-resource`) | RFC 9728 metadata: `resource`, `authorization_servers: [<issuer>]`, `scopes_supported`, `bearer_methods_supported: ["header"]` |
| `POST /mcp` with no credentials | `401`, `WWW-Authenticate: Bearer resource_metadata="<…/oauth-protected-resource/mcp>", scope="socialcrawl:read socialcrawl:spend socialcrawl:manage"` |
| `POST /mcp` with `Authorization: Bearer <JWT>` | Verified locally against the JWKS: signature (alg allow-list), `iss` = issuer, `aud` contains the resource URL, `exp` present and in the future. Failure → `401 error="invalid_token"` |
| … valid token, but the `tools/call` needs a scope it lacks | `403`, `WWW-Authenticate: Bearer error="insufficient_scope", scope="<held + needed>", resource_metadata="…"` (the spec's step-up challenge) |
| … valid token with enough scope | `sc_api_key_ref` claim → backend lookup → the SocialCrawl API key. Calls run with that key. Unknown or revoked ref → `401 invalid_token`; lookup backend down → `503` |
| `POST /mcp` with `x-api-key: sc_…`, or `Authorization: Bearer sc_…` (not a JWT) | The existing API-key path, unchanged. Headless clients keep working |

A Bearer value counts as a JWT when it has three dot-separated base64url parts.
SocialCrawl API keys (`sc_` + base64url) never contain a dot, so the two never
collide. **Any other Bearer value is treated as a SocialCrawl API key, even with
the flag on.** That includes an opaque (non-JWT) OAuth access token. Such a
value is not verified here. It is forwarded upstream as `x-api-key`, just as
before, and the SocialCrawl API rejects it. So the authorization server must
issue JWT access tokens. Opaque tokens and token introspection are not
supported.

A JWT-authenticated request must send `Content-Type: application/json` (charset
parameters are fine). Anything else gets `415` before the token is checked. The
reason: the SDK transport accepts any Content-Type that *contains*
`application/json` and parses the raw body itself, so the scope check must only
ever run on the body Express actually parsed. As a second guard, a body that is
not a JSON object or array needs every scope.

Anonymous discovery goes away when the flag is on. A credential-less request
gets the 401 challenge, which is the signal a connector client needs to start
the OAuth flow.

The access token is never forwarded anywhere: not to the SocialCrawl API, and not
to the lookup backend. The spec forbids token passthrough. Neither the token nor
the resolved key is ever logged. The request log keeps its 8-character
fingerprint.

The bearer check, the `WWW-Authenticate` formatting and the metadata route use
the SDK's own helpers (`requireBearerAuth`, `metadataHandler`,
`getOAuthProtectedResourceMetadataUrl`). The SDK has no JWT/JWKS verification,
so `jose` does that part (`src/oauth/jwt-verifier.ts`).

### Scopes

| Scope | Tools |
|---|---|
| `socialcrawl:read` | `list_platforms`, `list_endpoints`, `pricing`, `discover`, `get_docs`, `check_balance` |
| `socialcrawl:spend` | `request` |
| `socialcrawl:spend` + `socialcrawl:manage` | `web`, `monitors`, `cohorts` (they bill, and they create or delete persistent resources) |

Only `tools/call` is gated. `initialize`, `tools/list` and the other methods
need only a valid token. A tool missing from the map needs every scope (fail
closed), and a test fails if a registered tool is missing from
`src/oauth/scopes.ts`. JSON-RPC batches are checked message by message.

### Environment

| Var | Required with the flag | Meaning |
|---|---|---|
| `SOCIALCRAWL_OAUTH` | — | `1` turns OAuth on. Any other value, or unset, leaves it off |
| `SOCIALCRAWL_OAUTH_RESOURCE` | yes | Canonical URL of this endpoint, e.g. `https://mcp.socialcrawl.dev/mcp`. This is the token audience and the RFC 8707 `resource`. No fragment, no trailing slash |
| `SOCIALCRAWL_OAUTH_ISSUER` | yes | Authorization server issuer, matched exactly against `iss` |
| `SOCIALCRAWL_OAUTH_JWKS_URL` | yes | The issuer's JWKS. jose caches it and refetches when it sees an unknown `kid` |
| `SOCIALCRAWL_OAUTH_KEY_LOOKUP_URL` | yes | The backend lookup endpoint (contract below) |
| `SOCIALCRAWL_OAUTH_KEY_LOOKUP_SECRET` | yes | Shared secret sent to that endpoint as `Authorization: Bearer <secret>` |
| `SOCIALCRAWL_OAUTH_ALGORITHMS` | no | Comma list of accepted JWS algorithms. Default `RS256,PS256,ES256`. Only `RS256/384/512`, `PS256/384/512` and `ES256/384/512` are allowed. Anything else (HMAC, `none`, `EdDSA`) stops the process at boot |

All URLs must be `https` (plain `http` is accepted only for `localhost` and
`127.0.0.1`). If the flag is on and a variable is missing or invalid, the
process refuses to start and the error names the variable.

### What the owner must provide

**1. An authorization server** (in the `codebase/` monorepo or a hosted IdP). It must:

- publish RFC 8414 metadata (`/.well-known/oauth-authorization-server`, or OIDC
  discovery) at the issuer, with `authorization_endpoint`, `token_endpoint`,
  `code_challenge_methods_supported: ["S256"]`, `scopes_supported` and
  `client_id_metadata_document_supported: true`;
- run the authorization-code grant with **PKCE S256**;
- accept **Client ID Metadata Documents** (URL-shaped `client_id`s, such as
  claude.ai's). Fetch and validate the document, and match `redirect_uri`
  against it. Dynamic Client Registration is deprecated in 2026-07-28; keep it
  only if older clients need it;
- honour the RFC 8707 `resource` parameter, and issue tokens whose `aud` is
  exactly `SOCIALCRAWL_OAUTH_RESOURCE`;
- issue **JWT access tokens** signed with a key in the JWKS (with a `kid`), carrying
  `iss`, `aud`, `exp` (short-lived, at most 1 h recommended), `sub`, `client_id`,
  `scope` (space-delimited; `scp` is also accepted) and **`sc_api_key_ref`**;
- on the consent screen, let the user choose (or create) the SocialCrawl API key
  the connector will bill. Mint an opaque `sc_api_key_ref` for that choice,
  bound to the user. **Never put the API key itself in the token.** JWTs are
  signed, not encrypted, so any token holder can read them.

**2. The key-lookup endpoint** (`SOCIALCRAWL_OAUTH_KEY_LOOKUP_URL`):

```http
POST <SOCIALCRAWL_OAUTH_KEY_LOOKUP_URL>
Authorization: Bearer <SOCIALCRAWL_OAUTH_KEY_LOOKUP_SECRET>
Content-Type: application/json

{ "sc_api_key_ref": "ref_…", "sub": "<token sub>", "client_id": "<token client_id>", "scopes": ["socialcrawl:read", …] }
```

| Status | Body | MCP server does |
|---|---|---|
| `200` | `{ "api_key": "sc_…" }` | Runs the call with that key. Caches it for at most 60 s, and never past the token's `exp`. The cache key is `sha256(sub, client_id, ref)`, so a cache hit never skips the "ref belongs to sub" check for a different subject or client |
| `404` | anything | Ref is unknown or revoked, or the key is disabled → `401 invalid_token`, so the client re-authorizes |
| anything else, timeout (5 s), network error, `200` without `api_key` | — | `503`, nothing cached. The log records only the HTTP status |

The endpoint must:

- compare the shared secret in **constant time** (for example
  `crypto.timingSafeEqual` over SHA-256 digests);
- check that the ref belongs to `sub`, and refuse refs that were revoked, whose
  key was rotated or disabled, or whose user was suspended;
- serve over HTTPS only, send `Cache-Control: no-store`, never log the key or
  the secret, and charge 0 credits.

Revoking a ref takes effect within 60 s, because of the cache.

### Setup steps (owner)

1. Stand up the authorization server and the lookup endpoint above. Choose a
   long random lookup secret and store it on both sides.
2. Deploy the MCP server with `SOCIALCRAWL_OAUTH=1` and the five required variables
   (plus the usual `MCP_ALLOWED_HOSTS`, `MCP_TRUST_PROXY=1`).
3. Check it:
   ```bash
   curl -s https://mcp.socialcrawl.dev/.well-known/oauth-protected-resource/mcp
   curl -si -X POST https://mcp.socialcrawl.dev/mcp -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -i www-authenticate
   ```
4. In claude.ai: **Settings → Connectors → Add custom connector**, URL
   `https://mcp.socialcrawl.dev/mcp`. Sign in, consent, then confirm that a
   read-only grant can list tools and that `socialcrawl_request` returns a 403
   step-up.

Code: `src/oauth/config.ts` (env), `src/oauth/jwt-verifier.ts`,
`src/oauth/api-key-resolver.ts` (lookup strategy, pluggable: any
`(authInfo) => Promise<string | null>`), `src/oauth/scopes.ts`,
`src/oauth/resource-server.ts` (metadata route and gate), wired in `src/app.ts`.
Tests: `src/__tests__/oauth.test.ts` (units) and `oauth-http.test.ts` (end to end
over real HTTP: a local JWKS host, lookup backend and upstream).

---

## 11. What's intentionally NOT here (deferred)

- **The OAuth authorization server and key-lookup endpoint.** The MCP side
  (resource server, 401 challenge, scopes) ships as a preview behind
  `SOCIALCRAWL_OAUTH=1`. See [§10a](#10a-oauth-preview). The authorization server
  and lookup endpoint it depends on belong in the main `codebase/` monorepo and
  are not built yet. Until they are, header auth is the way.
- **The actual cloud deployment.** The container host, DNS (`mcp.socialcrawl.dev`
  CNAME), TLS, and publishing the registry entry are a manual ops checklist
  (Appendix A of the plan). Blocked on the hosting-platform decision. Notably,
  deploy with `MCP_ALLOWED_HOSTS=mcp.socialcrawl.dev`, `MCP_TRUST_PROXY=1`
  (assuming one load-balancer hop), and **no** `SOCIALCRAWL_API_KEY` set on
  the server.
- **SDK v2 migration.** Revisit ~Q4 2026; confined to the transport files because
  the tool layer is transport-agnostic behind `createServer(ctx)`.

---

## 12. Known minor items

The items originally deferred here (Dockerfile `HEALTHCHECK` port, 429s not
logged, trailing-slash enforcement, missing auth test cases) were all **fixed in
the 2026-07-02 security/reliability audit** — see
`docs/AUDIT-REMOTE-HTTP-2026-07-02.md` for the full list of findings and fixes.

Remaining cosmetic item:

- **CHANGELOG** puts the internal "per-request `ApiContext`" note under `### Added`
  where the file's prior convention would use `### Changed`. Cosmetic.

---

## 13. How to extend

- **Add a new tool:** add its input schema in `src/schemas/tools.ts`, its handler
  in `src/tools/`, and a `registerTool` block in `src/server.ts`. If it hits the
  API, give it a leading `ctx: ApiContext` param and call `makeRequest(ctx, …)` /
  `apiRequest(ctx, …)`; if it's pure/discovery, keep it ctx-free. Both transports
  pick it up automatically — you never touch `index.ts` or `app.ts`.
- **Change auth acceptance** (e.g. a new header): edit `src/auth.ts` only; add a
  case to `auth.test.ts`. Do **not** reach into `process.env` for the key.
- **Tune rate limits:** pass `rateLimit` in the `AppConfig` from `http.ts`, or
  change the default in `app.ts`.
- **Never** reintroduce a `process.env.SOCIALCRAWL_API_KEY` read outside
  `context.ts` — that would break security invariant #1.

---

## 14. Reference

- Plan (task-by-task, with rationale): `docs/superpowers/plans/2026-07-02-remote-streamable-http.md`
- Spec: `docs/specs/2026-07-02-remote-http-transport-upgrade.md`
- MCP Streamable HTTP transport: part of `@modelcontextprotocol/sdk` v1.29.x
  (`server/streamableHttp.js`, `client/streamableHttp.js`).
