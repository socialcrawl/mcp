import { describe, it, expect, vi, afterEach } from "vitest";
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK, type JWK } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { createServer } from "../server.js";
import { isJwtShaped } from "../auth.js";
import { SCOPES, SCOPES_SUPPORTED, TOOL_SCOPES, requiredScopesForTool, missingScopesForBody } from "../oauth/scopes.js";
import { oauthConfigFromEnv } from "../oauth/config.js";
import { createJwtVerifier } from "../oauth/jwt-verifier.js";
import { createLookupResolver, ApiKeyLookupUnavailableError } from "../oauth/api-key-resolver.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isJwtShaped", () => {
  it("recognises a compact JWS and nothing else", () => {
    expect(isJwtShaped("eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln")).toBe(true);
    expect(isJwtShaped("sc_live_abc123")).toBe(false);
    expect(isJwtShaped("a.b")).toBe(false);
    expect(isJwtShaped("a.b.c.d.e")).toBe(false);
    expect(isJwtShaped("a b.c.d")).toBe(false);
    expect(isJwtShaped("")).toBe(false);
  });
});

describe("scope → tool mapping", () => {
  it("covers every tool the server registers, legacy names included (a new tool must be classified)", async () => {
    const server = createServer({ apiKey: "", baseUrl: "https://www.socialcrawl.dev" }, { legacyTools: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "scope-coverage", version: "0.0.0" });
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(TOOL_SCOPES[tool.name], `unclassified tool ${tool.name}`).toBeDefined();
    }
    await client.close();
  });

  it("puts discovery tools under read and paid tools under spend", () => {
    for (const name of [
      "socialcrawl_list_platforms",
      "socialcrawl_list_endpoints",
      "socialcrawl_pricing",
      "socialcrawl_discover",
      "socialcrawl_get_docs",
      "socialcrawl_check_balance",
    ]) {
      expect(requiredScopesForTool(name)).toEqual([SCOPES.read]);
    }
    expect(requiredScopesForTool("socialcrawl_request")).toEqual([SCOPES.spend]);
    expect(requiredScopesForTool("socialcrawl_collect")).toEqual([SCOPES.spend]);
    for (const tool of ["socialcrawl_find", "socialcrawl_endpoint", "socialcrawl_estimate", "socialcrawl_account"]) {
      expect(requiredScopesForTool(tool), tool).toEqual([SCOPES.read]);
    }
    expect(requiredScopesForTool("socialcrawl_manage")).toEqual([SCOPES.spend, SCOPES.manage]);
    expect(requiredScopesForTool("socialcrawl_monitors")).toEqual([SCOPES.spend, SCOPES.manage]);
  });

  it("fails closed: an unknown tool needs every scope", () => {
    expect(requiredScopesForTool("socialcrawl_not_a_tool")).toEqual(SCOPES_SUPPORTED);
  });

  it("only gates tools/call — initialize and tools/list need no specific scope", () => {
    expect(missingScopesForBody({ jsonrpc: "2.0", id: 1, method: "tools/list" }, [])).toEqual([]);
    expect(missingScopesForBody({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, [])).toEqual([]);
  });

  it("reports the missing scopes for a tools/call, including inside a batch", () => {
    const call = (name: string) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } });
    expect(missingScopesForBody(call("socialcrawl_request"), [SCOPES.read])).toEqual([SCOPES.spend]);
    expect(missingScopesForBody(call("socialcrawl_request"), [SCOPES.spend])).toEqual([]);
    expect(
      missingScopesForBody([call("socialcrawl_list_platforms"), call("socialcrawl_monitors")], [SCOPES.read]),
    ).toEqual([SCOPES.spend, SCOPES.manage]);
  });

  it("SECURITY: fails closed when the body is not a parsed JSON object or array", () => {
    for (const body of [undefined, null, "", "tools/call", 42, true]) {
      expect(missingScopesForBody(body, [SCOPES.read]), String(body)).toEqual([SCOPES.spend, SCOPES.manage]);
    }
    expect(missingScopesForBody([{ jsonrpc: "2.0", id: 1, method: "tools/list" }, "junk"], [SCOPES.read])).toEqual([
      SCOPES.spend,
      SCOPES.manage,
    ]);
  });

  it("treats a tools/call without a string name as needing every scope", () => {
    expect(missingScopesForBody({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }, [SCOPES.read])).toEqual([
      SCOPES.spend,
      SCOPES.manage,
    ]);
  });
});

describe("oauthConfigFromEnv", () => {
  const FULL = {
    SOCIALCRAWL_OAUTH: "1",
    SOCIALCRAWL_OAUTH_RESOURCE: "https://mcp.socialcrawl.dev/mcp",
    SOCIALCRAWL_OAUTH_ISSUER: "https://auth.socialcrawl.dev",
    SOCIALCRAWL_OAUTH_JWKS_URL: "https://auth.socialcrawl.dev/.well-known/jwks.json",
    SOCIALCRAWL_OAUTH_KEY_LOOKUP_URL: "https://www.socialcrawl.dev/api/internal/oauth/api-key",
    SOCIALCRAWL_OAUTH_KEY_LOOKUP_SECRET: "lookup-secret",
  };

  it("is off unless SOCIALCRAWL_OAUTH=1", () => {
    expect(oauthConfigFromEnv({})).toBeUndefined();
    expect(oauthConfigFromEnv({ ...FULL, SOCIALCRAWL_OAUTH: "0" })).toBeUndefined();
    expect(oauthConfigFromEnv({ ...FULL, SOCIALCRAWL_OAUTH: "" })).toBeUndefined();
  });

  it("builds a resource-server config when every variable is set", () => {
    const config = oauthConfigFromEnv(FULL);
    expect(config).toBeDefined();
    expect(config!.resource.href).toBe("https://mcp.socialcrawl.dev/mcp");
    expect(config!.issuer).toBe("https://auth.socialcrawl.dev");
    expect(typeof config!.verifier.verifyAccessToken).toBe("function");
    expect(typeof config!.resolveApiKey).toBe("function");
  });

  it("fails fast, naming the variable, when the flag is on but configuration is missing", () => {
    for (const name of Object.keys(FULL).filter((k) => k !== "SOCIALCRAWL_OAUTH")) {
      const env: Record<string, string | undefined> = { ...FULL };
      delete env[name];
      expect(() => oauthConfigFromEnv(env)).toThrow(name);
    }
  });

  it("SECURITY: refuses plain-http issuer, JWKS or lookup URLs except on localhost", () => {
    expect(() => oauthConfigFromEnv({ ...FULL, SOCIALCRAWL_OAUTH_ISSUER: "http://auth.socialcrawl.dev" })).toThrow(
      "SOCIALCRAWL_OAUTH_ISSUER",
    );
    expect(() =>
      oauthConfigFromEnv({ ...FULL, SOCIALCRAWL_OAUTH_JWKS_URL: "http://auth.socialcrawl.dev/jwks.json" }),
    ).toThrow("SOCIALCRAWL_OAUTH_JWKS_URL");
    expect(() =>
      oauthConfigFromEnv({ ...FULL, SOCIALCRAWL_OAUTH_KEY_LOOKUP_URL: "http://www.socialcrawl.dev/x" }),
    ).toThrow("SOCIALCRAWL_OAUTH_KEY_LOOKUP_URL");
    expect(
      oauthConfigFromEnv({
        ...FULL,
        SOCIALCRAWL_OAUTH_RESOURCE: "http://localhost:3000/mcp",
        SOCIALCRAWL_OAUTH_ISSUER: "http://127.0.0.1:9000",
        SOCIALCRAWL_OAUTH_JWKS_URL: "http://127.0.0.1:9000/jwks.json",
        SOCIALCRAWL_OAUTH_KEY_LOOKUP_URL: "http://localhost:3001/lookup",
      }),
    ).toBeDefined();
  });

  it("SECURITY: refuses unknown or symmetric/none algorithms at startup", () => {
    for (const bad of ["HS256", "none", "RS256,HS512", "rs256", "EdDSA"]) {
      expect(() => oauthConfigFromEnv({ ...FULL, SOCIALCRAWL_OAUTH_ALGORITHMS: bad }), bad).toThrow(
        "SOCIALCRAWL_OAUTH_ALGORITHMS",
      );
    }
    expect(oauthConfigFromEnv({ ...FULL, SOCIALCRAWL_OAUTH_ALGORITHMS: "RS256, ES384,PS512" })).toBeDefined();
  });

  it("SECURITY: refuses a resource URL with a fragment", () => {
    expect(() => oauthConfigFromEnv({ ...FULL, SOCIALCRAWL_OAUTH_RESOURCE: "https://mcp.socialcrawl.dev/mcp#x" })).toThrow(
      "SOCIALCRAWL_OAUTH_RESOURCE",
    );
  });
});

describe("createJwtVerifier", () => {
  const ISSUER = "https://auth.example.test";
  const AUDIENCE = "https://mcp.example.test/mcp";

  async function setup() {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    const verifier = createJwtVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks: createLocalJWKSet({ keys: [jwk] }) });
    const mint = (claims: Record<string, unknown> = {}, opts: { exp?: boolean; iss?: string; aud?: string } = {}) => {
      let jwt = new SignJWT({ scope: "socialcrawl:read", client_id: "https://claude.ai/oauth/client", ...claims })
        .setProtectedHeader({ alg: "RS256", kid: "k1", typ: "at+jwt" })
        .setIssuer(opts.iss ?? ISSUER)
        .setAudience(opts.aud ?? AUDIENCE)
        .setSubject("user_1")
        .setIssuedAt();
      if (opts.exp !== false) jwt = jwt.setExpirationTime("5m");
      return jwt.sign(privateKey);
    };
    return { verifier, mint };
  }

  it("returns AuthInfo with scopes, client id, expiry, resource and the key reference", async () => {
    const { verifier, mint } = await setup();
    const token = await mint({ scope: "socialcrawl:read socialcrawl:spend", sc_api_key_ref: "ref_1" });
    const info: AuthInfo = await verifier.verifyAccessToken(token);
    expect(info.scopes).toEqual(["socialcrawl:read", "socialcrawl:spend"]);
    expect(info.clientId).toBe("https://claude.ai/oauth/client");
    expect(typeof info.expiresAt).toBe("number");
    expect(info.resource?.href).toBe(AUDIENCE);
    expect(info.extra).toMatchObject({ sub: "user_1", sc_api_key_ref: "ref_1" });
  });

  it("accepts an `scp` array as the scope claim", async () => {
    const { verifier, mint } = await setup();
    const token = await mint({ scope: undefined, scp: ["socialcrawl:read", "socialcrawl:manage"] });
    expect((await verifier.verifyAccessToken(token)).scopes).toEqual(["socialcrawl:read", "socialcrawl:manage"]);
  });

  it("SECURITY: rejects a token issued for another audience", async () => {
    const { verifier, mint } = await setup();
    await expect(verifier.verifyAccessToken(await mint({}, { aud: "https://other.example.test/mcp" }))).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("SECURITY: rejects a token from another issuer", async () => {
    const { verifier, mint } = await setup();
    await expect(verifier.verifyAccessToken(await mint({}, { iss: "https://evil.example.test" }))).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("SECURITY: rejects a token without exp", async () => {
    const { verifier, mint } = await setup();
    await expect(verifier.verifyAccessToken(await mint({}, { exp: false }))).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("SECURITY: rejects a token signed by an unknown key", async () => {
    const { verifier } = await setup();
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({ scope: "socialcrawl:spend" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .sign(other.privateKey);
    await expect(verifier.verifyAccessToken(forged)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("SECURITY: rejects an unsigned (alg none) token", async () => {
    const { verifier } = await setup();
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const exp = Math.floor(Date.now() / 1000) + 300;
    const unsigned = `${b64({ alg: "none" })}.${b64({ iss: ISSUER, aud: AUDIENCE, exp, scope: "socialcrawl:spend" })}.`;
    await expect(verifier.verifyAccessToken(unsigned)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("SECURITY: error messages never echo the token", async () => {
    const { verifier, mint } = await setup();
    const token = await mint({}, { aud: "https://other.example.test/mcp" });
    const error = await verifier.verifyAccessToken(token).catch((e: Error) => e);
    expect(String((error as Error).message)).not.toContain(token);
    expect(String((error as Error).message)).not.toContain(token.split(".")[1]);
  });
});

describe("createLookupResolver", () => {
  const auth = (extra: Record<string, unknown>): AuthInfo => ({
    token: "jwt-not-forwarded",
    clientId: "https://claude.ai/oauth/client",
    scopes: ["socialcrawl:read"],
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    extra: { sub: "user_1", ...extra },
  });

  function stubBackend(status: number, payload: unknown) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    });
    return calls;
  }

  it("posts the key reference with the shared secret and returns the API key", async () => {
    const calls = stubBackend(200, { api_key: "sc_resolved_key" });
    const resolve = createLookupResolver({ url: "https://backend.test/lookup", secret: "s3cret" });
    expect(await resolve(auth({ sc_api_key_ref: "ref_1" }))).toBe("sc_resolved_key");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://backend.test/lookup");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer s3cret");
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      sc_api_key_ref: "ref_1",
      sub: "user_1",
      client_id: "https://claude.ai/oauth/client",
      scopes: ["socialcrawl:read"],
    });
    // SECURITY: the access token itself is never passed through to another service.
    expect(String(calls[0].init.body)).not.toContain("jwt-not-forwarded");
  });

  it("returns null without calling the backend when the token carries no key reference", async () => {
    const calls = stubBackend(200, { api_key: "sc_should_not_be_used" });
    const resolve = createLookupResolver({ url: "https://backend.test/lookup", secret: "s3cret" });
    expect(await resolve(auth({}))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns null when the backend says the reference is unknown or revoked (404)", async () => {
    stubBackend(404, { error: "not_found" });
    const resolve = createLookupResolver({ url: "https://backend.test/lookup", secret: "s3cret" });
    expect(await resolve(auth({ sc_api_key_ref: "ref_gone" }))).toBeNull();
  });

  it("throws ApiKeyLookupUnavailableError on a backend failure or malformed reply", async () => {
    stubBackend(500, { error: "boom" });
    const resolve = createLookupResolver({ url: "https://backend.test/lookup", secret: "s3cret" });
    await expect(resolve(auth({ sc_api_key_ref: "ref_1" }))).rejects.toBeInstanceOf(ApiKeyLookupUnavailableError);
    stubBackend(200, { nope: true });
    await expect(resolve(auth({ sc_api_key_ref: "ref_2" }))).rejects.toBeInstanceOf(ApiKeyLookupUnavailableError);
  });

  it("caches a resolved key briefly so stateless requests do not hit the backend every time", async () => {
    const calls = stubBackend(200, { api_key: "sc_resolved_key" });
    let now = 1_000_000;
    const resolve = createLookupResolver({
      url: "https://backend.test/lookup",
      secret: "s3cret",
      cacheTtlMs: 60_000,
      now: () => now,
    });
    await resolve(auth({ sc_api_key_ref: "ref_1" }));
    await resolve(auth({ sc_api_key_ref: "ref_1" }));
    expect(calls).toHaveLength(1);
    now += 60_001;
    await resolve(auth({ sc_api_key_ref: "ref_1" }));
    expect(calls).toHaveLength(2);
  });

  it("SECURITY: a cached key is not reused for another subject or client with the same ref", async () => {
    const calls = stubBackend(200, { api_key: "sc_resolved_key" });
    const resolve = createLookupResolver({ url: "https://backend.test/lookup", secret: "s3cret", cacheTtlMs: 60_000 });
    await resolve(auth({ sc_api_key_ref: "ref_1" }));
    await resolve(auth({ sc_api_key_ref: "ref_1", sub: "user_mallory" }));
    expect(calls).toHaveLength(2);
    await resolve({ ...auth({ sc_api_key_ref: "ref_1" }), clientId: "https://other.example/client" });
    expect(calls).toHaveLength(3);
    await resolve(auth({ sc_api_key_ref: "ref_1" }));
    expect(calls).toHaveLength(3);
  });

  it("never caches a key past the token's own expiry", async () => {
    const calls = stubBackend(200, { api_key: "sc_resolved_key" });
    let now = 1_000_000_000;
    const resolve = createLookupResolver({
      url: "https://backend.test/lookup",
      secret: "s3cret",
      cacheTtlMs: 60_000,
      now: () => now,
    });
    const shortLived = { ...auth({ sc_api_key_ref: "ref_1" }), expiresAt: now / 1000 + 5 };
    await resolve(shortLived);
    now += 6_000;
    await resolve({ ...shortLived, expiresAt: now / 1000 + 300 });
    expect(calls).toHaveLength(2);
  });
});
