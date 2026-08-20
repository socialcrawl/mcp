import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildApp } from "../app.js";

interface UpstreamHit {
  path: string;
  apiKey: string | undefined;
}

let upstream: Server;
let hits: UpstreamHit[] = [];
let appServer: Server;
let origin: string;
let mcpUrl: string;

beforeAll(async () => {
  upstream = createHttpServer((req, res) => {
    hits.push({ path: req.url ?? "", apiKey: req.headers["x-api-key"] as string | undefined });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, data: { balance: 777 }, credits_used: 0, credits_remaining: 777 }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, resolve));
  const upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

  const app = buildApp({ baseUrl: upstreamUrl });
  appServer = app.listen(0);
  await new Promise<void>((resolve) => appServer.once("listening", resolve));
  origin = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
  mcpUrl = `${origin}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => appServer.close(() => resolve()));
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

beforeEach(() => {
  hits = [];
});

async function connect(headers?: Record<string, string>): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL(mcpUrl),
    headers ? { requestInit: { headers } } : undefined,
  );
  const client = new Client({ name: "http-test-client", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

function firstText(result: Record<string, unknown>): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
}

describe("Streamable HTTP endpoint", () => {
  it("completes the MCP handshake and lists all nine tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(9);
    await client.close();
  });

  it("serves discovery tools anonymously", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "socialcrawl_list_platforms", arguments: {} });
    expect(firstText(result)).toContain("tiktok");
    await client.close();
  });

  it("keyed tool errors for anonymous callers and never contacts the upstream", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "socialcrawl_check_balance", arguments: {} });
    expect(firstText(result)).toContain("No API key configured");
    expect(hits).toHaveLength(0);
    await client.close();
  });

  it("forwards the Authorization: Bearer key to the SocialCrawl API", async () => {
    const client = await connect({ Authorization: "Bearer sc_int_bearer" });
    const result = await client.callTool({ name: "socialcrawl_check_balance", arguments: {} });
    expect(hits.some((h) => h.apiKey === "sc_int_bearer" && h.path.includes("/v1/credits/balance"))).toBe(true);
    expect(firstText(result)).toContain("777");
    await client.close();
  });

  it("accepts x-api-key as an alternative header", async () => {
    const client = await connect({ "x-api-key": "sc_int_xkey" });
    await client.callTool({ name: "socialcrawl_check_balance", arguments: {} });
    expect(hits.some((h) => h.apiKey === "sc_int_xkey")).toBe(true);
    await client.close();
  });

  it("SECURITY: an anonymous caller never inherits the operator's env key", async () => {
    process.env.SOCIALCRAWL_API_KEY = "sc_operator_secret";
    try {
      const client = await connect();
      const result = await client.callTool({ name: "socialcrawl_check_balance", arguments: {} });
      expect(firstText(result)).toContain("No API key configured");
      expect(hits.some((h) => h.apiKey === "sc_operator_secret")).toBe(false);
      await client.close();
    } finally {
      delete process.env.SOCIALCRAWL_API_KEY;
    }
  });

  it("SECURITY: concurrent callers with different keys never bleed into each other", async () => {
    const clientA = await connect({ Authorization: "Bearer sc_tenant_a" });
    const clientB = await connect({ Authorization: "Bearer sc_tenant_b" });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        (i % 2 === 0 ? clientA : clientB).callTool({ name: "socialcrawl_check_balance", arguments: {} }),
      ),
    );
    const keys = hits.map((h) => h.apiKey);
    expect(keys.filter((k) => k === "sc_tenant_a")).toHaveLength(5);
    expect(keys.filter((k) => k === "sc_tenant_b")).toHaveLength(5);
    expect(keys.every((k) => k === "sc_tenant_a" || k === "sc_tenant_b")).toBe(true);
    await clientA.close();
    await clientB.close();
  });

  it("returns 405 for GET and DELETE on /mcp (stateless mode)", async () => {
    const getRes = await fetch(mcpUrl, { method: "GET" });
    expect(getRes.status).toBe(405);
    const delRes = await fetch(mcpUrl, { method: "DELETE" });
    expect(delRes.status).toBe(405);
  });

  it("answers CORS preflight", async () => {
    const res = await fetch(mcpUrl, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toContain("x-api-key");
  });

  it("serves /healthz", async () => {
    const res = await fetch(`${origin}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; name: string };
    expect(body.status).toBe("ok");
    expect(body.name).toBe("socialcrawl-mcp");
  });
});

describe("rate limiting", () => {
  it("throttles anonymous requests after the configured limit, keyed requests bypass", async () => {
    const upstream2 = createHttpServer((_req, res) => {
      res.end(JSON.stringify({ success: true, data: {} }));
    });
    await new Promise<void>((resolve) => upstream2.listen(0, resolve));
    const app = buildApp({
      baseUrl: `http://127.0.0.1:${(upstream2.address() as AddressInfo).port}`,
      rateLimit: { windowMs: 60_000, limit: 3 },
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;

    const initBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    const post = (headers: Record<string, string> = {}) =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...headers,
        },
        body: initBody,
      });

    const anon = [await post(), await post(), await post(), await post()];
    expect(anon[0].status).toBe(200);
    expect(anon[3].status).toBe(429);

    // Keyed requests skip the limiter even after the anonymous budget is spent.
    const keyed = await post({ "x-api-key": "sc_limit_bypass" });
    expect(keyed.status).toBe(200);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => upstream2.close(() => resolve()));
  });

  it("SECURITY: keyed traffic cannot bypass the global per-IP ceiling with garbage keys", async () => {
    const upstream3 = createHttpServer((_req, res) => {
      res.end(JSON.stringify({ success: true, data: {} }));
    });
    await new Promise<void>((resolve) => upstream3.listen(0, resolve));
    const app = buildApp({
      baseUrl: `http://127.0.0.1:${(upstream3.address() as AddressInfo).port}`,
      rateLimit: { windowMs: 60_000, limit: 100 },
      globalRateLimit: { windowMs: 60_000, limit: 3 },
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;

    const post = (key: string) =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "x-api-key": key,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
        }),
      });

    // Rotating garbage keys — each request is "keyed", none should escape the ceiling.
    const results = [await post("junk_1"), await post("junk_2"), await post("junk_3"), await post("junk_4")];
    expect(results[0].status).toBe(200);
    expect(results[3].status).toBe(429);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => upstream3.close(() => resolve()));
  });
});

describe("malformed requests", () => {
  it("returns a JSON-RPC parse error for invalid JSON bodies (not an HTML page)", async () => {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { jsonrpc: string; error: { code: number } };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error.code).toBe(-32700);
  });
});

describe("request logging", () => {
  it("logs a fingerprint, never the raw key", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const client = await connect({ Authorization: "Bearer sc_super_secret_key" });
      await client.callTool({ name: "socialcrawl_list_platforms", arguments: {} });
      await client.close();
      const logged = errSpy.mock.calls.map((args) => args.join(" ")).join("\n");
      expect(logged).toContain('"keyFp"');
      expect(logged).not.toContain("sc_super_secret_key");
    } finally {
      errSpy.mockRestore();
    }
  });
});
