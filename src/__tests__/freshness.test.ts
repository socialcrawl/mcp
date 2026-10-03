import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { probeFreshness, startFreshnessCheck, resetFreshness, STALE_LINE } from "../freshness.js";
import { REGISTRY_FINGERPRINT, REGISTRY_STATS } from "../data/registry-meta.js";
import type { ApiContext } from "../context.js";

const KEYED: ApiContext = { apiKey: "sc_test_key_1234567890", baseUrl: "https://www.socialcrawl.dev" };
const ANON: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const countsEnvelope = (endpoints: number, platforms = REGISTRY_STATS.totalPlatforms): Response =>
  json({ success: true, data: { stats: { platforms, endpoints }, total: 0, endpoints: [] } });

beforeEach(() => {
  resetFreshness();
  vi.stubEnv("SOCIALCRAWL_FRESHNESS_CHECK", "1");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("probeFreshness", () => {
  it("is fresh when the live fingerprint matches the bundled one", async () => {
    const f = fakeFetch(() => json({ success: true, data: { fingerprint: REGISTRY_FINGERPRINT } }));
    expect(await probeFreshness(KEYED, { fetchImpl: f.impl })).toBe("fresh");
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe("https://www.socialcrawl.dev/v1/utility/endpoints?fingerprint=1");
    expect((f.calls[0].init?.headers as Record<string, string>)["x-api-key"]).toBe(KEYED.apiKey);
  });

  it("accepts a bare {fingerprint} body", async () => {
    const f = fakeFetch(() => json({ fingerprint: "0".repeat(64) }));
    expect(await probeFreshness(KEYED, { fetchImpl: f.impl })).toBe("stale");
  });

  it("is stale when the fingerprints differ", async () => {
    const f = fakeFetch(() => json({ success: true, data: { fingerprint: "f".repeat(64) } }));
    expect(await probeFreshness(KEYED, { fetchImpl: f.impl })).toBe("stale");
  });

  it("falls back to the count check on 404 (route not deployed)", async () => {
    const f = fakeFetch((url) =>
      url.includes("fingerprint=1") ? json({ success: false }, 404) : countsEnvelope(REGISTRY_STATS.totalEndpoints),
    );
    expect(await probeFreshness(KEYED, { fetchImpl: f.impl })).toBe("fresh");
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1].url).toContain("/v1/utility/endpoints?search=");
  });

  it("count fallback flags a live registry with more endpoints", async () => {
    const f = fakeFetch((url) =>
      url.includes("fingerprint=1") ? json({}, 404) : countsEnvelope(REGISTRY_STATS.totalEndpoints + 5),
    );
    expect(await probeFreshness(KEYED, { fetchImpl: f.impl })).toBe("stale");
  });

  it("falls back when a 200 carries no fingerprint", async () => {
    const f = fakeFetch((url) =>
      url.includes("fingerprint=1") ? json({ success: true, data: {} }) : countsEnvelope(REGISTRY_STATS.totalEndpoints),
    );
    expect(await probeFreshness(KEYED, { fetchImpl: f.impl })).toBe("fresh");
  });

  it("is unknown (silent) when offline", async () => {
    const f = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await probeFreshness(KEYED, { fetchImpl: f.impl })).toBe("unknown");
  });

  it("is unknown without a key and makes no request", async () => {
    const f = fakeFetch(() => json({}));
    expect(await probeFreshness(ANON, { fetchImpl: f.impl })).toBe("unknown");
    expect(f.calls).toHaveLength(0);
  });

  it("gives up after the timeout", async () => {
    const f = fakeFetch(
      (_u, init) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
        }),
    );
    const started = Date.now();
    expect(await probeFreshness(KEYED, { fetchImpl: f.impl, timeoutMs: 40 })).toBe("unknown");
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe("startFreshnessCheck", () => {
  it("runs once per base URL per process", async () => {
    const f = fakeFetch(() => json({ success: true, data: { fingerprint: "f".repeat(64) } }));
    vi.stubGlobal("fetch", f.impl);
    expect(await startFreshnessCheck(KEYED)).toBe(true);
    expect(await startFreshnessCheck(KEYED)).toBe(true);
    expect(f.calls).toHaveLength(1);
  });

  it("does not spend the one check on a keyless caller", async () => {
    const f = fakeFetch(() => json({ success: true, data: { fingerprint: REGISTRY_FINGERPRINT } }));
    vi.stubGlobal("fetch", f.impl);
    expect(await startFreshnessCheck(ANON)).toBe(false);
    expect(f.calls).toHaveLength(0);
    expect(await startFreshnessCheck(KEYED)).toBe(false);
    expect(f.calls).toHaveLength(1);
  });

  it("can be switched off", async () => {
    vi.stubEnv("SOCIALCRAWL_FRESHNESS_CHECK", "off");
    const f = fakeFetch(() => json({}));
    vi.stubGlobal("fetch", f.impl);
    expect(await startFreshnessCheck(KEYED)).toBe(false);
    expect(f.calls).toHaveLength(0);
  });
});

async function connect(ctx: ApiContext): Promise<Client> {
  const server = createServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "freshness-test", version: "0.0.0" });
  await client.connect(a);
  return client;
}

const textOf = (r: Record<string, unknown>): string => (r.content as Array<{ text: string }>)[0].text;

function routedFetch(fingerprintBody: unknown) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    if (url.includes("fingerprint=1")) return json(fingerprintBody);
    return json({ success: true, data: { items: [{ id: "1" }] }, credits_used: 1, credits_remaining: 9 });
  });
  return urls;
}

describe("freshness through a real client", () => {
  const call = { name: "socialcrawl_request", arguments: { platform: "tiktok", resource: "search", params: { query: "x" } } };

  it("adds one line to the NEXT result and a structured warning when stale", async () => {
    routedFetch({ success: true, data: { fingerprint: "f".repeat(64) } });
    await startFreshnessCheck(KEYED);
    const client = await connect(KEYED);
    const first = await client.callTool(call);
    expect(textOf(first)).toContain(STALE_LINE);
    expect((first.structuredContent as { warnings?: string[] }).warnings).toContain(STALE_LINE);
    const second = await client.callTool(call);
    expect(textOf(second)).not.toContain(STALE_LINE);
    expect((second.structuredContent as { warnings?: string[] }).warnings ?? []).not.toContain(STALE_LINE);
    await client.close();
  });

  it("adds the line to a tool without structured output as text only", async () => {
    routedFetch({ success: true, data: { fingerprint: "f".repeat(64) } });
    await startFreshnessCheck(KEYED);
    const client = await connect(KEYED);
    const r = await client.callTool({ name: "socialcrawl_manage", arguments: { area: "monitors", action: "list" } });
    expect(textOf(r)).toContain(STALE_LINE);
    await client.close();
  });

  it("says nothing when the catalogue is current", async () => {
    routedFetch({ success: true, data: { fingerprint: REGISTRY_FINGERPRINT } });
    await startFreshnessCheck(KEYED);
    const client = await connect(KEYED);
    const r = await client.callTool(call);
    expect(textOf(r)).not.toContain(STALE_LINE);
    await client.close();
  });

  it("says nothing when offline", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/v1/utility/")) throw new TypeError("fetch failed");
      return json({ success: true, data: { items: [] } });
    });
    await startFreshnessCheck(KEYED);
    const client = await connect(KEYED);
    const r = await client.callTool(call);
    expect(textOf(r)).not.toContain(STALE_LINE);
    await client.close();
  });
});
