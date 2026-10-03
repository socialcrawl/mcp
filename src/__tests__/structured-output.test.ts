import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { ENDPOINTS } from "../data/endpoints.js";
import { REGISTRY_FINGERPRINT } from "../data/registry-meta.js";
import { RequestOutputSchema } from "../schemas/outputs.js";
import { INSTRUCTIONS } from "../instructions.js";
import type { ApiContext } from "../context.js";

const KEYED: ApiContext = { apiKey: "sc_test_key_1234567890", baseUrl: "https://www.socialcrawl.dev" };
const ANON: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };

async function connect(ctx: ApiContext): Promise<Client> {
  const server = createServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "structured-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function stub(status: number, payload: unknown): void {
  vi.stubGlobal(
    "fetch",
    async () => new Response(JSON.stringify(payload), { status, headers: { "x-request-id": "req-hdr" } }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const text = (r: Record<string, unknown>): string => (r.content as Array<{ text: string }>)[0].text;
type Sc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function paramsFor(platform: string, resource: string): Record<string, string> {
  const e = ENDPOINTS.find((x) => x.platform === platform && x.resource === resource)!;
  const out: Record<string, string> = {};
  for (const p of e.params.filter((q) => q.required)) out[p.name] = p.example;
  if (Object.keys(out).length === 0 && e.oneOfGroups[0]) {
    const name = e.oneOfGroups[0][0];
    out[name] = e.params.find((q) => q.name === name)?.example ?? "x";
  }
  return out;
}

const okEnv = (data: unknown, extra: Record<string, unknown> = {}) => ({
  success: true,
  platform: "x",
  endpoint: "/v1/x",
  data,
  credits_used: 1,
  credits_remaining: 2481,
  request_id: "req-ok1",
  cached: false,
  ...extra,
});
const errEnv = (type: string, message: string, status: number, extra: Record<string, unknown> = {}) => ({
  success: false,
  error: { type, message, status, ...extra },
  credits_used: 0,
  credits_remaining: 12,
  request_id: "req-err1",
});

interface Fixture {
  name: string;
  platform: string;
  resource: string;
  status: number;
  payload: unknown;
  check: (sc: Sc) => void;
}

const FIXTURES: Fixture[] = [
  {
    name: "single object (tiktok/profile)",
    platform: "tiktok", resource: "profile", status: 200,
    payload: okEnv({ handle: "a", followers: 10 }),
    check: (sc) => {
      expect(sc.ok).toBe(true);
      expect(sc.endpoint).toBe("tiktok/profile");
      expect(sc.credits).toMatchObject({ used: 1, remaining: 2481, cached: false });
      expect(sc.request_id).toBe("req-ok1");
      expect(sc.data).toEqual({ handle: "a", followers: 10 });
    },
  },
  {
    name: "list with paging, metered (tiktok/post/comments)",
    platform: "tiktok", resource: "post/comments", status: 200,
    payload: okEnv({ items: [{ id: 1 }, { id: 2 }], total: 2, dropped: 0 }, {
      credits_used: 10,
      pagination: { next_cursor: "sc.abc", has_more: true, page_size: 30 },
    }),
    check: (sc) => {
      expect(sc.rows).toHaveLength(2);
      expect(sc.paging).toEqual({ has_more: true, next_cursor: "sc.abc" });
      expect(sc.page).toMatchObject({ total: 2, dropped: 0 });
      expect(sc.credits.used).toBe(10);
      expect(sc.credits.quoted_max).toBeGreaterThan(0);
    },
  },
  {
    name: "cached hit (instagram/profile)",
    platform: "instagram", resource: "profile", status: 200,
    payload: okEnv({ handle: "instagram" }, { credits_used: 0, cached: true }),
    check: (sc) => expect(sc.credits).toMatchObject({ used: 0, cached: true }),
  },
  {
    name: "last page (facebook/search/posts)",
    platform: "facebook", resource: "search/posts", status: 200,
    payload: okEnv({ items: [] }, { pagination: { next_cursor: null, has_more: false } }),
    check: (sc) => expect(sc.paging).toEqual({ has_more: false, next_cursor: null }),
  },
  {
    name: "warnings and hint (twitter/profile)",
    platform: "twitter", resource: "profile", status: 200,
    payload: okEnv({ handle: "e", _warnings: ["param `foo` dropped"] }, { hint: { next: "twitter/profile/tweets" } }),
    check: (sc) => {
      expect(sc.warnings).toEqual(["param `foo` dropped"]);
      expect(sc.hint).toEqual({ next: "twitter/profile/tweets" });
    },
  },
  {
    name: "402 insufficient credits (youtube/video)",
    platform: "youtube", resource: "video", status: 402,
    payload: errEnv("INSUFFICIENT_CREDITS", "No credits left.", 402),
    check: (sc) => {
      expect(sc).toMatchObject({ ok: false, code: "INSUFFICIENT_CREDITS", retryable: false, request_id: "req-err1" });
      expect(sc.fix).toMatch(/top up|billing/i);
    },
  },
  {
    name: "400 with did_you_mean (tiktok/search)",
    platform: "tiktok", resource: "search", status: 400,
    payload: errEnv("VALIDATION_ERROR", "Invalid `region`: use an ISO code.", 400, {
      details: { reason: "bad_region", did_you_mean: "KR" },
    }),
    check: (sc) => {
      expect(sc).toMatchObject({ ok: false, retryable: false, reason: "bad_region" });
      expect(sc.did_you_mean).toEqual(["KR"]);
    },
  },
  {
    name: "429 rate limit (reddit/search)",
    platform: "reddit", resource: "search", status: 429,
    payload: errEnv("RATE_LIMITED", "Too many concurrent requests.", 429),
    check: (sc) => expect(sc).toMatchObject({ ok: false, code: "RATE_LIMITED", retryable: true }),
  },
  {
    name: "502 upstream (linkedin/profile)",
    platform: "linkedin", resource: "profile", status: 502,
    payload: errEnv("UPSTREAM_ERROR", "The data source failed.", 502),
    check: (sc) => expect(sc).toMatchObject({ ok: false, code: "UPSTREAM_ERROR", retryable: true }),
  },
  {
    name: "401 bad key (tiktok/profile)",
    platform: "tiktok", resource: "profile", status: 401,
    payload: errEnv("UNAUTHORIZED", "bad key", 401),
    check: (sc) => expect(sc).toMatchObject({ ok: false, code: "UNAUTHORIZED", retryable: false }),
  },
];

describe("socialcrawl_request structured output", () => {
  it("advertises an outputSchema on request, collect, account, estimate, find and endpoint", async () => {
    const client = await connect(ANON);
    const { tools } = await client.listTools();
    for (const name of [
      "socialcrawl_request",
      "socialcrawl_collect",
      "socialcrawl_account",
      "socialcrawl_estimate",
      "socialcrawl_find",
      "socialcrawl_endpoint",
    ]) {
      const t = tools.find((x) => x.name === name)!;
      expect(t.outputSchema, name).toBeDefined();
      expect((t.outputSchema as { type: string }).type).toBe("object");
    }
    await client.close();
  });

  for (const f of FIXTURES) {
    it(`produces valid structuredContent: ${f.name}`, async () => {
      stub(f.status, f.payload);
      const client = await connect(KEYED);
      const result = await client.callTool({
        name: "socialcrawl_request",
        arguments: { platform: f.platform, resource: f.resource, params: paramsFor(f.platform, f.resource) },
      });
      expect(result.isError ?? false).toBe(f.status >= 400);
      const sc = result.structuredContent as Sc;
      expect(sc).toBeDefined();
      expect(RequestOutputSchema.safeParse(sc).success).toBe(true);
      expect(sc.ok).toBe(f.status < 400);
      f.check(sc);
      await client.close();
    });
  }

  it("structures local errors (unknown platform, missing param) too", async () => {
    const client = await connect(KEYED);
    const a = await client.callTool({ name: "socialcrawl_request", arguments: { platform: "tiktok", resource: "not-a-resource" } });
    expect(a.isError).toBe(true);
    expect(a.structuredContent).toMatchObject({ ok: false, retryable: false });
    const b = await client.callTool({ name: "socialcrawl_request", arguments: { platform: "tiktok", resource: "post/comments" } });
    expect(b.structuredContent).toMatchObject({ ok: false, code: "MISSING_PARAMETER", retryable: false });
    await client.close();
  });

  it("text content is a short summary plus compact JSON, at least 25% smaller than pretty-printed", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`,
      author: { handle: `user${i}`, verified: false, stats: { followers: i * 10, following: 3 } },
      text: `comment number ${i}`,
      engagement: { likes: i, replies: 0 },
      computed: { sentiment: "neutral", spam: false },
    }));
    const payload = okEnv({ items: rows, total: 40 }, { pagination: { next_cursor: "sc.x", has_more: true } });
    stub(200, payload);
    const client = await connect(KEYED);
    const result = await client.callTool({
      name: "socialcrawl_request",
      arguments: { platform: "tiktok", resource: "post/comments", params: paramsFor("tiktok", "post/comments") },
    });
    const out = text(result);
    expect(out).toContain(JSON.stringify(payload));
    expect(out).not.toContain('{\n  "success"');
    const pretty = JSON.stringify(payload, null, 2).length;
    const compact = JSON.stringify(payload).length;
    const before = out.length - compact + pretty;
    expect(out.length).toBeLessThanOrEqual(before * 0.75);
    // summary is 2-4 lines of prose before the JSON fence
    expect(out).toMatch(/credits used 1, 2481 remaining/);
    await client.close();
  });
});

describe("other structured tools", () => {
  it("account returns structured balance and structured errors", async () => {
    stub(200, okEnv({ balance: 8432, recent_deductions: { last_24h: 1 } }, { credits_used: 0, credits_remaining: 8432 }));
    let client = await connect(KEYED);
    let r = await client.callTool({ name: "socialcrawl_account", arguments: {} });
    expect(r.structuredContent).toMatchObject({ ok: true, view: "balance", credits: { remaining: 8432 } });
    await client.close();

    client = await connect(ANON);
    r = await client.callTool({ name: "socialcrawl_account", arguments: {} });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ ok: false, code: "NO_API_KEY", retryable: false });
    await client.close();
  });

  it("estimate returns a structured quote for an endpoint and ok for the overview", async () => {
    const client = await connect(ANON);
    const q = await client.callTool({
      name: "socialcrawl_estimate",
      arguments: { id: "tiktok/post/comments" },
    });
    const sc = q.structuredContent as Sc;
    expect(sc.ok).toBe(true);
    expect(sc.quote).toMatchObject({ endpoint: "tiktok/post/comments", model: "metered" });
    expect(sc.quote.max_credits).toBeGreaterThanOrEqual(sc.quote.min_credits);
    const o = await client.callTool({ name: "socialcrawl_estimate", arguments: {} });
    expect(o.structuredContent).toMatchObject({ ok: true });
    const bad = await client.callTool({
      name: "socialcrawl_estimate",
      arguments: { id: "tiktok/post/comment" },
    });
    expect(bad.isError).toBe(true);
    expect(bad.structuredContent).toMatchObject({ ok: false });
    expect((bad.structuredContent as Sc).did_you_mean).toContain("tiktok/post/comments");
    await client.close();
  });
});

describe("server instructions", () => {
  it("are sent at connect time, within 2000 chars, with the key rules", async () => {
    const client = await connect(ANON);
    const instructions = client.getInstructions()!;
    expect(instructions).toBe(INSTRUCTIONS);
    expect(instructions.length).toBeLessThanOrEqual(2000);
    expect(instructions).toContain(REGISTRY_FINGERPRINT.slice(0, 12));
    expect(instructions).toMatch(/credits\.used/);
    expect(instructions).toMatch(/has_more/);
    expect(instructions).toMatch(/never retry/i);
    expect(instructions).toMatch(/untrusted/i);
    expect(instructions).toMatch(/injection/);
    await client.close();
  });
});
