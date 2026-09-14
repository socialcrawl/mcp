import { ENDPOINTS, findEndpoint, getEndpointsByPlatform } from "../data/endpoints.js";
import { PLATFORMS, findPlatform } from "../data/platforms.js";
import { CACHE_TTLS, CREDIT_LADDER, REGISTRY_STATS } from "../data/registry-meta.js";
import {
  describeLane,
  hydratingEndpoints,
  laneCeilingCredits,
  laneMaxCredits,
  quoteHydration,
} from "../hydration.js";
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
  hydrationCeiling,
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

export type PricingAction =
  | "overview"
  | "endpoint"
  | "platform"
  | "list"
  | "hydration";

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
  /** endpoint: the `include=` tokens you intend to send, for an exact quote. */
  include?: string;
  /** endpoint: the row cap you intend to send, which shrinks the hold. */
  rows?: number;
}

const BILLING_RULES = [
  "**Cache hits are free.** A repeat of the same call inside the endpoint's TTL returns `cached: true` and deducts 0 credits.",
  "**Idempotent replays are free.** Re-sending a request with the same `Idempotency-Key` (24h TTL) returns the stored response and deducts 0 new credits.",
  "**Empty results are refunded.** An empty single-object lookup returns 404 `RESOURCE_NOT_FOUND` and an empty list returns 200 `{items: []}` — both auto-refund the deduction, so a missing profile or a zero-match search costs nothing.",
  "**Failures are refunded.** 502 `UPSTREAM_ERROR`, 503 `SERVICE_UNAVAILABLE`, 500 `INTERNAL_ERROR`, and request-deadline 504s all reverse the charge. 400/401/402/405/409/422/429 never deduct in the first place (validation runs before billing).",
  "**Metered endpoints deduct a ceiling and refund down.** The upfront hold is the worst case for your query; the settled charge is the work actually done, reported as `credits_used` in the envelope and the `X-Credits-Used` header.",
  "**`/v1/search/everywhere` has a coverage floor.** Zero usable items = full refund; coverage below 50% of the called sources = 50% refund (10cr instead of 20cr).",
  "**Row joins (`include=`) hold per row and keep per row FILLED.** On the endpoints that offer one, the ceiling is held up front, a credit is kept only for a row a fresh sibling lookup actually filled, and every other slot is refunded — rows served from the sibling's cache are free, unfillable rows are free, and a page that joined in full is cached whole. See `action: \"hydration\"`.",
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
    `A single call can deduct at most **${worstCaseCost(endpoint.pricing)} credit${worstCaseCost(endpoint.pricing) === 1 ? "" : "s"}** and at least **${bestCaseCost(endpoint.pricing)} credit${bestCaseCost(endpoint.pricing) === 1 ? "" : "s"}** (0 on a cache hit, an empty result, or an upstream failure).`,
  ];

  if (endpoint.pricing.model === "metered") {
    lines.push(
      "",
      "The upfront hold is the ceiling for your specific query; the settled charge comes back in `credits_used`. Read it from the response envelope rather than assuming the hold.",
    );
  }

  // An exact quote beats a band. Once the caller says which joins they intend
  // to ask for, the hold is not a range at all — it is arithmetic, and this is
  // the same arithmetic the backend's pricer runs.
  if (endpoint.hydration && endpoint.hydration.length > 0) {
    const quote = quoteHydration(endpoint, params.include, params.rows);
    lines.push("", "## Your quote");
    if (params.include === undefined) {
      lines.push(
        "",
        `Without \`include\`, this call is exactly **${endpoint.pricing.cost} credit${endpoint.pricing.cost === 1 ? "" : "s"}** — the joins are opt-in, and nothing changes for a caller who never asks.`,
        "",
        `Pass \`include\` (and \`rows\`, if you intend to send a row cap) to price a specific join: e.g. \`include: "${endpoint.hydration[0].token}"\`.`,
      );
    } else {
      if (quote.unknownTokens.length > 0) {
        lines.push(
          "",
          `**This endpoint does not offer ${quote.unknownTokens.map((t) => `\`${t}\``).join(", ")}.** It accepts ${endpoint.hydration.map((l) => `\`${l.token}\``).join(", ")}. An unknown token is rejected before billing (a free 400) — but it also joins nothing.`,
        );
      }
      lines.push(
        "",
        `\`include=${params.include}\`${params.rows !== undefined ? ` with a row cap of ${params.rows}` : ""} holds **${quote.held} credits** up front:`,
        "",
        "| Part | Rows | Held |",
        "|------|------|------|",
        `| the page itself | — | ${quote.base}cr |`,
        ...quote.lanes.map(
          (l) =>
            `| \`${l.lane.param}=${l.lane.token}\` → \`${l.lane.sibling}\` | ${l.rows} | ${l.held}cr |`,
        ),
      );
      if (quote.lanes.length > 0) {
        lines.push(
          "",
          `It settles between **${quote.floor}** and **${quote.held}** credits: ${quote.base} for the page, and each join keeps ${quote.lanes
            .map((l) => `${l.lane.creditsPerItem}cr`)
            .join(" / ")} only for a row a fresh sibling lookup actually filled. Every cached row, every unfillable row and every unused slot is refunded.`,
        );
        const capped = quote.lanes.filter((l) => l.lane.rowLimitParam);
        if (params.rows === undefined && capped.length > 0) {
          lines.push(
            "",
            `To hold less, send \`${capped[0].lane.rowLimitParam}\` — it caps the rows joined and the credits together.`,
          );
        }
      }
    }
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

/**
 * The catalogue of opt-in row joins, priced.
 *
 * This answers "what can I get in ONE call, and what does it cost" — the
 * question the engine was built for. Before it, a caller paid for a page and
 * then paid again, per row, to fill the page in; this is the same work at the
 * sibling's price with the cache hits taken off.
 */
function buildHydrationCatalogue(params: PricingParams): string {
  const all = hydratingEndpoints();
  const scoped = params.platform
    ? all.filter((e) => e.platform === params.platform)
    : all;

  if (scoped.length === 0) {
    return [
      params.platform
        ? `No endpoint on \`${params.platform}\` offers an \`include=\` row join.`
        : "No endpoint offers an `include=` row join.",
      "",
      `${all.length} endpoint${all.length === 1 ? "" : "s"} across ${new Set(all.map((e) => e.platform)).size} platforms do — drop \`platform\` to see them all.`,
    ].join("\n");
  }

  const laneCount = scoped.reduce((n, e) => n + (e.hydration?.length ?? 0), 0);
  const lines: string[] = [
    `# Row hydration — ${laneCount} join${laneCount === 1 ? "" : "s"} across ${scoped.length} endpoint${scoped.length === 1 ? "" : "s"}${params.platform ? ` on ${params.platform}` : ""}`,
    "",
    "A list endpoint whose rows are thin by construction can fill them from a sibling endpoint **inside the same call**, when you ask with `include=`. A caller who does not ask pays exactly what they always paid.",
    "",
    "**How it is billed:** the ceiling is held up front; a credit is KEPT only for a row a fresh sibling lookup actually filled. Rows served from the sibling's cache are free, rows it could not fill are refunded, and a page that joined in full is cached whole — so an immediate repeat is 0 credits. `credits_used` is the real charge, and `data.hydration` itemises rows, lookups, cache hits, credits held/kept and milliseconds.",
    "",
    "| Endpoint | Token | Joins to | Per row | Max rows | Plain | With every join |",
    "|----------|-------|----------|---------|----------|-------|-----------------|",
  ];

  for (const e of scoped) {
    for (const lane of e.hydration ?? []) {
      const rate = lane.batch
        ? `${lane.creditsPerItem}cr (cap ${lane.batch.creditCap} per ${lane.batch.size})`
        : `${lane.creditsPerItem}cr`;
      const siblingPrefix =
        lane.siblingMethod && lane.siblingMethod !== "GET"
          ? `${lane.siblingMethod} `
          : "";
      lines.push(
        `| \`${endpointPath(e)}\` | \`${lane.token}\` | \`${siblingPrefix}/v1/${lane.sibling}\` | ${rate} | ${lane.maxItems}${lane.defaultRowLimit !== undefined ? ` (${lane.defaultRowLimit} by default)` : ""} | ${e.pricing.cost}cr | ${e.pricing.cost + hydrationCeiling(e)}cr |`,
      );
    }
  }

  lines.push("", "## What each join fills", "");
  for (const e of scoped) {
    for (const lane of e.hydration ?? []) {
      lines.push(
        `**\`${endpointPath(e)}\` + \`${lane.param}=${lane.token}\`** — the join holds ${laneCeilingCredits(lane) === laneMaxCredits(lane) ? `at most ${laneMaxCredits(lane)}cr` : `${laneCeilingCredits(lane)}cr by default and ${laneMaxCredits(lane)}cr for a full page`}, on top of the ${e.pricing.cost}cr page.`,
        lane.fills.map((f) => `\`${f}\``).join(", "),
        "",
      );
    }
  }

  lines.push(
    "## Rules that hold for every join",
    "",
    "- **Opt-in only.** No token, no join, no extra credit, no extra latency.",
    "- **Null-only.** A join writes a leaf only where the row lacks it. It never overwrites what the page already returned, except a leaf the row itself flags as approximate (LinkedIn's rounded follower buckets).",
    "- **A row cap caps the bill.** Where a lane offers one, sending it shrinks the rows joined and the credits held together.",
    "- **Several tokens are comma-separated**, and each holds, bills, refunds and warns on its own terms; the call holds the sum of the ones you asked for.",
    "- **Latency is real.** A join adds roughly 0.2 to 10 seconds on a fresh page depending on the lane, and nothing when the rows are already cached.",
    "- **An unknown token is a free 400**, rejected before billing.",
    "",
    'For one endpoint’s exact hold, use `action: "endpoint"` with `platform`, `resource` and the `include` you intend to send.',
  );

  return lines.join("\n");
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
    case "hydration":
      return buildHydrationCatalogue(params);
    case "overview":
      return buildOverview();
    default:
      return `Error: Unknown action "${String(action)}". Valid actions: overview, endpoint, platform, list, hydration.`;
  }
}
