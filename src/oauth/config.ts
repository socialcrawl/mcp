import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { createJwtVerifier, DEFAULT_ALGORITHMS } from "./jwt-verifier.js";
import { createLookupResolver, type ApiKeyResolver } from "./api-key-resolver.js";

/** Everything the HTTP app needs to act as an OAuth 2.1 resource server. */
export interface OAuthResourceServerConfig {
  /** Canonical URL of this MCP endpoint (RFC 8707 resource; the token audience). */
  resource: URL;
  /** Authorization server issuer, advertised in the protected resource metadata. */
  issuer: string;
  verifier: OAuthTokenVerifier;
  resolveApiKey: ApiKeyResolver;
}

type Env = Record<string, string | undefined>;

const ALLOWED_ALGORITHMS = new Set([
  "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512",
]);

/**
 * Build the OAuth config from env. `undefined` unless SOCIALCRAWL_OAUTH=1.
 * With the flag on, every setting is required and checked up front: a
 * half-configured resource server must fail at boot, not per request.
 */
export function oauthConfigFromEnv(env: Env): OAuthResourceServerConfig | undefined {
  if (env.SOCIALCRAWL_OAUTH?.trim() !== "1") return undefined;

  const resource = requireUrl(env, "SOCIALCRAWL_OAUTH_RESOURCE");
  if (resource.hash !== "" || env.SOCIALCRAWL_OAUTH_RESOURCE!.includes("#")) {
    throw new Error("SOCIALCRAWL_OAUTH_RESOURCE must not contain a fragment");
  }
  const issuer = requireUrl(env, "SOCIALCRAWL_OAUTH_ISSUER");
  const jwksUrl = requireUrl(env, "SOCIALCRAWL_OAUTH_JWKS_URL");
  const lookupUrl = requireUrl(env, "SOCIALCRAWL_OAUTH_KEY_LOOKUP_URL");
  const lookupSecret = requireValue(env, "SOCIALCRAWL_OAUTH_KEY_LOOKUP_SECRET");
  const algorithms = env.SOCIALCRAWL_OAUTH_ALGORITHMS?.trim()
    ? env.SOCIALCRAWL_OAUTH_ALGORITHMS.split(",").map((a) => a.trim()).filter(Boolean)
    : DEFAULT_ALGORITHMS;
  // Asymmetric only: an HMAC or "none" entry would let a forged token through.
  const unsupported = algorithms.filter((a) => !ALLOWED_ALGORITHMS.has(a));
  if (unsupported.length > 0) {
    throw new Error(
      `SOCIALCRAWL_OAUTH_ALGORITHMS has unsupported values (${unsupported.join(", ")}); allowed: ${[...ALLOWED_ALGORITHMS].join(", ")}`,
    );
  }

  // Use the issuer string exactly as configured: `iss` is compared verbatim.
  const issuerId = env.SOCIALCRAWL_OAUTH_ISSUER!.trim();
  return {
    resource,
    issuer: issuerId,
    verifier: createJwtVerifier({ issuer: issuerId, audience: resource.href, jwks: jwksUrl, algorithms }),
    resolveApiKey: createLookupResolver({ url: lookupUrl.href, secret: lookupSecret }),
  };
}

function requireValue(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`SOCIALCRAWL_OAUTH=1 requires ${name}`);
  return value;
}

/** https only, except loopback hosts for local development. */
function requireUrl(env: Env, name: string): URL {
  const raw = requireValue(env, name);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`${name} must use https (http is allowed only for localhost)`);
  }
  return url;
}
