export const CHARACTER_LIMIT = 25_000;
export const TIMEOUT_MS = 30_000;

// The tier ladder used to live here as a hand-copied literal. It is now
// generated from the backend registry into `data/registry-meta.ts`
// (CREDIT_LADDER) alongside the cache TTLs, so a ladder change cannot leave a
// stale copy behind. Import it from there.

export const SERVER_NAME = "socialcrawl-mcp";
export const SERVER_VERSION = "1.9.0";
