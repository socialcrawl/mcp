import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { generateKeyPair, SignJWT, exportJWK, type JWK, type CryptoKey } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildApp } from "../app.js";
import { createJwtVerifier } from "../oauth/jwt-verifier.js";
import { createLookupResolver } from "../oauth/api-key-resolver.js";
import { SCOPES_SUPPORTED } from "../oauth/scopes.js";

/**
 * End-to-end over real HTTP: a local JWKS host, a local key-lookup backend and
 * a local stand-in for the SocialCrawl API. Nothing leaves 127.0.0.1.
 */

const RESOURCE = "https://mcp.socialcrawl.test/mcp";
const PRM_URL = "https://mcp.socialcrawl.test/.well-known/oauth-protected-resource/mcp";
const LOOKUP_SECRET = "lookup-shared-secret";
const KEYS_BY_REF: Record<string, string> = { ref_alice: "sc_alice_key" };

let issuer: string;
let privateKey: CryptoKey;
let jwksServer: Server;
let lookupServer: Server;
let lookupStatus = 200;
let lookupCalls: Array<{ auth: string | undefined; body: string }> = [];
let upstream: Server;
let upstreamHits: Array<{ path: string; apiKey: string | undefined }> = [];
let appServer: Server;
let mcpUrl: string;
let origin: string;

function listen(server: Server): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );
}
function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  jwksServer = createHttpServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  issuer = await listen(jwksServer);

  lookupServer = createHttpServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      lookupCalls.push({ auth: req.headers.authorization, body });
      res.setHeader("Content-Type", "application/json");
      if (lookupStatus !== 200) {
        res.statusCode = lookupStatus;
        res.end(JSON.stringify({ error: "x" }));
        return;
      }
      const ref = (JSON.parse(body) as { sc_api_key_ref: string }).sc_api_key_ref;
      const key = KEYS_BY_REF[ref];
      res.statusCode = key ? 200 : 404;
      res.end(JSON.stringify(key ? { api_key: key } : { error: "not_found" }));
    });
  });
  const lookupUrl = `${await listen(lookupServer)}/lookup`;

  upstream = createHttpServer((req, res) => {
    upstreamHits.push({ path: req.url ?? "", apiKey: req.headers["x-api-key"] as string | undefined });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, data: { balance: 777 }, credits_used: 0, credits_remaining: 777 }));
  });
  const upstreamUrl = await listen(upstream);

  const app = buildApp({
    baseUrl: upstreamUrl,
    oauth: {
      resource: new URL(RESOURCE),
      issuer,
      verifier: createJwtVerifier({ issuer, audience: RESOURCE, jwks: new URL(`${issuer}/jwks.json`) }),
      resolveApiKey: createLookupResolver({ url: lookupUrl, secret: LOOKUP_SECRET, cacheTtlMs: 0 }),
    },
  });
  appServer = app.listen(0);
  await new Promise<void>((resolve) => appServer.once("listening", resolve));
  origin = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
  mcpUrl = `${origin}/mcp`;
});

afterAll(async () => {
  await close(appServer);
  await close(upstream);
  await close(lookupServer);
  await close(jwksServer);
});

beforeEach(() => {
  lookupStatus = 200;
  lookupCalls = [];
  upstreamHits = [];
});

async function mint(
  claims: Record<string, unknown>,
  opts: { aud?: string; iss?: string; exp?: boolean } = {},
): Promise<string> {
  let jwt = new SignJWT({ client_id: "https://claude.ai/oauth/mcp-client", sc_api_key_ref: "ref_alice", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1", typ: "at+jwt" })
    .setIssuer(opts.iss ?? issuer)
    .setAudience(opts.aud ?? RESOURCE)
    .setSubject("user_alice")
    .setIssuedAt();
  if (opts.exp !== false) jwt = jwt.setExpirationTime("5m");
  return jwt.sign(privateKey);
}

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

function rpc(method: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
}

async function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(mcpUrl, { method: "POST", headers: { ...JSON_HEADERS, ...headers }, body });
}

async function connect(headers: Record<string, string>): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers } });
  const client = new Client({ name: "oauth-test-client", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

describe("OAuth protected resource metadata (RFC 9728)", () => {
  it("serves the metadata at the path-specific and root well-known URIs", async () => {
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const res = await fetch(`${origin}${path}`);
      expect(res.status, path).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.resource).toBe(RESOURCE);
      expect(body.authorization_servers).toEqual([issuer]);
      expect(body.scopes_supported).toEqual(SCOPES_SUPPORTED);
      expect(body.bearer_methods_supported).toEqual(["header"]);
    }
  });
});

describe("401 challenge", () => {
  it("answers an unauthenticated POST /mcp with 401 and a resource_metadata challenge", async () => {
    const res = await post(rpc("tools/list"));
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(`resource_metadata="${PRM_URL}"`);
    expect(challenge).toContain(`scope="${SCOPES_SUPPORTED.join(" ")}"`);
    // RFC 6750 §3.1: no error code when the request carried no credentials at all.
    expect(challenge).not.toContain("error=");
  });

  it("rejects a token for another audience with 401 invalid_token", async () => {
    const token = await mint({ scope: "socialcrawl:read" }, { aud: "https://other.example.test/mcp" });
    const res = await post(rpc("tools/list"), { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain(`resource_metadata="${PRM_URL}"`);
    expect(lookupCalls).toHaveLength(0);
  });

  it("rejects a token from another issuer, an expired token and a token without exp", async () => {
    const tokens = [
      await mint({ scope: "socialcrawl:read" }, { iss: "https://evil.example.test" }),
      await new SignJWT({ scope: "socialcrawl:read" })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(issuer)
        .setAudience(RESOURCE)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 600)
        .sign(privateKey),
      await mint({ scope: "socialcrawl:read" }, { exp: false }),
    ];
    for (const token of tokens) {
      const res = await post(rpc("tools/list"), { Authorization: `Bearer ${token}` });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate") ?? "").toContain('error="invalid_token"');
    }
  });

  it("rejects a valid token whose key reference the backend does not know (401)", async () => {
    const token = await mint({ scope: "socialcrawl:read", sc_api_key_ref: "ref_unknown" });
    const res = await post(rpc("tools/list"), { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate") ?? "").toContain('error="invalid_token"');
  });

  it("returns 503 (not 401) when the key-lookup backend is down", async () => {
    lookupStatus = 500;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const token = await mint({ scope: "socialcrawl:read" });
      const res = await post(rpc("tools/list"), { Authorization: `Bearer ${token}` });
      expect(res.status).toBe(503);
      expect(res.headers.get("www-authenticate")).toBeNull();
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe("scopes", () => {
  it("a read-scoped token can list tools and call discovery tools", async () => {
    const token = await mint({ scope: "socialcrawl:read" });
    const client = await connect({ Authorization: `Bearer ${token}` });
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(7);
    const result = await client.callTool({ name: "socialcrawl_find", arguments: {} });
    expect(result.isError).toBeFalsy();
    await client.close();
  });

  it("a read-scoped token cannot call socialcrawl_request: 403 insufficient_scope, upstream never contacted", async () => {
    const token = await mint({ scope: "socialcrawl:read" });
    const res = await post(
      rpc("tools/call", { name: "socialcrawl_request", arguments: { platform: "tiktok", resource: "profile" } }),
      { Authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(403);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain("socialcrawl:spend");
    expect(challenge).toContain(`resource_metadata="${PRM_URL}"`);
    expect(upstreamHits).toHaveLength(0);
  });

  it("a spend-scoped token's calls reach the API with the resolved key — never the access token", async () => {
    const token = await mint({ scope: "socialcrawl:read socialcrawl:spend" });
    const client = await connect({ Authorization: `Bearer ${token}` });
    await client.callTool({ name: "socialcrawl_account", arguments: {} });
    await client.callTool({
      name: "socialcrawl_request",
      arguments: { platform: "tiktok", resource: "profile", params: { handle: "x" } },
    });
    await client.close();
    expect(upstreamHits.length).toBeGreaterThanOrEqual(2);
    expect(upstreamHits.every((h) => h.apiKey === "sc_alice_key")).toBe(true);
    expect(lookupCalls.every((c) => c.auth === `Bearer ${LOOKUP_SECRET}`)).toBe(true);
    expect(lookupCalls.every((c) => !c.body.includes(token))).toBe(true);
  });

  it("gates every tools/call inside a JSON-RPC batch", async () => {
    const token = await mint({ scope: "socialcrawl:read" });
    const body = JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "socialcrawl_find", arguments: {} } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "socialcrawl_manage", arguments: { area: "monitors", action: "list" } } },
    ]);
    const res = await post(body, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(403);
  });
});

describe("SECURITY: body/Content-Type mismatch cannot bypass the scope gate", () => {
  // express.json() parses only application/json, but the SDK transport accepts
  // any Content-Type containing "application/json" and parses the raw body
  // itself. The gate must never see "no body" while the tool still runs.
  const callRequest = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "socialcrawl_request", arguments: { platform: "tiktok", resource: "profile", params: { handle: "x" } } },
  });

  for (const contentType of ["text/plain; x=application/json", "application/jsonx", "application/json-patch+json"]) {
    it(`a read-only token never reaches the tool with Content-Type: ${contentType}`, async () => {
      const token = await mint({ scope: "socialcrawl:read" });
      const res = await fetch(mcpUrl, {
        method: "POST",
        headers: { Accept: "application/json, text/event-stream", "Content-Type": contentType, Authorization: `Bearer ${token}` },
        body: callRequest,
      });
      expect([403, 415]).toContain(res.status);
      expect(upstreamHits).toHaveLength(0);
      expect(lookupCalls).toHaveLength(0);
    });
  }

  it("application/json with a charset parameter still works", async () => {
    const token = await mint({ scope: "socialcrawl:read" });
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: rpc("tools/call", { name: "socialcrawl_find", arguments: {} }),
    });
    expect(res.status).toBe(200);
  });
});

describe("legacy credentials while OAuth is on", () => {
  it("x-api-key still works for headless clients", async () => {
    const client = await connect({ "x-api-key": "sc_headless_key" });
    await client.callTool({ name: "socialcrawl_account", arguments: {} });
    await client.close();
    expect(upstreamHits.some((h) => h.apiKey === "sc_headless_key")).toBe(true);
    expect(lookupCalls).toHaveLength(0);
  });

  it("a non-JWT Bearer value is still treated as a SocialCrawl API key", async () => {
    const client = await connect({ Authorization: "Bearer sc_bearer_api_key" });
    await client.callTool({ name: "socialcrawl_account", arguments: {} });
    await client.close();
    expect(upstreamHits.some((h) => h.apiKey === "sc_bearer_api_key")).toBe(true);
  });
});

describe("logging", () => {
  it("SECURITY: never logs the access token or the resolved API key", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const token = await mint({ scope: "socialcrawl:read socialcrawl:spend" });
      const client = await connect({ Authorization: `Bearer ${token}` });
      await client.callTool({ name: "socialcrawl_account", arguments: {} });
      await client.close();
      await post(rpc("tools/list"), { Authorization: `Bearer ${await mint({ scope: "x" }, { aud: "https://o.test" })}` });
      const logged = errSpy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
      expect(logged).not.toContain(token);
      expect(logged).not.toContain(token.split(".")[1]);
      expect(logged).not.toContain("sc_alice_key");
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe("flag off (default)", () => {
  let offServer: Server;
  let offUrl: string;

  beforeAll(async () => {
    delete process.env.SOCIALCRAWL_OAUTH;
    const upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    offServer = buildApp({ baseUrl: upstreamUrl }).listen(0);
    await new Promise<void>((resolve) => offServer.once("listening", resolve));
    offUrl = `http://127.0.0.1:${(offServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await close(offServer);
  });

  it("serves no well-known metadata", async () => {
    const res = await fetch(`${offUrl}/.well-known/oauth-protected-resource/mcp`);
    expect(res.status).toBe(404);
  });

  it("lets anonymous callers in with no challenge", async () => {
    const res = await fetch(`${offUrl}/mcp`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "t", version: "0" },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("passes a JWT-shaped Bearer value through as the API key, untouched", async () => {
    const token = await mint({ scope: "socialcrawl:read" });
    const transport = new StreamableHTTPClientTransport(new URL(`${offUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "off", version: "0" });
    await client.connect(transport);
    await client.callTool({ name: "socialcrawl_account", arguments: {} });
    await client.close();
    expect(upstreamHits.some((h) => h.apiKey === token)).toBe(true);
    expect(lookupCalls).toHaveLength(0);
  });
});
