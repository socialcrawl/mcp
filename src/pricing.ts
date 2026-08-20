import { ENDPOINTS } from "./data/endpoints.js";
import type { Endpoint, Pricing } from "./types.js";

/**
 * Shared credit-pricing formatting.
 *
 * The backend prices an endpoint one of three ways (see `Pricing.model`), and a
 * single number is a lie for two of them: a `flat` endpoint ignores its tier
 * rate, and a `metered` endpoint's real charge is decided by the query. Every
 * surface that quotes a price (list_endpoints, request, web, pricing, docs)
 * routes through here so they can never disagree — and so a metered endpoint is
 * always quoted as a band, never as its base.
 */

/** Compact price label, e.g. `1cr (standard)`, `20cr (flat)`, `2-14cr (metered)`. */
export function formatCost(p: Pricing): string {
  if (p.model === "metered") {
    if (p.minCost !== undefined && p.maxCost !== undefined) {
      return p.minCost === p.maxCost
        ? `${p.minCost}cr (metered)`
        : `${p.minCost}-${p.maxCost}cr (metered)`;
    }
    return `${p.cost}cr+ (metered)`;
  }
  if (p.cost === 0) return "0cr (free)";
  if (p.model === "flat") return `${p.cost}cr (flat)`;
  return `${p.cost}cr (${p.tier})`;
}

/**
 * The charge a caller should budget for: a metered endpoint's ceiling (what is
 * deducted up front), otherwise the static cost. Used for sorting and for
 * "what could this cost me" budget filters.
 */
export function worstCaseCost(p: Pricing): number {
  if (p.model === "metered" && p.maxCost !== undefined) return p.maxCost;
  return p.cost;
}

/** The least a call can ever be charged (before refunds for empty results). */
export function bestCaseCost(p: Pricing): number {
  if (p.model === "metered" && p.minCost !== undefined) return p.minCost;
  return p.cost;
}

/**
 * Optional params that appear by name in a metered endpoint's pricing rule —
 * i.e. the knobs that actually move the bill. Derived from the registry's own
 * `creditCostDescription` wording rather than a second hand-maintained list, so
 * it cannot drift from the pricer.
 */
export function priceDrivingParams(e: Endpoint): string[] {
  const rule = e.pricing.description;
  if (!rule) return [];
  const haystack = rule.toLowerCase();
  const names = [
    ...e.optionalParams.map((p) => p.name),
    ...e.params.map((p) => p.name),
  ];
  return names.filter((name) => {
    // Whole-word match, and never a name short enough to be ordinary prose:
    // a substring test reported `to` as a price driver on search/news because
    // the rule says "settles down to the actual charge".
    if (name.length < 3) return false;
    const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(haystack);
  });
}

/** Multi-line pricing explanation for one endpoint. */
export function explainPricing(e: Endpoint): string[] {
  const p = e.pricing;
  const lines: string[] = [`**Price:** ${formatCost(p)}`];

  if (p.model === "ladder") {
    lines.push(
      `Charged per request at the \`${p.tier}\` ladder rate (${p.ladderCost} credit${p.ladderCost === 1 ? "" : "s"}).`,
    );
  } else if (p.model === "flat") {
    lines.push(
      p.cost === 0
        ? `Free — this endpoint never deducts credits.`
        : `Flat per-endpoint override: ${p.cost} credits per request regardless of the \`${p.tier}\` tier rate (${p.ladderCost}cr).`,
    );
  } else {
    lines.push(
      `Metered — the charge depends on the request. ` +
        (p.minCost !== undefined && p.maxCost !== undefined
          ? `Between **${p.minCost}** and **${p.maxCost}** credits. `
          : "") +
        `An upfront ceiling is deducted and automatically refunded down to the work actually done; the response envelope's \`credits_used\` reports the real charge.`,
    );
    if (p.pageSize !== undefined) {
      lines.push(`Billed page size: ${p.pageSize} items per billed page.`);
    }
  }

  if (p.description) {
    lines.push(`**Rule:** ${p.description}`);
  }

  const drivers = priceDrivingParams(e);
  if (drivers.length > 0) {
    lines.push(
      `**Price-driving parameters:** ${drivers.map((d) => `\`${d}\``).join(", ")} — changing these changes the bill.`,
    );
  }

  if (e.cache.ttlSeconds > 0) {
    lines.push(
      `**Cache:** a repeat of the same call within ${formatTtl(e.cache.ttlSeconds)} (\`${e.cache.category}\` category) is served from cache at **0 credits**.`,
    );
  } else {
    lines.push(
      `**Cache:** never cached — every call is live and billed (\`${e.cache.category}\` category, TTL 0).`,
    );
  }

  return lines;
}

export function formatTtl(seconds: number): string {
  if (seconds === 0) return "no caching";
  if (seconds >= 86_400) return `${Math.round(seconds / 86_400)}d`;
  if (seconds >= 3_600) return `${Math.round(seconds / 3_600)}h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  return `${seconds}s`;
}

/**
 * Human wording for how a metered endpoint charges. Prefers the registry's own
 * authored rule; falls back to the band, which is the only other thing we can
 * state without inventing a pricer we do not own.
 */
export function meteredRule(p: Pricing): string {
  if (p.description) return p.description;
  if (p.minCost !== undefined && p.maxCost !== undefined && p.minCost !== p.maxCost) {
    return `Scales with the request between ${p.minCost} and ${p.maxCost} credits${
      p.pageSize !== undefined ? ` (billed per page of ${p.pageSize} items)` : ""
    }. The ceiling for your query is held up front and refunded down to the actual charge.`;
  }
  return "The ceiling for your query is held up front and refunded down to the actual charge.";
}

/** Every endpoint whose price is query-dependent, cheapest floor first. */
export function meteredEndpoints(): Endpoint[] {
  return ENDPOINTS.filter((e) => e.pricing.model === "metered").sort(
    (a, b) => bestCaseCost(a.pricing) - bestCaseCost(b.pricing),
  );
}

/** Every endpoint that overrides the 1/5/10 ladder with a flat price. */
export function flatOverrideEndpoints(): Endpoint[] {
  return ENDPOINTS.filter((e) => e.pricing.model === "flat").sort(
    (a, b) => a.pricing.cost - b.pricing.cost,
  );
}

/** Every endpoint that costs nothing to call. */
export function freeEndpoints(): Endpoint[] {
  return ENDPOINTS.filter((e) => e.pricing.cost === 0);
}

/** Endpoint label used in pricing tables: `resource`, method-prefixed when not GET. */
export function endpointLabel(e: Endpoint): string {
  return e.method === "GET" ? e.resource : `${e.method} ${e.resource}`;
}

/** Fully-qualified path label: `GET /v1/tiktok/profile`. */
export function endpointPath(e: Endpoint): string {
  return `${e.method} /v1/${e.platform}/${e.resource}`;
}
