import { createRemoteJWKSet, jwtVerify, errors, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidTokenError, ServerError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

export const DEFAULT_ALGORITHMS = ["RS256", "PS256", "ES256"];

export interface JwtVerifierOptions {
  /** Exact `iss` the authorization server puts in its access tokens. */
  issuer: string;
  /** This MCP server's canonical resource URL; tokens must name it in `aud`. */
  audience: string;
  /** JWKS URL (fetched and cached by jose) or a key getter (tests). */
  jwks: URL | JWTVerifyGetKey;
  /** Accepted signing algorithms. An allowlist — never trust the token's `alg` alone. */
  algorithms?: string[];
  clockToleranceSec?: number;
}

/**
 * Verifies JWT access tokens (RFC 9068 style) locally against the
 * authorization server's JWKS. The SDK ships the `OAuthTokenVerifier`
 * interface but no JWT implementation, hence jose.
 *
 * SECURITY: error messages are fixed strings — they end up in the
 * WWW-Authenticate header and must never echo the token or claim values.
 */
export function createJwtVerifier(options: JwtVerifierOptions): OAuthTokenVerifier {
  const getKey = options.jwks instanceof URL ? createRemoteJWKSet(options.jwks) : options.jwks;
  const resource = new URL(options.audience);

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, getKey, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: options.algorithms ?? DEFAULT_ALGORITHMS,
          requiredClaims: ["exp"],
          clockTolerance: options.clockToleranceSec ?? 30,
        }));
      } catch (error) {
        throw toAuthError(error);
      }
      return {
        token,
        clientId: stringClaim(payload.client_id) ?? stringClaim(payload.azp) ?? "",
        scopes: scopesOf(payload),
        expiresAt: payload.exp,
        resource,
        extra: {
          sub: payload.sub,
          sc_api_key_ref: stringClaim(payload.sc_api_key_ref),
        },
      };
    },
  };
}

function toAuthError(error: unknown): Error {
  // The key set could not be fetched — our problem, not the caller's token.
  if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid || !(error instanceof errors.JOSEError)) {
    return new ServerError("Unable to verify access token");
  }
  if (error instanceof errors.JWTExpired) return new InvalidTokenError("Token has expired");
  if (error instanceof errors.JWTClaimValidationFailed) {
    // `claim` is the claim NAME (aud, iss, exp, ...) — safe to surface.
    return new InvalidTokenError(`Token ${error.claim} claim is missing or invalid`);
  }
  return new InvalidTokenError("Token signature or format is invalid");
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** RFC 9068 `scope` (space-delimited); some servers emit `scp` (array or string). */
function scopesOf(payload: JWTPayload): string[] {
  const raw = payload.scope ?? payload.scp;
  if (typeof raw === "string") return raw.split(/\s+/).filter(Boolean);
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === "string" && s !== "");
  return [];
}
