import express from "express";
import { rateLimit } from "express-rate-limit";
import { createHash } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { extractApiKey } from "./auth.js";
import { createServer } from "./server.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";

export interface AppConfig {
  /** SocialCrawl API origin the tools call, no trailing slash. */
  baseUrl: string;
  /** When set, enables the SDK's DNS-rebinding protection for these Host values. */
  allowedHosts?: string[];
  /** Per-IP limit for ANONYMOUS /mcp traffic (keyed traffic skips this tier). */
  rateLimit?: { windowMs: number; limit: number };
  /**
   * Per-IP ceiling for ALL /mcp traffic, keyed or not. Without it, any
   * garbage `x-api-key` would bypass rate limiting entirely (invalid keys
   * are not throttled upstream — they just 401).
   */
  globalRateLimit?: { windowMs: number; limit: number };
  /**
   * Express `trust proxy` value. SECURITY: default false — when the app is
   * NOT behind a proxy, trusting X-Forwarded-For lets any client spoof its
   * IP and dodge the per-IP limiters. Set to the number of proxy hops
   * (e.g. 1 for one load balancer) only where that is actually true.
   */
  trustProxy?: number | boolean;
}

export function buildApp(config: AppConfig): express.Express {
  const app = express();
  app.set("trust proxy", config.trustProxy ?? false);
  app.use(express.json({ limit: "1mb" }));

  // CORS — required for browser-based MCP clients (incl. MCP Inspector).
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, x-api-key, mcp-protocol-version, mcp-session-id",
    );
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id, WWW-Authenticate");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // One JSON log line per request on stderr. Never log key material — only a
  // fingerprint. Mounted BEFORE the limiters so 429 rejections are logged too.
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      const key = extractApiKey(req.headers);
      const body = req.body as unknown;
      const rpc = Array.isArray(body)
        ? ((body[0] as { method?: string } | undefined)?.method ?? null)
        : ((body as { method?: string } | undefined)?.method ?? null);
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          method: req.method,
          path: req.path,
          rpc,
          status: res.statusCode,
          ms: Date.now() - startedAt,
          keyFp: key ? createHash("sha256").update(key).digest("hex").slice(0, 8) : null,
        }),
      );
    });
    next();
  });

  // The xForwardedForHeader validation would 500 any request carrying an
  // X-Forwarded-For header while `trust proxy` is off. We ignore that header
  // deliberately in that case (req.ip = socket address), so silence it.
  const limiterValidate = { xForwardedForHeader: false };

  // Tier 1 — hard per-IP ceiling for ALL /mcp traffic. Generous enough that no
  // real client hits it; stops garbage-key floods from bypassing limiting.
  const globalLimits = config.globalRateLimit ?? { windowMs: 60_000, limit: 600 };
  app.use(
    "/mcp",
    rateLimit({
      windowMs: globalLimits.windowMs,
      limit: globalLimits.limit,
      standardHeaders: true,
      legacyHeaders: false,
      validate: limiterValidate,
    }),
  );

  // Tier 2 — strict limiter for the anonymous discovery tools. Keyed traffic
  // skips it (valid keys are limited upstream by concurrency + credit billing;
  // invalid keys are caught by the global ceiling above).
  const limits = config.rateLimit ?? { windowMs: 60_000, limit: 60 };
  app.use(
    "/mcp",
    rateLimit({
      windowMs: limits.windowMs,
      limit: limits.limit,
      standardHeaders: true,
      legacyHeaders: false,
      validate: limiterValidate,
      skip: (req) => extractApiKey(req.headers) !== "",
    }),
  );

  // ApiContext documents baseUrl as "no trailing slash" — enforce it here so a
  // misconfigured env value doesn't produce `//v1/...` upstream URLs.
  const baseUrl = config.baseUrl.replace(/\/+$/, "");

  app.post("/mcp", async (req, res) => {
    // Stateless: fresh server + transport per request, key bound via closure.
    const ctx = { apiKey: extractApiKey(req.headers), baseUrl };
    const server = createServer(ctx);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      ...(config.allowedHosts
        ? { enableDnsRebindingProtection: true, allowedHosts: config.allowedHosts }
        : {}),
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).set("Allow", "POST").send();
  });
  app.delete("/mcp", (_req, res) => {
    res.status(405).set("Allow", "POST").send();
  });

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", name: SERVER_NAME, version: SERVER_VERSION });
  });

  // Error handler: malformed JSON / oversized bodies otherwise fall through to
  // Express's default HTML error page — return JSON-RPC errors instead.
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      const type = (err as { type?: string } | null)?.type;
      if (type === "entity.parse.failed") {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32700, message: "Parse error: invalid JSON" },
          id: null,
        });
        return;
      }
      if (type === "entity.too.large") {
        res.status(413).json({
          jsonrpc: "2.0",
          error: { code: -32600, message: "Request body too large (limit 1mb)" },
          id: null,
        });
        return;
      }
      console.error("Unhandled request error:", err);
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    },
  );

  return app;
}
