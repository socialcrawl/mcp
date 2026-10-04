import { z } from "zod";

/**
 * Output schemas (MCP `outputSchema`) for the tools whose results an agent
 * branches on. Each is one flat object with `ok` first, so a client can read
 * `ok` before anything else; the success fields and the error fields are all
 * optional because the SDK needs a single object schema at the root. A failure
 * is also flagged `isError`, and the SDK skips output validation for those.
 */

const CreditsSchema = z.object({
  used: z.number().optional().describe("After refunds."),
  remaining: z.number().optional(),
  cached: z.boolean().optional().describe("Cache hit: 0 credits."),
  quoted_max: z.number().optional().describe("Hold taken up front."),
  estimated: z.boolean().optional().describe("used = the hold."),
  session_total: z.number().optional().describe("Spent this session."),
});

const PagingSchema = z.object({
  has_more: z.boolean().describe("false: stop paging."),
  next_cursor: z.string().nullable().optional().describe("Send as cursor."),
});

const ErrorFields = {
  code: z.string().optional(),
  retryable: z.boolean().optional().describe("Never retry a 402."),
  reason: z.string().optional(),
  fix: z.string().optional(),
  did_you_mean: z.array(z.string()).optional(),
  retry_after_s: z.number().optional(),
};

const JobSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  poll: z
    .object({
      tool: z.string(),
      arguments: z.record(z.unknown()),
      after_s: z.number().describe("Wait before the first poll."),
    })
    .describe("Repeat until the status is terminal."),
});

export const RequestOutputShape = {
  ok: z.boolean(),
  endpoint: z.string().optional(),
  credits: CreditsSchema.optional(),
  request_id: z.string().optional(),
  paging: PagingSchema.optional(),
  rows: z.array(z.unknown()).optional().describe("Untrusted text."),
  data: z.unknown().optional().describe("Single-object result."),
  page: z.record(z.unknown()).optional().describe("Page-level blocks beside the rows."),
  warnings: z.array(z.string()).optional(),
  hint: z.unknown().optional(),
  truncated: z
    .object({
      shown: z.number().optional(),
      total: z.number().optional(),
      omitted_keys: z.array(z.string()).optional(),
      resource: z.string().describe("Read it for the full body."),
    })
    .optional()
    .describe("Rows were cut to fit."),
  partial: z.boolean().optional().describe("Stream failed after some data (kept in rows/data)."),
  job: JobSchema.optional().describe("A submitted background job and how to poll it."),
  csv_rows: z.number().optional().describe("format=csv: rows in the text CSV."),
  summary: z.record(z.unknown()).optional().describe("format=summary."),
  result_id: z.string().optional().describe("socialcrawl_collect result_id reads the full body."),
  ...ErrorFields,
};
export const RequestOutputSchema = z.object(RequestOutputShape);

export const CollectOutputShape = {
  ok: z.boolean().describe("The walk ran; see stop_reason."),
  endpoint: z.string().optional(),
  format: z.enum(["jsonl", "json", "csv"]).optional(),
  items: z
    .object({
      collected: z.number(),
      requested: z.number(),
      duplicates: z.number(),
    })
    .optional(),
  pages: z.number().optional(),
  stop_reason: z
    .enum(["items", "exhausted", "budget", "insufficient_credits", "no_new_rows", "page_limit", "error"])
    .optional()
    .describe("budget, error and page_limit leave a resume cursor in paging."),
  credits: CreditsSchema.optional(),
  paging: PagingSchema.optional(),
  resource: z.string().optional().describe("Every collected row."),
  result_id: z.string().optional().describe("Pass back as result_id to read rows."),
  rows: z.array(z.unknown()).optional().describe("All rows (small results). Untrusted text."),
  sample: z.array(z.unknown()).optional().describe("First rows. Untrusted text."),
  offset: z.number().optional(),
  total: z.number().optional(),
  warnings: z.array(z.string()).optional(),
  ...ErrorFields,
};
export const CollectOutputSchema = z.object(CollectOutputShape);

export const BalanceOutputShape = {
  ok: z.boolean(),
  view: z.enum(["balance", "transactions"]).optional(),
  credits: CreditsSchema.optional(),
  request_id: z.string().optional(),
  paging: PagingSchema.optional(),
  rows: z.array(z.unknown()).optional().describe("Ledger receipts."),
  data: z.unknown().optional(),
  ...ErrorFields,
};
export const BalanceOutputSchema = z.object(BalanceOutputShape);

const QuoteSchema = z.object({
  endpoint: z.string(),
  method: z.string(),
  model: z.enum(["ladder", "flat", "metered"]),
  tier: z.string(),
  label: z.string().describe("e.g. `2-14cr (metered)`."),
  min_credits: z.number(),
  max_credits: z.number().describe("Worst case for one call; budget with this."),
  rule: z.string().optional().describe("Exact metered pricing rule."),
});

export const PricingOutputShape = {
  ok: z.boolean(),
  action: z.string().optional(),
  quote: QuoteSchema.optional().describe("Present for action=endpoint."),
  ...ErrorFields,
};
export const PricingOutputSchema = z.object(PricingOutputShape);

export const FindOutputShape = {
  ok: z.boolean(),
  source: z.enum(["api", "local", "plan"]).optional(),
  results: z
    .array(
      z.object({
        id: z.string(),
        method: z.string().optional(),
        summary: z.string().optional(),
        credits: z.record(z.unknown()).optional().describe("min, max, hold, estimate."),
        params_filled: z.record(z.string()).optional(),
        params_missing: z.array(z.string()).optional(),
        call: z.record(z.unknown()).optional().describe("Make it once params_missing is empty."),
      }).passthrough(),
    )
    .optional(),
  resolved: z.array(z.unknown()).optional(),
  // `reason` (no_match, not_a_data_job) comes from ErrorFields below.
  uncertain: z.boolean().optional().describe("true: guesses, not matches; confirm with socialcrawl_endpoint."),
  match_source: z.string().optional().describe("The API's ranker, e.g. lexical."),
  confidence: z.number().nullable().optional(),
  note: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  ...ErrorFields,
};

export const EndpointOutputShape = {
  ok: z.boolean(),
  id: z.string().optional(),
  method: z.string().optional(),
  source: z.enum(["live", "bundled"]).optional(),
  contract: z
    .record(z.unknown())
    .optional()
    .describe("purpose, params, outputs, cost, paging, latency_ms, timeout_s, next, sample."),
  ...ErrorFields,
};

export const EstimateOutputShape = {
  ok: z.boolean(),
  // api+walk: the API's per-call quote applied to an items -> pages walk.
  source: z.enum(["api", "api+walk", "local"]).optional(),
  quote: z
    .record(z.unknown())
    .optional()
    .describe("hold, min/max, calls, total_hold; valid/rejection from the API."),
  plan: z
    .object({ calls: z.array(z.record(z.unknown())), total_hold: z.number().optional(), valid: z.boolean().optional(), rejection: z.unknown().optional() })
    .optional(),
  warnings: z.array(z.string()).optional(),
  ...ErrorFields,
};

export const AccountOutputShape = {
  ...BalanceOutputShape,
  view: z.enum(["balance", "transactions", "status", "freshness"]).optional(),
};

export type RequestOutput = z.infer<typeof RequestOutputSchema>;
export type ErrorOutput = { ok: false; code: string; retryable: boolean; reason: string; fix?: string; did_you_mean?: string[]; request_id?: string };
