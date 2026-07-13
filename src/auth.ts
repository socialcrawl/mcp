import type { IncomingHttpHeaders } from "node:http";

/**
 * Extract the caller's SocialCrawl API key from HTTP request headers.
 * Accepts `Authorization: Bearer <key>` (preferred) or `x-api-key: <key>`.
 * SECURITY INVARIANT: never reads process.env — an HTTP caller that sends
 * no credentials must get an anonymous context, not the operator's key.
 */
export function extractApiKey(headers: IncomingHttpHeaders): string {
  const auth = headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    // A whitespace-only bearer value falls through to x-api-key instead of
    // silently downgrading a caller who sent both headers to anonymous.
    if (token !== "") {
      return token;
    }
  }
  const xKey = headers["x-api-key"];
  if (typeof xKey === "string") {
    return xKey.trim();
  }
  return "";
}
