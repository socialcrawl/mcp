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
} from "./schemas/tools.js";
import { listPlatforms } from "./tools/list-platforms.js";
import { listEndpoints } from "./tools/list-endpoints.js";
import { request } from "./tools/request.js";
import { checkBalance } from "./tools/check-balance.js";
import { monitors } from "./tools/monitors.js";
import { web } from "./tools/web.js";
import { getDocs } from "./tools/get-docs.js";
import type { MonitorsParams } from "./tools/monitors.js";
import type { WebParams } from "./tools/web.js";
import { PLATFORMS } from "./data/platforms.js";
import { ENDPOINTS } from "./data/endpoints.js";

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
      description: `List all ${PLATFORMS.length} platforms available through SocialCrawl (${ENDPOINTS.length} endpoints — social media, commerce & reviews, app stores, places & travel, business reputation, web research, prediction markets, Naver, content analysis, universal meta-search). Returns platform names, endpoint counts, and descriptions. No API key required.`,
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
      description:
        "List all available endpoints for a specific platform with required + optional parameters, per-endpoint credit costs (pricing), and response types. No API key required.",
      inputSchema: ListEndpointsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const output = listEndpoints(params.platform);
      return { content: [{ type: "text", text: output }] };
    },
  );

  server.registerTool(
    "socialcrawl_request",
    {
      title: "Make a SocialCrawl API Request",
      description: `Make an API request to any SocialCrawl endpoint. Fetches real-time data (profiles, posts, comments, search results, products, reviews, apps, places, trends, analytics) from ${PLATFORMS.length} platforms. Most endpoints are GET (pass query params in \`params\`); batch endpoints (e.g. youtube/videos, prism/profiles) are POST — pass the array/object body in \`body\`. For web scraping/crawling/browser automation use the \`socialcrawl_web\` tool instead. Requires a valid SOCIALCRAWL_API_KEY. Validates platform, resource, and parameters before making the call to avoid wasting credits. Pass an optional idempotencyKey to make the request retry-safe (replays return the original response and deduct 0 credits).`,
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
        "Check the remaining credit balance and recent deductions for the authenticated SocialCrawl account. Calls the meta endpoint GET /v1/credits/balance — costs 0 credits. Requires a valid SOCIALCRAWL_API_KEY.",
      inputSchema: CheckBalanceInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const output = await checkBalance(ctx);
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
    "socialcrawl_get_docs",
    {
      title: "Get SocialCrawl Documentation",
      description:
        "Retrieve SocialCrawl API documentation. Topics: 'overview' (compact intro), 'full' (comprehensive reference), 'authentication', 'credits', 'errors', 'idempotency', 'monitors' (scheduled-recipe wrapper), 'pricing' (per-endpoint cost for every endpoint), or any platform slug (e.g., 'tiktok', or 'web' for the web-scraping/browser-automation surface) for platform-specific docs. No API key required.",
      inputSchema: GetDocsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const output = getDocs(params.topic ?? "overview");
      return { content: [{ type: "text", text: output }] };
    },
  );

  return server;
}
