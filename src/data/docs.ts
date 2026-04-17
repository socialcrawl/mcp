import { PLATFORMS } from "./platforms.js";
import { ENDPOINTS, getEndpointsByPlatform } from "./endpoints.js";
import type { Endpoint } from "../types.js";

/**
 * Hand-written documentation blocks. Platform-specific docs and the `full`
 * reference are generated at runtime from the ENDPOINTS / PLATFORMS data so
 * they stay in sync with the backend registry automatically.
 */

const HANDWRITTEN: Record<string, string> = {
  overview: `# SocialCrawl API

Unified social media data API. One API key, one response format, 21 platforms, 108 endpoints.

## Base URL

https://www.socialcrawl.dev/v1

## Authentication

Pass your API key in the \`x-api-key\` header with every request.

## Platforms

${PLATFORMS.map((p) => `- ${p.slug} (${p.endpointCount} endpoint${p.endpointCount === 1 ? "" : "s"})`).join("\n")}

## Credits

- Standard: 1 credit per request
- Advanced: 5 credits per request
- Premium: 10 credits per request

Most endpoints cost 1 credit (standard tier). Heavier endpoints (trending feeds, audience analytics, ad transparency, AI-powered utilities) cost 5 or 10.

## Meta Endpoints

API-key-authed endpoints that return account metadata at 0 credit cost:

- \`GET /v1/credits/balance\` — current credit balance and recent deduction summary. Use the \`socialcrawl_check_balance\` tool to call it.

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

## Environment variable

The MCP server reads \`SOCIALCRAWL_API_KEY\` from the environment of the MCP process. Set it in the MCP client config (Claude Desktop, Cursor, VS Code, etc.) or as a system environment variable.`,

  credits: `# SocialCrawl API — Credits

Every request costs credits. The MCP server pre-calculates cost from the endpoint tier before calling the API, and the response envelope reports both \`credits_used\` and \`credits_remaining\`.

## Tiers

| Tier | Cost per request | Typical use |
|------|------------------|-------------|
| standard | 1 credit | Profile, post, comment, search endpoints |
| advanced | 5 credits | Trending feeds, audience analytics, ad transparency |
| premium | 10 credits | AI-powered utilities (e.g. transcript generation, age/gender detection) |

## Caching

Cached responses are free (BIL-03) — the envelope includes \`"cached": true\` and no credits are deducted. Cache TTLs range from 2 minutes (search) to 30 minutes (analytics).

## Empty upstream auto-refund (BIL-01)

When the upstream returns 200 with an empty body for a nonexistent profile/post (e.g. an Instagram handle that does not exist), the API auto-refunds the credit and returns a 404 \`RESOURCE_NOT_FOUND\` envelope. You are never billed for missing resources.

## Idempotent retries (BIL-02)

Pass an \`Idempotency-Key\` header to make a request safely retryable. Replays return the original response, deduct 0 new credits, and include \`X-Idempotent-Replay: true\`. The \`socialcrawl_request\` tool accepts an \`idempotencyKey\` parameter for this.

## Check balance (SEC-02)

Use the \`socialcrawl_check_balance\` tool — it calls \`GET /v1/credits/balance\` and costs 0 credits.

## Advisory warnings (ENV-03)

Successful responses may include an optional \`data._warnings\` string array — non-fatal notices from the transform pipeline (e.g. an engagement-rate clamp). Treat as observability hints, not as failures.

## Insufficient credits

If your account runs out of credits, requests return a structured error with \`type: "INSUFFICIENT_CREDITS"\` and \`credits_remaining: 0\`. Top up from the dashboard.`,

  errors: `# SocialCrawl API — Errors

All errors follow the same envelope:

\`\`\`json
{
  "success": false,
  "error": {
    "type": "INVALID_REQUEST",
    "message": "Missing required parameter: handle",
    "status": 400,
    "doc_url": "https://www.socialcrawl.dev/docs/errors/invalid-request"
  },
  "credits_remaining": 99,
  "request_id": "req-XXXXX"
}
\`\`\`

## Error types

| Type | Status | Meaning |
|------|--------|---------|
| \`MISSING_API_KEY\` | 401 | No \`x-api-key\` header supplied |
| \`INVALID_API_KEY\` | 401 | Key does not exist or has been revoked |
| \`INSUFFICIENT_CREDITS\` | 402 | Account balance too low for this endpoint |
| \`INVALID_REQUEST\` | 400 | Missing/invalid parameter, bad platform/handle/URL format (ERR-01) |
| \`METHOD_NOT_ALLOWED\` | 405 | Non-GET request against \`/v1/*\` (ERR-02). Response includes \`Allow: GET\` |
| \`ENDPOINT_NOT_FOUND\` | 404 | Unknown platform+resource combination |
| \`RESOURCE_NOT_FOUND\` | 404 | Upstream resource does not exist or empty body (BIL-01) — credits auto-refunded |
| \`IDEMPOTENCY_KEY_CONFLICT\` | 409 | \`Idempotency-Key\` already used by another account (BIL-02) |
| \`IDEMPOTENCY_KEY_PAYLOAD_MISMATCH\` | 422 | Same \`Idempotency-Key\` reused with different parameters (BIL-02) |
| \`CONCURRENCY_LIMIT\` | 429 | Too many simultaneous requests on the same API key (50 max) |
| \`UPSTREAM_ERROR\` | 502 | ScrapeCreators upstream failed — credits are refunded automatically |
| \`SERVICE_UNAVAILABLE\` | 503 | Circuit breaker open — credits refunded, response includes \`Retry-After: 30\` |
| \`INTERNAL_ERROR\` | 500 | Bug on our side — credits refunded; the request ID in the response is the fastest way to report it |

## Auto-refund matrix

Credits are refunded automatically on: 404 \`RESOURCE_NOT_FOUND\` (empty upstream — BIL-01), 502 \`UPSTREAM_ERROR\`, 503 \`SERVICE_UNAVAILABLE\`, 500 \`INTERNAL_ERROR\`. Cache hits, 405, 409, and 422 never deduct credits in the first place.

## Client-side validation

Before making any request, the MCP server validates locally that the platform exists, the resource exists, and all required parameters (including \`oneOf\` groups) are present. This avoids burning credits on malformed calls.`,

  idempotency: `# SocialCrawl API — Idempotent Requests (BIL-02)

Any \`/v1/*\` request can be made retry-safe by supplying an \`Idempotency-Key\` header. Network blips, agent retries, and redelivery from a queue stop being a billing risk.

## How to use it

The \`socialcrawl_request\` tool accepts an optional \`idempotencyKey\` parameter:

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

Replays cost **0 credits** — same as cache hits.`,
};

function buildCurl(e: Endpoint): string {
  const parts: string[] = [];

  // Required params with examples.
  for (const p of e.params) {
    parts.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(p.example)}`);
  }

  // If this endpoint has oneOf groups, pick the first member of each group
  // and synthesise a placeholder value so the example is runnable.
  for (const group of e.oneOfGroups) {
    const already = parts.find((piece) => group.some((m) => piece.startsWith(`${m}=`)));
    if (already) continue;
    const member = group[0];
    parts.push(`${encodeURIComponent(member)}=example`);
  }

  const qs = parts.length > 0 ? `?${parts.join("&")}` : "";
  return [
    `curl "https://www.socialcrawl.dev/v1/${e.platform}/${e.resource}${qs}" \\`,
    `  -H "x-api-key: sc_your_api_key_here"`,
  ].join("\n");
}

function buildEndpointBlock(e: Endpoint): string {
  const lines: string[] = [];
  lines.push(`## GET /v1/${e.platform}/${e.resource}`);
  lines.push("");
  lines.push(e.summary);
  lines.push("");
  lines.push(`Credit cost: ${e.creditCost} (${e.creditTier})`);
  lines.push("");

  if (e.params.length > 0) {
    lines.push("Required parameters:");
    for (const p of e.params) {
      lines.push(`- \`${p.name}\`: ${p.description}. Example: \`${p.example}\``);
    }
    lines.push("");
  }

  if (e.oneOfGroups.length > 0) {
    for (const group of e.oneOfGroups) {
      const list = group.map((n) => `\`${n}\``).join(", ");
      lines.push(`Constraint: one of ${list} (at least one required)`);
    }
    lines.push("");
  }

  if (e.optionalParams.length > 0) {
    lines.push("Optional parameters:");
    for (const opt of e.optionalParams) {
      const typeLabel =
        opt.type === "enum" && opt.enumValues
          ? `enum: ${opt.enumValues.join("|")}`
          : opt.type;
      const desc = opt.description ? ` — ${opt.description}` : "";
      lines.push(`- \`${opt.name}\` (${typeLabel})${desc}`);
    }
    lines.push("");
  }

  lines.push("```");
  lines.push(buildCurl(e));
  lines.push("```");

  return lines.join("\n");
}

function buildPlatformDoc(slug: string): string {
  const platform = PLATFORMS.find((p) => p.slug === slug);
  if (!platform) return "";
  const endpoints = getEndpointsByPlatform(slug);
  const header = [
    `# SocialCrawl API — ${platform.name} endpoints`,
    `# Base URL: https://www.socialcrawl.dev`,
    `# Auth: x-api-key header`,
    `# Full docs: https://www.socialcrawl.dev/docs/${slug}`,
    "",
    platform.description,
    "",
    `${endpoints.length} endpoint${endpoints.length === 1 ? "" : "s"}.`,
    "",
  ].join("\n");
  return header + endpoints.map(buildEndpointBlock).join("\n\n");
}

function buildFullDoc(): string {
  const sections: string[] = [
    HANDWRITTEN.overview,
    "",
    "---",
    "",
    "## Authentication",
    "",
    "Every request requires an `x-api-key` header:",
    "",
    "```",
    'curl https://www.socialcrawl.dev/v1/tiktok/profile?handle=charlidamelio \\',
    '  -H "x-api-key: sc_your_api_key_here"',
    "```",
    "",
    "## Response Format",
    "",
    "All responses follow this envelope:",
    "",
    "```json",
    "{",
    '  "success": true,',
    '  "platform": "tiktok",',
    '  "endpoint": "/v1/tiktok/profile",',
    '  "data": { "..." : "..." },',
    '  "credits_used": 1,',
    '  "credits_remaining": 4999,',
    '  "request_id": "req-XXXXX",',
    '  "cached": false',
    "}",
    "```",
    "",
    "---",
    "",
  ];

  for (const platform of PLATFORMS) {
    sections.push(`# ${platform.name}`);
    sections.push("");
    sections.push(platform.description);
    sections.push("");
    const endpoints = getEndpointsByPlatform(platform.slug);
    for (const e of endpoints) {
      sections.push(buildEndpointBlock(e));
      sections.push("");
    }
    sections.push("---");
    sections.push("");
  }

  return sections.join("\n");
}

/**
 * Eagerly-built doc map. Computed at module load so getDoc is a simple lookup.
 */
export const DOCS: Record<string, string> = (() => {
  const out: Record<string, string> = {
    overview: HANDWRITTEN.overview,
    authentication: HANDWRITTEN.authentication,
    credits: HANDWRITTEN.credits,
    errors: HANDWRITTEN.errors,
    idempotency: HANDWRITTEN.idempotency,
    full: buildFullDoc(),
  };
  for (const platform of PLATFORMS) {
    out[platform.slug] = buildPlatformDoc(platform.slug);
  }
  return out;
})();

export function getDoc(topic: string): string | undefined {
  return DOCS[topic];
}

export function getAvailableTopics(): string[] {
  return [
    "overview",
    "full",
    "authentication",
    "credits",
    "errors",
    "idempotency",
    ...PLATFORMS.map((p) => p.slug),
  ];
}

// Silence unused-import warning if tree-shakers ever prune the re-read of ENDPOINTS.
void ENDPOINTS;
