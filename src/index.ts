#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import {
  ListPlatformsInputSchema,
  ListEndpointsInputSchema,
  RequestInputSchema,
  CheckBalanceInputSchema,
  MonitorsInputSchema,
  GetDocsInputSchema,
} from "./schemas/tools.js";
import { listPlatforms } from "./tools/list-platforms.js";
import { listEndpoints } from "./tools/list-endpoints.js";
import { request } from "./tools/request.js";
import { checkBalance } from "./tools/check-balance.js";
import { monitors } from "./tools/monitors.js";
import { getDocs } from "./tools/get-docs.js";
import type { MonitorsParams } from "./tools/monitors.js";
import { PLATFORMS } from "./data/platforms.js";
import { ENDPOINTS } from "./data/endpoints.js";

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
    description: `Make an API request to any SocialCrawl endpoint. Fetches real-time data (profiles, posts, comments, search results, products, reviews, apps, places, analytics) from ${PLATFORMS.length} platforms. Requires a valid SOCIALCRAWL_API_KEY. Validates platform, resource, and parameters before making the call to avoid wasting credits. Pass an optional idempotencyKey to make the request retry-safe (replays return the original response and deduct 0 credits).`,
    inputSchema: RequestInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (params) => {
    const output = await request({
      platform: params.platform,
      resource: params.resource,
      params: params.params,
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
    const output = await checkBalance();
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
    const output = await monitors(params as MonitorsParams);
    return { content: [{ type: "text", text: output }] };
  },
);

server.registerTool(
  "socialcrawl_get_docs",
  {
    title: "Get SocialCrawl Documentation",
    description:
      "Retrieve SocialCrawl API documentation. Topics: 'overview' (compact intro), 'full' (comprehensive reference), 'authentication', 'credits', 'errors', 'idempotency', 'monitors' (scheduled-recipe wrapper), 'pricing' (per-endpoint cost for every endpoint), or any platform slug (e.g., 'tiktok') for platform-specific docs. No API key required.",
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

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error("Fatal error starting SocialCrawl MCP server:", error);
  process.exit(1);
});
