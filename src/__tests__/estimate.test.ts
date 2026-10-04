import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { estimateStructured } from "../tools/estimate.js";
import { EstimateOutputShape } from "../schemas/outputs.js";
import type { PlanCall } from "../tools/estimate.js";
import type { ApiContext } from "../context.js";

const ANON: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };
const KEYED: ApiContext = { apiKey: "sc_test_key_1234567890", baseUrl: "https://www.socialcrawl.dev" };

function stub(status: number, body: unknown): string[] {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(body), { status });
  });
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

type Quote = Record<string, unknown>;

describe("socialcrawl_estimate, one call", () => {
  it("quotes locally without a key: band plus the hold for these params", async () => {
    const urls = stub(200, {});
    const out = await estimateStructured(ANON, { id: "tiktok/post/comments", params: { url: "https://x", label: "toxic" } });
    expect(urls).toHaveLength(0);
    expect(out.structured).toMatchObject({ ok: true, source: "local" });
    const q = out.structured.quote as Quote;
    expect(q).toMatchObject({ endpoint: "tiktok/post/comments", min_credits: 1, max_credits: 7 });
    expect(q.hold).toBeGreaterThan(1);
  });

  it("walks items to pages to credits offline from the paging block (same as estimate.py)", async () => {
    stub(200, {});
    const out = await estimateStructured(ANON, { id: "instagram/followers", params: { handle: "x", coverage: "full" }, items: 2600 });
    const q = out.structured.quote as Quote;
    expect(q).toMatchObject({ pages: 52, page_size: 50, price_basis: "per_page", expected_min: 260, expected_max: 520, hold: 520, total_hold: 520 });
    expect(out.text).toContain("52 pages");
  });

  it("applies the items walk to the API's per-call quote when keyed", async () => {
    stub(200, { success: true, data: { valid: true, hold: 10, expected_min: 5, expected_max: 10, levers: [{ param: "coverage", hold: 5, effect: "less" }], warnings: ["api warning"] } });
    const out = await estimateStructured(KEYED, { id: "instagram/followers", params: { handle: "nasa", coverage: "full" }, items: 2600 });
    const q = out.structured.quote as Quote;
    expect(out.structured.source).toBe("api+walk");
    expect(q).toMatchObject({ pages: 52, page_size: 50, expected_min: 260, expected_max: 520, hold: 520, total_hold: 520, valid: true });
    expect(q.levers).toHaveLength(1);
    expect(out.structured.warnings).toEqual(["api warning"]);
    expect(out.text).toContain("52 pages");
    // MCP clients validate structuredContent against the declared outputSchema.
    expect(z.object(EstimateOutputShape).safeParse(out.structured).success).toBe(true);
  });

  it("keeps the one-call API quote for an endpoint that cannot page", async () => {
    stub(200, { success: true, data: { valid: true, hold: 1, expected_min: 1, expected_max: 1 } });
    const out = await estimateStructured(KEYED, { id: "tiktok/profile", params: { handle: "a" }, items: 100 });
    const q = out.structured.quote as Quote;
    expect(out.structured.source).toBe("api");
    expect(q.hold).toBe(1);
    expect(q.pages).toBeUndefined();
    expect(out.structured.warnings).toEqual([expect.stringMatching(/^not_paged/)]);
  });

  it("prices a per-row walk by rows, and says when items cannot be paged", async () => {
    stub(200, {});
    const rows = (await estimateStructured(ANON, { id: "douyin/search/users", params: { query: "x" }, items: 100 })).structured.quote as Quote;
    expect(rows).toMatchObject({ pages: 10, price_basis: "per_row", expected_min: 500, expected_max: 500, hold: 500 });
    const flat = await estimateStructured(ANON, { id: "tiktok/profile", params: { handle: "a" }, items: 100 });
    expect(flat.structured.warnings).toEqual([expect.stringMatching(/^not_paged/)]);
    expect((flat.structured.quote as Quote).hold).toBe(1);
  });

  it("multiplies by calls for a whole-job budget", async () => {
    const out = await estimateStructured(ANON, { id: "tiktok/profile", params: { handle: "a" }, calls: 200 });
    expect(out.structured.quote).toMatchObject({ hold: 1, calls: 200, total_hold: 200 });
  });

  it("asks /v1/utility/estimate with params as JSON when a key is set", async () => {
    const urls = stub(200, {
      success: true,
      data: {
        valid: true,
        hold: 5,
        expected_min: 1,
        expected_max: 5,
        unit: "credits",
        formula: "1 per page + 4 for label=toxic",
        levers: [{ param: "label", hold: 1, effect: "drop label=toxic" }],
        warnings: [],
      },
    });
    const out = await estimateStructured(KEYED, { id: "tiktok/post/comments", params: { url: "https://x", label: "toxic" } });
    const u = new URL(urls[0]);
    expect(u.pathname).toBe("/v1/utility/estimate");
    expect(u.searchParams.get("id")).toBe("tiktok/post/comments");
    expect(JSON.parse(u.searchParams.get("params")!)).toEqual({ url: "https://x", label: "toxic" });
    expect(out.structured).toMatchObject({ ok: true, source: "api" });
    expect(out.structured.quote).toMatchObject({ hold: 5, expected_min: 1, expected_max: 5 });
    expect(out.text).toContain("1 per page + 4 for label=toxic");
  });

  it("reports a call the API would refuse (valid:false) without failing the tool", async () => {
    stub(200, { success: true, data: { valid: false, hold: 0, rejection: { status: 400, message: "url is required" } } });
    const out = await estimateStructured(KEYED, { id: "tiktok/post/comments" });
    expect(out.structured).toMatchObject({ ok: true, source: "api" });
    expect(out.structured.quote).toMatchObject({ valid: false });
    expect(out.text).toContain("url is required");
  });

  it("falls back to the local quote on a 404", async () => {
    stub(404, { success: false, error: { type: "ENDPOINT_NOT_FOUND", message: "no" } });
    const out = await estimateStructured(KEYED, { id: "tiktok/profile", params: { handle: "a" } });
    expect(out.structured).toMatchObject({ ok: true, source: "local" });
  });

  it("errors with did_you_mean on an unknown id", async () => {
    const out = await estimateStructured(ANON, { id: "tiktok/comments" });
    expect(out.structured).toMatchObject({ ok: false, code: "ENDPOINT_NOT_FOUND" });
    expect(out.structured.did_you_mean).toContain("tiktok/post/comments");
  });

  it("answers the pricing overview with no id and a platform table for a slug", async () => {
    const overview = await estimateStructured(ANON, {});
    expect(overview.structured.ok).toBe(true);
    expect(overview.text).toMatch(/metered/i);
    const platform = await estimateStructured(ANON, { id: "tiktok" });
    expect(platform.structured.ok).toBe(true);
    expect(platform.text).toContain("post/comments");
  });
});

describe("socialcrawl_estimate, a plan", () => {
  const plan: PlanCall[] = [
    { id: "tiktok/search", params: { query: "skincare" } },
    { id: "tiktok/profile", params: { handle: "a" }, repeat: 20 },
  ];

  it("totals a plan locally without a key", async () => {
    const out = await estimateStructured(ANON, { plan });
    expect(out.structured).toMatchObject({ ok: true, source: "local" });
    const p = out.structured.plan as { calls: Array<{ id: string; hold: number }>; total_hold: number };
    expect(p.calls).toHaveLength(2);
    expect(p.calls[1].hold).toBe(20);
    expect(p.total_hold).toBe(p.calls[0].hold + 20);
  });

  it("sends the plan as base64url JSON when a key is set", async () => {
    const urls = stub(200, { success: true, data: { calls: [{ id: "tiktok/search", hold: 1 }, { id: "tiktok/profile", hold: 20 }], hold_total: 21 } });
    const out = await estimateStructured(KEYED, { plan });
    const raw = new URL(urls[0]).searchParams.get("plan")!;
    const decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { calls: unknown[] };
    expect(decoded.calls).toHaveLength(2);
    expect(out.structured).toMatchObject({ ok: true, source: "api" });
    expect(out.structured.plan).toMatchObject({ total_hold: 21 });
  });

  it("flags an unknown id inside a plan", async () => {
    const out = await estimateStructured(ANON, { plan: [{ id: "nope/thing" }] });
    expect(out.structured.ok).toBe(false);
  });
});

describe("socialcrawl_estimate, plan payload details", () => {
  it("shows each call's hold_total and the plan-level valid:false", async () => {
    stub(200, {
      success: true,
      data: {
        valid: false,
        rejection: { message: "step 2 is missing handle" },
        calls: [{ id: "tiktok/profile", hold: 1, repeat: 20, hold_total: 20 }],
        hold_total: 20,
      },
    });
    const out = await estimateStructured(KEYED, { plan: [{ id: "tiktok/profile", params: { handle: "a" }, repeat: 20 }] });
    expect(out.text).toContain("tiktok/profile: 20");
    expect(out.text).toContain("step 2 is missing handle");
    expect(out.structured.plan).toMatchObject({ valid: false, total_hold: 20 });
  });
});
