import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { RESULT_URI_PREFIX, resultsStore, scopeOf } from "./results-store.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import type { ApiContext } from "./context.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { ProgressTick } from "./client.js";
import {
  FindInputSchema,
  EndpointInputSchema,
  EstimateInputSchema,
  RequestInputSchema,
  CollectInputSchema,
  AccountInputSchema,
  ManageInputSchema,
} from "./schemas/tools.js";
import { withNormalizedArgs } from "./schemas/normalize.js";
import { findStructured } from "./tools/find.js";
import { endpointStructured } from "./tools/endpoint.js";
import { estimateStructured } from "./tools/estimate.js";
import { requestStructured } from "./tools/request.js";
import { collectStructured } from "./tools/collect.js";
import { accountStructured } from "./tools/account.js";
import { manage } from "./tools/manage.js";
import { legacyToolsFromEnv, registerLegacyTools } from "./tools/legacy.js";
import { PLATFORMS } from "./data/platforms.js";
import { ENDPOINTS } from "./data/endpoints.js";
import { toResult } from "./result.js";
import {
  RequestOutputShape,
  CollectOutputShape,
  FindOutputShape,
  EndpointOutputShape,
  EstimateOutputShape,
  AccountOutputShape,
} from "./schemas/outputs.js";
import { INSTRUCTIONS } from "./instructions.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";
import { addStaleNotice, startFreshnessCheck } from "./freshness.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP progress notifications for a call, or undefined when the client sent no
 * `progressToken` (it did not ask for progress). A failed send never fails the call.
 */
function progressReporter(
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
): ((tick: ProgressTick) => void) | undefined {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) return undefined;
  return ({ progress, message }) => {
    extra
      .sendNotification({
        method: "notifications/progress",
        params: { progressToken, progress, ...(message ? { message } : {}) },
      })
      .catch(() => undefined);
  };
}

export interface ServerOptions {
  /**
   * Also register the 1.x tool names (thin wrappers, for one major version).
   * Defaults to `SOCIALCRAWL_LEGACY_TOOLS=1`.
   */
  legacyTools?: boolean;
}

/**
 * Build a fully-wired McpServer bound to one caller's credentials.
 * stdio calls this once per process; the HTTP transport calls it once per
 * request (stateless mode), so construction must stay I/O-free and cheap.
 *
 * Seven tools (MCP-04): find, endpoint, estimate, request, collect, account,
 * manage. The 1.x names come back with `legacyTools` (see `tools/legacy.ts`).
 */
export function createServer(baseCtx: ApiContext, options: ServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  // Spend approvals go through MCP elicitation when the client offers it.
  const ctx: ApiContext = { ...baseCtx, confirm: (message) => askToSpend(server, message) };

  // Freshness: one background check per process (memoised); a stale answer is
  // appended once to the next tool result of this server instance. Never waits
  // more than a moment, so a slow network cannot delay a call.
  const freshness = startFreshnessCheck(baseCtx);
  let staleNoticeSent = false;
  const withFreshness = async (result: CallToolResult): Promise<CallToolResult> => {
    if (staleNoticeSent) return result;
    const stale = await Promise.race([freshness, new Promise<boolean>((r) => setTimeout(() => r(false), 250).unref())]);
    if (!stale) return result;
    staleNoticeSent = true;
    return addStaleNotice(result);
  };
  const registerTool = server.registerTool.bind(server) as (...a: unknown[]) => unknown;
  (server as { registerTool: unknown }).registerTool = (name: unknown, config: unknown, cb: (...a: unknown[]) => unknown) =>
    registerTool(name, config, async (...args: unknown[]) => withFreshness((await cb(...args)) as CallToolResult));

  server.registerTool(
    "socialcrawl_find",
    {
      title: "Find the Endpoint for a Task",
      description:
        `Start here: a task in plain words -> the best endpoints (3 by default) of ${ENDPOINTS.length}, each with the params the task supplies (URLs and @handles resolved), the params still missing, the credit cost and the exact call. With no task it lists platforms, or one platform's endpoints. Free; no key needed.`,
      inputSchema: withNormalizedArgs(FindInputSchema, "find"),
      outputSchema: FindOutputShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      const output = await findStructured(ctx, { task: params.task, platform: params.platform, limit: params.limit });
      return toResult(output.text, output.structured);
    },
  );

  server.registerTool(
    "socialcrawl_endpoint",
    {
      title: "Endpoint Contract",
      description:
        "Read before calling: one endpoint's purpose, params, where the rows are and up to 25 response fields, cost rule, paging, latency, timeout, next endpoints and a sample link. id (or platform+resource, path), a platform slug (its endpoints) or a guide topic. Free.",
      inputSchema: withNormalizedArgs(EndpointInputSchema, "endpoint"),
      outputSchema: EndpointOutputShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      const output = await endpointStructured(ctx, { id: params.id, method: params.method, page: params.page });
      return toResult(output.text, output.structured);
    },
  );

  server.registerTool(
    "socialcrawl_estimate",
    {
      title: "Estimate Credit Cost",
      description:
        "Exact credits before you spend: one call (id, platform+resource or path, plus the params you will send; calls for a job total; items for a walk) or a plan of several calls. Uses the API's estimator when available, else the bundled pricing. A platform slug gives its price table; no id gives the pricing overview. Free.",
      inputSchema: withNormalizedArgs(EstimateInputSchema, "estimate"),
      outputSchema: EstimateOutputShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      const output = await estimateStructured(ctx, {
        id: params.id,
        method: params.method,
        params: params.params,
        body: params.body,
        calls: params.calls,
        items: params.items,
        plan: params.plan,
      });
      return toResult(output.text, output.structured);
    },
  );

  server.registerTool(
    "socialcrawl_request",
    {
      title: "Call an Endpoint",
      description:
        "Call one endpoint (platform+resource, or id, or path). Validated locally first (a bad call is free), quoted, refused above max_credits and confirmed above the threshold. A large page is cut at row boundaries; socialcrawl_collect result_id reads the rest. Spends credits; needs SOCIALCRAWL_API_KEY.",
      inputSchema: withNormalizedArgs(RequestInputSchema, "request"),
      outputSchema: RequestOutputShape,
      annotations: {
        // Billable and not repeatable: each call can spend credits, and a repeat
        // spends again unless an idempotencyKey is sent. It never destroys data.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params, extra) => {
      const output = await requestStructured(ctx, {
        platform: params.platform,
        resource: params.resource,
        method: params.method,
        params: params.params,
        body: params.body,
        idempotencyKey: params.idempotencyKey,
        fields: params.fields,
        max_items: params.max_items,
        format: params.format,
        max_credits: params.max_credits,
        confirm: params.confirm,
        onProgress: progressReporter(extra),
      });
      return toResult(output.text, output.structured, output.links);
    },
  );

  server.registerTool(
    "socialcrawl_collect",
    {
      title: "Collect Rows Across Pages",
      description:
        "Walk a paged endpoint (id, platform+resource or path) to `items` unique rows, the last page or max_credits: cursors supplied, duplicates dropped, stops on a 402, refused free when one page exceeds max_credits. Small results come back whole. result_id (+offset, limit, format) reads a stored result, free. Spends credits.",
      inputSchema: withNormalizedArgs(CollectInputSchema, "collect"),
      outputSchema: CollectOutputShape,
      annotations: {
        // Spends credits page after page; a repeat spends again (cached pages are free).
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      const output = await collectStructured(ctx, {
        id: params.id,
        params: params.params,
        items: params.items,
        max_credits: params.max_credits,
        format: params.format,
        fields: params.fields,
        confirm: params.confirm,
        result_id: params.result_id,
        offset: params.offset,
        limit: params.limit,
      });
      return toResult(output.text, output.structured, output.links);
    },
  );

  server.registerTool(
    "socialcrawl_account",
    {
      title: "Account and Service Status",
      description:
        "Free checks: balance (with this session's spend), transactions (itemised ledger; the receipts for one request_id), status (platform health; read it before retrying a 502/503) and freshness (whether this server's bundled catalogue is behind the API).",
      inputSchema: withNormalizedArgs(AccountInputSchema, "account"),
      outputSchema: AccountOutputShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      const output = await accountStructured(ctx, {
        view: params.view,
        limit: params.limit,
        cursor: params.cursor,
        request_id: params.request_id,
      });
      return toResult(output.text, output.structured);
    },
  );

  server.registerTool(
    "socialcrawl_manage",
    {
      title: "Manage Monitors, Cohorts, Web and Jobs",
      description:
        "Stateful work by area + action: monitors (scheduled recipes, webhooks, alerts), cohorts (mention search over your own panel of accounts), web (scrape, search, crawl and agent jobs, change monitors, browser sessions) and jobs (Prism background jobs). A wrong field is refused free with the rules. Managing is free; scrapes, jobs, queries and monitor runs bill credits.\ndry_run: true validates and quotes a create/update and never creates it. rows_new alerts need track (id=monitors).",
      inputSchema: withNormalizedArgs(ManageInputSchema, "manage"),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      const output = await manage(ctx, {
        area: params.area,
        action: params.action,
        id: params.id,
        input: params.input,
        idempotencyKey: params.idempotencyKey,
        dry_run: params.dry_run,
      });
      return toResult(output.text, output.structured, output.links);
    },
  );

  if (options.legacyTools ?? legacyToolsFromEnv()) registerLegacyTools(server, ctx);

  // Reference material (MCP-05): static resources, templates, prompts from recipes.
  registerResources(server, ctx);
  registerPrompts(server);

  // Full bodies of results that were cut to fit. Scoped to the caller's key.
  server.registerResource(
    "results",
    new ResourceTemplate(`${RESULT_URI_PREFIX}{request_id}`, { list: undefined }),
    {
      title: "Full result body",
      description:
        "The complete, unshaped response of a recent socialcrawl_request whose rows were cut to fit. Held in memory for 30 minutes; read it before it expires.",
      mimeType: "application/json",
    },
    async (uri, vars) => {
      const id = String(Array.isArray(vars.request_id) ? vars.request_id[0] : vars.request_id);
      let decoded = id;
      try {
        decoded = decodeURIComponent(id);
      } catch {
        throw new McpError(ErrorCode.InvalidParams, `Malformed result id "${id}".`);
      }
      const body = resultsStore.get(scopeOf(ctx.apiKey), decoded);
      if (body === undefined) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `No stored result for ${id}. Stored bodies expire after 30 minutes; repeat the request (a cached repeat is free).`,
        );
      }
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: body }] };
    },
  );

  return server;
}

/** Ask the user to approve a spend; "unsupported" when the client cannot be asked. */
async function askToSpend(server: McpServer, message: string): Promise<"accepted" | "declined" | "unsupported"> {
  const elicitation = server.server.getClientCapabilities()?.elicitation;
  // An empty capability object means form mode; a URL-only client cannot show a form.
  if (!elicitation || (Object.keys(elicitation).length > 0 && !elicitation.form)) return "unsupported";
  try {
    const answer = await server.server.elicitInput({
      message,
      requestedSchema: {
        type: "object",
        properties: { confirm: { type: "boolean", title: "Spend these credits?", description: message } },
        required: ["confirm"],
      },
    });
    return answer.action === "accept" && answer.content?.confirm === true ? "accepted" : "declined";
  } catch {
    return "unsupported";
  }
}
