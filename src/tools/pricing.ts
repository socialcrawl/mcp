import { ENDPOINTS, findEndpoint, getEndpointsByPlatform } from "../data/endpoints.js";
import { PLATFORMS, findPlatform } from "../data/platforms.js";
import { CACHE_TTLS, CREDIT_LADDER, REGISTRY_STATS } from "../data/registry-meta.js";
import {
  bestCaseCost,
  endpointLabel,
  endpointPath,
  explainPricing,
  flatOverrideEndpoints,
  formatCost,
  formatTtl,
  freeEndpoints,
  meteredEndpoints,
  meteredRule,
  worstCaseCost,
} from "../pricing.js";
import type { Endpoint } from "../types.js";

/**
 * The pricing tool. Everything a caller needs to answer "what will this cost
 * me" without spending a credit to find out: the tier ladder, every flat
 * override, every metered band with its exact rule, per-platform cost tables,
 * budget-filtered rankings, and the refund/cache rules that make the real
 * charge differ from the sticker price.
 */

export type PricingAction = "overview" | "endpoint" | "platform" | "list";

export interface PricingParams {
  action?: PricingAction;
  platform?: string;
  resource?: string;
  method?: string;
  search?: string;
  model?: "ladder" | "flat" | "metered" | "free";
  maxCost?: number;
  minCost?: number;
  sort?: "cost_asc" | "cost_desc" | "platform" | "name";
  limit?: number;
}

const BILLING_RULES = [
  "**Cache hits are free.** A repeat of the same call inside the endpoint's TTL returns `cached: true` and deducts 0 credits.",
  "**Idempotent replays are free.** Re-sending a request with the same `Idempotency-Key` (24h TTL) returns the stored response and deducts 0 new credits.",
  "**Empty results are refunded.** An empty single-object lookup returns 404 `RESOURCE_NOT_FOUND` and an empty list returns 200 `{items: []}` — both auto-refund the deduction, so a missing profile or a zero-match search costs nothing.",
  "**Failures are refunded.** 502 `UPSTREAM_ERROR`, 503 `SERVICE_UNAVAILABLE`, 500 `INTERNAL_ERROR`, and request-deadline 504s all reverse the charge. 400/401/402/405/409/422/429 never deduct in the first place (validation runs before billing).",
  "**Metered endpoints deduct a ceiling and refund down.** The upfront hold is the worst case for your query; the settled charge is the work actually done, reported as `credits_used` in the envelope and the `X-Credits-Used` header.",
  "**`/v1/search/everywhere` has a coverage floor.** Zero usable items = full refund; coverage below 50% of the called sources = 50% refund (10cr instead of 20cr).",
  "**Monitors add +1 credit per scheduled run** on top of the recipe's own cost. Managing monitors is free.",
];

function matchesFilters(e: Endpoint, p: PricingParams): boolean {
  if (p.platform && e.platform !== p.platform) return false;
  if (p.method && e.method !== p.method.toUpperCase()) return false;
  if (p.model) {
    if (p.model === "free" ? e.pricing.cost !== 0 : e.pricing.model !== p.model) {
      return false;
    }
  }
  if (p.maxCost !== undefined && worstCaseCost(e.pricing) > p.maxCost) return false;
  if (p.minCost !== undefined && bestCaseCost(e.pricing) < p.minCost) return false;
  if (p.search) {
    const q = p.search.toLowerCase();
    const haystack =
      `${e.platform} ${e.resource} ${e.summary} ${e.archetype} ${e.actionLabel ?? ""} ${e.group ?? ""}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

function sortEndpoints(list: Endpoint[], sort: PricingParams["sort"]): Endpoint[] {
  const byName = (a: Endpoint, b: Endpoint) =>
    a.platform.localeCompare(b.platform) || a.resource.localeCompare(b.resource);
  switch (sort) {
    case "cost_desc":
      return [...list].sort(
        (a, b) => worstCaseCost(b.pricing) - worstCaseCost(a.pricing) || byName(a, b),
      );
    case "cost_asc":
      return [...list].sort(
        (a, b) => worstCaseCost(a.pricing) - worstCaseCost(b.pricing) || byName(a, b),
      );
    case "name":
      return [...list].sort((a, b) => a.resource.localeCompare(b.resource));
    default:
      return [...list].sort(byName);
  }
}

function costTable(list: Endpoint[], withPlatform: boolean): string[] {
  const head = withPlatform
    ? ["| Endpoint | Price | Model | Tier | Cache |", "|----------|-------|-------|------|-------|"]
    : ["| Endpoint | Price | Model | Tier | Cache |", "|----------|-------|-------|------|-------|"];
  const rows = list.map((e) => {
    const label = withPlatform
      ? `${e.method === "GET" ? "" : `${e.method} `}/v1/${e.platform}/${e.resource}`
      : endpointLabel(e);
    return `| \`${label}\` | ${formatCost(e.pricing)} | ${e.pricing.model} | ${e.pricing.tier} | ${formatTtl(e.cache.ttlSeconds)} |`;
  });
  return [...head, ...rows];
}

function buildOverview(): string {
  const ladderCounts = { standard: 0, advanced: 0, premium: 0 };
  for (const e of ENDPOINTS) {
    if (e.pricing.model === "ladder") ladderCounts[e.pricing.tier] += 1;
  }
  const metered = meteredEndpoints();
  const flat = flatOverrideEndpoints();
  const free = freeEndpoints();

  const lines: string[] = [
    "# SocialCrawl Pricing — Overview",
    "",
    `${ENDPOINTS.length} endpoints across ${PLATFORMS.length} platforms. Every call is billed in credits. Three billing models:`,
    "",
    "| Model | Endpoints | What it means |",
    "|-------|-----------|---------------|",
    `| ladder | ${ENDPOINTS.filter((e) => e.pricing.model === "ladder").length} | The flat tier rate, charged per request. |`,
    `| flat | ${flat.length} | A per-endpoint override off the ladder (includes the ${free.length} free endpoints). |`,
    `| metered | ${metered.length} | Query-dependent: a ceiling is deducted, then refunded down to the work actually done. |`,
    "",
    "## Tier ladder",
    "",
    "| Tier | Rate | Ladder-priced endpoints | Typical use |",
    "|------|------|-------------------------|-------------|",
    `| standard | ${CREDIT_LADDER.standard} credit | ${ladderCounts.standard} | Profiles, posts, comments, search, reference data |`,
    `| advanced | ${CREDIT_LADDER.advanced} credits | ${ladderCounts.advanced} | Trending feeds, audience analytics, ad libraries, commerce/app-store/places data |`,
    `| premium | ${CREDIT_LADDER.premium} credits | ${ladderCounts.premium} | AI transcripts, LinkedIn people/job search, app-listings databases |`,
    "",
    `Counting every endpoint under its declared tier (overrides folded back in): standard ${REGISTRY_STATS.standardEndpoints}, advanced ${REGISTRY_STATS.advancedEndpoints}, premium ${REGISTRY_STATS.premiumEndpoints}.`,
    "",
    `## Free endpoints (${free.length}) — 0 credits`,
    "",
    ...free.map((e) => `- \`${endpointPath(e)}\`${e.summary ? ` — ${e.summary}` : ""}`),
    "",
    "Plus the meta endpoints `GET /v1/credits/balance` and `GET /v1/credits/transactions` (`socialcrawl_check_balance`), and all monitor management (`socialcrawl_monitors`).",
    "",
    `## Flat overrides (${flat.filter((e) => e.pricing.cost > 0).length} priced)`,
    "",
    "| Endpoint | Price |",
    "|----------|-------|",
    ...flat
      .filter((e) => e.pricing.cost > 0)
      .map((e) => `| \`${endpointPath(e)}\` | ${e.pricing.cost}cr |`),
    "",
    `## Metered endpoints (${metered.length}) — price depends on the request`,
    "",
    "| Endpoint | Band | Rule |",
    "|----------|------|------|",
    ...metered.map(
      (e) =>
        `| \`${endpointPath(e)}\` | ${formatCost(e.pricing)} | ${meteredRule(e.pricing)} |`,
    ),
    "",
    "## Cache TTLs (a hit costs 0 credits)",
    "",
    "| Category | TTL |",
    "|----------|-----|",
    ...Object.entries(CACHE_TTLS).map(
      ([cat, ttl]) => `| ${cat} | ${formatTtl(ttl)} |`,
    ),
    "",
    "## Billing rules that change what you actually pay",
    "",
    ...BILLING_RULES.map((r) => `- ${r}`),
    "",
    "Next: `action: \"endpoint\"` with a platform + resource for one endpoint's exact price, `action: \"platform\"` for a whole platform's cost table, or `action: \"list\"` with `maxCost` / `model` / `sort` to rank endpoints by price.",
  ];

  return lines.join("\n");
}

function buildEndpointDetail(params: PricingParams): string {
  const platform = params.platform!;
  const resource = params.resource!;
  const endpoint = findEndpoint(platform, resource, params.method?.toUpperCase());
  if (!endpoint) {
    const alternatives = getEndpointsByPlatform(platform)
      .filter((e) => e.resource.includes(resource) || resource.includes(e.resource))
      .slice(0, 5);
    return [
      `Error: No endpoint "${resource}" on platform "${platform}"${params.method ? ` with method ${params.method.toUpperCase()}` : ""}.`,
      ...(alternatives.length > 0
        ? ["", "Did you mean:", ...alternatives.map((e) => `- \`${endpointLabel(e)}\``)]
        : []),
      "",
      `Use socialcrawl_list_endpoints with platform "${platform}" to see every resource.`,
    ].join("\n");
  }

  const lines: string[] = [
    `# Pricing — \`${endpointPath(endpoint)}\``,
    "",
    endpoint.summary,
    "",
    ...explainPricing(endpoint),
    "",
    "## Worst case for budgeting",
    "",
    `A single call can deduct at most **${worstCaseCost(endpoint.pricing)} credits** and at least **${bestCaseCost(endpoint.pricing)} credits** (0 on a cache hit, an empty result, or an upstream failure).`,
  ];

  if (endpoint.pricing.model === "metered") {
    lines.push(
      "",
      "The upfront hold is the ceiling for your specific query; the settled charge comes back in `credits_used`. Read it from the response envelope rather than assuming the hold.",
    );
  }

  if (endpoint.paginatable || endpoint.pagination) {
    lines.push(
      "",
      "## Paging cost",
      "",
      endpoint.paginatable
        ? "This endpoint walks every page server-side — one call, one metered charge covering the whole walk."
        : `Each page is a separate billed request. Page with \`cursor\` (the universal alias for \`${endpoint.pagination!.nativeParam}\`) and stop on \`pagination.has_more === false\`; a wrong cursor name is a free 400, not a silent re-bill of page 1.`,
    );
    if (endpoint.collectUntilN) {
      lines.push(
        "",
        `\`limit\` here is **collect-until-N**, not a page size: ${endpoint.collectUntilN} Billing follows the pages actually consumed, with the unused budget refunded.`,
      );
    }
  }

  if (endpoint.contractDetails && endpoint.contractDetails.length > 0) {
    lines.push("", "## Contract details", "", ...endpoint.contractDetails.map((d) => `- ${d}`));
  }

  return lines.join("\n");
}

function buildPlatformTable(slug: string): string {
  const platform = findPlatform(slug);
  if (!platform) {
    return `Error: Unknown platform "${slug}". Use socialcrawl_list_platforms to see available platforms.`;
  }
  const endpoints = getEndpointsByPlatform(slug);
  const metered = endpoints.filter((e) => e.pricing.model === "metered");
  const cheapest = Math.min(...endpoints.map((e) => bestCaseCost(e.pricing)));
  const dearest = Math.max(...endpoints.map((e) => worstCaseCost(e.pricing)));

  const lines: string[] = [
    `# Pricing — ${platform.name} (\`/v1/${slug}/…\`)`,
    "",
    `${endpoints.length} endpoint${endpoints.length === 1 ? "" : "s"}, ${cheapest}-${dearest} credits per call.`,
    "",
    ...costTable(endpoints, false),
  ];

  if (metered.length > 0) {
    lines.push(
      "",
      "## Metered rules",
      "",
      ...metered.flatMap((e) => [
        `**\`${endpointLabel(e)}\`** — ${formatCost(e.pricing)}`,
        meteredRule(e.pricing),
        "",
      ]),
    );
  }

  lines.push(
    "",
    "Cache hits, idempotent replays, empty results, and upstream failures all cost 0 credits — see `action: \"overview\"` for the full refund matrix.",
  );

  return lines.join("\n");
}

function buildList(params: PricingParams): string {
  const limit = Math.min(Math.max(params.limit ?? 40, 1), 200);
  const filtered = ENDPOINTS.filter((e) => matchesFilters(e, params));
  const sorted = sortEndpoints(filtered, params.sort ?? "cost_desc");
  const shown = sorted.slice(0, limit);

  const criteria: string[] = [];
  if (params.platform) criteria.push(`platform \`${params.platform}\``);
  if (params.method) criteria.push(`method \`${params.method.toUpperCase()}\``);
  if (params.model) criteria.push(`model \`${params.model}\``);
  if (params.search) criteria.push(`matching "${params.search}"`);
  if (params.maxCost !== undefined) criteria.push(`costing at most ${params.maxCost}cr`);
  if (params.minCost !== undefined) criteria.push(`costing at least ${params.minCost}cr`);

  if (shown.length === 0) {
    return [
      `No endpoints match${criteria.length > 0 ? ` ${criteria.join(", ")}` : ""}.`,
      "",
      "Relax a filter, or use `action: \"overview\"` for the full pricing picture.",
    ].join("\n");
  }

  const totalWorstCase = shown.reduce((sum, e) => sum + worstCaseCost(e.pricing), 0);

  return [
    `# Pricing — ${filtered.length} endpoint${filtered.length === 1 ? "" : "s"}${criteria.length > 0 ? ` (${criteria.join(", ")})` : ""}`,
    "",
    shown.length < filtered.length
      ? `Showing the first ${shown.length} sorted by \`${params.sort ?? "cost_desc"}\`. Raise \`limit\` (max 200) or narrow the filters for the rest.`
      : `Sorted by \`${params.sort ?? "cost_desc"}\`.`,
    "",
    ...costTable(shown, true),
    "",
    `Calling every endpoint listed above once would deduct at most **${totalWorstCase} credits**.`,
    "",
    "Metered rows show their full band — the settled charge lands somewhere inside it and is reported as `credits_used`.",
  ].join("\n");
}

export function pricing(params: PricingParams): string {
  const action = params.action ?? "overview";

  switch (action) {
    case "endpoint":
      if (!params.platform || !params.resource) {
        return 'Error: `action: "endpoint"` requires both `platform` and `resource` (e.g. platform "prism", resource "comments").';
      }
      return buildEndpointDetail(params);
    case "platform":
      if (!params.platform) {
        return 'Error: `action: "platform"` requires `platform` (e.g. "tiktok").';
      }
      return buildPlatformTable(params.platform);
    case "list":
      return buildList(params);
    case "overview":
      return buildOverview();
    default:
      return `Error: Unknown action "${String(action)}". Valid actions: overview, endpoint, platform, list.`;
  }
}
