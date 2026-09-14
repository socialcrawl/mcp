import { ENDPOINTS } from "./data/endpoints.js";
import type { Endpoint, HydrationLane } from "./types.js";

/**
 * Row hydration — the opt-in `include=` joins.
 *
 * A list endpoint whose rows are thin by construction declares a sibling
 * endpoint on the same platform that already answers the missing leaves for
 * ONE row, plus a token the caller puts in `include` to join every row to it
 * inside the same call. Before the engine existed the caller wrote that join
 * themselves: a page, then one lookup per row, then a client-side merge.
 *
 * Two things make this worth a first-class surface in the MCP rather than a
 * line in a description:
 *
 * 1. **It moves the bill.** 26 endpoints stopped being flat ladder prices and
 *    became metered bands the day they learned to hydrate. Quoting
 *    `linkedin/search/people` at 10 credits is now wrong by up to 40.
 * 2. **The ceiling is computable, not guessable.** The hold is an exact
 *    function of the lane's per-row rate, its row cap, and the caller's own
 *    `limit`. The arithmetic below is a port of the backend's single pricing
 *    leaf (`packages/social-api/src/hydrate/pricing.ts`), which sizes both the
 *    upfront hold and the refund, so an estimate here matches what the API
 *    actually holds rather than approximating it.
 *
 * What a caller is charged is lower again: `creditsPerItem` is kept only for a
 * row a FRESH sibling lookup filled. Rows served from the sibling's cache are
 * free, rows the sibling could not fill are refunded, and a page that joined in
 * full is cached whole, so an immediate repeat costs 0.
 */

/** Every endpoint that offers at least one `include=` row join. */
export function hydratingEndpoints(): Endpoint[] {
  return ENDPOINTS.filter((e) => (e.hydration?.length ?? 0) > 0);
}

/** The lane an endpoint runs for one token, if it offers that token. */
export function findLane(
  e: Endpoint,
  token: string,
): HydrationLane | undefined {
  const want = token.trim().toLowerCase();
  return e.hydration?.find((l) => l.token.toLowerCase() === want);
}

/** Every token this endpoint accepts in `include`. */
export function hydrationTokens(e: Endpoint): string[] {
  return (e.hydration ?? []).map((l) => l.token);
}

/**
 * CSV membership, trimmed and case-insensitive — the backend's `csvHas`.
 * `"foo, Engagement"` contains `engagement`.
 */
export function csvHas(value: string | undefined, token: string): boolean {
  if (value === undefined) return false;
  const want = token.toLowerCase();
  return value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(want);
}

/**
 * Credits for `slots` rows at the lane's rate. A batch sibling answers `size`
 * keys in one lookup and never keeps more than `creditCap` for it, so the
 * charge is the cheaper of per-row and per-chunk — the join can never cost
 * more than calling the sibling directly would.
 *
 * Port of `creditsForSlots` in the backend's `hydrate/pricing.ts`.
 */
function creditsForSlots(slots: number, lane: HydrationLane): number {
  const perItem = slots * lane.creditsPerItem;
  if (!lane.batch) return perItem;
  return Math.min(perItem, Math.ceil(slots / lane.batch.size) * lane.batch.creditCap);
}

/**
 * How many rows this request joins: the caller's own row cap when the lane
 * offers one and the caller sent it, else the lane's default hydrated cap when
 * it declares one, else the page. The same number sizes the hold and the
 * refund, so a caller who asks for 20 rows is held for 20, never for the page.
 *
 * Port of `hydrationSlotCount`.
 */
export function hydrationSlotCount(
  lane: HydrationLane,
  rowLimit?: number,
): number {
  const fallback = Math.min(lane.maxItems, lane.defaultRowLimit ?? lane.maxItems);
  if (lane.rowLimitParam === undefined) return fallback;
  if (rowLimit === undefined || !Number.isFinite(rowLimit) || rowLimit < 1) {
    return fallback;
  }
  return Math.min(lane.maxItems, Math.floor(rowLimit));
}

/** The most this lane can ever hold on one page, whatever the caller sends. */
export function laneMaxCredits(lane: HydrationLane): number {
  return creditsForSlots(lane.maxItems, lane);
}

/** The most THIS request can bill for this lane: every slot the caller can fill. */
export function laneCeilingCredits(
  lane: HydrationLane,
  rowLimit?: number,
): number {
  return creditsForSlots(hydrationSlotCount(lane, rowLimit), lane);
}

export interface HydrationQuote {
  /** Base page price before any join. */
  base: number;
  /** Tokens that were recognised, with what each one holds. */
  lanes: { lane: HydrationLane; rows: number; held: number }[];
  /** Tokens in `include` that this endpoint does not offer. */
  unknownTokens: string[];
  /** Total held up front: the base page plus every requested lane's ceiling. */
  held: number;
  /** The floor: what the call settles to if every row is cached or unfillable. */
  floor: number;
}

/**
 * Exactly what a given `include=` (plus optional row cap) holds on this
 * endpoint, and what it can settle down to.
 *
 * The base is the endpoint's own static cost; a lane is added only for a token
 * the caller actually asked for, which is why a caller who never sends
 * `include` pays precisely what they paid before the endpoint learned to join.
 *
 * Port of `hydrationUpfrontCostAll`, which sums the ceilings of the tokens the
 * request asked for.
 */
export function quoteHydration(
  e: Endpoint,
  include: string | undefined,
  rowLimit?: number,
): HydrationQuote {
  const base = e.pricing.cost;
  const lanes: HydrationQuote["lanes"] = [];
  for (const lane of e.hydration ?? []) {
    if (!csvHas(include, lane.token)) continue;
    const rows = hydrationSlotCount(lane, rowLimit);
    lanes.push({ lane, rows, held: creditsForSlots(rows, lane) });
  }
  const offered = new Set(hydrationTokens(e).map((t) => t.toLowerCase()));
  const unknownTokens = (include ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((t) => !offered.has(t.toLowerCase()));
  return {
    base,
    lanes,
    unknownTokens,
    held: base + lanes.reduce((sum, l) => sum + l.held, 0),
    floor: base,
  };
}

/** `instagram/post/stats` → `GET /v1/instagram/post/stats`, honouring method. */
function siblingPath(lane: HydrationLane): string {
  const method = lane.siblingMethod ?? "GET";
  return `${method} /v1/${lane.sibling}`;
}

/** One lane, as a compact line for a table or a list. */
export function describeLane(lane: HydrationLane): string {
  const cap = lane.rowLimitParam
    ? `up to ${lane.maxItems} rows (\`${lane.rowLimitParam}\` caps both the rows and the credits${
        lane.defaultRowLimit !== undefined
          ? `; defaults to the top ${lane.defaultRowLimit}`
          : ""
      })`
    : `up to ${lane.maxItems} row${lane.maxItems === 1 ? "" : "s"}`;
  const rate = lane.batch
    ? `${lane.creditsPerItem}cr per row filled, never more than ${lane.batch.creditCap} per ${lane.batch.size} rows`
    : `${lane.creditsPerItem}cr per row filled`;
  return `\`${lane.param}=${lane.token}\` → joins each row to \`${siblingPath(lane)}\` — ${rate}, ${cap}. Ceiling ${laneMaxCredits(lane)}cr.`;
}

/** Multi-line explanation of every join an endpoint offers. */
export function explainHydration(e: Endpoint): string[] {
  const lanes = e.hydration ?? [];
  if (lanes.length === 0) return [];

  const param = lanes[0].param;
  const lines: string[] = [
    `**Row hydration:** this endpoint can fill its own rows in the same call. Send \`${param}=${lanes
      .map((l) => l.token)
      .join(",")}\`${lanes.length > 1 ? " (any one, or several comma-separated)" : ""}.`,
  ];

  for (const lane of lanes) {
    lines.push(`- ${describeLane(lane)}`);
    lines.push(`  Fills: ${lane.fills.map((f) => `\`${f}\``).join(", ")}.`);
    if (lane.replaceApproximate && lane.replaceApproximate.length > 0) {
      lines.push(
        `  Replaces (not just fills) ${lane.replaceApproximate
          .map((f) => `\`${f}\``)
          .join(", ")} on a row that flags its own value approximate.`,
      );
    }
  }

  const total = lanes.reduce((sum, l) => sum + laneMaxCredits(l), 0);
  lines.push(
    `**What you are actually charged:** the ceiling (${e.pricing.cost}cr base + ${total}cr for every join = ${e.pricing.cost + total}cr) is held up front, then ` +
      `${lanes[0].creditsPerItem}cr is KEPT per row a fresh sibling lookup filled and every other slot is refunded. ` +
      `Rows served from the sibling's cache are free, rows it could not fill are refunded, and a page that joined in full is cached whole — an immediate repeat is 0 credits.`,
  );
  lines.push(
    `**Reading the result:** \`data.hydration\` reports \`rows\`, \`looked_up\`, \`filled\`, \`cached\`, \`unfilled\`, \`credits_held\`, \`extra_credits\` (what was kept) and \`ms\`. ` +
      `If nothing filled you get \`_warnings: ["${lanes[0].warnings.unavailable}"]\`; if only some rows filled, \`["${lanes[0].warnings.partial}"]\`. The envelope's \`credits_used\` is always the real charge.`,
  );

  return lines;
}
