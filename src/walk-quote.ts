import { pagingFor } from "./data/outputs.js";
import type { Endpoint } from "./types.js";

/**
 * Items -> pages -> credits for a paged walk, from the contract's `paging`
 * block (registry dump). The arithmetic is the skill's `scripts/estimate.py`
 * offline quote, so the two surfaces give the same number for the same walk.
 *
 * Page size precedence (the registry's own): `pricing.pageSize` > the
 * contract's `page_size` (a code constant > agreeing captures > a baseline,
 * already resolved upstream). An endpoint that does not page has none.
 */
export function pageSizeOf(e: Endpoint): number | null {
  const paging = pagingFor(e);
  if (!paging) return null;
  return e.pricing.pageSize ?? paging.page_size ?? null;
}

export interface WalkQuote {
  pages: number;
  page_size: number;
  price_basis: string | null;
  expected_min: number;
  expected_max: number;
  /** e.g. `2600 items: ceil(N/50) x 5-10 = 52 pages, 260-520 credits.` */
  formula: string;
  exact: boolean;
}

export type WalkResult = { quote: WalkQuote | null; warnings: string[] };

export function walkQuote(e: Endpoint, items: number): WalkResult {
  const id = `${e.platform}/${e.resource}`;
  const paging = pagingFor(e);
  if (!paging) return { quote: null, warnings: [`not_paged: ${id} does not page, so items=${items} is ignored`] };
  const size = pageSizeOf(e);
  if (!size) {
    return {
      quote: null,
      warnings: [
        `pages_unknown: ${id} has no verified page size, so ${items} items cannot be turned into a page count. Quote one page and count pages as you go.`,
      ],
    };
  }
  const warnings: string[] = [];
  let pages = Math.ceil(items / size);
  const cap = paging.max_pages;
  if (cap && pages > cap) {
    pages = cap;
    warnings.push(`items_capped: ${id} serves at most ${cap} pages, so ${items} items are not all reachable.`);
  }
  const costMin = e.pricing.minCost ?? e.pricing.cost;
  const costMax = e.pricing.maxCost ?? e.pricing.cost;
  let lo: number;
  let hi: number;
  let exact: boolean;
  if (paging.price_basis === "per_row" && paging.credits_per_row !== null) {
    const rows = Math.min(items, pages * size);
    lo = hi = rows * paging.credits_per_row;
    exact = true;
  } else {
    const per = paging.credits_per_page ?? { min: costMin, max: costMax };
    lo = pages * per.min;
    hi = pages * (per.max ?? costMax);
    if (paging.price_basis === "unknown" || per.max === null) {
      warnings.push("price_basis_unknown: the per-page price of this endpoint is not proven, so the hold is the registry's ceiling per page.");
      exact = false;
    } else {
      exact = lo === hi;
    }
  }
  const rule = paging.per_n_items ?? "pages x price";
  const credits = lo === hi ? `${hi}` : `${lo}-${hi}`;
  return {
    quote: {
      pages,
      page_size: size,
      price_basis: paging.price_basis,
      expected_min: lo,
      expected_max: hi,
      formula: `${items} items: ${rule} = ${pages} pages, ${credits} credits.`,
      exact,
    },
    warnings,
  };
}
