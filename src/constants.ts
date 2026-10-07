export const CHARACTER_LIMIT = 25_000;
/**
 * Budget for a `socialcrawl_request` result's text. Rows are cut at row
 * boundaries to fit; the full body stays behind a `socialcrawl://results/` link.
 */
export const RESULT_CHAR_BUDGET = CHARACTER_LIMIT;
export const TIMEOUT_MS = 30_000;
/** A result this small comes back whole (text and structuredContent); larger ones sit behind a result_id. */
export const INLINE_MAX_ROWS = 200;
export const INLINE_MAX_BYTES = 60_000;

// The tier ladder used to live here as a hand-copied literal. It is now
// generated from the backend registry into `data/registry-meta.ts`
// (CREDIT_LADDER) alongside the cache TTLs, so a ladder change cannot leave a
// stale copy behind. Import it from there.

export const SERVER_NAME = "socialcrawl-mcp";
export const SERVER_VERSION = "2.0.2";

/**
 * Inside a normalised `socialcrawl_request` params object: the names of the
 * endpoint params that arrived as top-level arguments and were moved into
 * params (comma-separated). The request tool removes it and says so.
 */
export const MOVED_PARAMS_KEY = "\u0000moved_from_top_level";
