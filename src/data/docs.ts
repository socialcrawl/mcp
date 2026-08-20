import { PLATFORMS } from "./platforms.js";
import { ENDPOINTS, getEndpointsByPlatform } from "./endpoints.js";
import { CREDIT_LADDER } from "./registry-meta.js";
import { HANDWRITTEN } from "./docs-handwritten.js";
import {
  endpointLabel,
  formatCost,
  formatTtl,
  meteredRule,
  worstCaseCost,
} from "../pricing.js";
import type { Endpoint } from "../types.js";

/**
 * Documentation topics. The cross-cutting contracts are hand-written in
 * `docs-handwritten.ts`; everything endpoint-specific — the per-platform docs,
 * the `pricing` reference, and the `full` reference — is generated at runtime
 * from the ENDPOINTS / PLATFORMS data so it can never drift from the backend
 * registry.
 */

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
      const member = e.optionalParams.find((o) => o.name === group[0]);
      queryParts.push(
        `${encodeURIComponent(group[0])}=${encodeURIComponent(member?.example ?? "example")}`,
      );
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

/** Optional-param line carrying its type, bounds, enum set, and couplings. */
function optionalParamLine(e: Endpoint, opt: Endpoint["optionalParams"][number]): string {
  const bits: string[] = [];
  if (opt.type === "enum" && opt.enumValues) {
    bits.push(`enum: ${opt.enumValues.join("|")}`);
  } else {
    bits.push(opt.type);
  }
  if (opt.minimum !== undefined || opt.maximum !== undefined) {
    bits.push(`range ${opt.minimum ?? ""}-${opt.maximum ?? ""}`);
  }
  const csv = e.csvConstraints?.[opt.name];
  if (csv) {
    const csvBits = ["CSV"];
    if (csv.max !== undefined) csvBits.push(`max ${csv.max}`);
    if (csv.enumValues) csvBits.push(`each of ${csv.enumValues.join("|")}`);
    bits.push(csvBits.join(", "));
  }
  if (opt.in === "query" && e.method !== "GET") bits.push("query param");

  const notes: string[] = [];
  if (opt.requires) notes.push(`Requires \`${opt.requires}\`.`);
  if (opt.couplesWith) {
    notes.push(`Requires \`${opt.couplesWith.param}=${opt.couplesWith.value}\`.`);
  }

  const desc = opt.description ? ` — ${opt.description}` : "";
  return `- \`${opt.name}\` (${bits.join("; ")})${desc}${notes.length > 0 ? ` ${notes.join(" ")}` : ""}`;
}

function buildEndpointBlock(e: Endpoint): string {
  const lines: string[] = [];
  lines.push(`## ${e.method} /v1/${e.platform}/${e.resource}`);
  lines.push("");
  lines.push(e.summary);
  lines.push("");
  lines.push(`Credit cost: ${formatCost(e.pricing)}`);
  if (e.pricing.description) {
    lines.push(`Pricing rule: ${e.pricing.description}`);
  }
  lines.push(`Response: ${e.archetype} · Cache: ${formatTtl(e.cache.ttlSeconds)} (${e.cache.category})`);
  lines.push("");

  if (e.params.length > 0) {
    lines.push("Required parameters:");
    for (const p of e.params) {
      const csv = e.csvConstraints?.[p.name];
      const csvNote = csv
        ? ` (CSV${csv.max !== undefined ? `, max ${csv.max}` : ""}${csv.enumValues ? `, each of ${csv.enumValues.join("|")}` : ""})`
        : "";
      lines.push(`- \`${p.name}\`${csvNote}: ${p.description} Example: \`${p.example}\``);
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
    for (const opt of e.optionalParams) lines.push(optionalParamLine(e, opt));
    lines.push("");
  }

  const notes: string[] = [];
  if (e.pagination) {
    notes.push(
      `Paging: ${e.pagination.style} — pass \`cursor\` (native \`${e.pagination.nativeParam}\`)${
        e.pagination.limitParam
          ? `, page size \`${e.pagination.limitParam}\`${e.pagination.limitMax !== undefined ? ` (max ${e.pagination.limitMax})` : ""}`
          : ""
      }; stop on \`pagination.has_more === false\`.`,
    );
  }
  if (e.paginatable) notes.push("Paging: walks every page server-side in one call.");
  if (e.collectUntilN) notes.push(`\`limit\` is collect-until-N: ${e.collectUntilN}`);
  if (e.execution === "async") notes.push("Async: submits a job (202) — poll for the result.");
  if (e.streaming) {
    notes.push(
      e.streaming === "accept-header"
        ? "Streaming: send `Accept: text/event-stream` for SSE."
        : e.streaming === "always"
          ? "Streaming: always SSE."
          : `Streaming: streams when \`${e.streaming}\`.`,
    );
  }
  if (e.emptyOn404) {
    notes.push("Empty is not an error: an upstream 404 returns 200 `{items: []}` with the credit refunded.");
  }
  if (e.upstream.fallbackKinds && e.upstream.fallbackKinds.length > 0) {
    notes.push(
      `Sources: \`${e.upstream.kind}\` primary, falling back to ${e.upstream.fallbackKinds.map((k) => `\`${k}\``).join(", ")}.`,
    );
  }
  if (e.contractDetails && e.contractDetails.length > 0) {
    notes.push(`Contract: ${e.contractDetails.join(" ")}`);
  }
  if (notes.length > 0) {
    lines.push(...notes.map((n) => `> ${n}`));
    lines.push("");
  }

  lines.push("```");
  lines.push(buildCurl(e));
  lines.push("```");

  return lines.join("\n");
}

/**
 * Per-endpoint pricing reference, generated from ENDPOINTS so it can never
 * drift from the registry-derived data. Rows list `resource` only (method
 * prefixed when not GET) with the shared `/v1/{slug}/…` base in the section
 * header — repeating the full path in every one of ~380 rows would blow past
 * the response character limit and truncate the tail of the table.
 */
function buildPricingDoc(): string {
  const byModel = { ladder: 0, flat: 0, metered: 0 };
  const ladderCounts = { standard: 0, advanced: 0, premium: 0 };
  for (const e of ENDPOINTS) {
    byModel[e.pricing.model] += 1;
    if (e.pricing.model === "ladder") ladderCounts[e.pricing.tier] += 1;
  }
  const metered = ENDPOINTS.filter((e) => e.pricing.model === "metered");
  const free = ENDPOINTS.filter((e) => e.pricing.cost === 0);
  const flatPriced = ENDPOINTS.filter(
    (e) => e.pricing.model === "flat" && e.pricing.cost > 0,
  );

  const lines: string[] = [
    "# SocialCrawl API — Per-Endpoint Pricing",
    "",
    `All ${ENDPOINTS.length} endpoints, billed in credits per request. Three billing models:`,
    "",
    "| Model | Endpoints | How it charges |",
    "|-------|-----------|----------------|",
    `| ladder | ${byModel.ladder} | The tier rate per request: standard ${CREDIT_LADDER.standard}, advanced ${CREDIT_LADDER.advanced}, premium ${CREDIT_LADDER.premium}. |`,
    `| flat | ${byModel.flat} | A per-endpoint override (${free.length} of them free at 0cr). |`,
    `| metered | ${byModel.metered} | Query-dependent: a ceiling is deducted, then refunded down to the work actually done. |`,
    "",
    `Ladder-priced by tier: standard ${ladderCounts.standard} · advanced ${ladderCounts.advanced} · premium ${ladderCounts.premium}.`,
    "",
    "Cache hits, idempotent replays, empty results (404 RESOURCE_NOT_FOUND or 200 `{items:[]}`), upstream errors (502), circuit-breaker rejections (503), internal errors (500), deadline 504s, and `GET /v1/credits/{balance,transactions}` all cost 0 credits — see the `credits` topic.",
    "",
    `## Free endpoints (${free.length})`,
    "",
    free.map((e) => `\`${e.method === "GET" ? "" : `${e.method} `}/v1/${e.platform}/${e.resource}\``).join(" · "),
    "",
    `## Flat overrides (${flatPriced.length} priced)`,
    "",
    "| Endpoint | Cost |",
    "|----------|------|",
    ...flatPriced.map(
      (e) =>
        `| \`${e.method === "GET" ? "" : `${e.method} `}/v1/${e.platform}/${e.resource}\` | ${e.pricing.cost}cr |`,
    ),
    "",
    `## Metered endpoints (${metered.length}) — the charge depends on your request`,
    "",
    "| Endpoint | Band | Rule |",
    "|----------|------|------|",
    ...metered.map(
      (e) =>
        `| \`${e.method === "GET" ? "" : `${e.method} `}/v1/${e.platform}/${e.resource}\` | ${formatCost(e.pricing)} | ${meteredRule(e.pricing)} |`,
    ),
    "",
    "## Cost per endpoint",
    "",
  ];

  // Grouped by price within each platform rather than one row per endpoint:
  // ~380 table rows overflow the response character limit and truncate the
  // tail, and the price is the only column that varies row to row anyway.
  for (const platform of PLATFORMS) {
    const endpoints = getEndpointsByPlatform(platform.slug);
    const byPrice = new Map<string, string[]>();
    for (const e of endpoints) {
      const key = formatCost(e.pricing);
      const bucket = byPrice.get(key) ?? [];
      bucket.push(`\`${endpointLabel(e)}\``);
      byPrice.set(key, bucket);
    }
    lines.push(
      `**${platform.name}** \`/v1/${platform.slug}/…\` — ` +
        [...byPrice.entries()]
          .map(([price, resources]) => `**${price}:** ${resources.join(", ")}`)
          .join(" · "),
    );
    lines.push("");
  }

  lines.push(
    "For one endpoint's exact price, metered rule, price-driving parameters, and worst case, use the `socialcrawl_pricing` tool.",
  );

  return lines.join("\n");
}

/**
 * Preamble for the stateful `web` platform, explaining that it is driven by the
 * dedicated `socialcrawl_web` tool rather than `socialcrawl_request`.
 */
const WEB_DOC_PREAMBLE = `The web platform is driven by the dedicated \`socialcrawl_web\` tool (not \`socialcrawl_request\`), which maps each endpoint to an action:

- Sync reads: \`scrape\`, \`search\`, \`map\`, \`extract\` — return data immediately.
- Async jobs: \`crawl\`, \`batch_scrape\`, \`agent\` submit a job (202); poll it with \`job_get\` / \`job_list\`, read per-page failures with \`job_errors\`, and stop it with \`job_cancel\`. \`crawl_preview\` dry-runs a crawl's parameters for free before you pay for it.
- Monitors: \`monitor_create\` / \`monitor_list\` / \`monitor_get\` / \`monitor_update\` / \`monitor_delete\` / \`monitor_checks\` — re-check a URL on a cadence and deliver changes to a webhook.
- Sessions: \`session_create\` / \`session_get\` / \`session_list\` / \`session_execute\` / \`session_close\` — an interactive browser you drive with code.

Billing: managing jobs, monitors, and sessions is 0 credits; you pay for the work, and most of it is metered rather than flat (a crawl holds \`limit\` credits and refunds the pages it never crawled; a session holds against \`ttl_seconds\` and settles on close). \`web/parse\` (document upload) is a multipart endpoint — call \`POST /v1/web/parse\` directly with a file part.
`;

function buildPlatformDoc(slug: string): string {
  const platform = PLATFORMS.find((p) => p.slug === slug);
  if (!platform) return "";
  const endpoints = getEndpointsByPlatform(slug);
  const cheapest = Math.min(...endpoints.map((e) => e.pricing.cost));
  const dearest = Math.max(...endpoints.map((e) => worstCaseCost(e.pricing)));
  const header = [
    `# SocialCrawl API — ${platform.name} endpoints`,
    `# Base URL: https://www.socialcrawl.dev`,
    `# Auth: x-api-key header`,
    `# Full docs: https://www.socialcrawl.dev/docs/${slug}`,
    "",
    platform.description,
    "",
    ...(slug === "web" ? [WEB_DOC_PREAMBLE, ""] : []),
    `${endpoints.length} endpoint${endpoints.length === 1 ? "" : "s"}, ${cheapest}-${dearest} credits per call.`,
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
    "`credits_used` is the settled charge — for a metered endpoint that is the post-refund number, not the upfront hold.",
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

/** Fixed (non-platform) topics, in the order they are offered to callers. */
export const FIXED_TOPICS = [
  "overview",
  "setup",
  "full",
  "authentication",
  "credits",
  "pricing",
  "errors",
  "idempotency",
  "pagination",
  "caching",
  "response-schema",
  "limits",
  "monitors",
  "discovery",
] as const;

/**
 * Eagerly-built doc map. Computed at module load so getDoc is a simple lookup.
 */
export const DOCS: Record<string, string> = (() => {
  const out: Record<string, string> = {
    overview: HANDWRITTEN.overview,
    setup: HANDWRITTEN.setup,
    authentication: HANDWRITTEN.authentication,
    credits: HANDWRITTEN.credits,
    errors: HANDWRITTEN.errors,
    idempotency: HANDWRITTEN.idempotency,
    pagination: HANDWRITTEN.pagination,
    caching: HANDWRITTEN.caching,
    "response-schema": HANDWRITTEN["response-schema"],
    limits: HANDWRITTEN.limits,
    discovery: HANDWRITTEN.discovery,
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
  return [...FIXED_TOPICS, ...PLATFORMS.map((p) => p.slug)];
}

