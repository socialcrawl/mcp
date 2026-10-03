import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiContext } from "../context.js";
import {
  ListPlatformsInputSchema,
  ListEndpointsInputSchema,
  CheckBalanceInputSchema,
  MonitorsInputSchema,
  WebInputSchema,
  CohortsInputSchema,
  GetDocsInputSchema,
  PricingInputSchema,
  DiscoverInputSchema,
} from "../schemas/tools.js";
import { BalanceOutputShape, PricingOutputShape } from "../schemas/outputs.js";
import { PLATFORMS } from "../data/platforms.js";
import { ENDPOINTS } from "../data/endpoints.js";
import { REGISTRY_STATS } from "../data/registry-meta.js";
import { meteredEndpoints } from "../pricing.js";
import { toResult } from "../result.js";
import { listPlatforms } from "./list-platforms.js";
import { listEndpoints } from "./list-endpoints.js";
import { checkBalanceStructured } from "./check-balance.js";
import { monitors } from "./monitors.js";
import type { MonitorsParams } from "./monitors.js";
import { web } from "./web.js";
import type { WebParams } from "./web.js";
import { cohorts } from "./cohorts.js";
import type { CohortsParams } from "./cohorts.js";
import { getDocs } from "./get-docs.js";
import { pricingStructured } from "./pricing.js";
import type { PricingParams } from "./pricing.js";
import { discover } from "./discover.js";
import type { DiscoverParams } from "./discover.js";

/**
 * The 1.x tool names, kept for one major version behind
 * `SOCIALCRAWL_LEGACY_TOOLS=1` (MCP-04). Each is a thin wrapper over the same
 * module the 2.0 tools use, with its 1.x schema, so an agent or a saved prompt
 * written against 1.x keeps working. Old name -> new tool:
 *
 *   socialcrawl_list_platforms  -> socialcrawl_find (no task)
 *   socialcrawl_list_endpoints  -> socialcrawl_find (task / platform), socialcrawl_endpoint
 *   socialcrawl_pricing         -> socialcrawl_estimate
 *   socialcrawl_discover        -> socialcrawl_endpoint, socialcrawl_find, socialcrawl_account
 *   socialcrawl_get_docs        -> socialcrawl_endpoint (topic as id)
 *   socialcrawl_check_balance   -> socialcrawl_account
 *   socialcrawl_monitors / _web / _cohorts -> socialcrawl_manage (area)
 */
export const LEGACY_TOOL_NAMES = [
  "socialcrawl_list_platforms",
  "socialcrawl_list_endpoints",
  "socialcrawl_check_balance",
  "socialcrawl_monitors",
  "socialcrawl_web",
  "socialcrawl_cohorts",
  "socialcrawl_pricing",
  "socialcrawl_discover",
  "socialcrawl_get_docs",
] as const;

/** True when `SOCIALCRAWL_LEGACY_TOOLS` asks for the old names (1, true, yes, on). */
export function legacyToolsFromEnv(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.SOCIALCRAWL_LEGACY_TOOLS?.trim() ?? "");
}

export function registerLegacyTools(server: McpServer, ctx: ApiContext): void {
  server.registerTool(
    "socialcrawl_list_platforms",
    {
      title: "List SocialCrawl Platforms",
      description: `List all ${PLATFORMS.length} platforms available through SocialCrawl (${ENDPOINTS.length} endpoints — social media, commerce, marketplaces & product reviews, retail (Amazon, Walmart, Target, Home Depot, eBay, Klarna, AliExpress, Etsy, Sephora, H&M, Kohl's, Wayfair, Gumtree, Google Shopping), app stores, places, travel & local (Tripadvisor, Yelp, Google Business), business & software reputation (Trustpilot, G2), jobs & salaries, markets & finance, US congressional trading, news, web research and full scraping/browser automation, on-page SEO audits, prediction markets, search trends, Korean search (Naver), Chinese social (Douyin, Xiaohongshu), Product Hunt, content analysis, and cross-platform Prism composites). Grouped by category, with each platform's endpoint count, credit range, and available data. No API key required.`,
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
      return toResult(output);
    },
  );

  server.registerTool(
    "socialcrawl_list_endpoints",
    {
      title: "List Endpoints for a Platform",
      description: `List endpoints with their full parameter contract — required + optional params, types, integer ranges, enum values, parameter couplings, CSV limits, pagination style, cache TTL, and per-endpoint pricing (including metered bands). Pass a \`platform\` for that platform's reference, or a \`search\` term to find an endpoint across all ${PLATFORMS.length} platforms / ${ENDPOINTS.length} endpoints. Filter with \`method\`, \`maxCost\`, and \`hydrating\` (endpoints that can fill their own rows in one call via \`include=\`). Each endpoint also shows its featured params, its free and metered judgments (\`label=\` / \`relevance=\`), its cost levers (\`max_pages\`, \`seen\`, \`since\`, \`stop_at_id\`) and its related endpoints. Search also matches parameter names and label presets. No API key required.`,
      inputSchema: ListEndpointsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const output = listEndpoints({
        platform: params.platform,
        search: params.search,
        method: params.method,
        maxCost: params.maxCost,
        hydrating: params.hydrating,
        detail: params.detail,
        page: params.page,
      });
      return toResult(output);
    },
  );

  server.registerTool(
    "socialcrawl_check_balance",
    {
      title: "Check SocialCrawl Credit Balance",
      description:
        "Check the credit balance and the credit ledger for the authenticated SocialCrawl account. Default view calls GET /v1/credits/balance (balance + recent-deduction summary); `view: \"transactions\"` calls GET /v1/credits/transactions for dispute-grade itemised receipts — every deduction and refund with its amount, balance_after, endpoint, and request_id, which is how you confirm what a metered endpoint actually charged after its upfront hold was refunded down. Both cost 0 credits. Requires a valid SOCIALCRAWL_API_KEY.",
      inputSchema: CheckBalanceInputSchema,
      outputSchema: BalanceOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const output = await checkBalanceStructured(ctx, {
        view: params.view,
        limit: params.limit,
        cursor: params.cursor,
        requestId: params.requestId,
      });
      return toResult(output.text, output.structured);
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
      return toResult(output);
    },
  );

  server.registerTool(
    "socialcrawl_web",
    {
      title: "SocialCrawl Web Scraping & Browser Automation",
      description:
        "Full web scraping, search, and browser automation. Sync reads: 'scrape' (URL → markdown/HTML/screenshot/links), 'search' (web search with page content), 'map' (discover a site's URLs), 'extract' (LLM structured data from a page). Async jobs (submit, then poll with job_get/job_list, stop with job_cancel): 'crawl' a whole site, 'batch_scrape' many URLs, 'agent' (autonomous multi-step web task). Change detection: monitor_create/list/get/update/delete/checks (re-check a URL on a cadence → webhook). Interactive browser: session_create/get/list, session_execute (run code in the live page), session_close. Pricing varies by action (scrape 1cr, search 2cr, extract/session_create 5cr, agent 25cr; jobs/monitors/sessions management 0cr) — see the 'web' get_docs topic. Requires a valid SOCIALCRAWL_API_KEY.",
      inputSchema: WebInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      const output = await web(ctx, params as WebParams);
      return toResult(output);
    },
  );

  server.registerTool(
    "socialcrawl_cohorts",
    {
      title: "SocialCrawl Cohorts — Audience-Filtered Mention Search",
      description:
        "Answer 'which of THESE specific public identities is talking about my keywords?' — the opposite of open social listening. You upload a panel of up to 10,000 platform-qualified public handles (instagram, tiktok, youtube, twitter, threads, bluesky, truth-social, kwai, twitch, linkedin), submit a keyword query bounded to a recent window, and read back the matching posts per member PLUS a coverage record for every member, including the ones that matched nothing — so a partial crawl can never read as 'nobody talked about you'. Actions: create, add_members (1,000 per call, upsert on external_id so a nightly re-push is safe), estimate_cost (local, no API call — sizes the reservation before you commit), query (async, returns 202), query_status, query_results (paged, carries `items` + `coverage`), query_cancel, get, delete. Matching is deterministic: literal, whole-word, Unicode-normalized — no stemming, fuzzy matching, or alias inference. Every lifecycle call costs 0 credits; only the query is metered — it reserves a worst-case ceiling at submission and refunds down to the pages that actually succeeded. SocialCrawl only ever receives platform + handle + your opaque external_id, encrypted at rest. Requires a valid SOCIALCRAWL_API_KEY.",
      inputSchema: CohortsInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      const output = await cohorts(ctx, params as CohortsParams);
      return toResult(output);
    },
  );

  server.registerTool(
    "socialcrawl_pricing",
    {
      title: "SocialCrawl Pricing & Credit Costs",
      description: `Exact credit pricing for every one of the ${ENDPOINTS.length} SocialCrawl endpoints. 'overview' returns the tier ladder (${REGISTRY_STATS.standardEndpoints} standard / ${REGISTRY_STATS.advancedEndpoints} advanced / ${REGISTRY_STATS.premiumEndpoints} premium), every free endpoint, every flat override, all ${meteredEndpoints().length} metered endpoints with their min-max band and exact charging rule, cache TTLs, and the full refund matrix. 'endpoint' gives one endpoint's price, metered rule, price-driving parameters, paging cost, and worst case. 'platform' gives a platform's whole cost table. 'list' ranks and filters endpoints by cost (maxCost/minCost/model/search/sort) — e.g. "everything I can call for 1 credit" or "the most expensive endpoints". 'hydration' catalogues every opt-in \`include=\` row join — what each fills, its per-row rate, its row cap, and what a fully-joined page holds. 'judgments' lists every endpoint with free default labels/relevance, which presets are metered, and the hold each opt-in takes. On 'endpoint', pass \`params\` (the exact query you will send — include, label, relevant_to, max_pages, …) and optionally \`calls\`, and the band becomes an itemised hold per page, per call and for the whole job. Use this before spending credits. No API key required.`,
      inputSchema: PricingInputSchema,
      outputSchema: PricingOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const output = pricingStructured(params as PricingParams);
      return toResult(output.text, output.structured);
    },
  );

  server.registerTool(
    "socialcrawl_discover",
    {
      title: "SocialCrawl API Self-Discovery (utility endpoints)",
      description:
        "The API describing itself, live, at 0 credits — the `/v1/utility/*` family. 'quickstart': everything needed for a first successful call (auth, base URL, response envelope, billing model, the full error taxonomy, rate limits, paging). 'catalog': every endpoint with its live metered-aware price, params, and paging flag — filter by platform/search/method. 'capabilities': every cross-cutting parameter (label presets, relevance, judgments, include, since/stop_at_id, seen, max_pages, row filters, trim, fit) with what it does, its price, and every endpoint that supports it. 'plan': a job in plain words ('track mentions of Acme on TikTok and Reddit') turned into the exact priced calls to make, in order (needs a key). 'endpoint': one endpoint's complete usage guide — every parameter with type and example, the exact pricing rule, cache TTL, paging recipe, an example response, a copy-paste curl, and related endpoints. 'llms': the agent context corpus for the whole API or one platform. 'freshness': compare the live registry against this server's bundled catalogue to check whether this MCP version has fallen behind the API. 'status': every platform's live circuit-breaker state from the public `GET /v1/status` meta route — read it before retrying a persistent 502/503, since a degraded platform is the breaker holding traffic off a failing upstream. These answer from the live registry at request time, so unlike bundled data they can never drift from what is actually callable — use them when correctness matters more than latency, or when an endpoint looks unknown. Without an API key everything except 'llms' and 'plan' still answers from bundled data ('status' needs no key at all).",
      inputSchema: DiscoverInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const output = await discover(ctx, params as DiscoverParams);
      return toResult(output);
    },
  );

  server.registerTool(
    "socialcrawl_get_docs",
    {
      title: "Get SocialCrawl Documentation",
      description: `Retrieve SocialCrawl API documentation. Topics: 'overview' (compact intro), 'full' (comprehensive reference for all ${ENDPOINTS.length} endpoints), 'authentication', 'credits', 'pricing' (per-endpoint cost for every endpoint), 'errors', 'idempotency', 'pagination' (universal cursor contract), 'caching' (TTLs and free hits), 'hydration' (the opt-in \`include=\` row joins, what each fills and what it costs), 'judgments' (free default labels and relevance, the metered presets, and every control), 'batch-jobs' (batch endpoints and async background jobs of up to 5,000 items), 'response-schema' (the canonical envelope and unified objects), 'limits' (rate, concurrency, timeouts), 'monitors' (scheduled-recipe wrapper), 'cohorts' (audience-filtered mention search over a panel you supply), 'discovery' (the free self-describing utility endpoints), or any platform slug (e.g., 'tiktok', or 'web' for the web-scraping/browser-automation surface). No API key required.`,
      inputSchema: GetDocsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const topic = params.topic ?? "overview";
      const output = getDocs(
        topic,
        params.page ?? 1,
        (next) => `Call socialcrawl_get_docs again with topic "${topic}" and page ${next} for the next part.`,
      );
      return toResult(output);
    },
  );
}
