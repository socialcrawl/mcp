import { scopeOf } from "./results-store.js";

/**
 * Credits spent through this server process, per API key (MCP-08). A stdio
 * server is one session; the stateless HTTP transport builds a server per
 * request, so the tally lives here and not on the server object. Keys are
 * hashed, so one caller never sees another's total.
 */
const totals = new Map<string, number>();

/** Add a settled charge; ignores anything that is not a positive finite number. Returns the new total. */
export function recordSpend(apiKey: string, used: unknown): number {
  const scope = scopeOf(apiKey);
  const prev = totals.get(scope) ?? 0;
  if (typeof used !== "number" || !Number.isFinite(used) || used <= 0) return prev;
  totals.set(scope, prev + used);
  return prev + used;
}

export function sessionTotal(apiKey: string): number {
  return totals.get(scopeOf(apiKey)) ?? 0;
}

export function resetSessionSpend(): void {
  totals.clear();
}

export const DEFAULT_CONFIRM_ABOVE = 100;

/** Credits above which a call needs the user's confirmation. `SOCIALCRAWL_CONFIRM_ABOVE`, default 100. */
export function confirmThreshold(): number {
  const raw = process.env.SOCIALCRAWL_CONFIRM_ABOVE;
  if (raw === undefined || raw.trim() === "") return DEFAULT_CONFIRM_ABOVE;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CONFIRM_ABOVE;
}
