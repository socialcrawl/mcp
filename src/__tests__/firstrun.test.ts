import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { resetSessionSpend } from "../session-spend.js";
import type { ApiContext } from "../context.js";
import { expectValidOutput, valuesAt } from "./helpers/output-schema.js";

/**
 * FIX-mcp-firstrun: what eight fresh agents tripped over on real jobs. Every
 * call here goes through a real MCP client, so the SDK's own input and output
 * validation is part of what is tested.
 */

const KEYED: ApiContext = { apiKey: "sc_test_key_1234567890", baseUrl: "https://www.socialcrawl.dev" };
const ANON: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };

interface Call {
  method: string;
  path: string;
  url: URL;
  body?: unknown;
}
type Handler = (c: Call) => { status?: number; body: unknown } | undefined;

/** A fake API: the first handler that answers wins; anything else is a 404. Records every call. */
function fakeApi(...handlers: Handler[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const call: Call = {
      method: (init?.method ?? "GET").toUpperCase(),
      path: url.pathname,
      url,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    for (const h of handlers) {
      const r = h(call);
      if (r) return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "x-request-id": "req-hdr" } });
    }
    return new Response(JSON.stringify({ success: false, error: { type: "ENDPOINT_NOT_FOUND", message: `Unknown endpoint: ${call.path}.` } }), { status: 404 });
  });
  return calls;
}

const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  success: true,
  data: { items, pagination: { has_more: false, next_cursor: null } },
  credits_used: 1,
  credits_remaining: 90,
  request_id: `req-${Math.random().toString(36).slice(2, 10)}`,
  ...extra,
});

async function connect(ctx: ApiContext): Promise<Client> {
  const server = createServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "firstrun-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

type Res = { isError?: boolean; content: Array<{ type: string; text?: string }>; structuredContent?: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(ctx: ApiContext, name: string, args: Record<string, unknown>): Promise<Res> {
  const client = await connect(ctx);
  return (await client.callTool({ name, arguments: args })) as Res;
}

const text = (r: Res): string => r.content.map((c) => c.text ?? "").join("\n");

afterEach(() => {
  vi.unstubAllGlobals();
  resetSessionSpend();
});

// ── 1. Argument shapes ──────────────────────────────────────────────────

describe("one endpoint-naming shape for every tool", () => {
  const profile = () => fakeApi((c) => (c.path === "/v1/tiktok/profile" ? { body: { success: true, data: { handle: "x" }, credits_used: 1, request_id: "r1" } } : undefined));

  it("socialcrawl_request takes id 'platform/resource'", async () => {
    const calls = profile();
    const r = await call(KEYED, "socialcrawl_request", { id: "tiktok/profile", params: { handle: "x" } });
    expect(r.isError).toBeFalsy();
    expect(calls.some((c) => c.path === "/v1/tiktok/profile")).toBe(true);
    expectValidOutput("socialcrawl_request", r.structuredContent);
  });

  it("socialcrawl_request takes path '/v1/platform/resource'", async () => {
    const calls = profile();
    const r = await call(KEYED, "socialcrawl_request", { path: "/v1/tiktok/profile", params: { handle: "x" } });
    expect(r.isError).toBeFalsy();
    expect(calls.some((c) => c.path === "/v1/tiktok/profile")).toBe(true);
  });

  it("socialcrawl_collect takes platform + resource, and path", async () => {
    const calls = fakeApi((c) => (c.path === "/v1/tiktok/post/comments" ? { body: page([{ id: "1" }, { id: "2" }]) } : undefined));
    const a = await call(KEYED, "socialcrawl_collect", { platform: "tiktok", resource: "post/comments", params: { url: "https://www.tiktok.com/@a/video/1" }, items: 2 });
    expect(a.isError).toBeFalsy();
    expectValidOutput("socialcrawl_collect", a.structuredContent);
    const b = await call(KEYED, "socialcrawl_collect", { path: "/v1/tiktok/post/comments", params: { url: "https://www.tiktok.com/@a/video/1" }, items: 2 });
    expect(b.isError).toBeFalsy();
    expect(calls.filter((c) => c.path === "/v1/tiktok/post/comments")).toHaveLength(2);
  });

  it("socialcrawl_estimate takes platform + resource", async () => {
    const r = await call(ANON, "socialcrawl_estimate", { platform: "tiktok", resource: "profile", params: { handle: "x" } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.quote?.endpoint).toBe("tiktok/profile");
    expectValidOutput("socialcrawl_estimate", r.structuredContent);
  });

  it("socialcrawl_estimate takes path, and platform alone for the price table", async () => {
    const a = await call(ANON, "socialcrawl_estimate", { path: "/v1/tiktok/profile" });
    expect(a.structuredContent?.quote?.endpoint).toBe("tiktok/profile");
    const b = await call(ANON, "socialcrawl_estimate", { platform: "tiktok" });
    expect(b.isError).toBeFalsy();
    expect(text(b)).toMatch(/tiktok/i);
  });

  it("socialcrawl_endpoint takes platform + resource, and path", async () => {
    const a = await call(ANON, "socialcrawl_endpoint", { platform: "tiktok", resource: "profile" });
    expect(a.isError).toBeFalsy();
    expect(a.structuredContent?.id).toBe("tiktok/profile");
    expectValidOutput("socialcrawl_endpoint", a.structuredContent);
    const b = await call(ANON, "socialcrawl_endpoint", { path: "/v1/tiktok/profile" });
    expect(b.structuredContent?.id).toBe("tiktok/profile");
  });

  it("estimate plan entries take platform + resource and path too", async () => {
    const r = await call(ANON, "socialcrawl_estimate", {
      plan: [
        { platform: "tiktok", resource: "profile", params: { handle: "x" } },
        { path: "/v1/tiktok/post/comments", params: { url: "https://www.tiktok.com/@a/video/1" } },
      ],
    });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.plan?.calls).toHaveLength(2);
    expectValidOutput("socialcrawl_estimate", r.structuredContent);
  });

  it("estimate reads an array given as `calls` as the plan", async () => {
    const r = await call(ANON, "socialcrawl_estimate", { calls: [{ id: "tiktok/profile", params: { handle: "x" } }, { id: "tiktok/profile", params: { handle: "y" } }] });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.plan?.calls).toHaveLength(2);
  });

  it("`fields` takes an array of strings as well as a comma string", async () => {
    const calls = fakeApi((c) => (c.path === "/v1/tiktok/post/comments" ? { body: page([{ id: "1", text: "a" }]) } : undefined));
    const r = await call(KEYED, "socialcrawl_request", {
      id: "tiktok/post/comments",
      params: { url: "https://www.tiktok.com/@a/video/1" },
      fields: ["id", "text"],
    });
    expect(r.isError).toBeFalsy();
    const sent = calls.find((c) => c.path === "/v1/tiktok/post/comments")!;
    expect(sent.url.searchParams.get("fields")).toBe("id,text");
    const c = await call(KEYED, "socialcrawl_collect", { id: "tiktok/post/comments", params: { url: "https://www.tiktok.com/@a/video/1" }, items: 1, fields: ["id"] });
    expect(c.isError).toBeFalsy();
  });

  it("an unknown key names the right one instead of a bare unrecognized_keys", async () => {
    const r = await call(ANON, "socialcrawl_request", { endpoint: "tiktok/profile", params: { handle: "x" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/use id, or platform\+resource/);
    expect(text(r)).not.toMatch(/unrecognized_keys/);
    const c = await call(ANON, "socialcrawl_collect", { id: "tiktok/post/comments", items: 5, max_items: 5 });
    expect(c.isError).toBe(true);
    expect(text(c)).toMatch(/max_items/);
    expect(text(c)).toMatch(/items/);
  });

  it("no endpoint named at all says the three ways to name one", async () => {
    const r = await call(ANON, "socialcrawl_request", { params: { handle: "x" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/id/);
    expect(text(r)).toMatch(/platform\+resource/);
    expect(text(r)).toMatch(/path/);
  });

  it("keeps the advertised schemas compact and documents the alternatives in the descriptions", async () => {
    const client = await connect(ANON);
    const { tools } = await client.listTools();
    const by = (n: string) => tools.find((t) => t.name === n)!;
    for (const name of ["socialcrawl_request", "socialcrawl_collect", "socialcrawl_estimate", "socialcrawl_endpoint"]) {
      const props = Object.keys((by(name).inputSchema as { properties: Record<string, unknown> }).properties);
      expect(props).not.toContain("path");
      expect(by(name).description).toMatch(/platform\+resource/);
    }
  });
});

// ── 2/3. find: ready calls, a quote per result, monitors ──────────────────

const findApi = (results: unknown[], extra: Record<string, unknown> = {}): Handler => (c) =>
  c.path === "/v1/utility/find"
    ? { body: { success: true, data: { kind: "endpoint_find", uncertain: false, reason: "routed", source: "router", confidence: 1, results, ...extra } } }
    : undefined;

describe("socialcrawl_find: ready calls with the filled params", () => {
  it("puts the API's params_filled into the Call example", async () => {
    fakeApi(findApi([{ id: "amazon/reviews", method: "GET", params_filled: { asin: "B0BSHF7WHW" }, missing: [], estimated_credits: 5 }]));
    const r = await call(KEYED, "socialcrawl_find", { task: "amazon reviews for the product B0BSHF7WHW" });
    expect(r.isError).toBeFalsy();
    const top = r.structuredContent!.results[0];
    expect(top.params_filled).toEqual({ asin: "B0BSHF7WHW" });
    expect(top.params_missing).toEqual([]);
    expect(top.call).toMatchObject({ tool: "socialcrawl_request", arguments: { platform: "amazon", resource: "reviews", params: { asin: "B0BSHF7WHW" } } });
    expect(text(r)).toContain('"params":{"asin":"B0BSHF7WHW"}');
    expectValidOutput("socialcrawl_find", r.structuredContent);
  });

  it("puts a POST endpoint's filled params in body, the way socialcrawl_request expects", async () => {
    fakeApi(findApi([{ id: "prism/post-stats", method: "POST", params_filled: { urls: "https://www.tiktok.com/@a/video/1" }, missing: [] }]));
    const r = await call(KEYED, "socialcrawl_find", { task: "stats for https://www.tiktok.com/@a/video/1" });
    const top = r.structuredContent!.results[0];
    expect(top.call.arguments).toMatchObject({ platform: "prism", resource: "post-stats", body: { urls: "https://www.tiktok.com/@a/video/1" } });
    expect(top.call.arguments.params).toBeUndefined();
  });

  it("adds a one-line ready socialcrawl_estimate call per result", async () => {
    fakeApi(findApi([{ id: "amazon/reviews", method: "GET", params_filled: { asin: "B0BSHF7WHW" }, missing: [] }, { id: "amazon/deals", method: "GET", params_filled: {}, missing: [] }]));
    const r = await call(KEYED, "socialcrawl_find", { task: "amazon reviews for B0BSHF7WHW" });
    const [a, b] = r.structuredContent!.results;
    expect(a.estimate).toEqual({ tool: "socialcrawl_estimate", arguments: { id: "amazon/reviews", params: { asin: "B0BSHF7WHW" } } });
    expect(b.estimate).toMatchObject({ tool: "socialcrawl_estimate", arguments: { id: "amazon/deals" } });
    const lines = text(r).split("\n").filter((l) => l.includes("socialcrawl_estimate") && l.includes('"id":"amazon/'));
    expect(lines).toHaveLength(2);
    expectValidOutput("socialcrawl_find", r.structuredContent);
  });

  it("offline, the bundled ranker's results carry the estimate call too", async () => {
    fakeApi();
    const r = await call(ANON, "socialcrawl_find", { task: "tiktok profile of @scout2015" });
    const top = r.structuredContent!.results[0];
    expect(top.estimate).toEqual({ tool: "socialcrawl_estimate", arguments: { id: "tiktok/profile", params: { handle: "scout2015" } } });
  });
});

describe("socialcrawl_find: monitors and alerts", () => {
  it("an alert task also points at socialcrawl_manage monitors create with the recipe to schedule", async () => {
    fakeApi(findApi([{ id: "tiktok/profile/videos", method: "GET", params_filled: { handle: "mrbeast" }, missing: [] }]));
    const r = await call(KEYED, "socialcrawl_find", { task: "weekly alert when @mrbeast posts a new tiktok video" });
    expect(r.isError).toBeFalsy();
    const res = r.structuredContent!.results as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const m = res.find((x) => x.kind === "manage");
    expect(m).toBeDefined();
    expect(m!.call).toMatchObject({
      tool: "socialcrawl_manage",
      arguments: { area: "monitors", action: "create", dry_run: true, input: { recipe: "tiktok/profile/videos", params: { handle: "mrbeast" }, cadence: "weekly" } },
    });
    expect(m!.params_missing).toContain("webhook_url");
    // rows_new needs a track monitor: the suggestion sends one with it.
    expect(m!.call.arguments.input.alert_rules).toEqual([{ metric: "rows_new", op: "gt", value: 0 }]);
    expect(m!.call.arguments.input.track).toBeDefined();
    // The endpoint results are still there.
    expect(res.some((x) => x.id === "tiktok/profile/videos")).toBe(true);
    expect(text(r)).toMatch(/socialcrawl_manage/);
    expectValidOutput("socialcrawl_find", r.structuredContent);
  });

  it("a page-change task points at a web change monitor for that URL", async () => {
    fakeApi(findApi([{ id: "web/scrape", method: "GET", params_filled: { url: "https://example.com/pricing" }, missing: [] }]));
    const r = await call(KEYED, "socialcrawl_find", { task: "notify me when https://example.com/pricing changes" });
    const m = (r.structuredContent!.results as Array<Record<string, any>>).find((x) => x.kind === "manage"); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(m!.call).toMatchObject({ tool: "socialcrawl_manage", arguments: { area: "web", action: "monitor_create", dry_run: true, input: { url: "https://example.com/pricing" } } });
    expectValidOutput("socialcrawl_find", r.structuredContent);
  });

  it("works offline too", async () => {
    fakeApi();
    const r = await call(ANON, "socialcrawl_find", { task: "every day, watch @nasa on instagram and alert me on new posts" });
    const m = (r.structuredContent!.results as Array<Record<string, any>>).find((x) => x.kind === "manage"); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(m!.call.arguments).toMatchObject({ area: "monitors", action: "create", input: { cadence: "daily" } });
  });

  it("a one-off task gets no monitor pointer", async () => {
    fakeApi(findApi([{ id: "amazon/reviews", method: "GET", params_filled: { asin: "B0BSHF7WHW" }, missing: [] }]));
    const r = await call(KEYED, "socialcrawl_find", { task: "amazon reviews for B0BSHF7WHW" });
    expect((r.structuredContent!.results as Array<Record<string, unknown>>).some((x) => x.kind === "manage")).toBe(false);
  });
});

// ── 4. dry_run on manage ──────────────────────────────────────────────────

describe("socialcrawl_manage dry_run", () => {
  const monitorInput = { recipe: "tiktok/profile/videos", params: { handle: "mrbeast" }, cadence: "weekly", webhook_url: "https://example.com/hook" };

  /**
   * The capability probe: POST /v1/monitors with an empty body and dry_run=probe.
   * A route that reads dry_run refuses the value; one that ignores it refuses the
   * empty body. Neither can create anything.
   */
  const probe = (supported: boolean): Handler => (c) =>
    c.path === "/v1/monitors" && c.method === "POST" && c.url.searchParams.get("dry_run") === "probe"
      ? {
          status: 400,
          body: supported
            ? { success: false, error: { type: "INVALID_REQUEST", message: "dry_run takes 1 or true (validate and quote the call for 0 credits; nothing is fetched or charged), or 0 / false for a real call." } }
            : { error: { type: "INVALID_REQUEST", message: "Invalid input: expected string, received undefined" } },
        }
      : undefined;

  it("sends monitors create with ?dry_run=1 and returns the validation and quote", async () => {
    const calls = fakeApi(probe(true), (c) =>
      c.path === "/v1/monitors" && c.method === "POST"
        ? { body: { success: true, data: { valid: true, estimate: { hold: 0, estimated_cost_per_run: 2 } } } }
        : undefined,
    );
    const r = await call(KEYED, "socialcrawl_manage", { area: "monitors", action: "create", input: monitorInput, dry_run: true });
    expect(r.isError).toBeFalsy();
    const post = calls.find((c) => c.path === "/v1/monitors" && c.url.searchParams.get("dry_run") === "1")!;
    expect(post.body).toMatchObject({ recipe: "tiktok/profile/videos" });
    expect(text(r)).toMatch(/dry run/i);
    expect(text(r)).toMatch(/estimated_cost_per_run/);
  });

  it("refuses without sending the create when the API cannot dry-run monitors", async () => {
    const calls = fakeApi(probe(false), (c) =>
      c.path === "/v1/monitors" && c.method === "POST" ? { status: 201, body: { monitor: { id: "mon_123" }, webhook_secret: "whsec_x" } } : undefined,
    );
    const r = await call(KEYED, "socialcrawl_manage", { area: "monitors", action: "create", input: monitorInput, dry_run: true });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/dry_run is not supported/);
    expect(text(r)).toMatch(/nothing was sent/i);
    // Only the probe went out: an empty body that cannot create anything.
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({});
  });

  it("never keeps a monitor the API created anyway: deletes it at once and refuses", async () => {
    const calls = fakeApi(
      probe(true),
      (c) => (c.path === "/v1/monitors" && c.method === "POST" ? { status: 201, body: { monitor: { id: "mon_123", status: "active" }, webhook_secret: "whsec_x" } } : undefined),
      (c) => (c.path === "/v1/monitors/mon_123" && c.method === "DELETE" ? { body: { deleted: true } } : undefined),
    );
    const r = await call(KEYED, "socialcrawl_manage", { area: "monitors", action: "create", input: monitorInput, dry_run: true });
    expect(r.isError).toBe(true);
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/v1/monitors/mon_123")).toBe(true);
    expect(text(r)).toMatch(/dry_run/);
    expect(text(r)).toMatch(/deleted/);
    expect(text(r)).not.toContain("whsec_x");
  });

  it("accepts dry_run inside input as well", async () => {
    const calls = fakeApi(probe(true), (c) => (c.path === "/v1/monitors" ? { body: { success: true, data: { valid: true } } } : undefined));
    await call(KEYED, "socialcrawl_manage", { area: "monitors", action: "create", input: { ...monitorInput, dry_run: true } });
    const sent = calls.find((c) => c.path === "/v1/monitors" && c.url.searchParams.get("dry_run") === "1")!;
    expect(sent).toBeDefined();
    expect((sent.body as Record<string, unknown>).dry_run).toBeUndefined();
  });

  it("passes dry_run to web monitor_create / monitor_update and cohorts create", async () => {
    const calls = fakeApi((c) => (c.path.startsWith("/v1/web/monitors") || c.path === "/v1/cohorts" ? { body: { success: true, data: { valid: true, estimate: { hold: 0 } } } } : undefined));
    await call(KEYED, "socialcrawl_manage", { area: "web", action: "monitor_create", input: { url: "https://example.com" }, dry_run: true });
    await call(KEYED, "socialcrawl_manage", { area: "web", action: "monitor_update", id: "wm_1", input: { cadence_minutes: 60 }, dry_run: true });
    await call(KEYED, "socialcrawl_manage", { area: "cohorts", action: "create", input: { name: "panel" }, dry_run: true });
    expect(calls.filter((c) => c.url.searchParams.get("dry_run") === "1").map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /v1/web/monitors",
      "PATCH /v1/web/monitors/wm_1",
      "POST /v1/cohorts",
    ]);
  });

  it("refuses dry_run on an action that cannot take it, without calling the API", async () => {
    const calls = fakeApi();
    const r = await call(KEYED, "socialcrawl_manage", { area: "monitors", action: "delete", id: "mon_1", dry_run: true });
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

// ── 5. Stored results readable through a tool; small results inline ─────

describe("stored results are readable everywhere", () => {
  const comments = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: String(from + i), text: `row ${from + i}` }));

  it("collect returns every row inline when the result is small, and a result_id to read it back", async () => {
    fakeApi((c) => (c.path === "/v1/tiktok/post/comments" ? { body: page(comments(7)) } : undefined));
    const r = await call(KEYED, "socialcrawl_collect", { id: "tiktok/post/comments", params: { url: "https://www.tiktok.com/@a/video/1" }, items: 7 });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent!.rows).toHaveLength(7);
    expect(typeof r.structuredContent!.result_id).toBe("string");
    for (let i = 0; i < 7; i++) expect(text(r)).toContain(`row ${i}`);
    expectValidOutput("socialcrawl_collect", r.structuredContent);
  });

  it("collect keeps a large result behind the link with a sample", async () => {
    fakeApi((c) => (c.path === "/v1/tiktok/post/comments" ? { body: page(comments(250)) } : undefined));
    const r = await call(KEYED, "socialcrawl_collect", { id: "tiktok/post/comments", params: { url: "https://www.tiktok.com/@a/video/1" }, items: 250 });
    expect(r.structuredContent!.rows).toBeUndefined();
    expect(r.structuredContent!.sample.length).toBeLessThanOrEqual(3);
    expectValidOutput("socialcrawl_collect", r.structuredContent);
  });

  it("collect with result_id reads a stored walk back as CSV, with offset and limit", async () => {
    fakeApi((c) => (c.path === "/v1/tiktok/post/comments" ? { body: page(comments(250)) } : undefined));
    const walk = await call(KEYED, "socialcrawl_collect", { id: "tiktok/post/comments", params: { url: "https://www.tiktok.com/@a/video/1" }, items: 250 });
    const id = walk.structuredContent!.result_id as string;
    const r = await call(KEYED, "socialcrawl_collect", { result_id: id, format: "csv", offset: 10, limit: 5 });
    expect(r.isError).toBeFalsy();
    const t = text(r);
    expect(t).toContain("id,text");
    expect(t).toContain("row 10");
    expect(t).toContain("row 14");
    expect(t).not.toContain("row 15");
    expect(r.structuredContent).toMatchObject({ ok: true, result_id: id, offset: 10, total: 250 });
    expectValidOutput("socialcrawl_collect", r.structuredContent);
  });

  it("collect with result_id also takes the socialcrawl:// link, and reads a stored request body", async () => {
    // A csv request stores the full body behind a link.
    fakeApi((c) => (c.path === "/v1/tiktok/post/comments" ? { body: page(comments(4)) } : undefined));
    const req = await call(KEYED, "socialcrawl_request", { id: "tiktok/post/comments", params: { url: "https://www.tiktok.com/@a/video/1" }, format: "csv" });
    const id = req.structuredContent!.result_id as string;
    expect(typeof id).toBe("string");
    expectValidOutput("socialcrawl_request", req.structuredContent);
    const r = await call(KEYED, "socialcrawl_collect", { result_id: `socialcrawl://results/${id}` });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent!.rows).toHaveLength(4);
  });

  it("an unknown result_id is a clear error", async () => {
    const r = await call(KEYED, "socialcrawl_collect", { result_id: "nope" });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/expired|No stored result/);
  });

  it("request returns a 150-row, 40 KB page whole, without cutting it", async () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ id: String(i), text: "x".repeat(250) }));
    fakeApi((c) => (c.path === "/v1/tiktok/post/comments" ? { body: page(rows) } : undefined));
    const r = await call(KEYED, "socialcrawl_request", { id: "tiktok/post/comments", params: { url: "https://www.tiktok.com/@a/video/1" } });
    expect(r.structuredContent!.rows).toHaveLength(150);
    expect(r.structuredContent!.truncated).toBeUndefined();
  });

  it("never prints a multi-KB cursor in the text; structuredContent keeps it whole", async () => {
    const cursor = "c".repeat(5000);
    fakeApi((c) =>
      c.path === "/v1/tiktok/post/comments"
        ? { body: { ...page(comments(3)), data: { items: comments(3), pagination: { has_more: true, next_cursor: cursor } } } }
        : undefined,
    );
    const col = await call(KEYED, "socialcrawl_collect", { id: "tiktok/post/comments", params: { url: "https://www.tiktok.com/@a/video/1" }, items: 3 });
    expect(text(col)).not.toContain(cursor);
    expect(text(col)).toContain("…");
    expect(col.structuredContent!.paging.next_cursor).toBe(cursor);
    const req = await call(KEYED, "socialcrawl_request", { id: "tiktok/post/comments", params: { url: "https://www.tiktok.com/@a/video/1" } });
    expect(text(req)).not.toContain(cursor);
    expect(text(req)).toContain("…");
    expect(req.structuredContent!.paging.next_cursor).toBe(cursor);
    expectValidOutput("socialcrawl_request", req.structuredContent);
  });
});

// ── 6. The cost guard uses the real quote ─────────────────────────────────

describe("cost guard: the API's quote for the exact request", () => {
  const urls = ["https://www.tiktok.com/@a/video/1", "https://www.tiktok.com/@b/video/2"];

  /** The estimator answers like the API: valid only when urls is a real array. */
  const estimator: Handler = (c) => {
    if (c.path !== "/v1/utility/estimate") return undefined;
    const body = JSON.parse(c.url.searchParams.get("body") ?? "{}") as { urls?: unknown };
    return Array.isArray(body.urls)
      ? { body: { success: true, data: { valid: true, hold: body.urls.length, expected_min: 1, expected_max: body.urls.length } } }
      : { body: { success: true, data: { valid: false, hold: 0, rejection: { status: 400, message: "`urls` must be an array of post URLs." } } } };
  };
  const postStats: Handler = (c) =>
    c.path === "/v1/prism/post-stats" && c.method === "POST"
      ? { body: { success: true, data: { items: [{ url: urls[0] }, { url: urls[1] }] }, credits_used: 2, credits_remaining: 80, request_id: "req-ps" } }
      : undefined;

  it("does not ask for confirmation on a 2-URL post-stats call given as params; moves them to body and says so", async () => {
    const calls = fakeApi(estimator, postStats);
    const r = await call(KEYED, "socialcrawl_request", { platform: "prism", resource: "post-stats", params: { urls } });
    expect(r.structuredContent?.code).not.toBe("CONFIRMATION_REQUIRED");
    expect(r.isError).toBeFalsy();
    const post = calls.find((c) => c.path === "/v1/prism/post-stats")!;
    expect((post.body as { urls: unknown }).urls).toEqual(urls);
    expect((r.structuredContent!.warnings as string[]).some((w) => /moved .*params.* to body/i.test(w))).toBe(true);
    expect(r.structuredContent!.credits.quoted_max).toBe(2);
    expectValidOutput("socialcrawl_request", r.structuredContent);
  });

  it("still asks when the API's quote for the exact request is above the threshold", async () => {
    fakeApi((c) => (c.path === "/v1/utility/estimate" ? { body: { success: true, data: { valid: true, hold: 400 } } } : undefined), postStats);
    const r = await call(KEYED, "socialcrawl_request", { platform: "prism", resource: "post-stats", body: { urls } });
    expect(r.structuredContent?.code).toBe("CONFIRMATION_REQUIRED");
  });
});

// ── 7. Estimate never returns a null max ──────────────────────────────────

describe("estimate on a metered list endpoint", () => {
  const apiItemsQuote: Handler = (c) =>
    c.path === "/v1/utility/estimate"
      ? {
          body: {
            success: true,
            data: {
              valid: true,
              hold: 1,
              expected_min: 1,
              expected_max: 1,
              warnings: ["price_basis_unknown: the per-page price of this endpoint is not proven, so credits_max is null and credits_min is a lower bound only."],
              items: { n: 100, page_size: 49, pages: 3, credits_min: 3, credits_max: null, price_basis: "unknown", exact: false },
            },
          },
        }
      : undefined;

  it("keyed with items: a one-call quote and a walk caveat, never a null max", async () => {
    fakeApi(apiItemsQuote);
    const r = await call(KEYED, "socialcrawl_estimate", { id: "tiktok/post/comments", params: { url: "https://www.tiktok.com/@a/video/1" }, items: 100 });
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent!;
    expect(valuesAt(s, "credits_max").every((v) => typeof v === "number")).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/price_basis_unknown/);
    expect(text(r)).not.toMatch(/price_basis_unknown|is null/);
    for (const k of ["hold", "expected_min", "expected_max"]) expect(typeof s.quote[k]).toBe("number");
    expect((s.warnings as string[]).filter((w) => /walk/i.test(w))).toHaveLength(1);
    expectValidOutput("socialcrawl_estimate", s);
  });

  it("keyed without items: the one-call quote, no walk warnings", async () => {
    fakeApi(apiItemsQuote);
    const r = await call(KEYED, "socialcrawl_estimate", { id: "tiktok/post/comments", params: { url: "https://www.tiktok.com/@a/video/1" } });
    const s = r.structuredContent!;
    expect(valuesAt(s, "credits_max").every((v) => typeof v === "number")).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/price_basis_unknown/);
    expect(s.quote).toMatchObject({ hold: 1, expected_min: 1, expected_max: 1 });
  });

  it("offline with items: numbers only, one caveat", async () => {
    fakeApi();
    const r = await call(ANON, "socialcrawl_estimate", { id: "tiktok/post/comments", params: { url: "https://www.tiktok.com/@a/video/1" }, items: 100 });
    const s = r.structuredContent!;
    expect(JSON.stringify(s)).not.toMatch(/price_basis_unknown|null/);
    for (const k of ["hold", "expected_min", "expected_max"]) expect(typeof s.quote[k]).toBe("number");
    expectValidOutput("socialcrawl_estimate", s);
  });
});

// ── 8. No stale counts; a working install line ───────────────────────────

describe("README and package metadata", () => {
  const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  const COUNT = /\b\d{2,4}\s+(platforms|endpoints)\b|Platforms-\d+|Endpoints-\d+|Total: \d+/i;

  it("hard-code no platform or endpoint counts", () => {
    expect(read("README.md")).not.toMatch(COUNT);
    expect((JSON.parse(read("package.json")) as { description: string }).description).not.toMatch(COUNT);
    expect((JSON.parse(read("server.json")) as { description: string }).description).not.toMatch(COUNT);
  });

  it("gives a Claude Code install command that exists", () => {
    const readme = read("README.md");
    expect(readme).not.toContain("add-env");
    expect(readme).toContain("claude mcp add --scope user socialcrawl -e SOCIALCRAWL_API_KEY=sc_your_key_here -- npx -y socialcrawl-mcp");
  });

  it("puts Install first and leaves release notes to the changelog", () => {
    const readme = read("README.md");
    const install = readme.indexOf("## Installation");
    expect(install).toBeGreaterThan(0);
    expect(readme.indexOf("## Overview") === -1 || readme.indexOf("## Overview") > install).toBe(true);
    expect(readme).not.toMatch(/In v1\.13\.0/);
    expect(read("CHANGELOG.md")).toMatch(/## \[1\.13\.0\]/);
  });
});

// ── Round 2 ───────────────────────────────────────────────────────────────

describe("round 2: a single object's main block is never hidden", () => {
  const quote = {
    id: "GOOGL:NASDAQ",
    name: "Alphabet Inc Class A",
    ticker: "GOOGL",
    type: "stock",
    currency: "USD",
    price: 187.22,
    change_percent: 1.31,
    history: Array.from({ length: 3000 }, (_, i) => ({ t: `2026-01-01T00:${String(i % 60).padStart(2, "0")}:00Z`, close: 180 + (i % 10) })),
    about: "Alphabet ".repeat(4000),
  };
  const news = Array.from({ length: 200 }, (_, i) => ({ title: `headline ${i} `.repeat(30), url: `https://news.example/${i}` }));
  const fixture = { success: true, platform: "finance", endpoint: "/v1/finance/quote", data: { quote, news }, credits_used: 1, credits_remaining: 9, request_id: "req-quote" };

  it("keeps finance/quote's quote (trimmed), and omits the secondary block instead", async () => {
    fakeApi((c) => (c.path === "/v1/finance/quote" ? { body: fixture } : undefined));
    const r = await call(KEYED, "socialcrawl_request", { id: "finance/quote", params: { keyword: "GOOGL:NASDAQ" } });
    expect(r.isError).toBeFalsy();
    const q = r.structuredContent!.data.quote;
    expect(q).toBeDefined();
    expect(q.price).toBe(187.22);
    expect(q.name).toBe("Alphabet Inc Class A");
    expect(q.history.length).toBeLessThan(3000);
    expect(q.about.length).toBeLessThan(quote.about.length);
    expect(r.structuredContent!.data.news).toBeUndefined();
    expect(text(r)).toContain('"price":187.22');
    expect((r.structuredContent!.warnings as string[]).some((w) => /quote/.test(w) && /trimmed/i.test(w))).toBe(true);
    expect(r.structuredContent!.truncated.omitted_keys).toContain("news");
    expect(text(r).length).toBeLessThanOrEqual(25_000);
    expectValidOutput("socialcrawl_request", r.structuredContent);
  });
});

describe("round 2: endpoint params given at the top level of socialcrawl_request", () => {
  it("moves a declared param (limit) into params, with a warning", async () => {
    const calls = fakeApi((c) => (c.path === "/v1/tiktok/post/comments" ? { body: page([{ id: "1" }]) } : undefined));
    const r = await call(KEYED, "socialcrawl_request", { platform: "tiktok", resource: "post/comments", params: { url: "https://www.tiktok.com/@a/video/1" }, limit: 5 });
    expect(r.isError).toBeFalsy();
    expect(calls.find((c) => c.path === "/v1/tiktok/post/comments")!.url.searchParams.get("limit")).toBe("5");
    expect((r.structuredContent!.warnings as string[]).some((w) => /`limit`/.test(w) && /params/.test(w))).toBe(true);
    expectValidOutput("socialcrawl_request", r.structuredContent);
  });

  it("moves a top-level url too (no params at all)", async () => {
    const calls = fakeApi((c) => (c.path === "/v1/tiktok/post/comments" ? { body: page([{ id: "1" }]) } : undefined));
    const r = await call(KEYED, "socialcrawl_request", { id: "tiktok/post/comments", url: "https://www.tiktok.com/@a/video/1" });
    expect(r.isError).toBeFalsy();
    expect(calls.find((c) => c.path === "/v1/tiktok/post/comments")!.url.searchParams.get("url")).toBe("https://www.tiktok.com/@a/video/1");
  });

  it("still refuses a key that is neither a tool argument nor an endpoint param", async () => {
    const r = await call(KEYED, "socialcrawl_request", { id: "tiktok/post/comments", params: { url: "u" }, bogus_key: 1 });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/bogus_key/);
  });
});

describe("round 2: socialcrawl_account aliases", () => {
  const ledger: Handler = (c) =>
    c.path.startsWith("/v1/credits") ? { body: { success: true, data: { items: [], pagination: { has_more: false, next_cursor: null } }, credits_used: 0, credits_remaining: 9 } } : undefined;

  it("takes action as view, and ledger/history as transactions", async () => {
    for (const args of [{ action: "transactions" }, { view: "ledger" }, { action: "history" }]) {
      const calls = fakeApi(ledger);
      const r = await call(KEYED, "socialcrawl_account", args);
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent!.view).toBe("transactions");
      expect(calls.some((c) => c.path.includes("transactions"))).toBe(true);
      expectValidOutput("socialcrawl_account", r.structuredContent);
    }
  });
});

describe("round 2: stored results say they live for this session; small CSV comes inline", () => {
  // Rows whose JSON is large (nested arrays of objects) but whose CSV is small.
  const bulky = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: String(i), text: `row ${i}`, raw: { frames: Array.from({ length: 30 }, (_, j) => ({ j, junk: "z".repeat(20) })) } }));

  it("collect csv: every row inline when the CSV fits, even if the JSON would not", async () => {
    fakeApi((c) => (c.path === "/v1/tiktok/post/comments" ? { body: page(bulky(100)) } : undefined));
    const r = await call(KEYED, "socialcrawl_collect", { id: "tiktok/post/comments", params: { url: "https://www.tiktok.com/@a/video/1" }, items: 100, format: "csv" });
    const t = text(r);
    expect(t).toContain("```csv");
    for (const i of [0, 50, 99]) expect(t).toContain(`row ${i}`);
    expect(t).toMatch(/in this session with result_id/);
    expectValidOutput("socialcrawl_collect", r.structuredContent);
  });

  it("collect json over the inline limit says where to read the rest in this session", async () => {
    fakeApi((c) => (c.path === "/v1/tiktok/post/comments" ? { body: page(bulky(250)) } : undefined));
    const r = await call(KEYED, "socialcrawl_collect", { id: "tiktok/post/comments", params: { url: "https://www.tiktok.com/@a/video/1" }, items: 250 });
    expect(text(r)).toMatch(/in this session with result_id/);
  });

  it("a cut request page says the same", async () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({ id: String(i), text: "y".repeat(300) }));
    fakeApi((c) => (c.path === "/v1/tiktok/post/comments" ? { body: page(rows) } : undefined));
    const r = await call(KEYED, "socialcrawl_request", { id: "tiktok/post/comments", params: { url: "https://www.tiktok.com/@a/video/1" } });
    expect(r.structuredContent!.truncated).toBeDefined();
    expect(text(r)).toMatch(/in this session with result_id/);
  });
});

describe("round 2: the monitor suggestion is a complete new-items alert", () => {
  it("includes a webhook_url placeholder, the guide's rows_new rule on a track monitor, and dry_run", async () => {
    fakeApi(findApi([{ id: "tiktok/profile/videos", method: "GET", params_filled: { handle: "mrbeast" }, missing: [] }]));
    const r = await call(KEYED, "socialcrawl_find", { task: "weekly alert when @mrbeast posts a new video" });
    const m = (r.structuredContent!.results as Array<Record<string, any>>).find((x) => x.kind === "manage"); // eslint-disable-line @typescript-eslint/no-explicit-any
    const input = m!.call.arguments.input;
    expect(m!.call.arguments.dry_run).toBe(true);
    expect(typeof input.webhook_url).toBe("string");
    expect(input.webhook_url).toMatch(/^https:\/\//);
    expect(input.alert_rules).toEqual([{ metric: "rows_new", op: "gt", value: 0 }]);
    expect(input.suppress_webhook_unless_alert).toBe(true);
    expect(input.track.metrics[0]).toMatch(/^items\[\]\.post\.engagement\./);
    expectValidOutput("socialcrawl_find", r.structuredContent);
  });

  it("socialcrawl_manage monitors create sends track", async () => {
    const calls = fakeApi((c) => (c.path === "/v1/monitors" && c.method === "POST" ? { status: 201, body: { monitor: { id: "m1" } } } : undefined));
    const r = await call(KEYED, "socialcrawl_manage", {
      area: "monitors",
      action: "create",
      input: { recipe: "tiktok/profile/videos", params: { handle: "mrbeast" }, cadence: "weekly", webhook_url: "https://example.com/h", track: { metrics: ["items[].post.engagement.views"] }, alert_rules: [{ metric: "rows_new", op: "gt", value: 0 }] },
    });
    expect(r.isError).toBeFalsy();
    expect((calls.find((c) => c.path === "/v1/monitors")!.body as Record<string, unknown>).track).toEqual({ metrics: ["items[].post.engagement.views"] });
  });
});

describe("item 6: a live contract that lags the bundled field list does not hide it", () => {
  const liveContract = (outputs: Record<string, unknown>): Handler => (c) =>
    c.path === "/v1/utility/endpoint" ? { body: { success: true, data: { contract: { outputs } } } } : undefined;

  it("finance/quote keeps the bundled price fields when the live list is shorter", async () => {
    fakeApi(liveContract({ archetype: "Quote", rows_at: "data.quote", source: "field_map", fields: [{ path: "quote.id", type: "string", nullable: false }], never_filled: [], page_level: [] }));
    const r = await call(KEYED, "socialcrawl_endpoint", { id: "finance/quote" });
    expect(text(r)).toContain("quote.price.current");
    expectValidOutput("socialcrawl_endpoint", r.structuredContent);
  });

  it("prism/post-stats keeps the bundled sample fields when the live one is not published", async () => {
    fakeApi(liveContract({ archetype: "Analytics", rows_at: "data", source: "unknown", fields: [], never_filled: [], page_level: [] }));
    const r = await call(KEYED, "socialcrawl_endpoint", { id: "prism/post-stats" });
    expect(text(r)).not.toContain("Fields not published");
    expect(text(r)).toContain("summary.credits_charged");
  });
});
