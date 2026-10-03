import type { ApiContext } from "../context.js";
import { errorFromText, isErrorText } from "../result.js";
import type { ToolOutput } from "../result.js";
import { checkBalanceStructured } from "./check-balance.js";
import { discover } from "./discover.js";

/**
 * `socialcrawl_account` (MCP-04): the account and the service, all free.
 * `balance` (default; carries this session's spend) and `transactions` (the
 * ledger, the receipts for one request) read `/v1/credits/*`; `status` reads
 * the public `/v1/status`; `freshness` compares the live catalogue with the
 * one bundled in this server.
 */

export interface AccountParams {
  view?: "balance" | "transactions" | "status" | "freshness";
  limit?: number;
  cursor?: string;
  request_id?: string;
}

export async function accountStructured(ctx: ApiContext, params: AccountParams): Promise<ToolOutput> {
  const view = params.view ?? "balance";
  if (view === "balance" || view === "transactions") {
    return checkBalanceStructured(ctx, { view, limit: params.limit, cursor: params.cursor, requestId: params.request_id });
  }
  const text = await discover(ctx, { action: view });
  return { text, structured: isErrorText(text) ? errorFromText(text) : { ok: true, view } };
}
