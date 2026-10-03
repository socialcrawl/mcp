import type { IncomingHttpHeaders } from "node:http";

/**
 * Extract the caller's SocialCrawl API key from HTTP request headers.
 * Accepts `Authorization: Bearer <key>` (preferred) or `x-api-key: <key>`.
 * SECURITY INVARIANT: never reads process.env — an HTTP caller that sends
 * no credentials must get an anonymous context, not the operator's key.
 */
export function extractApiKey(headers: IncomingHttpHeaders): string {
  const token = extractBearerToken(headers);
  // A whitespace-only bearer value falls through to x-api-key instead of
  // silently downgrading a caller who sent both headers to anonymous.
  if (token !== "") {
    return token;
  }
  const xKey = headers["x-api-key"];
  if (typeof xKey === "string") {
    return xKey.trim();
  }
  return "";
}

/**
 * True for a compact JWS (`header.payload.signature`, base64url segments).
 * With OAuth on, this is how a Bearer access token is told apart from a
 * SocialCrawl API key sent as Bearer (API keys never contain dots).
 */
export function isJwtShaped(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(value);
}

/** The trimmed `Authorization: Bearer` value, or "" when absent/empty/another scheme. */
export function extractBearerToken(headers: IncomingHttpHeaders): string {
  const auth = headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}
