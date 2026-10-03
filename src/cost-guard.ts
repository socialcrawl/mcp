import { apiRequest } from "./client.js";
import { DISCOVERY_TIMEOUT_MS, noteRoute, routeMissing } from "./discovery-routes.js";
import type { ApiContext } from "./context.js";
import { priceDrivingParams } from "./pricing.js";
import { quoteHydration } from "./hydration.js";
import { quoteJudgments } from "./judgments.js";
import { confirmThreshold } from "./session-spend.js";
import type { Endpoint } from "./types.js";

/**
 * Cost guard (MCP-08): quote a call before it runs, refuse it when the quote
 * exceeds the caller's `max_credits`, and ask the user before anything above
 * `SOCIALCRAWL_CONFIRM_ABOVE` bills. Every step here is free: the quote is
 * local arithmetic or `GET /v1/utility/estimate` (0 credits), and a refusal or
 * a confirmation request never reaches a billing route.
 */

export type Confirmation = "accepted" | "declined" | "unsupported";

export interface Quote {
  /** Credits the call holds up front (its ceiling). */
  hold: number;
  source: "estimate" | "local";
}

export interface GuardInput {
  /** Hold for one call (one page); compared with `max_credits`. */
  hold: number;
  /** What the whole operation may spend; compared with the confirmation threshold. */
  exposure: number;
  maxCredits?: number;
  confirm?: boolean;
  /** Sentence subject, e.g. "This call" / "This walk". */
  subject: string;
}

export interface GuardStop {
  text: string;
  structured: Record<string, unknown>;
}

const present = (v: unknown): boolean => v !== undefined && v !== null && v !== "";

/**
 * What this call can hold, from the registry data shipped with the server: the
 * page, any `include=` joins and metered judgments the params switch on, and
 * the band's ceiling when a param the pricing rule names is present (a
 * plain call stays at the page price). `max_pages` multiplies the lot.
 */
export function localQuote(endpoint: Endpoint, params: Record<string, unknown>): number {
  const p = endpoint.pricing;
  let hold = p.cost;
  if ((endpoint.hydration?.length ?? 0) > 0) {
    const limit = Number(params.limit);
    hold = quoteHydration(
      endpoint,
      typeof params.include === "string" ? params.include : undefined,
      Number.isFinite(limit) ? limit : undefined,
    ).held;
  }
  if (endpoint.judgments) hold += quoteJudgments(endpoint, params).held;
  if (p.model === "metered" && p.maxCost !== undefined) {
    if (priceDrivingParams(endpoint).some((name) => present(params[name]))) hold = Math.max(hold, p.maxCost);
  }
  const pages = Number(params.max_pages);
  if (Number.isFinite(pages) && pages > 1 && endpoint.optionalParams.some((o) => o.name === "max_pages")) {
    hold *= Math.floor(pages);
  }
  return hold;
}

/**
 * `GET /v1/utility/estimate` for one call (API-02): `id`, the params as a JSON
 * `params=` (it wins over flat keys and never collides with the route's own
 * `id`/`method`), `method` off GET, the body as JSON, `items` for a walk. The
 * payload's `data` (`valid`, `hold`, `expected_min/max`, `formula`, `levers`,
 * `rejection`, `warnings`), or undefined when the route is not deployed (404),
 * fails, or answers something else. Costs 0 credits.
 */
export async function fetchEstimateData(
  ctx: ApiContext,
  call: { id: string; method?: string; params?: Record<string, unknown>; body?: Record<string, unknown>; items?: number },
): Promise<Record<string, unknown> | undefined> {
  const query: Record<string, string> = { id: call.id };
  if (call.method && call.method !== "GET") query.method = call.method;
  const params: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(call.params ?? {})) if (present(v)) params[k] = v;
  if (Object.keys(params).length > 0) query.params = JSON.stringify(params);
  if (call.body && Object.keys(call.body).length > 0) query.body = JSON.stringify(call.body);
  if (call.items !== undefined) query.items = String(call.items);
  return estimateGet(ctx, query);
}

/** `GET /v1/utility/estimate?plan=<base64url JSON>` for several calls. Same fallbacks as one call. */
export async function fetchPlanEstimate(
  ctx: ApiContext,
  calls: Array<Record<string, unknown>>,
): Promise<Record<string, unknown> | undefined> {
  const plan = Buffer.from(JSON.stringify({ calls }), "utf8").toString("base64url");
  return estimateGet(ctx, { plan });
}

/** The estimate route, skipped once it answered 404 in this process, given up after DISCOVERY_TIMEOUT_MS. */
async function estimateGet(ctx: ApiContext, query: Record<string, string>): Promise<Record<string, unknown> | undefined> {
  const path = "/v1/utility/estimate";
  if (routeMissing(ctx.baseUrl, path)) return undefined;
  const response = await apiRequest(ctx, { method: "GET", path, query, raw: true, timeoutMs: DISCOVERY_TIMEOUT_MS });
  noteRoute(ctx.baseUrl, path, response);
  return estimatePayload(response);
}

function estimatePayload(response: string): Record<string, unknown> | undefined {
  if (/^Error(?::| \(\d+\):)/.test(response)) return undefined;
  try {
    const parsed = JSON.parse(response) as Record<string, unknown>;
    if (parsed.success === false) return undefined;
    const body = typeof parsed.data === "object" && parsed.data !== null ? parsed.data : parsed;
    return body as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** The API's own hold, or undefined when the route is not deployed, fails, or rejects the call. */
async function fetchEstimate(
  ctx: ApiContext,
  endpoint: Endpoint,
  params: Record<string, unknown>,
): Promise<number | undefined> {
  const body = await fetchEstimateData(ctx, {
    id: `${endpoint.platform}/${endpoint.resource}`,
    method: endpoint.method,
    params: endpoint.method === "GET" ? params : undefined,
    body: endpoint.method === "GET" ? undefined : params,
  });
  if (!body || body.valid === false) return undefined;
  return typeof body.hold === "number" && Number.isFinite(body.hold) && body.hold >= 0 ? body.hold : undefined;
}

/**
 * Quote one call. The estimate route costs a round trip, so it is asked only
 * when the local quote could trip a guard (above `max_credits` or the
 * confirmation threshold): a cheap call goes straight through.
 */
export async function quoteCall(
  ctx: ApiContext,
  endpoint: Endpoint,
  params: Record<string, unknown>,
  maxCredits?: number,
): Promise<Quote> {
  const local = localQuote(endpoint, params);
  const bar = Math.min(confirmThreshold(), maxCredits ?? Number.POSITIVE_INFINITY);
  if (local <= bar || !ctx.apiKey) return { hold: local, source: "local" };
  const est = await fetchEstimate(ctx, endpoint, params);
  return est === undefined ? { hold: local, source: "local" } : { hold: est, source: "estimate" };
}

function confirmationStop(reason: string, exposure: number): GuardStop {
  return {
    text: `Confirmation required: ${reason} Nothing was billed. Ask the user, then repeat the call with confirm: true.`,
    structured: {
      ok: false,
      code: "CONFIRMATION_REQUIRED",
      retryable: false,
      reason,
      fix: "Ask the user whether to spend these credits; repeat the same call with confirm: true to proceed. Nothing was billed.",
      credits: { quoted_max: exposure },
    },
  };
}

/** Undefined means go ahead; otherwise the non-billed result to return instead. */
export async function checkGuard(ctx: ApiContext, g: GuardInput): Promise<GuardStop | undefined> {
  if (g.maxCredits !== undefined && g.hold > g.maxCredits) {
    return {
      text: `Error: Quoted hold of ${g.hold} credits exceeds max_credits (${g.maxCredits}). No credits were charged. Raise max_credits, or narrow the call (lower limit, drop include/label).`,
      structured: {
        ok: false,
        code: "OVER_MAX_CREDITS",
        retryable: false,
        reason: `Quoted hold of ${g.hold} credits exceeds max_credits (${g.maxCredits}).`,
        fix: "Raise max_credits or narrow the call; nothing was charged.",
        credits: { quoted_max: g.hold },
      },
    };
  }
  const threshold = confirmThreshold();
  if (g.exposure <= threshold || g.confirm === true) return undefined;

  const reason = `${g.subject} is quoted at up to ${g.exposure} credits, above the ${threshold}-credit confirmation threshold (SOCIALCRAWL_CONFIRM_ABOVE).`;
  const answer = ctx.confirm ? await ctx.confirm(`${reason} Spend up to ${g.exposure} credits?`) : "unsupported";
  if (answer === "accepted") return undefined;
  if (answer === "declined") return confirmationStop(`${reason} The user declined, so the call was not confirmed.`, g.exposure);
  return confirmationStop(reason, g.exposure);
}
