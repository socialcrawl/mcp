/**
 * Upstream supplier names no agent-facing text may contain.
 * Copied from codebase/packages/social-api/src/docs/test/skills-source-opacity.test.ts
 * (SUPPLIER_TOKENS / INTERNAL_TOKENS). Keep in sync with that file.
 */
export const SUPPLIER_TOKENS = [
  "scrapecreators",
  "scrape creators",
  "tiktok-api23",
  "api23",
  "pro social",
  "prosocial",
  "rapidapi",
  "poix",
  "tokapi",
  "flashapi",
  "dataforseo",
  "crawlio",
  "firecrawl",
  "apify",
  "bright data",
  "yourhomedepot",
  "hikerapi",
] as const;

export const INTERNAL_TOKENS = ["triage-", "UPSTREAM_ERROR)", "-fieldmaps"] as const;

/** First banned token found in `text` (case-insensitive), or undefined. */
export function findBanned(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const t of SUPPLIER_TOKENS) if (lower.includes(t)) return t;
  for (const t of INTERNAL_TOKENS) if (text.includes(t)) return t;
  if (/\bDFS\b/.test(text)) return "DFS";
  return undefined;
}
