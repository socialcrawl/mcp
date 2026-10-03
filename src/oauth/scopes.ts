/**
 * OAuth scopes for the remote server and the tools each one unlocks.
 *
 * read   — free discovery and account reads (no credits move).
 * spend  — anything that can bill credits.
 * manage — anything that creates, changes or deletes a persistent resource
 *          (monitors, cohorts, web jobs/sessions). Those tools also spend, so
 *          they need both.
 */
export const SCOPES = {
  read: "socialcrawl:read",
  spend: "socialcrawl:spend",
  manage: "socialcrawl:manage",
} as const;

export const SCOPES_SUPPORTED: string[] = [SCOPES.read, SCOPES.spend, SCOPES.manage];

/**
 * Every registered tool must appear here — a test enforces it. The 2.0 tools
 * first, then the 1.x names `SOCIALCRAWL_LEGACY_TOOLS=1` brings back.
 */
export const TOOL_SCOPES: Record<string, readonly string[]> = {
  socialcrawl_find: [SCOPES.read],
  socialcrawl_endpoint: [SCOPES.read],
  socialcrawl_estimate: [SCOPES.read],
  socialcrawl_account: [SCOPES.read],
  socialcrawl_request: [SCOPES.spend],
  socialcrawl_collect: [SCOPES.spend],
  socialcrawl_manage: [SCOPES.spend, SCOPES.manage],
  // 1.x names (legacy flag).
  socialcrawl_list_platforms: [SCOPES.read],
  socialcrawl_list_endpoints: [SCOPES.read],
  socialcrawl_pricing: [SCOPES.read],
  socialcrawl_discover: [SCOPES.read],
  socialcrawl_get_docs: [SCOPES.read],
  socialcrawl_check_balance: [SCOPES.read],
  socialcrawl_web: [SCOPES.spend, SCOPES.manage],
  socialcrawl_monitors: [SCOPES.spend, SCOPES.manage],
  socialcrawl_cohorts: [SCOPES.spend, SCOPES.manage],
};

/** Scopes a tool needs. Unknown tools fail closed and need every scope. */
export function requiredScopesForTool(name: string): readonly string[] {
  return Object.hasOwn(TOOL_SCOPES, name) ? TOOL_SCOPES[name] : SCOPES_SUPPORTED;
}

/**
 * Scopes missing from `granted` for the JSON-RPC body (single message or
 * batch). Only `tools/call` is gated; initialize, tools/list and the rest need
 * just a valid token. A body that is not a JSON object/array needs every
 * scope. Returned in SCOPES_SUPPORTED order, deduplicated.
 */
export function missingScopesForBody(body: unknown, granted: readonly string[]): string[] {
  const messages = Array.isArray(body) ? body : [body];
  const needed = new Set<string>();
  for (const message of messages) {
    // SECURITY: fail closed. Anything that is not a parsed JSON-RPC object
    // (no body, a string, a number) could still be read as a tool call
    // further down the stack, so it needs every scope.
    if (typeof message !== "object" || message === null || Array.isArray(message)) {
      for (const scope of SCOPES_SUPPORTED) needed.add(scope);
      continue;
    }
    if ((message as { method?: unknown }).method !== "tools/call") continue;
    const name = (message as { params?: { name?: unknown } }).params?.name;
    const scopes = typeof name === "string" ? requiredScopesForTool(name) : SCOPES_SUPPORTED;
    for (const scope of scopes) needed.add(scope);
  }
  return SCOPES_SUPPORTED.filter((scope) => needed.has(scope) && !granted.includes(scope));
}
