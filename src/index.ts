#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import {
  ListPlatformsInputSchema,
  ListEndpointsInputSchema,
  RequestInputSchema,
  CheckBalanceInputSchema,
  GetDocsInputSchema,
} from "./schemas/tools.js";
import { listPlatforms } from "./tools/list-platforms.js";
import { listEndpoints } from "./tools/list-endpoints.js";
import { request } from "./tools/request.js";
import { checkBalance } from "./tools/check-balance.js";
import { getDocs } from "./tools/get-docs.js";

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

server.registerTool(
  "socialcrawl_list_platforms",
  {
    title: "List SocialCrawl Platforms",
    description:
      "List all 21 social media platforms available through SocialCrawl. Returns platform names, endpoint counts, and descriptions. No API key required.",
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
      "List all available endpoints for a specific platform with required parameters, credit costs, and response types. No API key required.",
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
    description:
      "Make an API request to any SocialCrawl endpoint. Fetches real-time social media data (profiles, posts, comments, search results, analytics) from 21 platforms. Requires a valid SOCIALCRAWL_API_KEY. Validates platform, resource, and parameters before making the call to avoid wasting credits. Pass an optional idempotencyKey to make the request retry-safe (replays return the original response and deduct 0 credits).",
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
  "socialcrawl_get_docs",
  {
    title: "Get SocialCrawl Documentation",
    description:
      "Retrieve SocialCrawl API documentation. Topics: 'overview' (compact intro), 'full' (comprehensive reference), 'authentication', 'credits', 'errors', or any platform slug (e.g., 'tiktok') for platform-specific docs. No API key required.",
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
