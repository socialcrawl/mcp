import { describe, it, expect, vi, afterEach } from "vitest";
import { manage, MANAGE_ACTIONS, DRY_RUN_ACTIONS } from "../tools/manage.js";
import type { ManageParams } from "../tools/manage.js";
import { LONG_READ_TIMEOUT_MS, resolveFollowUrl } from "../tools/async-common.js";
import { discoverRuns } from "../tools/discover-runs.js";
import { events } from "../tools/events.js";
import { DiscoverInputSchema, EventsInputSchema, ReviewHistoryInputSchema } from "../schemas/async.js";
import { DISCOVER_RUNS_DOC, EVENTS_DOC } from "../data/docs-async.js";
import { getAvailableTopics, getDoc } from "../data/docs.js";
import { findBanned } from "./fixtures/supplier-tokens.js";
import type { ApiContext } from "../context.js";

const BASE = "https://www.socialcrawl.dev";
const ctx: ApiContext = { apiKey: "sc_test_key", baseUrl: BASE };
const anonCtx: ApiContext = { apiKey: "", baseUrl: BASE };

const JOB_ID = "bj_ziJygy91eDlzFJLzzUgIY";
const REVIEW_JOB_ID = "job_ziJygy91eDlzFJLzzUgIY";
const RUN_ID = "run_abcdefghijklmnopqrstuv";
const SCHEDULE_ID = "dsch_abcdefghijklmnopqrstu";
const WE_ID = "we_V1StGXR8Z5jdHi6BmyTab";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Captured {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
  calls: number;
}

function stubFetch(status: number, payload: unknown, raw?: string): () => Captured {
  const cap: Captured = { url: "", method: "", headers: {}, calls: 0 };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    cap.calls += 1;
    cap.url = url;
    cap.method = (init.method ?? "GET").toString();
    cap.body = init.body as string | undefined;
    cap.headers = (init.headers as Record<string, string>) ?? {};
    const text = raw ?? (status === 204 ? null : JSON.stringify(payload));
    return new Response(text, { status });
  });
  return () => cap;
}

function forbidFetch(): ReturnType<typeof vi.fn> {
  const spy = vi.fn();
  vi.stubGlobal("fetch", spy);
  return spy;
}

const ok = (data: unknown, extra: Record<string, unknown> = {}) => ({ success: true, data, credits_used: 0, request_id: "req-1", ...extra });

const call = (area: ManageParams["area"], action: string, id?: string, input?: Record<string, unknown>, more: Partial<ManageParams> = {}) =>
  manage(ctx, { area, action, ...(id ? { id } : {}), ...(input ? { input } : {}), ...more });

describe("socialcrawl_manage — the new areas", () => {
  it("lists every action from the area schemas", () => {
    expect(MANAGE_ACTIONS.discover).toEqual([
      "run_list",
      "run_get",
      "run_export",
      "run_legs",
      "run_cancel",
      "run_resume",
      "run_more",
      "schedule_list",
      "schedule_get",
      "schedule_pause",
      "schedule_resume",
      "schedule_delete",
      "follow",
    ]);
    expect(MANAGE_ACTIONS.review_history).toEqual(["get"]);
    expect(MANAGE_ACTIONS.events).toEqual([
      "feed",
      "ack",
      "endpoint_create",
      "endpoint_list",
      "endpoint_get",
      "endpoint_update",
      "endpoint_delete",
      "endpoint_rotate_secret",
      "endpoint_test",
      "endpoint_attempts",
    ]);
  });

  it("offers no dry run on routes that do not read it, and refuses one free", async () => {
    expect(DRY_RUN_ACTIONS.discover).toEqual([]);
    expect(DRY_RUN_ACTIONS.review_history).toEqual([]);
    expect(DRY_RUN_ACTIONS.events).toEqual([]);
    const spy = forbidFetch();
    const out = await call("discover", "run_resume", RUN_ID, undefined, { dry_run: true });
    expect(out.text).toMatch(/^Error: dry_run is only for/);
    expect(out.structured).toMatchObject({ ok: false });
    const evt = await call("events", "endpoint_create", undefined, { url: "https://example.com/h", dry_run: true });
    expect(evt.text).toMatch(/^Error: dry_run is only for/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects an unknown action with the area's list, free", async () => {
    const spy = forbidFetch();
    const out = await call("discover", "run_status", RUN_ID);
    expect(out.text).toContain('Unknown action "run_status"');
    expect(out.text).toContain("run_get");
    expect(spy).not.toHaveBeenCalled();
  });

  it("requires an API key", async () => {
    const out = await manage(anonCtx, { area: "events", action: "feed" });
    expect(out.text).toContain("No API key configured");
    expect(out.structured).toMatchObject({ ok: false, code: "NO_API_KEY" });
  });

  it("refuses unknown fields and an Idempotency-Key the area does not take, free", async () => {
    const spy = forbidFetch();
    const bad = await call("discover", "run_get", RUN_ID, { nope: 1 });
    expect(bad.text).toMatch(/^Error: Invalid parameter value\(s\) for socialcrawl_manage area "discover"/);
    expect(bad.structured).toMatchObject({ ok: false, code: "INVALID_PARAMETER" });
    const key = await call("discover", "run_more", RUN_ID, {}, { idempotencyKey: "11111111-1111-4111-8111-111111111111" });
    expect(key.text).toContain("idempotencyKey");
    const review = await call("review_history", "get", REVIEW_JOB_ID, { wait_s: 5 });
    expect(review.text).toMatch(/^Error: Invalid parameter value/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("SECURITY: ids are checked before any path is built", () => {
  it("refuses path-traversal ids on every id-taking area without calling the API", async () => {
    const spy = forbidFetch();
    for (const evil of ["../credits/balance", "run_x/../../y", "run_abcdefgh?x=1", "run_abc%2F..", "run_", "bj_abcdefghijk"]) {
      expect((await call("discover", "run_cancel", evil)).text, evil).toMatch(/^Error: Invalid parameter value/);
    }
    for (const evil of ["../x", "dsch_abc/..", "run_abcdefghijklmnop"]) {
      expect((await call("discover", "schedule_delete", evil)).text, evil).toMatch(/^Error: Invalid parameter value/);
    }
    for (const evil of ["../credits", JOB_ID, "job_a/b"]) {
      expect((await call("review_history", "get", evil)).text, evil).toMatch(/^Error: Invalid parameter value/);
    }
    for (const evil of ["../credits/balance", "we_x/../../y", "we_abc?x=1", "we_abc%2F..", "we_"]) {
      expect((await call("events", "endpoint_delete", evil)).text, evil).toMatch(/^Error: Invalid parameter value/);
    }
    for (const evil of ["../x", "Main", "a/b", "a b", "x".repeat(65)]) {
      expect((await call("events", "ack", evil, { cursor: "c_x" })).text, evil).toMatch(/^Error: Invalid parameter value/);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("the tools re-check the ids for non-MCP callers", async () => {
    const spy = forbidFetch();
    expect(await discoverRuns(ctx, { action: "run_cancel", run_id: "../credits/balance" })).toContain("Invalid parameter value");
    expect(await discoverRuns(ctx, { action: "schedule_delete", schedule_id: "../x" })).toContain("Invalid parameter value");
    expect(await events(ctx, { action: "endpoint_delete", endpoint_id: "../x" })).toContain("Invalid parameter value");
    expect(await events(ctx, { action: "ack", consumer: "../x", cursor: "c" })).toContain("Invalid parameter value");
    expect(spy).not.toHaveBeenCalled();
  });

  it("id-requiring actions say which id is missing, free", async () => {
    const spy = forbidFetch();
    for (const action of ["run_get", "run_export", "run_legs", "run_cancel", "run_resume", "run_more"]) {
      const out = await call("discover", action);
      expect(out.text, action).toMatch(/^Error: Missing required parameter\(s\): `id` \(the run_id/);
      expect(out.structured).toMatchObject({ ok: false, code: "MISSING_PARAMETER" });
    }
    for (const action of ["schedule_get", "schedule_pause", "schedule_resume", "schedule_delete"]) {
      expect((await call("discover", action)).text, action).toContain("the schedule_id");
    }
    expect((await call("review_history", "get")).text).toContain("the job_id");
    for (const action of ["endpoint_get", "endpoint_update", "endpoint_delete", "endpoint_rotate_secret", "endpoint_test", "endpoint_attempts"]) {
      expect((await call("events", action)).text, action).toContain("webhook endpoint id");
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("the zod schemas enforce the same shapes and are strict", () => {
    expect(DiscoverInputSchema.safeParse({ action: "run_get", run_id: RUN_ID }).success).toBe(true);
    expect(DiscoverInputSchema.safeParse({ action: "run_get", run_id: "../x" }).success).toBe(false);
    expect(DiscoverInputSchema.safeParse({ action: "run_more", feedback: { accept: Array(101).fill("r") } }).success).toBe(false);
    expect(DiscoverInputSchema.safeParse({ action: "run_get", include: "posts" }).success).toBe(false);
    expect(DiscoverInputSchema.safeParse({ action: "run_get", wait_s: 30 }).success).toBe(false);
    expect(ReviewHistoryInputSchema.safeParse({ action: "get", job_id: REVIEW_JOB_ID, platform: "yelp" }).success).toBe(false);
    expect(EventsInputSchema.safeParse({ action: "endpoint_get", endpoint_id: WE_ID }).success).toBe(true);
    expect(EventsInputSchema.safeParse({ action: "ack", consumer: "Bad Name" }).success).toBe(false);
    expect(EventsInputSchema.safeParse({ action: "feed", types: ["Discover.Completed"] }).success).toBe(false);
    expect(EventsInputSchema.safeParse({ action: "feed", types: ["discover.*", "*", "discover.completed"] }).success).toBe(true);
    expect(EventsInputSchema.safeParse({ action: "feed", nope: 1 }).success).toBe(false);
  });
});

describe("discover runs", () => {
  it("run_list sends only the declared list params; id is a schedule filter", async () => {
    const cap = stubFetch(200, ok({ items: [] }));
    const out = await call("discover", "run_list", SCHEDULE_ID, {
      status: "running,paused",
      kind: "background",
      created_after: "2026-10-01",
      page_size: 50,
    });
    const url = new URL(cap().url);
    expect(url.pathname).toBe("/v1/prism/discover/runs");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: "running,paused",
      kind: "background",
      schedule_id: SCHEDULE_ID,
      created_after: "2026-10-01",
      page_size: "50",
    });
    expect(out.structured).toMatchObject({ ok: true });
    expect(out.text).toContain("**Credit cost:** 0 credits");
  });

  it("run_get forwards filters, wait_s and tag.<key> params with a long client timeout", async () => {
    const cap = stubFetch(200, ok({ run: { run_id: RUN_ID, status: "running" }, next: { status_url: "x" } }));
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const out = await call("discover", "run_get", RUN_ID, {
      wait_s: 25,
      view: "accounts",
      page_size: 100,
      changes_since: 7,
      include_pending: true,
      include: "dropped",
      state: "all",
      tags: { region: "eu" },
    });
    const url = new URL(cap().url);
    expect(cap().method).toBe("GET");
    expect(url.pathname).toBe(`/v1/prism/discover/runs/${RUN_ID}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      wait_s: "25",
      view: "accounts",
      page_size: "100",
      changes_since: "7",
      include_pending: "true",
      include: "dropped",
      state: "all",
      "tag.region": "eu",
    });
    expect(LONG_READ_TIMEOUT_MS).toBeGreaterThan(25_000 + 20_000);
    expect(setTimeoutSpy.mock.calls.some((c) => c[1] === LONG_READ_TIMEOUT_MS)).toBe(true);
    expect(out.text).toContain('action "follow"');
    expect(out.text).toContain("0 credits");
  });

  it("refuses bad page_size, tag keys and export paging locally", async () => {
    const spy = forbidFetch();
    expect((await call("discover", "run_get", RUN_ID, { page_size: 200 })).text).toContain("1 to 100");
    expect((await call("discover", "run_get", RUN_ID, { tags: { "a&b": "x" } })).text).toContain("tag key");
    expect((await call("discover", "run_export", RUN_ID, { wait_s: 5 })).text).toContain("run_export takes no");
    expect((await call("discover", "run_list", undefined, { page_size: 101 })).text).toContain("1 to 100");
    expect(spy).not.toHaveBeenCalled();
  });

  it("run_export GETs results.jsonl and renders NDJSON", async () => {
    const ndjson = '{"id":"r1"}\n{"id":"r2"}\n{"complete":true}\n';
    const cap = stubFetch(200, null, ndjson);
    const out = await call("discover", "run_export", RUN_ID, { platform: "tiktok" });
    expect(cap().url).toBe(`${BASE}/v1/prism/discover/runs/${RUN_ID}/results.jsonl?platform=tiktok`);
    expect(out.text).toContain("```jsonl");
    expect(out.text).toContain('{"complete":true}');
  });

  it("run_legs GETs the legs path with paging", async () => {
    const cap = stubFetch(200, ok({ items: [] }));
    await call("discover", "run_legs", RUN_ID, { page_size: 500, cursor: "c1" });
    expect(cap().url).toBe(`${BASE}/v1/prism/discover/runs/${RUN_ID}/legs?cursor=c1&page_size=500`);
  });

  it("run_cancel DELETEs the run and says rows are kept", async () => {
    const cap = stubFetch(200, ok({ run: { run_id: RUN_ID, status: "cancelled" } }));
    const out = await call("discover", "run_cancel", RUN_ID);
    expect(cap().method).toBe("DELETE");
    expect(cap().url).toBe(`${BASE}/v1/prism/discover/runs/${RUN_ID}`);
    expect(out.text).toContain("Rows are kept");
  });

  it("run_resume POSTs only max_credits and retry_failed, with no query", async () => {
    const cap = stubFetch(202, ok({ run: { run_id: RUN_ID, status: "running" } }));
    const out = await call("discover", "run_resume", RUN_ID, { max_credits: 500, retry_failed: true });
    expect(cap().method).toBe("POST");
    expect(cap().url).toBe(`${BASE}/v1/prism/discover/runs/${RUN_ID}/resume`);
    expect(JSON.parse(cap().body!)).toEqual({ max_credits: 500, retry_failed: true });
    expect(out.text).toContain("0 for the resume itself");
    expect(out.text).toContain("never paid twice");
  });

  it("run_resume sends an empty object when no field is given", async () => {
    const cap = stubFetch(202, ok({}));
    await call("discover", "run_resume", RUN_ID);
    expect(cap().body).toBe("{}");
  });

  it("run_more POSTs the more body without an Idempotency-Key and is labelled metered", async () => {
    const cap = stubFetch(202, ok({ more: { since_version: 4, legs_added: 3 } }));
    const out = await call("discover", "run_more", RUN_ID, {
      new_searches: true,
      feedback: { accept: ["row1"], reject: ["tiktok:123"] },
      max_credits: 900,
      pages: 2,
    });
    expect(cap().url).toBe(`${BASE}/v1/prism/discover/runs/${RUN_ID}/more`);
    expect(JSON.parse(cap().body!)).toEqual({
      new_searches: true,
      feedback: { accept: ["row1"], reject: ["tiktok:123"] },
      max_credits: 900,
      pages: 2,
    });
    expect(cap().headers["Idempotency-Key"]).toBeUndefined();
    expect(out.text).toContain("metered");
    expect(out.text).toContain("since_version");
  });

  it("run_more refuses accept-feedback without new_searches", async () => {
    const spy = forbidFetch();
    const out = await call("discover", "run_more", RUN_ID, { feedback: { accept: ["r"] } });
    expect(out.text).toContain("needs `new_searches: true`");
    expect(spy).not.toHaveBeenCalled();
  });

  it("passes a 410 RUN_EXPIRED through with guidance", async () => {
    stubFetch(410, { success: false, error: { type: "RUN_EXPIRED", message: "This run's retention passed." } });
    const out = await call("discover", "run_get", RUN_ID);
    expect(out.text).toContain("RUN_EXPIRED");
    expect(out.text).toContain("Start a new run");
    expect(out.structured).toMatchObject({ ok: false, code: "RUN_EXPIRED" });
  });

  it("passes a 409 run_not_completed through with guidance", async () => {
    stubFetch(409, {
      success: false,
      error: {
        type: "RUN_STATE_CONFLICT",
        message: "This run is running; more is offered only on a completed run.",
        details: { reason: "run_not_completed" },
      },
    });
    const out = await call("discover", "run_more", RUN_ID);
    expect(out.text).toContain("RUN_STATE_CONFLICT");
    expect(out.text).toContain("only on a completed run");
  });

  it("cleans a 404 so it does not send the agent to the endpoint finder", async () => {
    stubFetch(404, { success: false, error: { type: "RUN_NOT_FOUND", message: "No run run_x for this account." } });
    const out = await call("discover", "run_get", RUN_ID);
    expect(out.text).toContain("Not found (404)");
    expect(out.text).toContain("No run run_x for this account.");
    expect(out.text).not.toContain("socialcrawl_find");
  });
});

describe("discover schedules", () => {
  it("schedule_list GETs with status and page_size", async () => {
    const cap = stubFetch(200, ok({ items: [] }));
    await call("discover", "schedule_list", undefined, { status: "active,paused", page_size: 10 });
    expect(cap().url).toBe(`${BASE}/v1/prism/discover/schedules?status=active%2Cpaused&page_size=10`);
  });

  it("schedule_get / pause / resume / delete hit the right routes and methods", async () => {
    let cap = stubFetch(200, ok({ schedule: { schedule_id: SCHEDULE_ID } }));
    await call("discover", "schedule_get", SCHEDULE_ID);
    expect(cap().method).toBe("GET");
    expect(cap().url).toBe(`${BASE}/v1/prism/discover/schedules/${SCHEDULE_ID}`);

    cap = stubFetch(200, ok({}));
    await call("discover", "schedule_pause", SCHEDULE_ID);
    expect(cap().method).toBe("POST");
    expect(cap().url).toBe(`${BASE}/v1/prism/discover/schedules/${SCHEDULE_ID}/pause`);
    expect(cap().body).toBeUndefined();

    cap = stubFetch(200, ok({}));
    await call("discover", "schedule_resume", SCHEDULE_ID, { max_credits_per_run: 100, max_credits_per_month: null });
    expect(cap().url).toBe(`${BASE}/v1/prism/discover/schedules/${SCHEDULE_ID}/resume`);
    expect(JSON.parse(cap().body!)).toEqual({ max_credits_per_run: 100, max_credits_per_month: null });

    cap = stubFetch(200, ok({ deleted: true }));
    const out = await call("discover", "schedule_delete", SCHEDULE_ID);
    expect(cap().method).toBe("DELETE");
    expect(out.text).toContain("0 credits");
  });

  it("schedule_resume refuses a month cap below the run cap", async () => {
    const spy = forbidFetch();
    const out = await call("discover", "schedule_resume", SCHEDULE_ID, { max_credits_per_run: 500, max_credits_per_month: 100 });
    expect(out.text).toContain("below");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("review history", () => {
  it("polls a pending job (default platform trustpilot)", async () => {
    const cap = stubFetch(200, ok({ job_id: REVIEW_JOB_ID, status: "running", credits_hold: 30 }));
    const out = await call("review_history", "get", REVIEW_JOB_ID);
    expect(cap().url).toBe(`${BASE}/v1/trustpilot/reviews/history/${REVIEW_JOB_ID}`);
    expect(out.text).toContain("Not ready");
    expect(out.text).toContain("0 credits");
  });

  it("pages a finished job with offset/limit", async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: String(i) }));
    const cap = stubFetch(200, ok({ items }));
    const out = await call("review_history", "get", REVIEW_JOB_ID, { platform: "tripadvisor", offset: 20, limit: 10 });
    expect(cap().url).toBe(`${BASE}/v1/tripadvisor/reviews/history/${REVIEW_JOB_ID}?offset=20&limit=10`);
    expect(out.text).toContain("offset 30");
  });

  it("refuses an unsupported platform locally", async () => {
    const spy = forbidFetch();
    const out = await call("review_history", "get", REVIEW_JOB_ID, { platform: "../credits" });
    expect(out.text).toMatch(/^Error: Invalid parameter value/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("follow", () => {
  it("follows a status_url on the configured base, preserving its query", async () => {
    const cap = stubFetch(200, ok({ run: { run_id: RUN_ID } }));
    const out = await call("discover", "follow", undefined, { url: `${BASE}/v1/prism/discover/runs/${RUN_ID}?wait_s=25` });
    expect(cap().method).toBe("GET");
    expect(cap().url).toBe(`${BASE}/v1/prism/discover/runs/${RUN_ID}?wait_s=25`);
    expect(out.text).toContain("0 credits");
  });

  it("takes the URL as id too, and follows a relative attempts URL", async () => {
    const cap = stubFetch(200, ok({ items: [] }));
    await call("discover", "follow", `/v1/webhook-endpoints/${WE_ID}/attempts`);
    expect(cap().url).toBe(`${BASE}/v1/webhook-endpoints/${WE_ID}/attempts`);
  });

  it("SECURITY: refuses other hosts, billable continue_urls, POST urls and unknown routes", async () => {
    const spy = forbidFetch();
    const cases: [string, string][] = [
      [`https://evil.example.com/v1/prism/discover/runs/${RUN_ID}`, "not on the configured SocialCrawl API"],
      [`https://user:pw@www.socialcrawl.dev/v1/prism/jobs`, "not on the configured SocialCrawl API"],
      [`http://www.socialcrawl.dev/v1/prism/jobs`, "not on the configured SocialCrawl API"],
      [`${BASE}/v1/prism/discover?keywords=a&continue=tok`, "continue_url"],
      [`${BASE}/v1/prism/discover/runs/${RUN_ID}/resume`, "run_resume"],
      [`${BASE}/v1/prism/discover/runs/${RUN_ID}/more`, "run_more"],
      [`${BASE}/v1/events/consumers/main/ack`, '"ack"'],
      [`${BASE}/v1/webhook-endpoints/${WE_ID}/rotate-secret`, "endpoint_rotate_secret"],
      [`${BASE}/v1/credits/balance`, "not one of the free read routes"],
      [`${BASE}/v1/prism/discover/runs/${RUN_ID}/../../../credits/balance`, "not one of the free read routes"],
      [`${BASE}/v1/prism/discover/runs/run_x%2F..%2Fy`, "not one of the free read routes"],
      ["javascript:alert(1)", "not on the configured SocialCrawl API"],
    ];
    for (const [url, expected] of cases) {
      const out = await call("discover", "follow", undefined, { url });
      expect(out.text, url).toContain(expected);
      expect(out.structured, url).toMatchObject({ ok: false });
    }
    expect((await call("discover", "follow")).text).toContain("`url`");
    expect(spy).not.toHaveBeenCalled();
  });

  it("stays under a base URL that has a path prefix", () => {
    const prefixed: ApiContext = { apiKey: "k", baseUrl: "https://api.example.com/sc" };
    expect(resolveFollowUrl(prefixed, `https://api.example.com/sc/v1/prism/discover/runs/${RUN_ID}`)).toEqual({
      path: `/v1/prism/discover/runs/${RUN_ID}`,
      longRead: true,
    });
    expect(resolveFollowUrl(prefixed, `https://api.example.com/v1/prism/discover/runs/${RUN_ID}`)).toHaveProperty("error");
  });

  it("marks long reads", () => {
    expect(resolveFollowUrl(ctx, `${BASE}/v1/prism/discover/runs/${RUN_ID}`)).toEqual({ path: `/v1/prism/discover/runs/${RUN_ID}`, longRead: true });
    expect(resolveFollowUrl(ctx, `${BASE}/v1/prism/jobs/${JOB_ID}?cursor=5`)).toEqual({ path: `/v1/prism/jobs/${JOB_ID}?cursor=5`, longRead: false });
    expect(resolveFollowUrl(ctx, `${BASE}/v1/events?cursor=c_x&wait_s=25`)).toEqual({ path: "/v1/events?cursor=c_x&wait_s=25", longRead: true });
  });
});

describe("events feed and ack", () => {
  it("reads from a cursor with filters, long-polls with a long client timeout, and says it is free", async () => {
    const cap = stubFetch(
      200,
      ok({ items: [], next: { poll_url: `${BASE}/v1/events?cursor=c_next&wait_s=25` } }, { pagination: { next_cursor: "c_next", has_more: false } }),
    );
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const out = await call("events", "feed", undefined, {
      cursor: "oldest",
      types: ["discover.*", "endpoint.disabled"],
      subject_ids: ["run_abc", "dsch_def"],
      limit: 200,
      wait_s: 25,
    });
    const url = new URL(cap().url);
    expect(cap().method).toBe("GET");
    expect(url.pathname).toBe("/v1/events");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      cursor: "oldest",
      types: "discover.*,endpoint.disabled",
      subject_id: "run_abc,dsch_def",
      limit: "200",
      wait_s: "25",
    });
    expect(setTimeoutSpy.mock.calls.some((c) => c[1] === LONG_READ_TIMEOUT_MS)).toBe(true);
    expect(out.text).toContain("**Credit cost:** 0 credits");
    expect(out.text).toContain("cursor `c_next`");
  });

  it("reads as a named consumer (id) and tells the agent to ack", async () => {
    const cap = stubFetch(200, ok({ items: [{ id: "evt_1" }], unread: 1 }, { pagination: { next_cursor: "c_9", has_more: false } }));
    const out = await call("events", "feed", "main", { start: "oldest" });
    expect(cap().url).toBe(`${BASE}/v1/events?consumer=main&start=oldest`);
    expect(out.text).toContain('action "ack"');
    expect(out.text).toContain("c_9");
  });

  it("refuses cursor + consumer and start without consumer, locally", async () => {
    const spy = forbidFetch();
    expect((await call("events", "feed", "main", { cursor: "now" })).text).toContain("not both");
    expect((await call("events", "feed", undefined, { start: "now" })).text).toContain("new named consumer");
    expect((await call("events", "feed", undefined, { types: ["Bad"] })).text).toMatch(/^Error: Invalid parameter value/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("passes a 410 CURSOR_EXPIRED through with restart guidance", async () => {
    stubFetch(410, {
      success: false,
      error: {
        type: "CURSOR_EXPIRED",
        message: "This cursor is older than the 30-day retention: events after it were deleted.",
        details: { reason: "retention_passed", oldest_cursor: "c_old" },
      },
    });
    const out = await call("events", "feed", undefined, { cursor: "c_ancient" });
    expect(out.text).toContain("CURSOR_EXPIRED");
    expect(out.text).toContain("Events were missed");
    expect(out.text).toContain('cursor "oldest"');
    expect(out.structured).toMatchObject({ ok: false });
  });

  it("ack POSTs the cursor to the consumer's ack route", async () => {
    const cap = stubFetch(200, ok({ consumer: { name: "main", committed_cursor: "c_9", unread: 0 } }));
    const out = await call("events", "ack", "main", { cursor: "c_9" });
    expect(cap().method).toBe("POST");
    expect(cap().url).toBe(`${BASE}/v1/events/consumers/main/ack`);
    expect(JSON.parse(cap().body!)).toEqual({ cursor: "c_9" });
    expect(out.text).toContain("0 credits");
  });

  it("ack requires a consumer and a real cursor", async () => {
    const spy = forbidFetch();
    expect((await call("events", "ack", "main")).text).toMatch(/^Error: Missing required parameter/);
    expect((await call("events", "ack", "main", { cursor: "oldest" })).text).toContain("not oldest/now");
    expect(spy).not.toHaveBeenCalled();
  });

  it("maps an unknown consumer 404 with guidance", async () => {
    stubFetch(404, {
      success: false,
      error: { type: "RESOURCE_NOT_FOUND", message: "This key has no consumer named ghost.", details: { reason: "unknown_consumer" } },
    });
    const out = await call("events", "ack", "ghost", { cursor: "c_1" });
    expect(out.text).toContain("no consumer named ghost");
    expect(out.text).toContain("created by its first read");
  });
});

describe("webhook endpoints", () => {
  it("endpoint_create POSTs with a generated Idempotency-Key and warns the secret is shown once", async () => {
    const cap = stubFetch(201, ok({ endpoint: { id: WE_ID }, secret: "whsec_abc" }));
    const out = await call("events", "endpoint_create", undefined, {
      url: "https://example.com/hooks/socialcrawl",
      types: ["discover.*"],
      description: "prod",
      subject_ids: ["dsch_abc"],
    });
    const c = cap();
    expect(c.method).toBe("POST");
    expect(c.url).toBe(`${BASE}/v1/webhook-endpoints`);
    expect(c.headers["Idempotency-Key"]).toMatch(UUID_RE);
    expect(JSON.parse(c.body!)).toEqual({
      url: "https://example.com/hooks/socialcrawl",
      types: ["discover.*"],
      description: "prod",
      subject_ids: ["dsch_abc"],
    });
    expect(out.text).toContain("(generated)");
    expect(out.text).toContain("shown ONCE");
    expect(out.text).toContain("whsec_abc");
  });

  it("endpoint_create forwards a caller key and flags a replay that withholds the secret", async () => {
    const cap = stubFetch(201, ok({ endpoint: { id: WE_ID }, secret: null }));
    const key = "11111111-1111-4111-8111-111111111111";
    const out = await call("events", "endpoint_create", undefined, { url: "https://example.com/h" }, { idempotencyKey: key });
    expect(cap().headers["Idempotency-Key"]).toBe(key);
    expect(out.text).toContain("secret is withheld");
  });

  it("endpoint_create validates locally", async () => {
    const spy = forbidFetch();
    expect((await call("events", "endpoint_create")).text).toContain("`url`");
    expect((await call("events", "endpoint_create", undefined, { url: "http://example.com/h" })).text).toContain("https");
    expect((await call("events", "endpoint_create", undefined, { url: "https://example.com/h", subject_ids: [] })).text).toMatch(
      /^Error: Invalid parameter value/,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("endpoint_create passes the 20-per-key limit through with guidance", async () => {
    stubFetch(400, {
      success: false,
      error: { type: "INVALID_REQUEST", message: "This key already has 20 webhook endpoints, the most one key can hold.", details: { reason: "limit_reached" } },
    });
    const out = await call("events", "endpoint_create", undefined, { url: "https://example.com/h" });
    expect(out.text).toContain("20 webhook endpoints");
    expect(out.text).toContain("endpoint_delete");
  });

  it("endpoint_list GETs with limit/cursor/status", async () => {
    const cap = stubFetch(200, ok({ items: [] }));
    await call("events", "endpoint_list", undefined, { limit: 10, cursor: "c_x", status: "enabled" });
    expect(cap().url).toBe(`${BASE}/v1/webhook-endpoints?limit=10&cursor=c_x&status=enabled`);
    const spy = forbidFetch();
    expect((await call("events", "endpoint_list", undefined, { limit: 101 })).text).toContain("1 to 100");
    expect(spy).not.toHaveBeenCalled();
  });

  it("endpoint_get, endpoint_delete and endpoint_attempts hit the endpoint's routes", async () => {
    let cap = stubFetch(200, ok({ endpoint: { id: WE_ID } }));
    await call("events", "endpoint_get", WE_ID);
    expect(cap().method).toBe("GET");
    expect(cap().url).toBe(`${BASE}/v1/webhook-endpoints/${WE_ID}`);
    cap = stubFetch(200, ok({ id: WE_ID, deleted: true }));
    await call("events", "endpoint_delete", WE_ID);
    expect(cap().method).toBe("DELETE");
    expect(cap().url).toBe(`${BASE}/v1/webhook-endpoints/${WE_ID}`);
    cap = stubFetch(200, ok({ items: [] }));
    await call("events", "endpoint_attempts", WE_ID, { limit: 5 });
    expect(cap().url).toBe(`${BASE}/v1/webhook-endpoints/${WE_ID}/attempts?limit=5`);
  });

  it("endpoint_update PATCHes only the fields given, null included", async () => {
    const cap = stubFetch(200, ok({ endpoint: { id: WE_ID } }));
    const out = await call("events", "endpoint_update", WE_ID, { status: "enabled", description: null, subject_ids: null });
    expect(cap().method).toBe("PATCH");
    expect(JSON.parse(cap().body!)).toEqual({ status: "enabled", description: null, subject_ids: null });
    expect(out.text).toContain("resumes parked deliveries");
  });

  it("endpoint_update needs at least one field", async () => {
    const spy = forbidFetch();
    expect((await call("events", "endpoint_update", WE_ID)).text).toContain("at least one");
    expect(spy).not.toHaveBeenCalled();
  });

  it("endpoint_rotate_secret POSTs with no body and a generated Idempotency-Key", async () => {
    const cap = stubFetch(200, ok({ endpoint: { id: WE_ID }, secret: "whsec_new" }));
    const out = await call("events", "endpoint_rotate_secret", WE_ID);
    expect(cap().method).toBe("POST");
    expect(cap().url).toBe(`${BASE}/v1/webhook-endpoints/${WE_ID}/rotate-secret`);
    expect(cap().body).toBeUndefined();
    expect(cap().headers["Idempotency-Key"]).toMatch(UUID_RE);
    expect(out.text).toContain("24 hours");
    expect(out.text).toContain("shown ONCE");
  });

  it("endpoint_test POSTs the sample type, or no body without one", async () => {
    let cap = stubFetch(200, ok({ type: "discover.completed", attempt: { outcome: "delivered" } }));
    await call("events", "endpoint_test", WE_ID, { type: "discover.completed" });
    expect(cap().url).toBe(`${BASE}/v1/webhook-endpoints/${WE_ID}/test`);
    expect(JSON.parse(cap().body!)).toEqual({ type: "discover.completed" });
    cap = stubFetch(200, ok({}));
    await call("events", "endpoint_test", WE_ID);
    expect(cap().body).toBeUndefined();
  });

  it("maps an unowned endpoint 404 with guidance", async () => {
    stubFetch(404, {
      success: false,
      error: { type: "RESOURCE_NOT_FOUND", message: `No webhook endpoint ${WE_ID} for this API key.`, details: { reason: "unknown_webhook_endpoint" } },
    });
    const out = await call("events", "endpoint_get", WE_ID);
    expect(out.text).toContain("No webhook endpoint");
    expect(out.text).toContain("endpoint_list");
  });
});

describe("the discover-runs and events docs topics", () => {
  it("are offered as topics and served by getDoc", () => {
    expect(getAvailableTopics()).toEqual(expect.arrayContaining(["discover-runs", "events"]));
    expect(getDoc("discover-runs")).toBe(DISCOVER_RUNS_DOC);
    expect(getDoc("events")).toBe(EVENTS_DOC);
  });

  it("document billing, every route and the follow guard, naming no supplier", () => {
    for (const needle of ["discover/runs", "discover/schedules", "reviews/history", "continue_url", "free", "bills", "No dry_run"]) {
      expect(DISCOVER_RUNS_DOC, needle).toMatch(new RegExp(needle.replace(/[/]/g, "\\/"), "i"));
    }
    for (const needle of ["/v1/events", "CURSOR_EXPIRED", "20 per API key", "shown ONCE", "0 credits"]) {
      expect(EVENTS_DOC, needle).toContain(needle);
    }
    expect(findBanned(DISCOVER_RUNS_DOC)).toBeUndefined();
    expect(findBanned(EVENTS_DOC)).toBeUndefined();
  });
});
