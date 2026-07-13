import { apiRequest } from "../client.js";
import { findEndpoint } from "../data/endpoints.js";
import type { ApiContext } from "../context.js";

/**
 * Stateful monitors family (`/v1/monitors/*`). Monitors re-run any registered
 * recipe (a registry endpoint or a Prism composite) on a cadence, deliver each
 * result to a signed webhook, and accumulate a per-run time-series. They are
 * NOT registry endpoints, so they live in this dedicated tool rather than the
 * registry-driven `socialcrawl_request` tool. Auth is the same x-api-key.
 *
 * "Prism answers once; monitors watch it for you."
 */

export type MonitorAction =
  | "create"
  | "list"
  | "get"
  | "runs"
  | "timeseries"
  | "pause"
  | "resume"
  | "delete";

export interface MonitorsParams {
  action: MonitorAction;
  id?: string;
  // create
  recipe?: string;
  params?: Record<string, unknown>;
  cadence?: string;
  webhook_url?: string;
  name?: string;
  alert_rules?: unknown[];
  suppress_webhook_unless_alert?: boolean;
  output_schema?: Record<string, unknown>;
  webhook_secret?: string;
  // list / runs filters
  status?: string;
  cursor?: string;
  limit?: number;
  from?: string;
  to?: string;
  include?: string;
  // timeseries
  metric?: string;
}

const ID_ACTIONS = new Set<MonitorAction>([
  "get",
  "runs",
  "timeseries",
  "pause",
  "resume",
  "delete",
]);

/**
 * SECURITY: `id` is interpolated into the upstream URL path. Restricting it to
 * URL-safe characters (and encoding it at the call sites) prevents a crafted
 * id like "../credits/balance" or "x?y=z" from redirecting the request —
 * including DELETEs — to a different /v1 resource. Mirrors the zod schema so
 * direct (non-MCP) callers get the same guarantee.
 */
const MONITOR_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Map the validated `cadence` string to the API's union (preset | {cron}). */
function toCadence(cadence: string): "hourly" | "daily" | "weekly" | { cron: string } {
  if (cadence === "hourly" || cadence === "daily" || cadence === "weekly") {
    return cadence;
  }
  return { cron: cadence };
}

function pruneQuery(q: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

export async function monitors(ctx: ApiContext, input: MonitorsParams): Promise<string> {
  const { action } = input;

  if (ID_ACTIONS.has(action) && !input.id) {
    return `Error: The "${action}" action requires a monitor \`id\`. List your monitors with action "list" to find it.`;
  }
  if (input.id !== undefined && !MONITOR_ID_RE.test(input.id)) {
    return `Error: Invalid monitor id "${input.id}". Ids are 1-64 characters of letters, digits, '_' or '-'. List your monitors with action "list" to find the right id.`;
  }
  // Safe after the guard above; encoding is defense-in-depth for the URL path.
  const id = input.id === undefined ? undefined : encodeURIComponent(input.id);

  let response: string;
  let label: string;

  switch (action) {
    case "create": {
      const missing: string[] = [];
      if (!input.recipe) missing.push("`recipe` (e.g., \"prism/brand-mentions\" or \"tiktok/profile\")");
      if (!input.cadence) missing.push("`cadence` (\"hourly\" | \"daily\" | \"weekly\" | a cron expression)");
      if (!input.webhook_url) missing.push("`webhook_url`");
      if (missing.length > 0) {
        return `Error: Missing required parameter(s) for create: ${missing.join(", ")}.`;
      }
      // Local sanity check: the recipe must resolve to a registered endpoint.
      const slash = input.recipe!.indexOf("/");
      if (slash > 0) {
        const platform = input.recipe!.slice(0, slash);
        const resource = input.recipe!.slice(slash + 1);
        if (!findEndpoint(platform, resource)) {
          return `Error: Unknown recipe "${input.recipe}". It must be a registered endpoint (use socialcrawl_list_endpoints) or a Prism composite (e.g., "prism/reputation").`;
        }
      }
      const body: Record<string, unknown> = {
        recipe: input.recipe,
        cadence: toCadence(input.cadence!),
        webhook_url: input.webhook_url,
      };
      if (input.params) body.params = input.params;
      if (input.name) body.name = input.name;
      if (input.alert_rules) body.alert_rules = input.alert_rules;
      if (input.suppress_webhook_unless_alert !== undefined) {
        body.suppress_webhook_unless_alert = input.suppress_webhook_unless_alert;
      }
      if (input.output_schema) body.output_schema = input.output_schema;
      if (input.webhook_secret) body.webhook_secret = input.webhook_secret;

      response = await apiRequest(ctx, { method: "POST", path: "/v1/monitors", body });
      label = "POST /v1/monitors";
      break;
    }

    case "list": {
      const query = pruneQuery({
        status: input.status,
        cursor: input.cursor,
        limit: input.limit?.toString(),
      });
      response = await apiRequest(ctx, { method: "GET", path: "/v1/monitors", query });
      label = "GET /v1/monitors";
      break;
    }

    case "get": {
      response = await apiRequest(ctx, { method: "GET", path: `/v1/monitors/${id}` });
      label = `GET /v1/monitors/${input.id}`;
      break;
    }

    case "runs": {
      const query = pruneQuery({
        status: input.status,
        from: input.from,
        to: input.to,
        cursor: input.cursor,
        limit: input.limit?.toString(),
        include: input.include,
      });
      response = await apiRequest(ctx, { method: "GET", path: `/v1/monitors/${id}/runs`, query });
      label = `GET /v1/monitors/${input.id}/runs`;
      break;
    }

    case "timeseries": {
      const query = pruneQuery({ metric: input.metric, from: input.from, to: input.to });
      response = await apiRequest(ctx, { method: "GET", path: `/v1/monitors/${id}/timeseries`, query });
      label = `GET /v1/monitors/${input.id}/timeseries`;
      break;
    }

    case "pause":
    case "resume": {
      const status = action === "pause" ? "paused" : "active";
      response = await apiRequest(ctx, {
        method: "PATCH",
        path: `/v1/monitors/${id}`,
        body: { status },
      });
      label = `PATCH /v1/monitors/${input.id} (${status})`;
      break;
    }

    case "delete": {
      response = await apiRequest(ctx, { method: "DELETE", path: `/v1/monitors/${id}` });
      label = `DELETE /v1/monitors/${input.id}`;
      break;
    }

    default: {
      return `Error: Unknown action "${action as string}". Valid actions: create, list, get, runs, timeseries, pause, resume, delete.`;
    }
  }

  const header = [
    "## SocialCrawl Monitors",
    `**Operation:** \`${label}\``,
    "**Credit cost:** 0 to manage (each scheduled run bills the recipe's own cost + 1)",
    "",
  ].join("\n");

  if (response.startsWith("Error:")) {
    return `${header}${response}`;
  }

  try {
    const parsed = JSON.parse(response) as Record<string, unknown>;
    return `${header}\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
  } catch {
    return `${header}${response}`;
  }
}
