import { z } from "zod";
import { getAllPlatformSlugs } from "../data/platforms.js";

const platformSlugs = getAllPlatformSlugs();

export const ListPlatformsInputSchema = z.object({}).strict();

export const ListEndpointsInputSchema = z.object({
  platform: z
    .enum(platformSlugs as [string, ...string[]])
    .optional()
    .describe(
      "Platform slug (e.g., 'tiktok', 'instagram', 'youtube'). Omit it and pass `search` to look for an endpoint across all platforms.",
    ),
  search: z
    .string()
    .optional()
    .describe(
      "Free-text search over endpoint names, summaries, descriptions, archetypes, and tags (e.g. 'transcript', 'reviews', 'followers'). Works with or without `platform` — without one it searches all platforms.",
    ),
  method: z
    .enum(["GET", "POST", "PATCH", "DELETE"])
    .optional()
    .describe("Only show endpoints served with this HTTP method."),
  maxCost: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Only show endpoints that cost at most this many credits per call (metered endpoints are judged by their ceiling).",
    ),
  detail: z
    .enum(["compact", "full"])
    .optional()
    .describe(
      "'full' (default for a single platform) prints every parameter with its type, range, enum values, and couplings. 'compact' prints the summary table only — use it when searching broadly.",
    ),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Page number (default 1). Output longer than one response is paged, not truncated — the footer says how many pages there are and repeats your filters.",
    ),
}).strict();

export const RequestInputSchema = z.object({
  platform: z
    .enum(platformSlugs as [string, ...string[]])
    .describe("Platform slug (e.g., 'tiktok', 'instagram', 'youtube')"),
  resource: z
    .string()
    .min(1, "Resource path is required")
    .describe("Resource path (e.g., 'profile', 'post/comments', 'search')"),
  params: z
    .record(z.string())
    .optional()
    .describe(
      "Query parameters as key-value pairs (e.g., { handle: 'charlidamelio' }). For GET endpoints these are the query string. For POST batch endpoints, put scalar query params here (e.g. { hl: 'en' }) and the array/object body in `body`.",
    ),
  body: z
    .record(z.unknown())
    .optional()
    .describe(
      "JSON request body for POST batch endpoints (e.g. youtube/videos, prism/profiles). Put array/object params here — e.g. { ids: ['dQw4w9WgXcQ'] } or { items: [{ platform: 'tiktok', handle: '@scout2015' }] }. Ignored for GET endpoints. Use socialcrawl_list_endpoints to see which params belong in the body. For the web-scraping platform use the socialcrawl_web tool instead.",
    ),
  idempotencyKey: z
    .string()
    .min(16, "Idempotency-Key should be at least 16 characters (UUIDv4 recommended)")
    .optional()
    .describe(
      "Optional Idempotency-Key header. Lets you safely retry the same request — replays return the original response and deduct 0 credits (24h TTL).",
    ),
}).strict();

export const CheckBalanceInputSchema = z.object({
  view: z
    .enum(["balance", "transactions"])
    .optional()
    .describe(
      "'balance' (default) returns the current credit balance and recent-deduction summary. 'transactions' returns the itemised credit ledger — every deduction and refund keyed by request_id, which is how you confirm what a metered endpoint actually charged after its upfront hold was refunded.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("transactions: page size (1-100, default 50)."),
  cursor: z
    .string()
    .optional()
    .describe("transactions: opaque keyset cursor from a previous response's next_cursor."),
  requestId: z
    .string()
    .optional()
    .describe("transactions: fetch the receipt(s) for one request id (e.g. 'req-a1b2c3d4e5f6')."),
}).strict();

export const MonitorsInputSchema = z.object({
  action: z
    .enum(["create", "list", "get", "runs", "timeseries", "pause", "resume", "delete"])
    .describe(
      "Monitor operation: 'create' a scheduled monitor, 'list' your monitors, 'get' one, 'runs' for its run history, 'timeseries' for its metric series, 'pause'/'resume' it, or 'delete' it.",
    ),
  id: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]{1,64}$/,
      "Monitor id must be 1-64 characters of letters, digits, '_' or '-'",
    )
    .optional()
    .describe("Monitor id. Required for get/runs/timeseries/pause/resume/delete."),
  recipe: z
    .string()
    .optional()
    .describe(
      "create: the recipe to run each cadence — any registered endpoint or Prism composite as 'platform/resource' (e.g., 'prism/brand-mentions', 'tiktok/profile').",
    ),
  params: z
    .record(z.unknown())
    .optional()
    .describe("create: parameters passed to the recipe on every run (e.g., { keyword: 'acme' })."),
  cadence: z
    .string()
    .optional()
    .describe("create: 'hourly', 'daily', 'weekly', or a cron expression (e.g., '0 9 * * 1')."),
  webhook_url: z
    .string()
    .optional()
    .describe("create: HTTPS URL that receives each run's signed (HMAC-SHA256) result."),
  name: z.string().optional().describe("create: optional human-readable label."),
  alert_rules: z
    .array(
      z.object({
        metric: z.string(),
        op: z.enum([
          "gt",
          "lt",
          "gte",
          "lte",
          "abs_change_gt",
          "pct_change_gt",
          "pct_change_lt",
        ]),
        value: z.number(),
        window: z.enum(["1d", "1w"]).optional(),
      }),
    )
    .optional()
    .describe(
      "create: optional alert rules on the recipe's computed metrics — e.g., [{ metric: 'negative_share', op: 'pct_change_gt', value: 25 }].",
    ),
  suppress_webhook_unless_alert: z
    .boolean()
    .optional()
    .describe("create: only fire the webhook when an alert rule trips (default false)."),
  output_schema: z
    .record(z.unknown())
    .optional()
    .describe("create: optional JSON schema to shape the delivered payload."),
  webhook_secret: z
    .string()
    .optional()
    .describe("create: optional signing secret (8-200 chars); otherwise one is generated and returned once."),
  status: z
    .string()
    .optional()
    .describe(
      "Filter. For list: 'active' | 'paused' | 'all'. For runs: 'ok' | 'partial' | 'failed' | 'skipped'.",
    ),
  cursor: z.string().optional().describe("list/runs: pagination cursor."),
  limit: z.number().int().min(1).max(100).optional().describe("list/runs: page size (1-100, default 20)."),
  from: z.string().optional().describe("runs/timeseries: ISO start of the time window."),
  to: z.string().optional().describe("runs/timeseries: ISO end of the time window."),
  include: z
    .enum(["result"])
    .optional()
    .describe("runs: set to 'result' to include each run's full stored result envelope."),
  metric: z
    .string()
    .optional()
    .describe("timeseries: comma-separated metric keys to project (defaults to all stable computed keys)."),
}).strict();

export const WebInputSchema = z.object({
  action: z
    .enum([
      "scrape",
      "search",
      "map",
      "extract",
      "crawl",
      "batch_scrape",
      "agent",
      "job_list",
      "job_get",
      "job_cancel",
      "job_errors",
      "crawl_preview",
      "monitor_create",
      "monitor_list",
      "monitor_get",
      "monitor_update",
      "monitor_delete",
      "monitor_checks",
      "session_create",
      "session_list",
      "session_get",
      "session_execute",
      "session_close",
    ])
    .describe(
      "Web operation. Sync (returns data now): scrape, search, map, extract. Async jobs: crawl, batch_scrape, agent → then job_get/job_list/job_cancel to poll, and job_errors for a job's per-page failure feed. crawl_preview dry-runs a crawl's parameters for free before you pay for it. Change detection: monitor_create/list/get/update/delete/checks. Interactive browser: session_create/list/get/execute/close.",
    ),
  id: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]{1,128}$/,
      "Web resource id must be 1-128 chars of letters, digits, '_' or '-'",
    )
    .optional()
    .describe(
      "Job / monitor / session id. Required for *_get, *_cancel, *_delete, *_update, *_checks, *_execute, and job_errors actions. Returned by the matching *_create / *_list action.",
    ),
  input: z
    .record(z.unknown())
    .optional()
    .describe(
      "Operation parameters. For sync/GET actions these are query params (e.g. { url: 'https://example.com', formats: 'markdown,screenshot' } for scrape; { query: 'ai agents', limit: 10 } for search). For POST/PATCH actions this is the JSON body (e.g. { url, prompt, model } for agent; { url, cadence_minutes, webhook_url } for monitor_create; { code, language } for session_execute). Use socialcrawl_list_endpoints for platform 'web', or the 'web' get_docs topic, for the full per-action parameter list.",
    ),
  idempotencyKey: z
    .string()
    .min(16, "Idempotency-Key should be at least 16 characters (UUIDv4 recommended)")
    .optional()
    .describe(
      "Optional Idempotency-Key for the async job submitters (crawl, batch_scrape). Replays return the original job and deduct 0 credits.",
    ),
}).strict();

export const GetDocsInputSchema = z.object({
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Page number for long topics (default 1). Topics longer than one response are paged rather than truncated — the footer tells you how many pages there are. 'full' and the largest platform topics span several pages.",
    ),
  topic: z
    .string()
    .optional()
    .default("overview")
    .describe(
      "Documentation topic: 'overview', 'full', 'authentication', 'credits', 'pricing' (per-endpoint costs), 'errors', 'idempotency', 'pagination', 'caching', 'response-schema', 'limits', 'monitors', 'discovery', or a platform slug (e.g., 'tiktok', or 'web' for the scraping/browser surface).",
    ),
}).strict();

export const PricingInputSchema = z.object({
  action: z
    .enum(["overview", "endpoint", "platform", "list"])
    .optional()
    .describe(
      "'overview' (default): the tier ladder, every free endpoint, every flat override, every metered band with its rule, cache TTLs, and the refund matrix. 'endpoint': one endpoint's exact price, metered rule, price-driving params, and worst case (needs platform + resource). 'platform': the cost table for one platform (needs platform). 'list': rank/filter endpoints by price across platforms.",
    ),
  platform: z
    .enum(platformSlugs as [string, ...string[]])
    .optional()
    .describe("Platform slug. Required for 'endpoint' and 'platform' actions; filters the 'list' action."),
  resource: z
    .string()
    .optional()
    .describe("Resource path for the 'endpoint' action (e.g., 'profile', 'comments', 'jobs/{job_id}')."),
  method: z
    .enum(["GET", "POST", "PATCH", "DELETE"])
    .optional()
    .describe(
      "HTTP method. Disambiguates the `web` platform, where one resource is served by several methods; also filters the 'list' action.",
    ),
  search: z
    .string()
    .optional()
    .describe("list: free-text filter over platform, resource, summary, and archetype."),
  model: z
    .enum(["ladder", "flat", "metered", "free"])
    .optional()
    .describe(
      "list: filter by billing model — 'ladder' (tier rate per request), 'flat' (per-endpoint override), 'metered' (query-dependent, ceiling deducted then refunded down), or 'free' (0 credits).",
    ),
  maxCost: z
    .number()
    .min(0)
    .optional()
    .describe("list: only endpoints that can cost at most this many credits (metered judged by their ceiling)."),
  minCost: z
    .number()
    .min(0)
    .optional()
    .describe("list: only endpoints that cost at least this many credits (metered judged by their floor)."),
  sort: z
    .enum(["cost_asc", "cost_desc", "platform", "name"])
    .optional()
    .describe("list: sort order (default 'cost_desc' — most expensive first)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("list: maximum rows to return (1-200, default 40)."),
}).strict();

export const DiscoverInputSchema = z.object({
  action: z
    .enum(["quickstart", "catalog", "endpoint", "llms", "freshness"])
    .optional()
    .describe(
      "'quickstart' (default): auth, base URL, envelope, billing, the error taxonomy, limits, and a first call — GET /v1/utility/quickstart. 'catalog': the machine-readable list of every endpoint with live metered-aware prices — GET /v1/utility/endpoints. 'endpoint': one endpoint's complete usage guide, params, pricing rule, cache, paging, example response, curl, and related endpoints — GET /v1/utility/endpoint. 'llms': the agent context corpus for the whole API or one platform — GET /v1/utility/llms. 'freshness': compare the live registry against this server's bundled catalogue to see whether this MCP version is current.",
    ),
  platform: z
    .string()
    .optional()
    .describe(
      "Scope to one platform slug (e.g. 'tiktok'). Applies to quickstart, catalog, and llms.",
    ),
  search: z
    .string()
    .optional()
    .describe("catalog: case-insensitive substring filter over endpoint paths and summaries."),
  method: z
    .enum(["GET", "POST", "PATCH", "DELETE"])
    .optional()
    .describe(
      "catalog: filter by HTTP method. endpoint: disambiguate a resource registered under more than one method (the stateful `web` family).",
    ),
  id: z
    .string()
    .optional()
    .describe(
      "endpoint (required): the endpoint id as 'platform/resource' (e.g. 'tiktok/profile'), a path ('/v1/tiktok/profile'), or a full URL.",
    ),
  format: z
    .enum(["markdown", "json"])
    .optional()
    .describe("llms: 'markdown' (default) returns the corpus text; 'json' returns a structured context object."),
  live: z
    .boolean()
    .optional()
    .describe(
      "Set false to answer from this server's bundled catalogue instead of calling the live API. Default is live whenever an API key is configured; without a key everything except 'llms' falls back to bundled data automatically.",
    ),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Page number (default 1). Long output is paged, not truncated."),
}).strict();
