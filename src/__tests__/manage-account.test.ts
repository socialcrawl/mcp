import { describe, it, expect, vi, afterEach } from "vitest";
import { manage } from "../tools/manage.js";
import { accountStructured } from "../tools/account.js";
import type { ApiContext } from "../context.js";

const KEYED: ApiContext = { apiKey: "sc_test_key_1234567890", baseUrl: "https://www.socialcrawl.dev" };

interface Seen {
  calls: Array<{ url: string; method: string; body?: string }>;
}

function stub(status: number, body: unknown): Seen {
  const seen: Seen = { calls: [] };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    seen.calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
    return new Response(JSON.stringify(body), { status });
  });
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("socialcrawl_manage dispatch", () => {
  it("monitors: list and get by id", async () => {
    const seen = stub(200, { success: true, data: { monitors: [] } });
    await manage(KEYED, { area: "monitors", action: "list", input: { status: "active" } });
    expect(seen.calls[0].url).toContain("/v1/monitors");
    expect(seen.calls[0].url).toContain("status=active");
    await manage(KEYED, { area: "monitors", action: "get", id: "mon_1" });
    expect(seen.calls[1].url).toContain("/v1/monitors/mon_1");
  });

  it("web: scrape with input as query params", async () => {
    const seen = stub(200, { success: true, data: { markdown: "# hi" } });
    const out = await manage(KEYED, { area: "web", action: "scrape", input: { url: "https://example.com" } });
    expect(seen.calls[0].url).toContain("/v1/web/scrape");
    expect(seen.calls[0].url).toContain("url=https%3A%2F%2Fexample.com");
    expect(out.text).not.toMatch(/^Error/);
  });

  it("cohorts: id maps to cohort_id, or query_id for query_* actions", async () => {
    const seen = stub(200, { success: true, data: {} });
    const cohortId = "V1StGXR8xZ5jdHi6BamyT"; // the API's 21-character id form
    const queryId = "Q2StGXR8xZ5jdHi6BamyT";
    await manage(KEYED, { area: "cohorts", action: "get", id: cohortId });
    expect(seen.calls[0].url).toContain(`/v1/cohorts/${cohortId}`);
    await manage(KEYED, { area: "cohorts", action: "query_status", id: queryId });
    expect(seen.calls[1].url).toContain(`/v1/cohort-queries/${queryId}`);
  });

  it("jobs: get, list and submit go to prism/jobs", async () => {
    const seen = stub(200, { success: true, data: { job_id: "job_1", status: "queued" }, credits_used: 0 });
    await manage(KEYED, { area: "jobs", action: "get", id: "job_1" });
    expect(seen.calls[0].url).toContain("/v1/prism/jobs/job_1");
    await manage(KEYED, { area: "jobs", action: "list" });
    expect(new URL(seen.calls[1].url).pathname).toBe("/v1/prism/jobs");
    const submitted = await manage(KEYED, {
      area: "jobs",
      action: "submit",
      input: { endpoint: "prism/profiles", items: [{ platform: "tiktok", handle: "a" }], confirm: true },
    });
    const post = seen.calls.find((c) => c.method === "POST")!;
    expect(new URL(post.url).pathname).toBe("/v1/prism/jobs");
    expect(JSON.parse(post.body!)).not.toHaveProperty("confirm");
    expect((submitted.structured?.job as { poll: { tool: string; arguments: unknown } }).poll).toMatchObject({
      tool: "socialcrawl_request",
      arguments: { platform: "prism", resource: "jobs/{job_id}", method: "GET", params: { job_id: "job_1" } },
    });
  });

  it("rejects an unknown action with the area's action list, free", async () => {
    const seen = stub(200, {});
    const out = await manage(KEYED, { area: "monitors", action: "explode" });
    expect(out.text).toMatch(/^Error: /);
    expect(out.text).toContain("create, list, get");
    expect(seen.calls).toHaveLength(0);
  });

  it("rejects invalid input for the area, free", async () => {
    const seen = stub(200, {});
    const out = await manage(KEYED, { area: "cohorts", action: "query", id: "coh_1", input: { max_pages_per_identity: 99 } });
    expect(out.text).toMatch(/^Error: /);
    expect(out.text).toContain("max_pages_per_identity");
    expect(seen.calls).toHaveLength(0);
  });
});

describe("socialcrawl_account", () => {
  it("balance (default) and transactions", async () => {
    const seen = stub(200, { success: true, data: { balance: 42 }, credits_remaining: 42 });
    const b = await accountStructured(KEYED, {});
    expect(seen.calls[0].url).toContain("/v1/credits/balance");
    expect(b.structured).toMatchObject({ ok: true, view: "balance" });
    await accountStructured(KEYED, { view: "transactions", limit: 5, request_id: "req-1" });
    expect(seen.calls[1].url).toContain("/v1/credits/transactions");
    expect(seen.calls[1].url).toContain("request_id=req-1");
  });

  it("status reads the public status route", async () => {
    const seen = stub(200, { success: true, data: { platforms: [] } });
    const s = await accountStructured(KEYED, { view: "status" });
    expect(seen.calls[0].url).toContain("/v1/status");
    expect(s.structured).toMatchObject({ ok: true, view: "status" });
  });

  it("freshness compares the live catalogue with the bundled one", async () => {
    stub(200, { success: true, data: { endpoints: [], count: 0 } });
    const f = await accountStructured(KEYED, { view: "freshness" });
    expect(f.structured).toMatchObject({ view: "freshness" });
    expect(f.text.length).toBeGreaterThan(20);
  });
});
