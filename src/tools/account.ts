import type { ApiContext } from "../context.js";
import { errorFromText, isErrorText } from "../result.js";
import type { ToolOutput } from "../result.js";
import { apiRequest } from "../client.js";
import { checkBalanceStructured } from "./check-balance.js";
import { discover } from "./discover.js";

/**
 * `socialcrawl_account` (MCP-04): the account and the service, all free.
 * `balance` (default; carries this session's spend), `transactions` (the
 * ledger, the receipts for one request) and `usage` (spend per key per day)
 * read `/v1/credits/*`; `status` reads
 * the public `/v1/status`; `freshness` compares the live catalogue with the
 * one bundled in this server.
 */

export interface AccountParams {
  view?: "balance" | "transactions" | "usage" | "status" | "freshness" | "notifications";
  /** notifications: only unread (true) or only read (false). */
  unread?: boolean;
  /** notifications: comma list of kinds. */
  kind?: string;
  limit?: number;
  cursor?: string;
  request_id?: string;
  /** usage: first and last UTC day (YYYY-MM-DD), at most 92 days apart. */
  from?: string;
  to?: string;
  group_by?: "api_key" | "day" | "api_key,day";
  api_key_id?: string;
}

export async function accountStructured(ctx: ApiContext, params: AccountParams): Promise<ToolOutput> {
  const view = params.view ?? "balance";
  if (view === "balance" || view === "transactions") {
    return checkBalanceStructured(ctx, { view, limit: params.limit, cursor: params.cursor, requestId: params.request_id });
  }
  if (view === "usage") {
    return checkBalanceStructured(ctx, {
      view,
      from: params.from,
      to: params.to,
      groupBy: params.group_by,
      apiKeyId: params.api_key_id,
    });
  }
  if (view === "notifications") return notifications(ctx, params);
  const text = await discover(ctx, { action: view });
  return { text, structured: isErrorText(text) ? errorFromText(text) : { ok: true, view } };
}

/** The kinds GET /v1/notifications filters on (packages/db notification-kinds.ts). */
export const NOTIFICATION_KINDS = [
  "job.failed",
  "job.paused",
  "dataset.ready",
  "credits.refused",
  "credits.low",
  "defect.fixed",
  "release.published",
] as const;

/**
 * UPGRADE-LOG API-072: the account inbox, 0 credits. Each item carries
 * `kind`, `severity`, `title`, `message`, `next_step` (what to do about it),
 * `subject`, a dashboard `url` and `occurrences`.
 */
async function notifications(ctx: ApiContext, params: AccountParams): Promise<ToolOutput> {
  const kinds = (params.kind ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  const bad = kinds.filter((k) => !(NOTIFICATION_KINDS as readonly string[]).includes(k));
  if (bad.length > 0) {
    const text = `Error: Invalid parameter value(s): kind ${bad.map((k) => `"${k}"`).join(", ")}. Kinds: ${NOTIFICATION_KINDS.join(", ")}. Nothing was sent.`;
    return { text, structured: errorFromText(text) };
  }
  const query: Record<string, string> = {};
  if (params.unread !== undefined) query.unread = String(params.unread);
  if (kinds.length > 0) query.kind = kinds.join(",");
  if (params.limit !== undefined) query.limit = String(params.limit);
  if (params.cursor) query.cursor = params.cursor;
  const response = await apiRequest(ctx, { method: "GET", path: "/v1/notifications", query, errorPlatform: "notifications" });
  if (isErrorText(response)) return { text: response, structured: errorFromText(response) };
  const text = [
    "## SocialCrawl Notifications",
    "**Operation:** `GET /v1/notifications`",
    "**Credit cost:** 0 credits",
    "Each item's `next_step` says what to do about it (a failed or paused job, a dataset ready, a refused call, low credits, a fixed defect, a release). Page with `data.next_cursor` as `cursor`; `data.unread_count` is the inbox total. Mark items read in the dashboard.",
    "",
    "```json",
    response,
    "```",
  ].join("\n");
  return { text, structured: { ok: true, view: "notifications" } };
}
