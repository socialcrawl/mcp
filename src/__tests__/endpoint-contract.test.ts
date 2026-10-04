import { describe, it, expect, vi, afterEach } from "vitest";
import { endpointStructured } from "../tools/endpoint.js";
import { findBanned } from "./fixtures/supplier-tokens.js";
import { ENDPOINTS } from "../data/endpoints.js";
import type { ApiContext } from "../context.js";

const ANON: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };
const KEYED: ApiContext = { apiKey: "sc_test_key_1234567890", baseUrl: "https://www.socialcrawl.dev" };

type Contract = Record<string, unknown> & {
  outputs: { rows_at: string | null; fields: Array<{ path: string }>; fields_total: number };
  params: { required: Array<{ name: string }>; optional: Array<{ name: string }> };
  cost: Record<string, unknown>;
};
const contractOf = (s: Record<string, unknown>): Contract => s.contract as Contract;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("socialcrawl_endpoint (bundled contract)", () => {
  it("tells the agent what data comes back: rows_at and at most 25 fields", async () => {
    const out = await endpointStructured(ANON, { id: "tiktok/post/comments" });
    expect(out.structured).toMatchObject({ ok: true, id: "tiktok/post/comments", method: "GET", source: "bundled" });
    const c = contractOf(out.structured);
    expect(c.outputs.rows_at).toBe("data.items[].comment");
    expect(c.outputs.fields.length).toBeLessThanOrEqual(25);
    expect(c.outputs.fields.some((f) => f.path === "comment.text")).toBe(true);
    expect(c.outputs.fields_total).toBeGreaterThanOrEqual(c.outputs.fields.length);
    expect(out.text).toContain("data.items[].comment");
    expect(out.text).toContain("comment.text");
  });

  it("carries params, cost, paging, latency, next, purpose and a sample link", async () => {
    const out = await endpointStructured(ANON, { id: "/v1/tiktok/post/comments" });
    const c = contractOf(out.structured);
    expect(c.params.required.map((p) => p.name)).toEqual(["url"]);
    expect(c.params.optional.map((p) => p.name)).toContain("cursor");
    expect(c.cost).toMatchObject({ model: "metered", min: 1, max: 7 });
    expect(c.paging).toMatchObject({ style: "cursor" });
    expect(c.purpose).toMatchObject({ summary: "List TikTok post comments" });
    expect((c.next as Array<{ id: string }>).map((n) => n.id)).toContain("prism/comments");
    expect(c.sample).toBe("https://www.socialcrawl.dev/platforms/tiktok/post-comments");
    expect(c.timeout_s).toBeGreaterThan(0);
    const profile = contractOf((await endpointStructured(ANON, { id: "tiktok/profile" })).structured);
    expect(profile.latency_ms).toMatchObject({ p50: expect.any(Number) });
  });

  it("states the registry page size and per-N price in the bundled paging block", async () => {
    const c = contractOf((await endpointStructured(ANON, { id: "instagram/followers" })).structured) as Record<string, any>;
    expect(c.paging).toMatchObject({
      style: "cursor",
      page_size: 50,
      page_size_source: "declared",
      per_n_items: "ceil(N/50) x 5-10",
      price_basis: "per_page",
      cursor_param: "cursor",
    });
    const full = contractOf((await endpointStructured(ANON, { id: "instagram/profile/posts/full" })).structured) as Record<string, any>;
    expect(full.paging).toMatchObject({ page_size: 12, per_n_items: "ceil(N/12) x 5" });
  });

  it("resolves a concrete path to its template and disambiguates by method", async () => {
    const job = await endpointStructured(ANON, { id: "prism/jobs/job_abc" });
    expect(job.structured).toMatchObject({ ok: true, id: "prism/jobs/{job_id}" });
    const post = await endpointStructured(ANON, { id: "prism/jobs", method: "POST" });
    expect(post.structured).toMatchObject({ ok: true, method: "POST" });
  });

  it("answers a platform slug with its endpoint table and a topic with its guide", async () => {
    const platform = await endpointStructured(ANON, { id: "tiktok" });
    expect(platform.structured.ok).toBe(true);
    expect(platform.text).toContain("post/comments");
    const topic = await endpointStructured(ANON, { id: "errors" });
    expect(topic.structured.ok).toBe(true);
    expect(topic.text.length).toBeGreaterThan(200);
  });

  it("suggests close matches for an unknown endpoint, platform or topic", async () => {
    const res = await endpointStructured(ANON, { id: "tiktok/comments" });
    expect(res.structured).toMatchObject({ ok: false, code: "ENDPOINT_NOT_FOUND" });
    expect(res.structured.did_you_mean).toContain("tiktok/post/comments");
    const plat = await endpointStructured(ANON, { id: "tiktk/profile" });
    expect(plat.structured).toMatchObject({ ok: false, code: "UNKNOWN_PLATFORM" });
    expect(plat.structured.did_you_mean).toContain("tiktok");
    const topic = await endpointStructured(ANON, { id: "pagination-xyz" });
    expect(topic.structured.ok).toBe(false);
  });

  it("names no supplier for any endpoint", async () => {
    for (const e of ENDPOINTS) {
      const out = await endpointStructured(ANON, { id: `${e.platform}/${e.resource}`, method: e.method });
      expect(findBanned(out.text), `${e.platform}/${e.resource}`).toBeUndefined();
      expect(findBanned(JSON.stringify(out.structured)), `${e.platform}/${e.resource}`).toBeUndefined();
    }
  });
});

describe("socialcrawl_endpoint (live overlay)", () => {
  it("reads /v1/utility/endpoint when a key is set and overlays what it adds", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            id: "tiktok/post/comments",
            credits: { label: "1-7 credits", pricing_notes: "live rule" },
            links: { docs: "https://www.socialcrawl.dev/platforms/tiktok/post-comments" },
            next: [{ id: "tiktok/video/comment/replies", why: "expand a thread" }],
            latency_ms: { p50: 1200, p95: 3400, p99: 5000, n: 40 },
          },
        }),
        { status: 200 },
      );
    });
    const out = await endpointStructured(KEYED, { id: "tiktok/post/comments" });
    expect(urls[0]).toContain("/v1/utility/endpoint?id=tiktok%2Fpost%2Fcomments");
    expect(out.structured.source).toBe("live");
    const c = contractOf(out.structured);
    expect(c.latency_ms).toMatchObject({ p50: 1200 });
    expect((c.next as Array<{ id: string }>)[0].id).toBe("tiktok/video/comment/replies");
    expect(c.cost).toMatchObject({ rule: "live rule" });
  });

  it("falls back to the bundled contract on a 404", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
    const out = await endpointStructured(KEYED, { id: "tiktok/post/comments" });
    expect(out.structured).toMatchObject({ ok: true, source: "bundled" });
  });
});

describe("socialcrawl_endpoint: unknown and inferred field lists", () => {
  it("says the fields are not published yet and points at the sample (youtube/transcripts)", async () => {
    const out = await endpointStructured(ANON, { id: "youtube/transcripts", method: "POST" });
    const c = contractOf(out.structured);
    expect((c.outputs as unknown as { source: string }).source).toBe("unknown");
    expect(out.text).toContain("Fields not published yet");
    expect(out.text).toContain("socialcrawl://example/youtube/transcripts");
    expect(out.text).toMatch(/call it once with a small limit/);
  });

  it("marks an inferred field list as inferred from a sample", async () => {
    const out = await endpointStructured(ANON, { id: "web/jobs" });
    expect((contractOf(out.structured).outputs as unknown as { source: string }).source).toBe("inferred_sample");
    expect(out.text).toContain("inferred from a sample");
  });

  it("publishes the source for a declared field map", async () => {
    const out = await endpointStructured(ANON, { id: "tiktok/post/comments" });
    expect((contractOf(out.structured).outputs as unknown as { source: string }).source).toBe("field_map");
  });
});

describe("socialcrawl_endpoint: live contract (T18 shape) and malformed payloads", () => {
  const live = (data: unknown) =>
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true, data }), { status: 200 }));

  it("reads data.contract.{outputs,next,latency_ms,paging,cost} into the same schema as bundled", async () => {
    live({
      id: "tiktok/post/comments",
      contract: {
        id: "tiktok/post/comments",
        outputs: { archetype: "CommentList", rows_at: "data.items[].comment", source: "field_map", fields: [{ path: "comment.text", type: "string", nullable: false, meaning: "Text", fill: 0.99 }, { path: "comment.live_only", type: "string", nullable: true }], never_filled: [], page_level: [] },
        next: [{ to: "tiktok/video/comment/replies", bind: { comment_id: "items[].comment.id" }, why: "expand a thread", source: "curated" }],
        latency_ms: { p50: 2100, p95: 6400, p99: 9000, n: 50, sampled: "a..b", provisional: false, low_sample: false, recommended_timeout_s: 14 },
        paging: { style: "cursor", page_size: 50, page_size_source: "observed", page_size_max: 100, max_pages: null, max_pages_when: null, per_n_items: "ceil(N/50) x 1", price_basis: "per_page" },
        cost: { model: "metered", min: 1, max: 7, rule: "contract rule", levers: ["label"], estimator: "tiktok/post/comments", example_quote: null },
      },
    });
    const out = await endpointStructured(KEYED, { id: "tiktok/post/comments" });
    expect(out.structured.source).toBe("live");
    const c = contractOf(out.structured) as Record<string, any>;
    // A live list that names a field this release does not know is newer, so it replaces the bundled one.
    expect(c.outputs.fields).toHaveLength(2);
    expect(c.outputs.fields).toContainEqual({ path: "comment.text", type: "string", meaning: "Text", fill: 0.99 });
    expect(c.next).toEqual([{ id: "tiktok/video/comment/replies", why: "expand a thread", bind: { comment_id: "items[].comment.id" } }]);
    expect(c.latency_ms).toMatchObject({ p50: 2100, p95: 6400 });
    expect(c.timeout_s).toBe(14);
    expect(c.paging).toMatchObject({ style: "cursor", page_size: 50, per_n_items: "ceil(N/50) x 1", cursor_param: "cursor" });
    expect(c.cost).toMatchObject({ rule: "contract rule", levers: ["label"] });
    // Bundled paging uses the same keys.
    vi.unstubAllGlobals();
    const bundled = contractOf((await endpointStructured(ANON, { id: "tiktok/post/comments" })).structured) as Record<string, any>;
    expect(Object.keys(bundled.paging).sort()).toEqual(Object.keys(c.paging).sort());
  });

  it.each([
    ["null data", null],
    ["string data", "weird"],
    ["string contract", { contract: "x" }],
    ["garbage keys", { outputs: { fields: ["x", null, 3] }, next: ["a", null], latency_ms: {}, purpose: { foo: 1 }, contract: { paging: "x", next: [null, 7, { to: 5 }], outputs: { fields: null }, latency_ms: { p50: "1" } } }],
  ])("never throws and keeps the bundled facts on %s", async (_n, data) => {
    live(data);
    const out = await endpointStructured(KEYED, { id: "tiktok/post/comments" });
    expect(out.structured.ok).toBe(true);
    const c = contractOf(out.structured) as Record<string, any>;
    expect(c.outputs.fields.length).toBeGreaterThan(0);
    expect(c.outputs.fields.every((f: { path?: unknown }) => typeof f.path === "string")).toBe(true);
    expect(Array.isArray(c.next)).toBe(true);
    expect(c.next.every((n: { id?: unknown }) => typeof n.id === "string")).toBe(true);
    expect(c.paging === null || typeof c.paging.style === "string").toBe(true);
    expect((c.purpose as { summary?: unknown }).summary).toBe("List TikTok post comments");
  });
});
