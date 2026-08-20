import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import type { ApiContext } from "./context.js";
import {
  ListPlatformsInputSchema,
  ListEndpointsInputSchema,
  RequestInputSchema,
  CheckBalanceInputSchema,
  MonitorsInputSchema,
  WebInputSchema,
  GetDocsInputSchema,
  PricingInputSchema,
  DiscoverInputSchema,
} from "./schemas/tools.js";
import { listPlatforms } from "./tools/list-platforms.js";
import { listEndpoints } from "./tools/list-endpoints.js";
import { request } from "./tools/request.js";
import { checkBalance } from "./tools/check-balance.js";
import { monitors } from "./tools/monitors.js";
import { web } from "./tools/web.js";
import { getDocs } from "./tools/get-docs.js";
import { pricing } from "./tools/pricing.js";
import { discover } from "./tools/discover.js";
import type { MonitorsParams } from "./tools/monitors.js";
import type { WebParams } from "./tools/web.js";
import type { PricingParams } from "./tools/pricing.js";
import type { DiscoverParams } from "./tools/discover.js";
import { PLATFORMS } from "./data/platforms.js";
import { ENDPOINTS } from "./data/endpoints.js";
import { REGISTRY_STATS } from "./data/registry-meta.js";
import { meteredEndpoints } from "./pricing.js";

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
      description: `List all ${PLATFORMS.length} platforms available through SocialCrawl (${ENDPOINTS.length} endpoints — social media, commerce & product reviews, retail (Amazon, Walmart, Target, Home Depot, eBay, Google Shopping), app stores, places & travel, business reputation, news & finance, web research and full scraping/browser automation, prediction markets, search trends, Korean search (Naver), content analysis, and cross-platform Prism composites). Grouped by category, with each platform's endpoint count, credit range, and available data. No API key required.`,
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
      description: `List endpoints with their full parameter contract — required + optional params, types, integer ranges, enum values, parameter couplings, CSV limits, pagination style, cache TTL, and per-endpoint pricing (including metered bands). Pass a \`platform\` for that platform's reference, or a \`search\` term to find an endpoint across all ${PLATFORMS.length} platforms / ${ENDPOINTS.length} endpoints. Filter with \`method\` and \`maxCost\`. No API key required.`,
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
        detail: params.detail,
        page: params.page,
      });
      return { content: [{ type: "text", text: output }] };
    },
  );

  server.registerTool(
    "socialcrawl_request",
    {
      title: "Make a SocialCrawl API Request",
      description: `Make an API request to any of the ${ENDPOINTS.length} SocialCrawl endpoints. Fetches real-time data (profiles, posts, comments, transcripts, search results, products, reviews, apps, places, news, finance, trends, analytics, and cross-platform Prism composites) from ${PLATFORMS.length} platforms. Most endpoints are GET (pass query params in \`params\`); batch endpoints (e.g. youtube/videos, prism/profiles) are POST — pass the array/object body in \`body\`. For web scraping/crawling/browser automation use the \`socialcrawl_web\` tool instead. Requires a valid SOCIALCRAWL_API_KEY. Validates the platform, resource, required params, oneOf groups, enum values, integer ranges, parameter couplings, and CSV limits locally first, so a malformed call fails free instead of burning credits. Reports the endpoint's price (and metered rule) with every response. Pass an optional idempotencyKey to make the request retry-safe (replays return the original response and deduct 0 credits).`,
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
        body: params.body,
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
        "Check the credit balance and the credit ledger for the authenticated SocialCrawl account. Default view calls GET /v1/credits/balance (balance + recent-deduction summary); `view: \"transactions\"` calls GET /v1/credits/transactions for dispute-grade itemised receipts — every deduction and refund with its amount, balance_after, endpoint, and request_id, which is how you confirm what a metered endpoint actually charged after its upfront hold was refunded down. Both cost 0 credits. Requires a valid SOCIALCRAWL_API_KEY.",
      inputSchema: CheckBalanceInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const output = await checkBalance(ctx, {
        view: params.view,
        limit: params.limit,
        cursor: params.cursor,
        requestId: params.requestId,
      });
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
    "socialcrawl_web",
    {
      title: "SocialCrawl Web Scraping & Browser Automation",
      description:
        "Full web scraping, search, and browser automation (Firecrawl-backed). Sync reads: 'scrape' (URL → markdown/HTML/screenshot/links), 'search' (web search with page content), 'map' (discover a site's URLs), 'extract' (LLM structured data from a page). Async jobs (submit, then poll with job_get/job_list, stop with job_cancel): 'crawl' a whole site, 'batch_scrape' many URLs, 'agent' (autonomous multi-step web task). Change detection: monitor_create/list/get/update/delete/checks (re-check a URL on a cadence → webhook). Interactive browser: session_create/get/list, session_execute (run code in the live page), session_close. Pricing varies by action (scrape 1cr, search 2cr, extract/session_create 5cr, agent 25cr; jobs/monitors/sessions management 0cr) — see the 'web' get_docs topic. Requires a valid SOCIALCRAWL_API_KEY.",
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
      return { content: [{ type: "text", text: output }] };
    },
  );

  server.registerTool(
    "socialcrawl_pricing",
    {
      title: "SocialCrawl Pricing & Credit Costs",
      description: `Exact credit pricing for every one of the ${ENDPOINTS.length} SocialCrawl endpoints. 'overview' returns the tier ladder (${REGISTRY_STATS.standardEndpoints} standard / ${REGISTRY_STATS.advancedEndpoints} advanced / ${REGISTRY_STATS.premiumEndpoints} premium), every free endpoint, every flat override, all ${meteredEndpoints().length} metered endpoints with their min-max band and exact charging rule, cache TTLs, and the full refund matrix. 'endpoint' gives one endpoint's price, metered rule, price-driving parameters, paging cost, and worst case. 'platform' gives a platform's whole cost table. 'list' ranks and filters endpoints by cost (maxCost/minCost/model/search/sort) — e.g. "everything I can call for 1 credit" or "the most expensive endpoints". Use this before spending credits. No API key required.`,
      inputSchema: PricingInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const output = pricing(params as PricingParams);
      return { content: [{ type: "text", text: output }] };
    },
  );

  server.registerTool(
    "socialcrawl_discover",
    {
      title: "SocialCrawl API Self-Discovery (utility endpoints)",
      description:
        "The API describing itself, live, at 0 credits — the `/v1/utility/*` family. 'quickstart': everything needed for a first successful call (auth, base URL, response envelope, billing model, the full error taxonomy, rate limits, paging). 'catalog': every endpoint with its live metered-aware price, params, and paging flag — filter by platform/search/method. 'endpoint': one endpoint's complete usage guide — every parameter with type and example, the exact pricing rule, cache TTL, paging recipe, an example response, a copy-paste curl, and related endpoints. 'llms': the agent context corpus for the whole API or one platform. 'freshness': compare the live registry against this server's bundled catalogue to check whether this MCP version has fallen behind the API. These answer from the live registry at request time, so unlike bundled data they can never drift from what is actually callable — use them when correctness matters more than latency, or when an endpoint looks unknown. Without an API key everything except 'llms' still answers from bundled data.",
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
      return { content: [{ type: "text", text: output }] };
    },
  );

  server.registerTool(
    "socialcrawl_get_docs",
    {
      title: "Get SocialCrawl Documentation",
      description: `Retrieve SocialCrawl API documentation. Topics: 'overview' (compact intro), 'full' (comprehensive reference for all ${ENDPOINTS.length} endpoints), 'authentication', 'credits', 'pricing' (per-endpoint cost for every endpoint), 'errors', 'idempotency', 'pagination' (universal cursor contract), 'caching' (TTLs and free hits), 'response-schema' (the canonical envelope and unified objects), 'limits' (rate, concurrency, timeouts), 'monitors' (scheduled-recipe wrapper), 'discovery' (the free self-describing utility endpoints), or any platform slug (e.g., 'tiktok', or 'web' for the web-scraping/browser-automation surface). No API key required.`,
      inputSchema: GetDocsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const output = getDocs(params.topic ?? "overview", params.page ?? 1);
      return { content: [{ type: "text", text: output }] };
    },
  );

  return server;
}
