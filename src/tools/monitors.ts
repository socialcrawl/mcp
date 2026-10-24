import { apiRequest, withDryRun } from "../client.js";
import { ENDPOINTS, findEndpoint } from "../data/endpoints.js";
import type { ApiContext } from "../context.js";

/**
 * Stateful monitors family (`/v1/monitors/*`). Monitors re-run any registered
 * GET recipe (a registry endpoint or a Prism composite) on a cadence, deliver
 * each result to a signed webhook, and accumulate a per-run time-series. They
 * are NOT registry endpoints, so they live in this dedicated tool rather than
 * the registry-driven `socialcrawl_request` tool. Auth is the same x-api-key.
 *
 * A `track` monitor (numbers-only) keeps only the numbers it names, per row,
 * plus the change against the previous run; `webhook_url` is then optional
 * (a download-only monitor read back with `export` / `timeseries`).
 *
 * "Prism answers once; monitors watch it for you."
 *
 * Source of truth: packages/api/src/modules/monitors/ (router.ts, schema.ts,
 * create.ts, track-paths.ts, plan-caps.ts, params.ts, run-lifecycle.ts).
 */

export type MonitorAction =
  | "create"
  | "list"
  | "get"
  | "runs"
  | "timeseries"
  | "export"
  | "pause"
  | "resume"
  | "delete";

export interface MonitorTrack {
  /** 1-20 paths: `items[].<dot.path>` (one number per row) or `<dot.path>` (one off the page). */
  metrics: string[];
  /** Row id path. Defaults to post.id / comment.id / author.id when the row has one. */
  row_key?: string;
  /** Rows kept per run, 1-200 (default 100). */
  max_rows?: number;
}

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
  track?: MonitorTrack;
  webhook_format?: "full" | "rows";
  webhook_rows?: "all" | "new";
  // list / runs filters
  status?: string;
  cursor?: string;
  limit?: number;
  from?: string;
  to?: string;
  include?: string;
  // timeseries
  metric?: string;
  row?: string;
  // export
  format?: "csv" | "ndjson";
}

const ACTIONS: readonly MonitorAction[] = [
  "create",
  "list",
  "get",
  "runs",
  "timeseries",
  "export",
  "pause",
  "resume",
  "delete",
];

const ID_ACTIONS = new Set<MonitorAction>([
  "get",
  "runs",
  "timeseries",
  "export",
  "pause",
  "resume",
  "delete",
]);

/** Limits from track-paths.ts, enforced locally so a bad body costs no round trip. */
export const MONITOR_TRACK_LIMITS = { maxMetrics: 20, maxRows: 200 } as const;

/** The pseudo-metric a `track` monitor can alert on (schema.ts ROWS_NEW_METRIC). */
const ROWS_NEW_METRIC = "rows_new";
const ROWS_NEW_OPS = new Set(["gt", "gte"]);

/** `include` on runs: `result`, `numbers`, or both comma-separated (schema.ts runsQuerySchema). */
const INCLUDE_RE = /^(result|numbers)(,(result|numbers))?$/;

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

/**
 * Free local checks on the create body. Each mirrors a 400 the API returns at
 * create (create.ts planMonitorCreate), so the agent learns it without a round
 * trip. The server still runs the full check, including whether each track
 * path is a real numeric field of the recipe's page.
 */
function validateCreate(input: MonitorsParams): string | null {
  const missing: string[] = [];
  if (!input.recipe) missing.push("`recipe` (e.g., \"prism/brand-mentions\" or \"tiktok/profile\")");
  if (!input.cadence) missing.push("`cadence` (\"hourly\" | \"daily\" | \"weekly\" | a cron expression)");
  // A tracking monitor can be download-only; any other needs somewhere to deliver.
  if (!input.webhook_url && !input.track) {
    missing.push("`webhook_url` (required unless `track` is set: a track monitor can be download-only)");
  }
  if (missing.length > 0) {
    return `Error: Missing required parameter(s) for create: ${missing.join(", ")}.`;
  }

  // The recipe must resolve to a registered GET endpoint. Prism composites are
  // added often and may be newer than this server's bundled catalogue, so an
  // unknown prism/* recipe is left to the API's own (free) 400.
  const recipe = input.recipe!;
  const slash = recipe.indexOf("/");
  if (slash > 0) {
    const platform = recipe.slice(0, slash);
    const resource = recipe.slice(slash + 1);
    const endpoint = findEndpoint(platform, resource);
    if (!endpoint && platform !== "prism") {
      return `Error: Unknown recipe "${recipe}". It must be a registered GET endpoint (use socialcrawl_find) or a Prism composite (e.g., "prism/reputation", "prism/profile/comments").`;
    }
    const hasGet = ENDPOINTS.some((e) => e.platform === platform && e.resource === resource && e.method === "GET");
    if (endpoint && !hasGet) {
      return `Error: Recipe "${recipe}" is a ${endpoint.method} endpoint and cannot be monitored. Monitors re-run a recipe as a GET with the params frozen at create, so batch endpoints that read a JSON body have to be called directly. Monitor a GET recipe instead.`;
    }
  }

  const track = input.track;
  if (track) {
    const metrics = track.metrics ?? [];
    if (metrics.length < 1 || metrics.length > MONITOR_TRACK_LIMITS.maxMetrics) {
      return `Error: \`track.metrics\` takes 1 to ${MONITOR_TRACK_LIMITS.maxMetrics} paths (got ${metrics.length}). Use 'items[].<path>' for one number per row (e.g. items[].post.engagement.views) or '<path>' for one number off the page (e.g. author.followers).`;
    }
    if (
      track.max_rows !== undefined &&
      (!Number.isInteger(track.max_rows) || track.max_rows < 1 || track.max_rows > MONITOR_TRACK_LIMITS.maxRows)
    ) {
      return `Error: \`track.max_rows\` must be an integer between 1 and ${MONITOR_TRACK_LIMITS.maxRows} (default 100).`;
    }
  }
  const hasRowMetric = !!track && (track.metrics ?? []).some((m) => m.startsWith("items[]."));

  for (const raw of input.alert_rules ?? []) {
    const rule = raw as { metric?: unknown; op?: unknown };
    if (rule?.metric === ROWS_NEW_METRIC) {
      if (!track) {
        return `Error: alert_rules: '${ROWS_NEW_METRIC}' needs \`track\` (a numbers-only monitor), because only a track monitor keeps per-row numbers to compare. Add track.metrics with an 'items[].<path>' metric.`;
      }
      if (!ROWS_NEW_OPS.has(String(rule.op))) {
        return `Error: alert_rules: '${ROWS_NEW_METRIC}' supports only the ops gt and gte (got '${String(rule.op)}'). Use {"metric":"${ROWS_NEW_METRIC}","op":"gt","value":0} to alert on any new row.`;
      }
      if (!hasRowMetric) {
        return `Error: alert_rules: '${ROWS_NEW_METRIC}' counts new list rows, so track.metrics needs at least one 'items[].<path>' metric.`;
      }
    } else if (track && typeof rule?.metric === "string" && !track.metrics.includes(rule.metric)) {
      return `Error: alert_rules: '${rule.metric}' is not in track.metrics. A monitor with track stores only the tracked numbers, so its rules read those: add '${rule.metric}' to track.metrics, or use '${ROWS_NEW_METRIC}' to alert on new rows.`;
    }
  }

  if (!input.webhook_url && (input.webhook_secret !== undefined || input.webhook_format !== undefined)) {
    return "Error: `webhook_secret` and `webhook_format` only apply to webhook deliveries. Set `webhook_url`, or leave both out for a download-only monitor.";
  }
  if (input.webhook_format === "rows" && !track) {
    return 'Error: `webhook_format: "rows"` needs `track`: the rows payload is built from the tracked numbers. Add track, or use webhook_format "full".';
  }
  if (input.webhook_rows === "new") {
    if (!track || !hasRowMetric) {
      return "Error: `webhook_rows: \"new\"` sends only the list rows that are new since the previous run, so it needs `track` with at least one 'items[].<path>' metric.";
    }
    if (!input.webhook_url) {
      return "Error: `webhook_rows` only applies to webhook deliveries. Set `webhook_url`, or leave webhook_rows out for a download-only monitor.";
    }
  }
  return null;
}

export async function monitors(ctx: ApiContext, input: MonitorsParams, opts: { dryRun?: boolean } = {}): Promise<string> {
  const send = (o: Parameters<typeof apiRequest>[1]) => apiRequest(ctx, withDryRun(o, opts.dryRun));
  const { action } = input;

  if (!ACTIONS.includes(action)) {
    return `Error: Unknown action "${action as string}". Valid actions: ${ACTIONS.join(", ")}.`;
  }
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
      const invalid = validateCreate(input);
      if (invalid) return invalid;

      const body: Record<string, unknown> = {
        recipe: input.recipe,
        cadence: toCadence(input.cadence!),
      };
      if (input.webhook_url) body.webhook_url = input.webhook_url;
      if (input.track) body.track = input.track;
      if (input.params) body.params = input.params;
      if (input.name) body.name = input.name;
      if (input.alert_rules) body.alert_rules = input.alert_rules;
      if (input.suppress_webhook_unless_alert !== undefined) {
        body.suppress_webhook_unless_alert = input.suppress_webhook_unless_alert;
      }
      if (input.output_schema) body.output_schema = input.output_schema;
      if (input.webhook_secret) body.webhook_secret = input.webhook_secret;
      if (input.webhook_format) body.webhook_format = input.webhook_format;
      if (input.webhook_rows) body.webhook_rows = input.webhook_rows;

      response = await send({ method: "POST", path: "/v1/monitors", body });
      label = "POST /v1/monitors";
      break;
    }

    case "list": {
      const query = pruneQuery({
        status: input.status,
        cursor: input.cursor,
        limit: input.limit?.toString(),
      });
      response = await send({ method: "GET", path: "/v1/monitors", query });
      label = "GET /v1/monitors";
      break;
    }

    case "get": {
      response = await send({ method: "GET", path: `/v1/monitors/${id}` });
      label = `GET /v1/monitors/${input.id}`;
      break;
    }

    case "runs": {
      const include = input.include?.replace(/\s+/g, "");
      if (include !== undefined && !INCLUDE_RE.test(include)) {
        return "Error: `include` on runs takes 'result', 'numbers', or 'result,numbers'.";
      }
      const query = pruneQuery({
        status: input.status,
        from: input.from,
        to: input.to,
        cursor: input.cursor,
        limit: input.limit?.toString(),
        include,
      });
      response = await send({ method: "GET", path: `/v1/monitors/${id}/runs`, query });
      label = `GET /v1/monitors/${input.id}/runs`;
      break;
    }

    case "timeseries": {
      const query = pruneQuery({ metric: input.metric, from: input.from, to: input.to, row: input.row });
      response = await send({ method: "GET", path: `/v1/monitors/${id}/timeseries`, query });
      label = `GET /v1/monitors/${input.id}/timeseries`;
      break;
    }

    case "export": {
      if (input.format !== undefined && input.format !== "csv" && input.format !== "ndjson") {
        return "Error: `format` for export is 'csv' (default) or 'ndjson'.";
      }
      const format = input.format ?? "csv";
      const query = pruneQuery({ format, from: input.from, to: input.to });
      response = await send({ method: "GET", path: `/v1/monitors/${id}/export`, query });
      label = `GET /v1/monitors/${input.id}/export (${format})`;
      break;
    }

    case "pause":
    case "resume": {
      const status = action === "pause" ? "paused" : "active";
      response = await send({
        method: "PATCH",
        path: `/v1/monitors/${id}`,
        body: { status },
      });
      label = `PATCH /v1/monitors/${input.id} (${status})`;
      break;
    }

    case "delete": {
      response = await send({ method: "DELETE", path: `/v1/monitors/${id}` });
      label = `DELETE /v1/monitors/${input.id}`;
      break;
    }

    default: {
      return `Error: Unknown action "${action as string}". Valid actions: ${ACTIONS.join(", ")}.`;
    }
  }

  const costLine =
    action === "export"
      ? "**Credit cost:** 0 (export is free; it reads at most the newest 1,000 runs in the window)"
      : "**Credit cost:** 0 to manage (each scheduled run bills the recipe's own cost + 1; a run that fails or records nothing is refunded)";
  const header = ["## SocialCrawl Monitors", `**Operation:** \`${label}\``, costLine, ""].join("\n");

  if (response.startsWith("Error:")) {
    return `${header}${response}`;
  }

  if (action === "export") {
    const fence = (input.format ?? "csv") === "csv" ? "csv" : "jsonl";
    return `${header}\`\`\`${fence}\n${response.replace(/\n+$/, "")}\n\`\`\``;
  }

  try {
    const parsed = JSON.parse(response) as Record<string, unknown>;
    return `${header}\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
  } catch {
    return `${header}${response}`;
  }
}
