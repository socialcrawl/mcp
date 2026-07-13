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

Unified social media data API. One API key, one response format, ${PLATFORMS.length} platforms, ${ENDPOINTS.length} endpoints — social media, commerce & product reviews, app stores, places & travel, business reputation, web research, full web scraping & browser automation, prediction markets, search trends, Korean search (Naver), content/sentiment analysis, and universal meta-search.

The web-scraping/crawling/browser-automation surface (the \`web\` platform) is driven by the dedicated \`socialcrawl_web\` tool; the stateful monitors wrapper by \`socialcrawl_monitors\`. Everything else goes through \`socialcrawl_request\`.

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
- Flat / metered overrides: \`GET /v1/search/everywhere\` and the Content Analysis aggregate endpoints (\`/v1/content_analysis/*\`, except the 1-credit reference lists) are a flat 20 credits each; the cross-platform Prism composites (\`/v1/prism/*\`) are priced flat or metered per recipe (0–50 credits)

Most endpoints cost 1 credit (standard tier). Heavier endpoints (trending feeds, audience analytics, ad transparency, commerce/app-store data, AI-powered utilities) cost 5 or 10; Content Analysis aggregates are a flat 20, and the Prism composites cost more because they fan out across several endpoints. Use the \`pricing\` docs topic for the cost of every individual endpoint.

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

## Configuring the key in the MCP server

**Local (stdio, \`npx socialcrawl-mcp\`):** the server reads \`SOCIALCRAWL_API_KEY\` from the environment of the MCP process. Set it in the MCP client config (Claude Desktop, Cursor, VS Code, etc.) or as a system environment variable.

**Remote (Streamable HTTP, https://mcp.socialcrawl.dev/mcp):** send the key on every request as an \`Authorization: Bearer <key>\` or \`x-api-key: <key>\` header — in Claude Code: \`claude mcp add --transport http socialcrawl https://mcp.socialcrawl.dev/mcp --header "Authorization: Bearer sc_your_key"\`. Keys are never accepted in the URL or query string.`,

  credits: `# SocialCrawl API — Credits

Every request costs credits. The MCP server pre-calculates cost from the endpoint tier before calling the API, and the response envelope reports both \`credits_used\` and \`credits_remaining\`.

## Tiers

| Tier | Cost per request | Typical use |
|------|------------------|-------------|
| standard | 1 credit | Profile, post, comment, and search endpoints; static reference data (app-store categories/locations/languages) |
| advanced | 5 credits | Trending feeds, audience analytics, ad transparency, GitHub composites, Polymarket research, Amazon/Google Shopping product detail, Trustpilot reviews, Google Business reviews/Q&A, hotel details, app-store search/info/reviews/charts |
| premium | 10 credits | AI-powered utilities (transcript generation, age/gender detection, GitHub user/profile-velocity) and the app-store listings-search database (Google Play / App Store \`app-listings-search\`) |

Some endpoints override this ladder with a flat or metered per-endpoint price. The universal meta-search \`GET /v1/search/everywhere\` is a flat **20 credits** (it fans out across 12+ platforms in parallel); the **Content Analysis** aggregate endpoints (\`/v1/content_analysis/{search,summary,sentiment,rating-distribution,phrase-trends,category-trends}\`) are a flat **20 credits** each (its \`languages\`/\`locations\`/\`categories\`/\`filters\` reference endpoints stay at 1 credit); and the cross-platform **Prism** composites (\`/v1/prism/*\`, plus per-platform composites like \`{platform}/profile/full\`, \`instagram/profile/reels/full\` + \`profile/posts/full\`, and \`reddit/omni-search\`) are priced flat or metered per recipe — anywhere from 0 credits (\`prism/lookup\`) to 50 (\`prism/creator-vet\`) — because each one fans out across several detail endpoints. Metered composites deduct an upfront ceiling and auto-refund down to the actual work done; the response envelope's \`credits_used\` reports the real charge.

For the exact cost of every endpoint, use the \`pricing\` docs topic — it lists all ${ENDPOINTS.length} endpoints with their per-request cost. \`socialcrawl_list_endpoints\` also shows the cost per endpoint for a single platform, and \`socialcrawl_request\` echoes the cost in its response header.

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

  monitors: `# SocialCrawl API — Monitors

Monitors are the **stateful, scheduled wrapper** around any SocialCrawl recipe. A monitor re-runs a registered endpoint or a Prism composite on a cadence, delivers each result to a signed webhook, evaluates alert rules, and accumulates a per-run time-series you can read back. *"Prism answers once; monitors watch it for you."*

Monitors are **not** registry endpoints — they live at \`/v1/monitors/*\` and are managed through the \`socialcrawl_monitors\` tool, not \`socialcrawl_request\`. Auth is the same \`x-api-key\`.

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

Managing monitors (create/list/get/runs/timeseries/pause/delete) costs **0 credits**. Each *scheduled run* bills the underlying recipe's normal cost **plus a 1-credit scheduling premium** — so a daily \`prism/reputation\` monitor costs 30 + 1 = 31 credits per run. Runs skipped for insufficient balance are never charged, and a run whose recipe fails is fully refunded. Use \`estimated_cost_per_run\` / \`estimated_monthly_cost\` (returned by \`create\`) to budget. The webhook auto-pauses after 10 consecutive delivery failures.`,
};

/** Best-effort JSON value for a required body param example (arrays for CSV/JSON). */
function exampleBodyValue(example: string): unknown {
  const trimmed = example.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* fall through */
    }
  }
  if (trimmed.includes(",")) return trimmed.split(",").map((s) => s.trim());
  return example;
}

function buildCurl(e: Endpoint): string {
  const isBody = e.method === "POST" || e.method === "PATCH";

  // Params that ride the query string: all params on GET, only `in: "query"`
  // optional params on a body method.
  const queryParts: string[] = [];
  if (!isBody) {
    for (const p of e.params) {
      queryParts.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(p.example)}`);
    }
    for (const group of e.oneOfGroups) {
      const already = queryParts.find((piece) => group.some((m) => piece.startsWith(`${m}=`)));
      if (already) continue;
      queryParts.push(`${encodeURIComponent(group[0])}=example`);
    }
  } else {
    for (const opt of e.optionalParams) {
      if (opt.in === "query" && opt.example) {
        queryParts.push(`${encodeURIComponent(opt.name)}=${encodeURIComponent(opt.example)}`);
      }
    }
  }
  const qs = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";

  const methodFlag = e.method === "GET" ? "" : `-X ${e.method} `;
  const lines = [
    `curl ${methodFlag}"https://www.socialcrawl.dev/v1/${e.platform}/${e.resource}${qs}" \\`,
    `  -H "x-api-key: sc_your_api_key_here"${isBody && e.params.length > 0 ? " \\" : ""}`,
  ];

  if (isBody && e.params.length > 0) {
    const body: Record<string, unknown> = {};
    for (const p of e.params) {
      if (p.name.startsWith("{")) continue; // path param, not a body field
      body[p.name] = exampleBodyValue(p.example);
    }
    lines.push(`  -H "Content-Type: application/json" \\`);
    lines.push(`  -d '${JSON.stringify(body)}'`);
  }
  return lines.join("\n");
}

function buildEndpointBlock(e: Endpoint): string {
  const lines: string[] = [];
  lines.push(`## ${e.method} /v1/${e.platform}/${e.resource}`);
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

/**
 * Per-endpoint pricing reference, generated from ENDPOINTS so it can never
 * drift from the registry-derived data. Tier counts, overrides, and the
 * full per-platform cost table are all computed.
 */
function buildPricingDoc(): string {
  const tierCounts = { standard: 0, advanced: 0, premium: 0 };
  const overrides: Endpoint[] = [];
  for (const e of ENDPOINTS) {
    tierCounts[e.creditTier] += 1;
    const ladder = { standard: 1, advanced: 5, premium: 10 }[e.creditTier];
    if (e.creditCost !== ladder) overrides.push(e);
  }

  const lines: string[] = [
    "# SocialCrawl API — Per-Endpoint Pricing",
    "",
    `Every one of the ${ENDPOINTS.length} endpoints is billed in credits per request. Three tiers plus flat per-endpoint overrides:`,
    "",
    "| Tier | Cost | Endpoints |",
    "|------|------|-----------|",
    `| standard | 1 credit | ${tierCounts.standard} |`,
    `| advanced | 5 credits | ${tierCounts.advanced} |`,
    `| premium | 10 credits | ${tierCounts.premium} |`,
    ...overrides.map(
      (e) =>
        `| flat override | ${e.creditCost} credits | \`/v1/${e.platform}/${e.resource}\` |`,
    ),
    "",
    "Cache hits, idempotent replays, and `GET /v1/credits/balance` cost 0 credits. Empty upstream results (404 RESOURCE_NOT_FOUND), upstream errors (502), circuit-breaker rejections (503), and internal errors (500) are auto-refunded — see the `credits` topic.",
    "",
    "## Cost per endpoint",
    "",
  ];

  // Rows list `resource` only (method prefixed when not GET); the section
  // header carries the shared `GET /v1/{slug}/…` base path. Grouping by
  // platform makes repeating the full path in every row redundant — and the
  // compact form keeps the whole doc under the 25k truncation limit.
  for (const platform of PLATFORMS) {
    const endpoints = getEndpointsByPlatform(platform.slug);
    lines.push(`### ${platform.name} — \`/v1/${platform.slug}/…\``);
    lines.push("");
    lines.push("| Endpoint | Cost | Tier |");
    lines.push("|----------|------|------|");
    for (const e of endpoints) {
      const label = e.method === "GET" ? e.resource : `${e.method} ${e.resource}`;
      lines.push(`| \`${label}\` | ${e.creditCost}cr | ${e.creditTier} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Preamble for the stateful `web` platform, explaining that it is driven by the
 * dedicated `socialcrawl_web` tool rather than `socialcrawl_request`.
 */
const WEB_DOC_PREAMBLE = `The web platform is driven by the dedicated \`socialcrawl_web\` tool (not \`socialcrawl_request\`), which maps each endpoint to an action:

- Sync reads: \`scrape\`, \`search\`, \`map\`, \`extract\` — return data immediately.
- Async jobs: \`crawl\`, \`batch_scrape\`, \`agent\` submit a job (202); poll it with \`job_get\` / \`job_list\` and stop it with \`job_cancel\`.
- Monitors: \`monitor_create\` / \`monitor_list\` / \`monitor_get\` / \`monitor_update\` / \`monitor_delete\` / \`monitor_checks\` — re-check a URL on a cadence and deliver changes to a webhook.
- Sessions: \`session_create\` / \`session_get\` / \`session_list\` / \`session_execute\` / \`session_close\` — an interactive browser you drive with code.

Billing: managing jobs, monitors, and sessions is 0 credits; you pay for the work (scrape 1cr, search 2cr, extract & session_create 5cr, agent 25cr). \`web/parse\` (document upload) is a multipart endpoint — call \`POST /v1/web/parse\` directly with a file part.
`;

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
    ...(slug === "web" ? [WEB_DOC_PREAMBLE, ""] : []),
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
    monitors: HANDWRITTEN.monitors,
    pricing: buildPricingDoc(),
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
    "monitors",
    "pricing",
    ...PLATFORMS.map((p) => p.slug),
  ];
}
