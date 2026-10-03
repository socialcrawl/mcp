import { createHash } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

/**
 * Maps a verified access token to the SocialCrawl API key its calls bill to.
 * Resolves `null` when the token is not linked to an active key (→ 401);
 * throws ApiKeyLookupUnavailableError when the mapping cannot be determined
 * right now (→ 503). Pluggable: any function with this shape works.
 */
export type ApiKeyResolver = (auth: AuthInfo) => Promise<string | null>;

export class ApiKeyLookupUnavailableError extends Error {
  constructor(message = "API key lookup unavailable") {
    super(message);
    this.name = "ApiKeyLookupUnavailableError";
  }
}

export interface LookupResolverOptions {
  /** Backend endpoint the owner provides (see docs/REMOTE-STREAMABLE-HTTP.md, "OAuth (preview)"). */
  url: string;
  /** Shared secret sent as `Authorization: Bearer <secret>` to that endpoint. */
  secret: string;
  /** How long a resolved key is reused. Never longer than the token's own `exp`. Default 60s. */
  cacheTtlMs?: number;
  timeoutMs?: number;
  now?: () => number;
}

const MAX_CACHE_ENTRIES = 1_000;

/**
 * Default strategy: the token carries an opaque `sc_api_key_ref` claim and a
 * SocialCrawl backend endpoint turns it into the key. The access token itself
 * is never sent anywhere (MCP spec: no token passthrough).
 */
export function createLookupResolver(options: LookupResolverOptions): ApiKeyResolver {
  const ttlMs = options.cacheTtlMs ?? 60_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { apiKey: string; expiresAt: number }>();

  return async (auth) => {
    const ref = auth.extra?.sc_api_key_ref;
    if (typeof ref !== "string" || ref === "") return null;

    // SECURITY: key the cache on (sub, client_id, ref), not the ref alone, so
    // a hit never skips the backend's "this ref belongs to this sub" check.
    const cacheKey = createHash("sha256")
      .update(JSON.stringify([auth.extra?.sub ?? null, auth.clientId, ref]))
      .digest("hex");
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now()) return cached.apiKey;
    cache.delete(cacheKey);

    let res: Response;
    try {
      res = await fetch(options.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          sc_api_key_ref: ref,
          sub: auth.extra?.sub,
          client_id: auth.clientId,
          scopes: auth.scopes,
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
      });
    } catch {
      throw new ApiKeyLookupUnavailableError("API key lookup request failed");
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new ApiKeyLookupUnavailableError(`API key lookup returned HTTP ${res.status}`);

    const body = (await res.json().catch(() => null)) as { api_key?: unknown } | null;
    const apiKey = body?.api_key;
    if (typeof apiKey !== "string" || apiKey === "") {
      throw new ApiKeyLookupUnavailableError("API key lookup returned no api_key");
    }

    const tokenExpiryMs = typeof auth.expiresAt === "number" ? auth.expiresAt * 1000 : now();
    const expiresAt = Math.min(now() + ttlMs, tokenExpiryMs);
    if (expiresAt > now()) {
      if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
      cache.set(cacheKey, { apiKey, expiresAt });
    }
    return apiKey;
  };
}
