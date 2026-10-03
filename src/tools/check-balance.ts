import { makeRequest } from "../client.js";
import type { ApiContext } from "../context.js";
import { sessionTotal } from "../session-spend.js";
import { errorFromText, structureEnvelope, summaryLine } from "../result.js";
import type { ToolOutput } from "../result.js";

export interface CheckBalanceParams {
  /** `balance` (default) or `transactions` for the dispute-grade credit ledger. */
  view?: "balance" | "transactions";
  /** transactions: page size, default 50, hard-capped at 100. */
  limit?: number;
  /** transactions: opaque keyset cursor from a previous `next_cursor`. */
  cursor?: string;
  /** transactions: fetch the receipt(s) for one `req-…` request id. */
  requestId?: string;
}

/**
 * The account meta endpoints (api-key auth, 0 credits):
 *
 * - `GET /v1/credits/balance` — current balance + recent-deduction summary.
 * - `GET /v1/credits/transactions` — the credit ledger as paginated receipts.
 *   Deductions are negative, refunds positive, `balance_after` is the balance
 *   immediately after that row committed, and every row is keyed by
 *   `request_id` — so any charge can be reconciled against the exact request
 *   that produced it. This is how you verify what a metered endpoint actually
 *   charged after its upfront hold was refunded down.
 */
export async function checkBalance(
  ctx: ApiContext,
  params: CheckBalanceParams = {},
): Promise<string> {
  return (await checkBalanceStructured(ctx, params)).text;
}

/** Text for older clients plus the `structuredContent` object. */
export async function checkBalanceStructured(
  ctx: ApiContext,
  params: CheckBalanceParams = {},
): Promise<ToolOutput> {
  const view = params.view ?? "balance";

  if (view === "transactions") {
    const query: Record<string, string> = {};
    if (params.limit !== undefined) query.limit = String(params.limit);
    if (params.cursor) query.cursor = params.cursor;
    if (params.requestId) query.request_id = params.requestId;

    const response = await makeRequest(ctx, {
      platform: "meta",
      resource: "credits/transactions",
      params: Object.keys(query).length > 0 ? query : undefined,
    });

    const header = [
      "## SocialCrawl Credit Ledger",
      "**Endpoint:** `GET /v1/credits/transactions`",
      "**Credit cost:** 0 credits (meta endpoint)",
      "Deductions are negative and refunds positive, so a page of `amount` values sums to the balance delta. Newest first; page with `cursor` until `next_cursor` is null.",
      "",
    ].join("\n");
    return format(header, response, view, ctx);
  }

  const response = await makeRequest(ctx, {
    platform: "meta",
    resource: "credits/balance",
  });

  const header = [
    "## SocialCrawl Credit Balance",
    "**Endpoint:** `GET /v1/credits/balance`",
    "**Credit cost:** 0 credits (meta endpoint)",
    'Pass `view: "transactions"` for the itemised ledger behind these numbers.',
    "",
  ].join("\n");
  return format(header, response, view, ctx);
}

function format(header: string, response: string, view: "balance" | "transactions", ctx: ApiContext): ToolOutput {
  if (/^Error(?::| \(\d+\):)/.test(response)) {
    const text = `${header}${response}`;
    return { text, structured: errorFromText(text) };
  }
  try {
    const parsed = JSON.parse(response) as Record<string, unknown>;
    const env = structureEnvelope(parsed);
    const spent = sessionTotal(ctx.apiKey);
    const structured = { ok: true, view, ...env, credits: { ...(env.credits as Record<string, unknown>), session_total: spent } };
    return {
      text: `${header}**Session spend:** ${spent} credits through this server since it started.\n**Result:** ${summaryLine(structured)}\n\n\`\`\`json\n${JSON.stringify(parsed)}\n\`\`\``,
      structured,
    };
  } catch {
    return { text: `${header}${response}`, structured: { ok: true, view, warnings: ["Response was not JSON."] } };
  }
}
