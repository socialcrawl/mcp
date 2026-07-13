#!/usr/bin/env node

import { buildApp } from "./app.js";
import { DEFAULT_BASE_URL } from "./context.js";

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 3000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Fatal: invalid PORT "${raw}" — expected an integer between 1 and 65535.`);
    process.exit(1);
  }
  return port;
}

/**
 * Trust-proxy parsing. Default OFF: trusting X-Forwarded-For when there is no
 * proxy in front lets clients spoof their IP past the rate limiters. Set
 * MCP_TRUST_PROXY to the number of proxy hops (usually 1) when deployed
 * behind a load balancer. "true" is mapped to 1 hop, never blanket-trust.
 */
function parseTrustProxy(raw: string | undefined): number | boolean {
  if (raw === undefined || raw.trim() === "" || raw.trim().toLowerCase() === "false") {
    return false;
  }
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "true") return 1;
  const hops = Number(trimmed);
  if (!Number.isInteger(hops) || hops < 0) {
    console.error(`Fatal: invalid MCP_TRUST_PROXY "${raw}" — expected a hop count or "true"/"false".`);
    process.exit(1);
  }
  return hops;
}

function parseLimit(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1) {
    console.error(`Fatal: invalid ${name} "${raw}" — expected a positive integer (requests per minute).`);
    process.exit(1);
  }
  return limit;
}

const PORT = parsePort(process.env.PORT);
const anonLimit = parseLimit("MCP_RATE_LIMIT", process.env.MCP_RATE_LIMIT);
const globalLimit = parseLimit("MCP_GLOBAL_RATE_LIMIT", process.env.MCP_GLOBAL_RATE_LIMIT);

const app = buildApp({
  baseUrl: process.env.SOCIALCRAWL_BASE_URL ?? DEFAULT_BASE_URL,
  allowedHosts: process.env.MCP_ALLOWED_HOSTS
    ? process.env.MCP_ALLOWED_HOSTS.split(",").map((h) => h.trim())
    : undefined,
  trustProxy: parseTrustProxy(process.env.MCP_TRUST_PROXY),
  rateLimit: anonLimit ? { windowMs: 60_000, limit: anonLimit } : undefined,
  globalRateLimit: globalLimit ? { windowMs: 60_000, limit: globalLimit } : undefined,
});

const server = app.listen(PORT, () => {
  console.error(`SocialCrawl MCP (Streamable HTTP) listening on :${PORT}/mcp`);
});

// Graceful shutdown: Node's default SIGTERM handler kills in-flight requests
// (Docker/K8s send SIGTERM on stop/redeploy). Stop accepting, drain up to 10s.
function shutdown(signal: string): void {
  console.error(`Received ${signal}, shutting down…`);
  server.close(() => process.exit(0));
  setTimeout(() => {
    console.error("Forced exit after 10s drain timeout.");
    process.exit(1);
  }, 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
