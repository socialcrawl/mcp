import type { Endpoint } from "./types.js";

/**
 * The floor for every call. The API's own clocks are a 48s deadline, a 54s
 * fallback that answers 504 (refunded) and a 60s hard kill, and it recommends a
 * 60s client timeout. A client-side abort does not stop the server call: it
 * still runs, bills and caches, so giving up before the server does only pays
 * for an answer the agent never sees.
 */
export const DEFAULT_TIMEOUT_S = 60;
export const MAX_TIMEOUT_S = 120;
/** Headroom added to a server-side latency budget so the client does not give up first. */
const BUDGET_MARGIN_S = 5;

type TimeoutFields = Pick<Endpoint, "recommended_timeout_s" | "budget_ms" | "streaming" | "execution">;

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * Client timeout for one endpoint, in seconds, read from the registry data in
 * priority order: `recommended_timeout_s` plus a margin, then `budget_ms` plus a
 * margin, then the execution-mode default (a streaming endpoint with no
 * measured latency may run for minutes). Never below the 60s floor the API
 * recommends (a measured p99 is not a deadline), never above 120.
 */
export function timeoutSecondsFor(endpoint: TimeoutFields | undefined): number {
  let s = DEFAULT_TIMEOUT_S;
  if (endpoint) {
    if (positive(endpoint.recommended_timeout_s)) s = Math.ceil(endpoint.recommended_timeout_s) + BUDGET_MARGIN_S;
    else if (positive(endpoint.budget_ms)) s = Math.ceil(endpoint.budget_ms / 1000) + BUDGET_MARGIN_S;
    else if (endpoint.streaming) s = MAX_TIMEOUT_S;
  }
  return Math.min(MAX_TIMEOUT_S, Math.max(DEFAULT_TIMEOUT_S, s));
}

/**
 * Whether this call is answered as an SSE stream, so the client should ask for
 * one. `always` streams unconditionally; `"<param>=<value>"` streams when that
 * param's CSV carries the value. `accept-header` endpoints stay on JSON: the
 * assembled result is the same and the JSON path supports idempotent replay.
 */
export function wantsStream(
  endpoint: Pick<Endpoint, "streaming"> | undefined,
  params: Record<string, unknown>,
): boolean {
  const mode = endpoint?.streaming;
  if (!mode) return false;
  if (mode === "always") return true;
  const eq = mode.indexOf("=");
  if (eq < 0) return false;
  const value = params[mode.slice(0, eq)];
  if (typeof value !== "string") return false;
  const want = mode.slice(eq + 1);
  return value.split(",").some((m) => m.trim() === want);
}
