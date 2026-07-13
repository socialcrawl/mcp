import { z } from "zod";
import { getAllPlatformSlugs } from "../data/platforms.js";

const platformSlugs = getAllPlatformSlugs();

export const ListPlatformsInputSchema = z.object({}).strict();

export const ListEndpointsInputSchema = z.object({
  platform: z
    .enum(platformSlugs as [string, ...string[]])
    .describe("Platform slug (e.g., 'tiktok', 'instagram', 'youtube')"),
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

export const CheckBalanceInputSchema = z.object({}).strict();

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
      "Web operation. Sync (returns data now): scrape, search, map, extract. Async jobs: crawl, batch_scrape, agent → then job_get/job_list/job_cancel to poll. Change detection: monitor_create/list/get/update/delete/checks. Interactive browser: session_create/list/get/execute/close.",
    ),
  id: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]{1,128}$/,
      "Web resource id must be 1-128 chars of letters, digits, '_' or '-'",
    )
    .optional()
    .describe(
      "Job / monitor / session id. Required for *_get, *_cancel, *_delete, *_update, *_checks, *_execute actions. Returned by the matching *_create / *_list action.",
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
  topic: z
    .string()
    .optional()
    .default("overview")
    .describe(
      "Documentation topic: 'overview', 'full', 'authentication', 'credits', 'errors', 'idempotency', 'pricing', or a platform slug (e.g., 'tiktok')",
    ),
}).strict();
