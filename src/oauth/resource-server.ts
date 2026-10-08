import type express from "express";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { metadataHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/metadata.js";
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { extractApiKey, extractBearerToken, isJwtShaped } from "../auth.js";
import { SCOPES_SUPPORTED, missingScopesForBody, needsSignIn } from "./scopes.js";
import { ApiKeyLookupUnavailableError } from "./api-key-resolver.js";
import type { OAuthResourceServerConfig } from "./config.js";

const ROOT_METADATA_PATH = "/.well-known/oauth-protected-resource";

/** `res.locals` slot the gate fills with the API key a verified token maps to. */
export const RESOLVED_API_KEY = "socialcrawlApiKey";

/**
 * RFC 9728 protected resource metadata, served at the path-specific URI
 * (`/.well-known/oauth-protected-resource/mcp`, the one the 401 challenge
 * names) and at the root URI that clients probe as a fallback.
 */
export function mountProtectedResourceMetadata(app: express.Express, config: OAuthResourceServerConfig): void {
  const metadata: OAuthProtectedResourceMetadata = {
    resource: config.resource.href,
    authorization_servers: [config.issuer],
    scopes_supported: SCOPES_SUPPORTED,
    bearer_methods_supported: ["header"],
    resource_name: "SocialCrawl",
  };
  const handler = metadataHandler(metadata);
  const specificPath = new URL(getOAuthProtectedResourceMetadataUrl(config.resource)).pathname;
  app.use(specificPath, handler);
  if (specificPath !== ROOT_METADATA_PATH) app.use(ROOT_METADATA_PATH, handler);
}

/**
 * Gate for POST /mcp when OAuth is on.
 *
 *  - Bearer JWT       → SDK bearer middleware (signature, iss, aud, exp via
 *                       the verifier) → per-tool scope check (403 step-up)
 *                       → resolve the SocialCrawl API key (401 if unlinked).
 *  - x-api-key, or a non-JWT Bearer value → unchanged API-key path, so
 *                       headless clients keep working.
 *  - no credentials   → initialize, tools/list and the free discovery tools
 *                       run anonymously; a call that needs an account gets
 *                       401 + `WWW-Authenticate: Bearer resource_metadata=…`
 *                       so connector clients (claude.ai) start the OAuth flow.
 *
 * SECURITY: nothing here logs or echoes the token or the resolved key.
 */
export function oauthGate(config: OAuthResourceServerConfig): express.RequestHandler {
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(config.resource);
  const bearer = requireBearerAuth({ verifier: config.verifier, resourceMetadataUrl });

  return (req, res, next) => {
    if (!isJwtShaped(extractBearerToken(req.headers))) {
      if (extractApiKey(req.headers) !== "") {
        next();
        return;
      }
      // Lazy authentication: anonymous discovery keeps working, and only a
      // call that needs an account gets the 401. The challenge has to be an
      // HTTP 401 sent before the SDK runs; a tool result would be a 200, and
      // clients only start sign-in on the 401.
      if (req.is("application/json") && req.body !== undefined && !needsSignIn(req.body)) {
        next();
        return;
      }
      res.set(
        "WWW-Authenticate",
        `Bearer resource_metadata="${resourceMetadataUrl}", scope="${SCOPES_SUPPORTED.join(" ")}"`,
      );
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Authentication required" },
        id: null,
      });
      return;
    }

    // SECURITY: the scope check reads the body express.json() parsed. That
    // parser takes only application/json, while the SDK transport accepts any
    // Content-Type *containing* "application/json" and parses the raw stream
    // itself, so on a mismatch the gate would see no body while the tool still
    // ran. Refuse anything express did not parse, before any token work.
    if (!req.is("application/json") || req.body === undefined) {
      res.status(415).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Unsupported Media Type: Content-Type must be application/json" },
        id: null,
      });
      return;
    }

    void bearer(req, res, () => {
      void authorize(req, res, next);
    });
  };

  async function authorize(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
    const auth = req.auth!;
    const missing = missingScopesForBody(req.body, auth.scopes);
    if (missing.length > 0) {
      // Step-up: ask for what the token already has plus what this call needs.
      const wanted = SCOPES_SUPPORTED.filter((s) => auth.scopes.includes(s) || missing.includes(s));
      const description = `This call requires ${missing.join(" ")}`;
      res.set(
        "WWW-Authenticate",
        `Bearer error="insufficient_scope", scope="${wanted.join(" ")}", resource_metadata="${resourceMetadataUrl}", error_description="${description}"`,
      );
      res.status(403).json({ error: "insufficient_scope", error_description: description });
      return;
    }

    let apiKey: string | null;
    try {
      apiKey = await config.resolveApiKey(auth);
    } catch (error) {
      const reason = error instanceof ApiKeyLookupUnavailableError ? error.message : "resolver error";
      console.error(JSON.stringify({ event: "oauth_api_key_lookup_failed", reason }));
      res.status(503).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Authorization backend unavailable, retry shortly" },
        id: null,
      });
      return;
    }
    if (!apiKey) {
      const description = "Token is not linked to an active SocialCrawl API key";
      res.set(
        "WWW-Authenticate",
        `Bearer error="invalid_token", error_description="${description}", resource_metadata="${resourceMetadataUrl}"`,
      );
      res.status(401).json({ error: "invalid_token", error_description: description });
      return;
    }
    res.locals[RESOLVED_API_KEY] = apiKey;
    next();
  }
}
