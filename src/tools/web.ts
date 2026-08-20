import { apiRequest } from "../client.js";
import { findEndpoint } from "../data/endpoints.js";
import { formatCost } from "../pricing.js";
import type { ApiContext } from "../context.js";
import type { HttpMethod } from "../types.js";

/**
 * The stateful `web` platform (Firecrawl-backed) — full web scraping, search,
 * and browser automation. Unlike the registry-driven `socialcrawl_request`
 * tool (GET, one request → one response), the web surface mixes sync reads,
 * async jobs with a poll/cancel lifecycle, stateful monitors, and interactive
 * browser sessions across GET/POST/PATCH/DELETE and `{id}` path params — so it
 * lives in this dedicated tool, mirroring `socialcrawl_monitors`. Auth is the
 * same x-api-key.
 *
 * `web/parse` (document upload) is a multipart/form-data endpoint and is not
 * exposed here — call `POST /v1/web/parse` directly with a file part.
 *
 * Two actions (`job_errors`, `crawl_preview`) map to stateful-router routes
 * that are not registry endpoints: both are free, and `crawl_preview` is the
 * dry run that shows what an expensive `crawl` would actually submit.
 */

export type WebAction =
  | "scrape"
  | "search"
  | "map"
  | "extract"
  | "crawl"
  | "batch_scrape"
  | "agent"
  | "job_list"
  | "job_get"
  | "job_cancel"
  | "job_errors"
  | "crawl_preview"
  | "monitor_create"
  | "monitor_list"
  | "monitor_get"
  | "monitor_update"
  | "monitor_delete"
  | "monitor_checks"
  | "session_create"
  | "session_list"
  | "session_get"
  | "session_execute"
  | "session_close";

export interface WebParams {
  action: WebAction;
  id?: string;
  input?: Record<string, unknown>;
  idempotencyKey?: string;
}

interface ActionSpec {
  method: HttpMethod;
  /** Path builder under /v1/web. `id` is already URL-encoded when present. */
  path: (id?: string) => string;
  /** Whether this action needs an `{id}` path param. */
  needsId: boolean;
  /** Required `input` keys (beyond `id`). */
  requires: string[];
  /** The data-layer resource string, for the pricing header. */
  resource: string;
}

const ACTIONS: Record<WebAction, ActionSpec> = {
  scrape: { method: "GET", path: () => "/v1/web/scrape", needsId: false, requires: ["url"], resource: "scrape" },
  search: { method: "GET", path: () => "/v1/web/search", needsId: false, requires: ["query"], resource: "search" },
  map: { method: "GET", path: () => "/v1/web/map", needsId: false, requires: ["url"], resource: "map" },
  extract: { method: "GET", path: () => "/v1/web/extract", needsId: false, requires: ["url"], resource: "extract" },
  crawl: { method: "POST", path: () => "/v1/web/crawl", needsId: false, requires: ["url"], resource: "crawl" },
  batch_scrape: { method: "POST", path: () => "/v1/web/batch-scrape", needsId: false, requires: ["urls"], resource: "batch-scrape" },
  agent: { method: "POST", path: () => "/v1/web/agent", needsId: false, requires: ["url", "prompt"], resource: "agent" },
  job_list: { method: "GET", path: () => "/v1/web/jobs", needsId: false, requires: [], resource: "jobs" },
  job_get: { method: "GET", path: (id) => `/v1/web/jobs/${id}`, needsId: true, requires: [], resource: "jobs/{job_id}" },
  job_cancel: { method: "DELETE", path: (id) => `/v1/web/jobs/${id}`, needsId: true, requires: [], resource: "jobs/{job_id}" },
  // Per-page failure feed for a crawl/batch job (0cr). Not a registry endpoint
  // — a stateful-router-only helper, so `resource` has no pricing row and the
  // header falls through to 0 credits, which is correct.
  job_errors: { method: "GET", path: (id) => `/v1/web/jobs/${id}/errors`, needsId: true, requires: [], resource: "jobs/{job_id}/errors" },
  // Dry-run the crawl body builder (0cr): shows exactly what a `crawl` call
  // would submit upstream, so an expensive crawl can be checked before paying.
  crawl_preview: { method: "POST", path: () => "/v1/web/crawl/params-preview", needsId: false, requires: ["url"], resource: "crawl/params-preview" },
  monitor_create: { method: "POST", path: () => "/v1/web/monitors", needsId: false, requires: ["url"], resource: "monitors" },
  monitor_list: { method: "GET", path: () => "/v1/web/monitors", needsId: false, requires: [], resource: "monitors" },
  monitor_get: { method: "GET", path: (id) => `/v1/web/monitors/${id}`, needsId: true, requires: [], resource: "monitors/{monitor_id}" },
  monitor_update: { method: "PATCH", path: (id) => `/v1/web/monitors/${id}`, needsId: true, requires: [], resource: "monitors/{monitor_id}" },
  monitor_delete: { method: "DELETE", path: (id) => `/v1/web/monitors/${id}`, needsId: true, requires: [], resource: "monitors/{monitor_id}" },
  monitor_checks: { method: "GET", path: (id) => `/v1/web/monitors/${id}/checks`, needsId: true, requires: [], resource: "monitors/{monitor_id}/checks" },
  session_create: { method: "POST", path: () => "/v1/web/sessions", needsId: false, requires: ["url"], resource: "sessions" },
  session_list: { method: "GET", path: () => "/v1/web/sessions", needsId: false, requires: [], resource: "sessions" },
  session_get: { method: "GET", path: (id) => `/v1/web/sessions/${id}`, needsId: true, requires: [], resource: "sessions/{session_id}" },
  session_execute: { method: "POST", path: (id) => `/v1/web/sessions/${id}/execute`, needsId: true, requires: ["code"], resource: "sessions/{session_id}/execute" },
  session_close: { method: "DELETE", path: (id) => `/v1/web/sessions/${id}`, needsId: true, requires: [], resource: "sessions/{session_id}" },
};

/**
 * SECURITY: `id` is interpolated into the upstream URL path. The zod schema
 * restricts it to URL-safe characters; encoding here is defense-in-depth so a
 * crafted id can't redirect the request to a different /v1 resource.
 */
const WEB_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function toQuery(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return out;
}

export async function web(ctx: ApiContext, params: WebParams): Promise<string> {
  const spec = ACTIONS[params.action];
  if (!spec) {
    return `Error: Unknown action "${String(params.action)}". Valid actions: ${Object.keys(ACTIONS).join(", ")}.`;
  }

  const input = params.input ?? {};

  if (spec.needsId && !params.id) {
    return `Error: The "${params.action}" action requires an \`id\`. List with the matching *_list action to find it.`;
  }
  if (params.id !== undefined && !WEB_ID_RE.test(params.id)) {
    return `Error: Invalid id "${params.id}". Ids are 1-128 characters of letters, digits, '_' or '-'.`;
  }

  const missing = spec.requires.filter(
    (name) => input[name] === undefined || input[name] === "",
  );
  if (missing.length > 0) {
    return `Error: The "${params.action}" action requires \`input.${missing.join("`, `input.")}\`. Use socialcrawl_list_endpoints with platform "web" for the full parameter list.`;
  }
  if (params.action === "extract" && input.schema === undefined && input.prompt === undefined) {
    return `Error: The "extract" action requires one of \`input.schema\` or \`input.prompt\`.`;
  }

  const id = params.id === undefined ? undefined : encodeURIComponent(params.id);
  const path = spec.path(id);

  const isBodyMethod = spec.method === "POST" || spec.method === "PATCH";
  const response = await apiRequest(ctx, {
    method: spec.method === "PATCH" ? "PATCH" : spec.method,
    path,
    query: isBodyMethod ? undefined : toQuery(input),
    body: isBodyMethod ? input : undefined,
    idempotencyKey: params.idempotencyKey,
    errorPlatform: "web",
  });

  const priced = findEndpoint("web", spec.resource, spec.method);
  const headerLines = [
    "## SocialCrawl Web",
    `**Operation:** \`${spec.method} ${path}\``,
    priced ? `**Price:** ${formatCost(priced.pricing)}` : "**Price:** 0cr (free)",
  ];
  // Every metered web action (scrape, search, crawl, sessions, monitors) states
  // its own rule in the registry — quote it verbatim so an agent knows a crawl
  // holds `limit` credits and refunds the unused pages.
  if (priced?.pricing.description) {
    headerLines.push(`**Rule:** ${priced.pricing.description}`);
  }
  if (priced?.execution === "async") {
    headerLines.push(
      "**Async:** this submits a job. Poll with `job_get` (and `job_errors` for per-page failures); the hold settles when the job finishes.",
    );
  }
  const header = `${headerLines.join("\n")}\n\n`;

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

/**
 * The (method, resource) pair each action targets. Exported so the coverage
 * test can assert that every web endpoint has an action and every action
 * points at a real route.
 */
export const WEB_ACTION_RESOURCES: { action: WebAction; method: HttpMethod; resource: string }[] =
  (Object.entries(ACTIONS) as [WebAction, ActionSpec][]).map(([action, spec]) => ({
    action,
    method: spec.method,
    resource: spec.resource,
  }));
