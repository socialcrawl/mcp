import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { ENDPOINTS } from "../data/endpoints.js";
import type { ApiContext } from "../context.js";

/**
 * These tests drive the server the way a real MCP client does: JSON arguments
 * over a transport, validated by the SDK against the published input schema,
 * results read back as `content` + `isError`. Calling the tool functions
 * directly skips exactly the layer where these bugs lived.
 */

const KEYED: ApiContext = { apiKey: "sc_test_key_1234567890", baseUrl: "https://www.socialcrawl.dev" };
const ANON: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };

async function connect(ctx: ApiContext, legacyTools = false): Promise<Client> {
  const server = createServer(ctx, { legacyTools });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "client-level-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function text(result: Record<string, unknown>): string {
  return (result.content as Array<{ text: string }>)[0].text;
}

function stubFetch(status: number, payload: unknown): { urls: string[] } {
  const seen = { urls: [] as string[] };
  vi.stubGlobal("fetch", async (url: string) => {
    seen.urls.push(url);
    return new Response(JSON.stringify(payload), { status });
  });
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("socialcrawl_list_endpoints (legacy) over a real client", () => {
  it("honours hydrating:true instead of dropping it", async () => {
    const client = await connect(ANON, true);
    const hydratingCount = ENDPOINTS.filter((e) => (e.hydration?.length ?? 0) > 0).length;
    expect(hydratingCount).toBeGreaterThan(0);
    expect(hydratingCount).toBeLessThan(ENDPOINTS.length);

    const all = await client.callTool({
      name: "socialcrawl_list_endpoints",
      arguments: { detail: "compact" },
    });
    const filtered = await client.callTool({
      name: "socialcrawl_list_endpoints",
      arguments: { hydrating: true, detail: "compact" },
    });
    expect(text(filtered)).toContain(`${hydratingCount} of ${ENDPOINTS.length} endpoints match`);
    expect(text(filtered)).not.toBe(text(all));
    expect(text(filtered).length).toBeLessThan(text(all).length);
    await client.close();
  });
});

describe("socialcrawl_request params over a real client", () => {
  it("accepts numbers and booleans and sends them as strings", async () => {
    const seen = stubFetch(200, { success: true, data: {} });
    const client = await connect(KEYED);
    const result = await client.callTool({
      name: "socialcrawl_request",
      arguments: {
        platform: "tiktok",
        resource: "search",
        params: { query: "cooking", limit: 30, trim: true },
      },
    });
    expect(result.isError).toBeFalsy();
    const url = new URL(seen.urls[0]);
    expect(url.searchParams.get("limit")).toBe("30");
    expect(url.searchParams.get("trim")).toBe("true");
    await client.close();
  });

  it("joins array values with commas for CSV params", async () => {
    const seen = stubFetch(200, { success: true, data: {} });
    const client = await connect(KEYED);
    const result = await client.callTool({
      name: "socialcrawl_request",
      arguments: {
        platform: "tiktok",
        resource: "post/comments",
        params: { url: "https://www.tiktok.com/@a/video/1", label: ["sentiment", "spam"] },
      },
    });
    expect(result.isError).toBeFalsy();
    expect(new URL(seen.urls[0]).searchParams.get("label")).toBe("sentiment,spam");
    await client.close();
  });

  it("still applies local range validation to numeric values", async () => {
    const seen = stubFetch(200, { success: true });
    const client = await connect(KEYED);
    const result = await client.callTool({
      name: "socialcrawl_request",
      arguments: { platform: "tiktok", resource: "search", params: { query: "x", limit: 500 } },
    });
    expect(text(result)).toContain("above the maximum of 120");
    expect(result.isError).toBe(true);
    expect(seen.urls).toHaveLength(0);
    await client.close();
  });
});

describe("tool annotations are honest", () => {
  it("publishes the expected hints for every tool", async () => {
    const client = await connect(ANON);
    const { tools } = await client.listTools();
    const hints = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));

    expect(hints.socialcrawl_request).toMatchObject({
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
    for (const name of ["socialcrawl_find", "socialcrawl_endpoint", "socialcrawl_estimate", "socialcrawl_account"]) {
      expect(hints[name], name).toMatchObject({
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: true,
      });
    }
    expect(hints.socialcrawl_manage).toMatchObject({ readOnlyHint: false, idempotentHint: false, openWorldHint: true });
    await client.close();

    // The 1.x names keep their 1.x hints behind the legacy flag.
    const legacy = await connect(ANON, true);
    const old = Object.fromEntries((await legacy.listTools()).tools.map((t) => [t.name, t.annotations]));
    for (const name of [
      "socialcrawl_list_platforms",
      "socialcrawl_list_endpoints",
      "socialcrawl_pricing",
      "socialcrawl_get_docs",
    ]) {
      expect(old[name], name).toMatchObject({
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
    }
    for (const name of ["socialcrawl_check_balance", "socialcrawl_discover"]) {
      expect(old[name], name).toMatchObject({
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: true,
      });
    }
    for (const name of ["socialcrawl_monitors", "socialcrawl_web", "socialcrawl_cohorts"]) {
      expect(old[name], name).toMatchObject({
        readOnlyHint: false,
        idempotentHint: false,
        openWorldHint: true,
      });
    }
    await legacy.close();
  });
});

describe("tool-level errors set isError", () => {
  it("is not set on success", async () => {
    const client = await connect(ANON);
    const result = await client.callTool({ name: "socialcrawl_find", arguments: {} });
    expect(result.isError).toBeFalsy();
    await client.close();
  });

  it("missing API key", async () => {
    const client = await connect(ANON);
    const result = await client.callTool({ name: "socialcrawl_account", arguments: {} });
    expect(text(result)).toContain("No API key configured");
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("local validation failure (missing required param)", async () => {
    const seen = stubFetch(200, {});
    const client = await connect(KEYED);
    const result = await client.callTool({
      name: "socialcrawl_request",
      arguments: { platform: "tiktok", resource: "search", params: {} },
    });
    expect(text(result)).toContain("Missing required parameter");
    expect(result.isError).toBe(true);
    expect(seen.urls).toHaveLength(0);
    await client.close();
  });

  it("unknown platform and unknown docs topic", async () => {
    const client = await connect(KEYED);
    const docs = await client.callTool({
      name: "socialcrawl_endpoint",
      arguments: { id: "no-such-topic-xyz" },
    });
    expect(text(docs)).toContain("Error: Unknown endpoint, platform or topic");
    expect(docs.isError).toBe(true);
    const estimate = await client.callTool({
      name: "socialcrawl_estimate",
      arguments: { id: "tiktk/profile" },
    });
    expect(estimate.isError).toBe(true);
    const request = await client.callTool({
      name: "socialcrawl_request",
      arguments: { platform: "tiktk", resource: "profile" },
    });
    expect(request.isError).toBe(true);
    expect(request.structuredContent).toMatchObject({ code: "UNKNOWN_PLATFORM", did_you_mean: ["tiktok"] });
    await client.close();
  });

  it("HTTP error through socialcrawl_request keeps its header and sets isError", async () => {
    stubFetch(401, { error: { type: "UNAUTHORIZED", message: "bad key" } });
    const client = await connect(KEYED);
    const result = await client.callTool({
      name: "socialcrawl_request",
      arguments: { platform: "tiktok", resource: "search", params: { query: "x" } },
    });
    expect(text(result)).toContain("Error: Invalid API key");
    expect(text(result)).toContain("## SocialCrawl API Response");
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("HTTP error through socialcrawl_account", async () => {
    stubFetch(402, { error: { type: "INSUFFICIENT_CREDITS", message: "none" }, credits_remaining: 0 });
    const client = await connect(KEYED);
    const result = await client.callTool({ name: "socialcrawl_account", arguments: {} });
    expect(text(result)).toContain("Insufficient credits");
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("unmapped HTTP status (Error (500): ...) is still an error", async () => {
    stubFetch(500, { error: { type: "INTERNAL", message: "boom" } });
    const client = await connect(KEYED);
    const result = await client.callTool({
      name: "socialcrawl_request",
      arguments: { platform: "tiktok", resource: "search", params: { query: "x" } },
    });
    expect(text(result)).toContain("Error (500)");
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("network error", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const client = await connect(KEYED);
    const result = await client.callTool({
      name: "socialcrawl_request",
      arguments: { platform: "tiktok", resource: "search", params: { query: "x" } },
    });
    expect(text(result)).toContain("Could not reach SocialCrawl API");
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("errors from manage (monitors, web, cohorts, jobs)", async () => {
    stubFetch(404, { error: { type: "NOT_FOUND", message: "nope" } });
    const client = await connect(KEYED);
    const calls: Array<[string, Record<string, unknown>]> = [
      ["socialcrawl_manage", { area: "monitors", action: "get" }],
      ["socialcrawl_manage", { area: "web", action: "job_get" }],
      ["socialcrawl_manage", { area: "cohorts", action: "get" }],
      ["socialcrawl_manage", { area: "jobs", action: "get" }],
      ["socialcrawl_manage", { area: "jobs", action: "get", id: "job_1" }],
    ];
    for (const [name, args] of calls) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
    await client.close();
  });
});
