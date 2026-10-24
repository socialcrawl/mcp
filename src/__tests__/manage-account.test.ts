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

describe("socialcrawl_account usage", () => {
  it("reads /v1/credits/usage with from, to, group_by and api_key_id, free", async () => {
    const seen = stub(200, { success: true, data: { rows: [] }, credits_used: 0, credits_remaining: 42 });
    const out = await accountStructured(KEYED, {
      view: "usage",
      from: "2026-10-01",
      to: "2026-10-20",
      group_by: "day",
      api_key_id: "key_1",
    });
    const url = new URL(seen.calls[0].url);
    expect(url.pathname).toBe("/v1/credits/usage");
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: "2026-10-01", to: "2026-10-20", group_by: "day", api_key_id: "key_1" });
    expect(out.structured).toMatchObject({ ok: true, view: "usage" });
    expect(out.text).toContain("0 credits");
  });

  it("sends no query by default", async () => {
    const seen = stub(200, { success: true, data: { rows: [] } });
    await accountStructured(KEYED, { view: "usage" });
    expect(seen.calls[0].url).toBe("https://www.socialcrawl.dev/v1/credits/usage");
  });
});

describe("socialcrawl_manage monitors and cohorts, new fields", () => {
  it("monitors export goes through the manage schema", async () => {
    const seen = stub(200, { ok: true });
    await manage(KEYED, { area: "monitors", action: "export", id: "mon_1", input: { format: "ndjson", from: "2026-10-01" } });
    expect(seen.calls[0].url).toContain("/v1/monitors/mon_1/export?format=ndjson&from=2026-10-01");
  });

  it("monitors create accepts track, webhook_format and webhook_rows; runs take include=numbers; timeseries takes row", async () => {
    const seen = stub(201, { monitor: { id: "mon_t" } });
    const out = await manage(KEYED, {
      area: "monitors",
      action: "create",
      input: {
        recipe: "tiktok/profile/videos",
        params: { handle: "nasa" },
        cadence: "daily",
        webhook_url: "https://example.com/h",
        track: { metrics: ["items[].post.engagement.views"] },
        webhook_format: "rows",
        webhook_rows: "new",
        alert_rules: [{ metric: "rows_new", op: "gt", value: 0 }],
      },
    });
    expect(out.text).not.toMatch(/^Error/);
    const body = JSON.parse(seen.calls[0].body!);
    expect(body).toMatchObject({ webhook_format: "rows", webhook_rows: "new" });
    await manage(KEYED, { area: "monitors", action: "runs", id: "mon_t", input: { include: "result,numbers" } });
    expect(seen.calls[1].url).toContain(`include=${encodeURIComponent("result,numbers")}`);
    await manage(KEYED, { area: "monitors", action: "timeseries", id: "mon_t", input: { row: "7301" } });
    expect(seen.calls[2].url).toContain("row=7301");
    const bad = await manage(KEYED, { area: "monitors", action: "runs", id: "mon_t", input: { include: "everything" } });
    expect(bad.text).toMatch(/^Error: Invalid parameter value/);
    expect(seen.calls).toHaveLength(3);
  });

  it("cohorts query accepts match and topics through the manage schema", async () => {
    const seen = stub(202, { query_id: "Q2StGXR8xZ5jdHi6BamyT" });
    const out = await manage(KEYED, {
      area: "cohorts",
      action: "query",
      id: "V1StGXR8xZ5jdHi6BamyT",
      input: {
        keywords: ["apple"],
        date_from: "2026-08-01T00:00:00.000Z",
        max_pages_per_identity: 1,
        max_items_per_identity: 10,
        max_credits: 50,
        match: "both",
        topics: [{ id: "apple_inc", description: "Apple the company" }],
      },
    });
    expect(out.text).toContain("not billed");
    expect(JSON.parse(seen.calls[0].body!)).toMatchObject({ match: "both", topics: [{ id: "apple_inc", description: "Apple the company" }] });
    const bad = await manage(KEYED, {
      area: "cohorts",
      action: "query",
      id: "V1StGXR8xZ5jdHi6BamyT",
      input: { keywords: ["a"], topics: [{ id: "bad id", description: "x" }] },
    });
    expect(bad.text).toMatch(/^Error: Invalid parameter value/);
    expect(seen.calls).toHaveLength(1);
  });
});
