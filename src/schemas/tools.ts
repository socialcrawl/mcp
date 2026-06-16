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
    .describe("Query parameters as key-value pairs (e.g., { handle: 'charlidamelio' })"),
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

export const GetDocsInputSchema = z.object({
  topic: z
    .string()
    .optional()
    .default("overview")
    .describe(
      "Documentation topic: 'overview', 'full', 'authentication', 'credits', 'errors', 'idempotency', 'pricing', or a platform slug (e.g., 'tiktok')",
    ),
}).strict();
