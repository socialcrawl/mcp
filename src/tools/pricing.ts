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
import {
  judgedEndpoints,
  judgmentHoldMax,
  judgedRowCap,
  labelFamily,
  quoteJudgments,
  LEVERS,
} from "../judgments.js";
import type { Endpoint } from "../types.js";
import { errorFromText, isErrorText } from "../result.js";
import type { ToolOutput } from "../result.js";

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
  | "hydration"
  | "judgments";

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
  /**
   * endpoint: the exact query params you intend to send. Turns the band into
   * an itemised hold: the page, every `include=` join, `label=` /
   * `relevant_to=` judgments, and `max_pages` (each page billed as one call).
   */
  params?: Record<string, string>;
  /** endpoint: how many such calls you plan, for a whole-job budget. */
  calls?: number;
}

const BILLING_RULES = [
  "**Cache hits are free.** A repeat of the same call inside the endpoint's TTL returns `cached: true` and deducts 0 credits.",
  "**Idempotent replays are free.** Re-sending a request with the same `Idempotency-Key` (24h TTL) returns the stored response and deducts 0 new credits.",
  "**Empty results are refunded.** An empty single-object lookup returns 404 `RESOURCE_NOT_FOUND` and an empty list returns 200 `{items: []}` — both auto-refund the deduction, so a missing profile or a zero-match search costs nothing.",
  "**Failures are refunded.** 502 `UPSTREAM_ERROR`, 503 `SERVICE_UNAVAILABLE`, 500 `INTERNAL_ERROR`, and request-deadline 504s all reverse the charge. 400/401/402/405/409/422/429 never deduct in the first place (validation runs before billing).",
  "**Metered endpoints deduct a ceiling and refund down.** The upfront hold is the worst case for your query; the settled charge is the work actually done, reported as `credits_used` in the envelope and the `X-Credits-Used` header.",
  "**`/v1/search/everywhere` has a coverage floor.** Zero usable items = full refund; coverage below 50% of the called sources = 50% refund (10cr instead of 20cr).",
  "**Row joins (`include=`) hold per row and keep per row FILLED.** On the endpoints that offer one, the ceiling is held up front, a credit is kept only for a row a fresh sibling lookup actually filled, and every other slot is refunded — rows served from the sibling's cache are free, unfillable rows are free, and a page that joined in full is cached whole. See `action: \"hydration\"`.",
  "**Judgments are free by default.** Judged lists carry `computed.labels` (and `computed.relevance` on searches) at no extra credit. Only a metered `label=` preset, `label=intent` with `offer=`, or a topic of your own in `relevant_to=` adds credits: a hold of 1 per started 25 rows of the page (4 on a 100-row page), settling to 1 per started 25 rows judged fresh. `dry_run=1` previews it for 0 credits. See `action: \"judgments\"`.",
  "**`max_pages` bills each page walked as one call**, so its worst case is N × the page's hold (a cached page is free); `data.walk.stopped` says why the walk ended.",
  "**`seen=<id>` discounts repeats.** Rows this account already received under the same id are dropped and the page price falls with the share of repeats (rounded up) — a page of repeats is free. Join credits are never discounted.",
  "**`since` / `stop_at_id` end a walk early** at rows you already hold, so a daily poll pays only for pages with new rows.",
  "**Background jobs (`POST /v1/prism/jobs`) hold the whole job at submit** and refund down to the rows that succeeded when the last chunk settles; reading a job is free.",
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
    "Plus the meta endpoints `GET /v1/credits/balance` and `GET /v1/credits/transactions` (`socialcrawl_account`), and all monitor management (`socialcrawl_manage`, area monitors).",
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
    `## Judgments (${judgedEndpoints().length} endpoints) — free by default`,
    "",
    "Every judged list labels its rows for free (posts: sponsored, intent, niche · comments: sentiment, question, purchase_intent, complaint · reviews: sentiment, issue), and searches score relevance to your query for free. Metered presets, `intent` with `offer=`, and `relevant_to=` hold 1 credit per started 25 rows (4 on a 100-row page) and settle to the rows judged fresh. `action: \"judgments\"` lists every lane, its presets and its hold.",
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
      `Use socialcrawl_find with platform "${platform}" to see every resource.`,
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
  const exactCall = params.params !== undefined || params.calls !== undefined;
  if (!exactCall && endpoint.hydration && endpoint.hydration.length > 0) {
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

  if (params.params !== undefined || params.calls !== undefined) {
    lines.push("", ...callQuote(endpoint, params));
  } else if (endpoint.judgments || endpoint.optionalParams.some((o) => o.name === "max_pages")) {
    lines.push(
      "",
      "Pass `params` (the exact query you intend to send, e.g. `{ \"label\": \"mention\", \"brand\": \"Acme\", \"max_pages\": \"3\" }`) and optionally `calls` for an itemised hold and a whole-job budget.",
    );
  }

  if (endpoint.paginatable || endpoint.pagination) {
    lines.push(
      "",
      "## Paging cost",
      "",
      endpoint.paginatable
        ? "This endpoint walks every page server-side — one call, one metered charge covering the whole walk."
        : `Each page is a separate billed request. Page with \`cursor\`${endpoint.pagination!.nativeParam === "cursor" ? "" : ` (the universal alias for \`${endpoint.pagination!.nativeParam}\`)`} and stop on \`pagination.has_more === false\`; a wrong cursor name is a free 400, not a silent re-bill of page 1.`,
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

/**
 * Itemised hold for one exact call: the page (or band), every `include=` join
 * the params ask for, the judgments they switch on, and `max_pages`, which
 * bills every page walked as one call. Multiplied by `calls` for a job budget.
 */
function callQuote(endpoint: Endpoint, params: PricingParams): string[] {
  const q: Record<string, string> = { ...(params.params ?? {}) };
  if (params.include !== undefined && q.include === undefined) q.include = params.include;
  if (params.rows !== undefined && q.limit === undefined) q.limit = String(params.rows);

  const rows: string[] = [];
  const notes: string[] = [];
  const hasJoins = (endpoint.hydration?.length ?? 0) > 0;
  const hydration = hasJoins
    ? quoteHydration(endpoint, q.include, q.limit !== undefined ? Number(q.limit) : undefined)
    : undefined;

  // The page itself. Exact arithmetic is only valid when the band is fully
  // explained by the base, the joins and the judgments; any other meter
  // (`limit`-per-row, page walks the rule describes) is budgeted at the
  // band's ceiling, because the authored rule is the only exact statement.
  const pageFloor = bestCaseCost(endpoint.pricing);
  const explained =
    endpoint.pricing.cost +
    (endpoint.hydration ?? []).reduce((n, l) => n + laneMaxCredits(l), 0) +
    (endpoint.judgments?.labels &&
    (endpoint.judgments.labels.metered.length > 0 || endpoint.judgments.labels.free.includes("intent"))
      ? judgmentHoldMax(endpoint)
      : 0) +
    (endpoint.judgments?.relevance ? judgmentHoldMax(endpoint) : 0);
  const exact =
    endpoint.pricing.model !== "metered" || worstCaseCost(endpoint.pricing) <= explained;
  let pageHold: number;
  if (!exact) {
    pageHold = worstCaseCost(endpoint.pricing);
    rows.push(`| the page (metered band ${formatCost(endpoint.pricing)}, every opt-in included) | up to ${pageHold}cr |`);
    notes.push("This endpoint meters on more than joins and judgments (see the rule above), so the band's ceiling is the budget; the settled charge follows the rule.");
  } else if (hydration) {
    pageHold = hydration.held;
    rows.push(`| the page itself | ${hydration.base}cr |`);
    for (const l of hydration.lanes) {
      rows.push(`| \`include=${l.lane.token}\` (${l.rows} rows × ${l.lane.creditsPerItem}cr) | ${l.held}cr |`);
    }
  } else {
    pageHold = endpoint.pricing.cost;
    rows.push(`| the page itself | ${pageHold}cr |`);
  }
  if (hydration && hydration.unknownTokens.length > 0) {
    notes.push(`\`${hydration.unknownTokens.join(", ")}\` is not an \`include\` token here — a free 400.`);
  }

  const jq = quoteJudgments(endpoint, q);
  // Inside an unexplained band the judgment holds are already in the ceiling.
  if (!exact) {
    jq.held = 0;
    jq.labelHold = 0;
    jq.relevanceHold = 0;
  }
  if (jq.labelHold > 0) rows.push(`| \`label=${jq.paidPresets.join(",")}\` (${judgedRowCap(endpoint)} rows / 25) | ${jq.labelHold}cr |`);
  if (jq.relevanceHold > 0) rows.push(`| \`relevant_to\` relevance (${judgedRowCap(endpoint)} rows / 25) | ${jq.relevanceHold}cr |`);
  if (jq.unknownPresets.length > 0) {
    notes.push(`\`${jq.unknownPresets.join(", ")}\` is not a \`label\` preset here — a free 400. Offered: ${endpoint.judgments?.labels?.presets.join(", ") ?? "none"}.`);
  }
  if (jq.freePresets.length > 0) notes.push(`\`${jq.freePresets.join(", ")}\` ${jq.freePresets.length === 1 ? "is" : "are"} free.`);
  notes.push(...jq.notes);
  // Judgments are cached per row: whatever was judged before is free, so the
  // hold is a ceiling, the settle is 1 per started 25 rows judged fresh.
  const perPage = pageHold + jq.held;

  const declared = new Set(endpoint.optionalParams.map((o) => o.name));
  let pages = 1;
  if (q.max_pages !== undefined) {
    const n = Number(q.max_pages);
    if (!declared.has("max_pages")) {
      notes.push("`max_pages` is not declared on this endpoint and would be dropped.");
    } else if (Number.isFinite(n) && n >= 1) {
      pages = Math.floor(n);
      notes.push(`\`max_pages=${pages}\` walks up to ${pages} pages, each billed as one call (a cached page is free); the walk stops early at the last page.`);
    }
  }
  if (q.seen !== undefined && declared.has("seen")) {
    notes.push("`seen` discounts each page by its share of rows you already received under that id — the hold below is before that discount.");
  }
  if (q.dry_run === "1" && endpoint.judgments) {
    notes.push("With `dry_run=1` this call itself costs 0 credits — it only returns the estimate.");
  }

  const perCall = perPage * pages;
  const calls = Math.max(1, Math.floor(params.calls ?? 1));
  const floor = pageFloor === 0 ? 0 : pageFloor;

  const out = [
    "## Your quote",
    "",
    `Params: \`${JSON.stringify(q)}\``,
    "",
    "| Part | Held per page |",
    "|------|---------------|",
    ...rows,
    "",
    `**Per page:** up to **${perPage}cr**${pages > 1 ? ` × ${pages} pages = up to **${perCall}cr** per call` : ""}. Floor: ${floor}cr per page (0 on a cache hit, an empty result, or a failure).`,
  ];
  if (calls > 1) {
    out.push(
      "",
      `**Whole job (${calls} calls):** up to **${perCall * calls} credits** held in total, at least ${floor * calls} if every page is a fresh, non-empty, unjoined page. Repeats inside the cache window are free.`,
    );
  }
  if (notes.length > 0) out.push("", ...notes.map((n) => `- ${n}`));
  out.push("", "The settled charge is always `credits_used` on the response; `socialcrawl_account` with `view: \"transactions\"` shows each hold and refund.");
  return out;
}

/** Every lane that offers labels and/or relevance, with its presets and hold. */
function buildJudgmentsCatalogue(params: PricingParams): string {
  const all = judgedEndpoints();
  const scoped = params.platform ? all.filter((e) => e.platform === params.platform) : all;
  if (scoped.length === 0) {
    return `No endpoint${params.platform ? ` on \`${params.platform}\`` : ""} offers labels or relevance. ${all.length} endpoints do — drop \`platform\` to see them.`;
  }
  const lines: string[] = [
    `# Judgments — ${scoped.length} endpoint${scoped.length === 1 ? "" : "s"}${params.platform ? ` on ${params.platform}` : ""}`,
    "",
    "SocialCrawl judges the rows of these lists for you. **On by default and free:** every page carries the free label presets under `computed.labels` and, on a search, `computed.relevance` against your query. `judgments=off` (or `label=none`) returns the page unjudged.",
    "",
    "**What adds credits:** a metered `label=` preset, `label=intent` with `offer=`, or `relevance=score|filter` with your own topic in `relevant_to=`. Each holds 1 credit per started 25 rows of the page's judged-row cap (4cr on a 100-row page) and settles to 1 credit per started 25 rows judged FRESH: rows judged before, cached pages and pages where nothing could be judged are free. `dry_run=1` previews it for 0 credits.",
    "",
    "| Endpoint | Rows | Free labels | Metered labels | Relevance | Hold per opt-in |",
    "|----------|------|-------------|----------------|-----------|-----------------|",
  ];
  for (const e of scoped) {
    const j = e.judgments!;
    lines.push(
      `| \`${endpointPath(e)}\` | ${labelFamily(e) ?? "—"} | ${j.labels ? j.labels.free.join(", ") || "—" : "—"} | ${j.labels ? [...j.labels.metered, ...(j.labels.free.includes("intent") ? ["intent+offer"] : [])].join(", ") || "—" : "—"} | ${j.relevance ? `free; \`${j.relevance.meteredTopicParam}\` metered` : "—"} | ${judgmentHoldMax(e)}cr |`,
    );
  }
  lines.push(
    "",
    "## Context params",
    "",
    "- `brand=` (required by `label=mention`; without it the preset is skipped and not billed) and `brand_description=`.",
    "- `offer=` with `label=intent` adds `fits_offer` to every post (and makes `intent` metered).",
    "- `reports=<phrase>` with `label=reports` on reviews.",
    "- `exclude=` drops rows a label flags (e.g. `engagement_bait` with `label=quality`; `spam,low_quality` on comments).",
    "- `label_evidence=1` adds `computed.labels_evidence.<preset>` — the verbatim sentence behind each label.",
    "- `relevance_threshold=` (0-1, default 0.5) sets how strict `relevance=filter` is.",
    "",
    "## Other levers that move a bill",
    "",
    ...LEVERS.map((l) => `- \`${l.param}\` — ${l.what} ${l.cost}`),
    "",
    'For one call\'s exact hold: `action: "endpoint"` with `platform`, `resource` and `params` (e.g. `{ "label": "mention", "brand": "Acme" }`).',
  );
  return lines.join("\n");
}

function buildPlatformTable(slug: string): string {
  const platform = findPlatform(slug);
  if (!platform) {
    return `Error: Unknown platform "${slug}". Use socialcrawl_find to see the platforms.`;
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
    case "judgments":
      return buildJudgmentsCatalogue(params);
    case "overview":
      return buildOverview();
    default:
      return `Error: Unknown action "${String(action)}". Valid actions: overview, endpoint, platform, list, hydration, judgments.`;
  }
}

/**
 * Text plus the `structuredContent` object. `action: "endpoint"` carries the
 * per-call quote as numbers (the band and its worst case); the catalogue
 * actions are prose tables, so they report `ok` and the action only.
 */
/**
 * The 1.x pricing tool's text, worded for the 2.0 tools that reuse it
 * (`socialcrawl_estimate`): each `action: "..."` pointer becomes the 2.0 call
 * that gives the same answer.
 */
const V2_WORDING: Array<[RegExp, string]> = [
  [/`action: \\?"endpoint\\?"` with a platform \+ resource/g, '`socialcrawl_estimate` with `id: "platform/resource"`'],
  [/`action: \\?"endpoint\\?"` with `platform`, `resource`(,)? and/g, '`socialcrawl_estimate` with `id: "platform/resource"` and'],
  [/use `action: \\?"endpoint\\?"` with/g, "use `socialcrawl_estimate` with"],
  [/`action: \\?"platform\\?"`/g, "`socialcrawl_estimate` with a platform slug as `id`"],
  [/, or `action: \\?"list\\?"` with `maxCost` \/ `model` \/ `sort` to rank endpoints by price/g, ""],
  [/`action: \\?"overview\\?"`/g, "`socialcrawl_estimate` with no `id`"],
  [/`action: \\?"(judgments|hydration)\\?"`/g, '`socialcrawl_endpoint` with `id: "$1"`'],
];

export function v2Wording(text: string): string {
  return V2_WORDING.reduce((t, [re, to]) => t.replace(re, to), text);
}

export function pricingStructured(params: PricingParams): ToolOutput {
  const text = pricing(params);
  if (isErrorText(text)) return { text, structured: errorFromText(text) };
  const action = params.action ?? "overview";
  const structured: Record<string, unknown> = { ok: true, action };
  if (action === "endpoint" && params.platform && params.resource) {
    const e = findEndpoint(params.platform, params.resource, params.method?.toUpperCase());
    if (e) {
      structured.quote = {
        endpoint: `${e.platform}/${e.resource}`,
        method: e.method,
        model: e.pricing.model,
        tier: e.pricing.tier,
        label: formatCost(e.pricing),
        min_credits: bestCaseCost(e.pricing),
        max_credits: worstCaseCost(e.pricing),
        ...(e.pricing.model === "metered" && e.pricing.description ? { rule: e.pricing.description } : {}),
      };
    }
  }
  return { text, structured };
}
