/**
 * The free discovery routes this server asks before falling back to bundled
 * data (`/v1/utility/find`, `resolve`, `plan`, `endpoint`, `estimate`). Some
 * are not deployed yet. Only the router's own "no such route" answer marks a
 * route missing: HTTP 404 with `error_code: ENDPOINT_NOT_FOUND` whose message
 * names the route's path. A deployed route's 404 for an unknown id ("Unknown
 * endpoint '<id>'", another error type) never does, so one bad id cannot turn
 * live answers off for everyone. A missing mark lasts ROUTE_MISSING_TTL_MS
 * (per base URL), then the route is tried again. Every call gets a short
 * timeout so a slow route never holds up discovery.
 */

export const DISCOVERY_TIMEOUT_MS = 5_000;
export const ROUTE_MISSING_TTL_MS = 10 * 60 * 1000;

/** route key → time it was marked missing. */
const missing = new Map<string, number>();
const keyOf = (baseUrl: string, path: string): string => `${baseUrl}${path}`;

/** True while this route's "not deployed" mark (on this base URL) is fresh. */
export function routeMissing(baseUrl: string, path: string): boolean {
  const key = keyOf(baseUrl, path);
  const at = missing.get(key);
  if (at === undefined) return false;
  if (Date.now() - at > ROUTE_MISSING_TTL_MS) {
    missing.delete(key);
    return false;
  }
  return true;
}

/** Remember the router's "no such route" from `apiRequest` error text (message plus `status:` / `error_code:` tail). */
export function noteRoute(baseUrl: string, path: string, response: string): void {
  if (!/^Error/.test(response)) return;
  if (!/(^|\n)status: 404\b/.test(response) || !/(^|\n)error_code: ENDPOINT_NOT_FOUND\b/.test(response)) return;
  // The router's message interpolates the path it could not route; an unknown-id 404 names the id instead.
  const bare = path.replace(/^\/v1\//, "").replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  // `/v1/utility/endpoint` must not match inside `/v1/utility/endpoints`.
  if (!new RegExp(`(^|[^\\w-])${bare}(?![\\w/-])`).test(response)) return;
  missing.set(keyOf(baseUrl, path), Date.now());
}

/** Tests only: forget every remembered route. */
export function resetDiscoveryRoutes(): void {
  missing.clear();
}
