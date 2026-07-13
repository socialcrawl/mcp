export const DEFAULT_BASE_URL = "https://www.socialcrawl.dev";

export interface ApiContext {
  /** Per-user SocialCrawl API key. Empty string = anonymous (discovery tools only). */
  apiKey: string;
  /** SocialCrawl API origin, no trailing slash. */
  baseUrl: string;
}

/**
 * Build the context for the stdio entrypoint from process env.
 * ONLY the stdio transport may use this — the HTTP transport builds its
 * context from request headers and must NEVER fall back to process env
 * (an anonymous HTTP caller must not inherit the operator's key).
 */
export function contextFromEnv(): ApiContext {
  return {
    apiKey: process.env.SOCIALCRAWL_API_KEY ?? "",
    // Normalize away trailing slashes so URL building never yields `//v1/...`.
    baseUrl: (process.env.SOCIALCRAWL_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}
