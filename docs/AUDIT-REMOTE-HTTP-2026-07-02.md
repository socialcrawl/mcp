# Security & Reliability Audit — Remote Streamable HTTP Transport

**Date:** 2026-07-02 · **Scope:** the v1.7.0 Streamable HTTP work described in
`docs/REMOTE-STREAMABLE-HTTP.md` (`src/app.ts`, `src/http.ts`, `src/auth.ts`,
`src/context.ts`, `src/client.ts`, `src/server.ts`, `src/tools/*`, `Dockerfile`)
· **Outcome:** 4 security findings and 6 reliability findings, **all fixed**;
tests extended; full suite green (111 tests, 10 files); built server smoke-tested
end-to-end.

## What was audited

The full HTTP request path (CORS → limiter → logger → `POST /mcp` → transport →
tools → upstream `fetch`), the auth extraction, the credential-threading model
(`ApiContext`), input validation on every tool schema, the Docker image, and the
existing test suite. The three documented security invariants (no env-key
fallback, no cross-tenant bleed, no key material in logs) were verified intact —
no changes were needed there.

---

## Security findings (fixed)

### S1 — Path injection via monitor `id` (high)

`src/tools/monitors.ts` interpolated the caller-supplied `id` directly into the
upstream URL: `` `/v1/monitors/${input.id}` ``. The zod schema allowed any
string, so an id like `../credits/balance` or `mon_1?x=y` redirected the request
— including **DELETE** and **PATCH** — to a different `/v1` path or injected
query parameters, using the caller's own key. Any MCP-driving agent fed
untrusted content could be steered into this.

**Fix (defense in depth):**
- `src/schemas/tools.ts` — `id` now requires `/^[A-Za-z0-9_-]{1,64}$/`.
- `src/tools/monitors.ts` — the same regex is re-checked at runtime (covers
  direct, non-MCP callers), and the id is `encodeURIComponent`-ed before URL
  construction.
- New test: crafted ids (`../credits/balance`, `mon_1?x=y`, `mon_1/runs`, `..`,
  `a b`) are rejected **without any upstream call**.

### S2 — Total rate-limit bypass via garbage API keys (high)

The single limiter used `skip: (req) => extractApiKey(req.headers) !== ""`. The
skip rationale ("keyed traffic is limited upstream") only holds for **valid**
keys — an attacker sending `x-api-key: junk` bypassed rate limiting entirely and
could flood the server (and relay unauthenticated load to the upstream API) with
zero throttling.

**Fix:** rate limiting is now two-tier in `src/app.ts`:
1. **Global per-IP ceiling** on all `/mcp` traffic, keyed or not (default
   600/min, `AppConfig.globalRateLimit` / `MCP_GLOBAL_RATE_LIMIT`). Generous
   enough that no real client hits it.
2. The existing **strict anonymous limiter** (default 60/min,
   `AppConfig.rateLimit` / `MCP_RATE_LIMIT`), which keyed traffic still skips.

New test: rotating garbage keys (`junk_1`…`junk_4`) hit `429` at the global
ceiling. The original anonymous-throttling test still passes unchanged.

### S3 — Hardcoded `trust proxy: 1` enables IP spoofing (medium)

`app.set("trust proxy", 1)` was unconditional. Whenever the app is **not**
actually behind exactly one proxy (local runs, direct exposure, `docker run -p`),
any client could send a fabricated `X-Forwarded-For` header and get a fresh
rate-limit bucket per request — a complete bypass of both limiters (and poisoned
log data).

**Fix:** `trust proxy` is now **off by default** and configurable:
`AppConfig.trustProxy`, wired to `MCP_TRUST_PROXY` in `src/http.ts` (integer hop
count; `"true"` maps to `1` hop, never blanket trust; invalid values are a fatal
startup error). The deploy checklist in the main doc now says to set
`MCP_TRUST_PROXY=1` behind the load balancer. Because we deliberately ignore
`X-Forwarded-For` when trust is off, express-rate-limit's
`xForwardedForHeader` validation (which would 500 such requests) is disabled on
both limiters.

### S4 — Empty Bearer value silently downgraded dual-header callers (low)

`extractApiKey` returned `""` for `Authorization: Bearer ` (whitespace-only
token) even when a valid `x-api-key` header was also present — the caller was
silently downgraded to anonymous. Now a whitespace-only Bearer token falls
through to `x-api-key`. (Absence of any credential still yields anonymous —
never the operator's env key.) New tests cover the fallthrough and `x-api-key`
trimming — two cases §12 of the main doc had flagged as untested.

---

## Reliability findings (fixed)

### R1 — Malformed JSON / oversized bodies returned Express HTML error pages

A body that failed `express.json()` parsing (or exceeded the 1 MB limit) fell
through to Express's default handler: an HTML error page (with a stack trace
when `NODE_ENV` isn't production). MCP clients expect JSON-RPC. A terminal
error middleware in `src/app.ts` now returns proper JSON-RPC errors:
`400` / `-32700 Parse error` for invalid JSON, `413` / `-32600` for oversized
bodies, `500` / `-32603` otherwise. Covered by a new test and verified against
the running server.

### R2 — 429 rejections were invisible in logs

The logger was mounted after the rate limiter, so throttled requests were never
logged (a gap §12 acknowledged). The logger is now mounted **before** the
limiters; 429s appear in the JSON log stream like any other response.

### R3 — Unvalidated `PORT` (and other env numbers)

`Number(process.env.PORT ?? 3000)` turns `PORT=""` into port `0` (random port)
and `PORT=abc` into `NaN` (opaque crash). `src/http.ts` now validates `PORT`,
`MCP_TRUST_PROXY`, `MCP_RATE_LIMIT`, and `MCP_GLOBAL_RATE_LIMIT` at startup and
exits with a clear one-line fatal error on garbage. Verified:
`PORT=abc node dist/http.js` → `Fatal: invalid PORT "abc" …`, exit 1.

### R4 — No graceful shutdown

Node's default `SIGTERM` handler kills in-flight requests instantly — and
Docker/K8s send `SIGTERM` on every stop/redeploy. `src/http.ts` now stops
accepting connections and drains for up to 10 s before exiting (`SIGTERM` and
`SIGINT`).

### R5 — Dockerfile healthcheck hardcoded port 3000

The `HEALTHCHECK` probed `:3000` regardless of `$PORT` (a gap §12 acknowledged).
The Dockerfile now sets `ENV PORT=3000` and the healthcheck probes
`http://127.0.0.1:${PORT}/healthz`, so a platform-injected `PORT` keeps the
probe honest.

### R6 — `baseUrl` trailing slash documented but not enforced

`ApiContext.baseUrl` is documented as "no trailing slash", but a value like
`https://api.example.com/` would silently produce `//v1/...` upstream URLs.
Trailing slashes are now stripped at both boundaries: `contextFromEnv()`
(stdio) and `buildApp()` (HTTP).

Two smaller observability fixes rode along in `src/app.ts`: the logged `rpc`
field now handles batch (array) JSON-RPC bodies instead of logging `null`, and
the new error middleware logs otherwise-unhandled request errors.

---

## Explicitly reviewed and left as-is

- **Wildcard CORS** — correct here: auth is header-bearer, not cookie-based, so
  a cross-origin page can't exfiltrate a key it doesn't already hold.
- **The three security invariants** (no env-key fallback on the HTTP path, no
  cross-tenant bleed, fingerprint-only logging) — verified against the code and
  their adversarial tests; untouched.
- **`socialcrawl_request` path construction** — `platform` is enum-validated
  and `resource` must resolve via `findEndpoint()` before any URL is built, so
  it is not injectable the way monitor `id` was.
- **`webhook_url` / `webhook_secret` contents** — deliberately left to upstream
  validation (SSRF policy for webhook targets is the API's responsibility, and
  duplicating it here would drift).
- **`/healthz` exposing name+version** — acceptable; it's public metadata.

## Files changed

| File | Change |
|---|---|
| `src/auth.ts` | S4: empty Bearer falls through to `x-api-key` |
| `src/schemas/tools.ts` | S1: monitor `id` format constraint |
| `src/tools/monitors.ts` | S1: runtime id guard + `encodeURIComponent` in all 5 id paths |
| `src/app.ts` | S2/S3/R1/R2/R6: two-tier limiter, configurable `trust proxy`, JSON-RPC error middleware, logger before limiters, baseUrl normalization, batch-aware rpc logging |
| `src/http.ts` | S3/R3/R4: env validation, `MCP_TRUST_PROXY`/`MCP_RATE_LIMIT`/`MCP_GLOBAL_RATE_LIMIT`, graceful shutdown |
| `Dockerfile` | R5: `ENV PORT=3000` + `$PORT`-aware healthcheck |
| `src/context.ts` | R6: trailing-slash normalization in `contextFromEnv` |
| `src/__tests__/auth.test.ts` | +2 tests (fallthrough, x-api-key trim) |
| `src/__tests__/monitors.test.ts` | +1 test (path-injection ids rejected, no upstream call) |
| `src/__tests__/http.test.ts` | +2 tests (garbage-key global ceiling, JSON-RPC parse error) |
| `docs/REMOTE-STREAMABLE-HTTP.md` | Updated §6/§7/§10/§11/§12 to match |

## Verification

- `npm run build` — clean.
- `npm test` — **111 tests, 10 files, all passing** (5 new tests).
- Live smoke against `node dist/http.js`: `/healthz` 200, MCP `initialize`
  handshake 200, malformed JSON → `400` JSON-RPC `-32700`, `GET /mcp` → 405,
  `PORT=abc` → clean fatal exit.

## Follow-ups (not blocking)

- The two rate-limit tiers use in-memory stores — fine for a single instance;
  swap in a shared store (e.g. Redis) if the deployment ever scales horizontally.
- OAuth 2.1 (`401` + `WWW-Authenticate`) remains deferred per the main doc.
- Consider a startup warning when `MCP_ALLOWED_HOSTS` is unset in production,
  since DNS-rebinding protection is off without it.
