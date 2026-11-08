import { describe, it, expect, vi, afterEach } from "vitest";
import { manage, MANAGE_ACTIONS, DRY_RUN_ACTIONS } from "../tools/manage.js";
import type { ManageParams } from "../tools/manage.js";
import { LONG_READ_TIMEOUT_MS, resolveFollowUrl } from "../tools/async-common.js";
import { ManageInputSchema } from "../schemas/tools.js";
import { getAvailableTopics, getDoc } from "../data/docs.js";
import type { ApiContext } from "../context.js";

/**
 * UPGRADE-LOG API-073 / API-077 / API-091 (universal search runs, lists,
 * watches, `more`, follow-ups) and API-062 / API-082 (creator runs + save).
 * These routes live outside the registry, so the registry dump never carries
 * them: `socialcrawl_manage` areas `search_runs` and `creator_runs` are
 * hand-written against the backend route code
 * (prism/discover/jobs/routes.ts createSearchRunsRouter, meta-search/
 * list-watch-routes.ts, list-actions.ts, list-more.ts, list-followups.ts,
 * creators/follow.ts).
 */

const BASE = "https://www.socialcrawl.dev";
const ctx: ApiContext = { apiKey: "sc_test_key", baseUrl: BASE };
const RUN_ID = "run_abcdefghijklmnopqrstuv";
const WATCH_ID = "dsch_abcdefghijklmnopqrstu";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Captured {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
  signalTimeout?: boolean;
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
    return new Response(raw ?? JSON.stringify(payload), { status });
  });
  return () => cap;
}

const forbidFetch = () => {
  const spy = vi.fn();
  vi.stubGlobal("fetch", spy);
  return spy;
};

const ok = (data: unknown) => ({ success: true, data, credits_used: 0, request_id: "req-1" });
const call = (area: ManageParams["area"], action: string, id?: string, input?: Record<string, unknown>, more: Partial<ManageParams> = {}) =>
  manage(ctx, { area, action, ...(id ? { id } : {}), ...(input ? { input } : {}), ...more });

describe("socialcrawl_manage area search_runs — shape", () => {
  it("offers every run, watch and follow action", () => {
    expect(MANAGE_ACTIONS.search_runs).toEqual([
      "run_list",
      "run_get",
      "run_export",
      "run_legs",
      "run_cancel",
      "run_resume",
      "run_more",
      "run_include",
      "watch_list",
      "watch_get",
      "watch_pause",
      "watch_resume",
      "watch_delete",
      "follow",
    ]);
    // more and include answer a free plan + estimate under `dry_run: true`.
    expect(DRY_RUN_ACTIONS.search_runs).toEqual(["run_more", "run_include"]);
  });

  it("is an area the tool schema accepts", () => {
    expect(ManageInputSchema.safeParse({ area: "search_runs", action: "run_list" }).success).toBe(true);
    expect(ManageInputSchema.safeParse({ area: "creator_runs", action: "run_list" }).success).toBe(true);
  });
});

describe("search_runs — runs", () => {
  it("run_list sends the documented filters, free", async () => {
    const cap = stubFetch(200, ok({ items: [] }));
    const out = await call("search_runs", "run_list", undefined, { status: "running,paused", page_size: 10, created_after: "2026-11-01" });
    const u = new URL(cap().url);
    expect(u.pathname).toBe("/v1/search/everywhere/runs");
    expect(Object.fromEntries(u.searchParams)).toEqual({ status: "running,paused", page_size: "10", created_after: "2026-11-01" });
    expect(out.text).toContain("0 credits");
  });

  it("run_get long-polls with wait_s and reads with the run filters", async () => {
    const cap = stubFetch(200, ok({ run: { run_id: RUN_ID, status: "running" }, items: [] }));
    await call("search_runs", "run_get", RUN_ID, { wait_s: 25, format: "compact", sort: "recent", state: "all", max_per_platform: 5, changes_since: 3 });
    const u = new URL(cap().url);
    expect(u.pathname).toBe(`/v1/search/everywhere/runs/${RUN_ID}`);
    expect(Object.fromEntries(u.searchParams)).toEqual({ wait_s: "25", format: "compact", sort: "recent", state: "all", max_per_platform: "5", changes_since: "3" });
  });

  it("run_get refuses a wait_s above 25 without sending", async () => {
    const spy = forbidFetch();
    const out = await call("search_runs", "run_get", RUN_ID, { wait_s: 60 });
    expect(spy).not.toHaveBeenCalled();
    expect(out.structured.ok).toBe(false);
  });

  it("run_export streams results.jsonl and takes no paging", async () => {
    const cap = stubFetch(200, undefined, '{"id":"a"}\n{"complete":true,"changes_url":"x"}\n');
    const out = await call("search_runs", "run_export", RUN_ID, { platform: "tiktok" });
    expect(new URL(cap().url).pathname).toBe(`/v1/search/everywhere/runs/${RUN_ID}/results.jsonl`);
    expect(out.text).toContain("```jsonl");
    const spy = forbidFetch();
    const bad = await call("search_runs", "run_export", RUN_ID, { page_size: 10 });
    expect(spy).not.toHaveBeenCalled();
    expect(bad.structured.ok).toBe(false);
  });

  it("run_cancel is a DELETE on the run", async () => {
    const cap = stubFetch(200, ok({ items: [], run: { status: "cancelled" } }));
    await call("search_runs", "run_cancel", RUN_ID);
    expect(cap().method).toBe("DELETE");
    expect(new URL(cap().url).pathname).toBe(`/v1/search/everywhere/runs/${RUN_ID}`);
  });

  it("run_resume posts only max_credits and retry_failed", async () => {
    const cap = stubFetch(202, ok({ run: { status: "running" } }));
    await call("search_runs", "run_resume", RUN_ID, { max_credits: 400, retry_failed: true });
    expect(cap().method).toBe("POST");
    expect(new URL(cap().url).pathname).toBe(`/v1/search/everywhere/runs/${RUN_ID}/resume`);
    expect(JSON.parse(cap().body!)).toEqual({ max_credits: 400, retry_failed: true });
  });

  it("run_more posts max_credits and dry_run, carries an Idempotency-Key, and quotes 20 per search", async () => {
    const cap = stubFetch(200, ok({ plan: {}, estimate: { credits: 40 } }));
    const out = await call("search_runs", "run_more", RUN_ID, { max_credits: 100, dry_run: true }, { idempotencyKey: "abcdefghijklmnop-1" });
    expect(new URL(cap().url).pathname).toBe(`/v1/search/everywhere/runs/${RUN_ID}/more`);
    expect(JSON.parse(cap().body!)).toEqual({ max_credits: 100, dry_run: true });
    expect(cap().headers["Idempotency-Key"]).toBe("abcdefghijklmnop-1");
    expect(out.text).toMatch(/20 credits per search/);
  });

  it("run_include posts the follow-up body and refuses an unknown block locally", async () => {
    const cap = stubFetch(200, ok({ items: [], extras: [] }));
    await call("search_runs", "run_include", RUN_ID, {
      include: ["comments", "authors"],
      ids: ["r1", "r2"],
      "comments.per_post": 20,
      "comments.replies": true,
      "authors.top": 5,
      max_credits: 60,
    });
    expect(new URL(cap().url).pathname).toBe(`/v1/search/everywhere/runs/${RUN_ID}/include`);
    expect(JSON.parse(cap().body!)).toEqual({
      include: ["comments", "authors"],
      ids: ["r1", "r2"],
      "comments.per_post": 20,
      "comments.replies": true,
      "authors.top": 5,
      max_credits: 60,
    });
    const spy = forbidFetch();
    const bad = await call("search_runs", "run_include", RUN_ID, { include: ["likes"] });
    expect(spy).not.toHaveBeenCalled();
    expect(bad.structured.ok).toBe(false);
  });

  it("refuses a run id that could redirect the request", async () => {
    const spy = forbidFetch();
    for (const id of ["../credits/balance", "run_x/../../v1", "x?y=z", "run_a b"]) {
      const out = await call("search_runs", "run_cancel", id);
      expect(out.structured.ok, id).toBe(false);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("uses the long read timeout on reads", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Response(JSON.stringify(ok({ items: [] })), { status: 200 });
    });
    await call("search_runs", "run_get", RUN_ID, { wait_s: 25 });
    expect(signal).toBeDefined();
    expect(LONG_READ_TIMEOUT_MS).toBeGreaterThanOrEqual(55_000);
  });
});

describe("search_runs — watches", () => {
  it("watch_list, watch_get and watch_delete hit the watch routes", async () => {
    let cap = stubFetch(200, ok({ items: [] }));
    await call("search_runs", "watch_list", undefined, { status: "active", page_size: 5 });
    expect(new URL(cap().url).pathname).toBe("/v1/search/everywhere/watches");
    expect(Object.fromEntries(new URL(cap().url).searchParams)).toEqual({ status: "active", page_size: "5" });

    cap = stubFetch(200, ok({ watch: { watch_id: WATCH_ID } }));
    await call("search_runs", "watch_get", WATCH_ID);
    expect(new URL(cap().url).pathname).toBe(`/v1/search/everywhere/watches/${WATCH_ID}`);

    cap = stubFetch(200, ok({ watch_id: WATCH_ID, deleted: true }));
    await call("search_runs", "watch_delete", WATCH_ID);
    expect(cap().method).toBe("DELETE");
    expect(new URL(cap().url).pathname).toBe(`/v1/search/everywhere/watches/${WATCH_ID}`);
  });

  it("watch_pause and watch_resume use the schedule routes a watch is built on", async () => {
    let cap = stubFetch(200, ok({ status: "paused" }));
    await call("search_runs", "watch_pause", WATCH_ID);
    expect(cap().method).toBe("POST");
    expect(new URL(cap().url).pathname).toBe(`/v1/prism/discover/schedules/${WATCH_ID}/pause`);
    cap = stubFetch(200, ok({ status: "active" }));
    await call("search_runs", "watch_resume", WATCH_ID, { max_credits_per_run: 40 });
    expect(new URL(cap().url).pathname).toBe(`/v1/prism/discover/schedules/${WATCH_ID}/resume`);
    expect(JSON.parse(cap().body!)).toEqual({ max_credits_per_run: 40 });
  });

  it("refuses a watch id with a slash or dot", async () => {
    const spy = forbidFetch();
    const out = await call("search_runs", "watch_delete", "../../credits");
    expect(out.structured.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("socialcrawl_manage area creator_runs", () => {
  it("offers the run actions plus save", () => {
    expect(MANAGE_ACTIONS.creator_runs).toEqual([
      "run_list",
      "run_get",
      "run_export",
      "run_legs",
      "run_cancel",
      "run_resume",
      "run_more",
      "run_save",
      "follow",
    ]);
  });

  it("reads a creator run with the creator filters", async () => {
    const cap = stubFetch(200, ok({ run: { run_id: RUN_ID }, items: [] }));
    await call("creator_runs", "run_get", RUN_ID, { country: "US", account_kind: "creator", platform: "tiktok", wait_s: 10 });
    const u = new URL(cap().url);
    expect(u.pathname).toBe(`/v1/prism/creators/runs/${RUN_ID}`);
    expect(Object.fromEntries(u.searchParams)).toEqual({ country: "US", account_kind: "creator", platform: "tiktok", wait_s: "10" });
  });

  it("run_save posts the keys with an Idempotency-Key and says how to follow", async () => {
    const cap = stubFetch(201, ok({ run_id: RUN_ID, saved: 2, lists: [], next: { follow: { method: "POST", url: `${BASE}/v1/prism/discover` } } }));
    const out = await call("creator_runs", "run_save", RUN_ID, { keys: ["tiktok:a", "youtube:b"] }, { idempotencyKey: "abcdefghijklmnop-2" });
    expect(cap().method).toBe("POST");
    expect(new URL(cap().url).pathname).toBe(`/v1/prism/creators/runs/${RUN_ID}/save`);
    expect(JSON.parse(cap().body!)).toEqual({ keys: ["tiktok:a", "youtube:b"] });
    expect(cap().headers["Idempotency-Key"]).toBe("abcdefghijklmnop-2");
    expect(out.text).toContain("0 credits");
    expect(out.text).toContain("next.follow");
  });
});

describe("follow covers the new run families (API-056 absolute links)", () => {
  it("follows absolute and relative links to search and creator run reads", () => {
    for (const raw of [
      `${BASE}/v1/search/everywhere/runs/${RUN_ID}?changes_since=4`,
      `/v1/search/everywhere/runs/${RUN_ID}/results.jsonl`,
      `${BASE}/v1/search/everywhere/runs/${RUN_ID}/legs`,
      `${BASE}/v1/search/everywhere/watches/${WATCH_ID}`,
      `${BASE}/v1/prism/creators/runs/${RUN_ID}/results.jsonl`,
      `${BASE}/v1/prism/creators/runs`,
    ]) {
      const r = resolveFollowUrl(ctx, raw);
      expect("path" in r, raw).toBe(true);
    }
  });

  it("maps the billable POST links to their actions instead of following them", () => {
    for (const [raw, action] of [
      [`${BASE}/v1/search/everywhere/runs/${RUN_ID}/more`, "run_more"],
      [`${BASE}/v1/search/everywhere/runs/${RUN_ID}/include`, "run_include"],
      [`${BASE}/v1/search/everywhere/runs/${RUN_ID}/resume`, "run_resume"],
      [`${BASE}/v1/prism/creators/runs/${RUN_ID}/save`, "run_save"],
    ] as const) {
      const r = resolveFollowUrl(ctx, raw);
      expect("error" in r && r.error, raw).toContain(action);
    }
  });

  it("search_runs follow GETs the link", async () => {
    const cap = stubFetch(200, ok({ items: [] }));
    await call("search_runs", "follow", undefined, { url: `${BASE}/v1/search/everywhere/runs/${RUN_ID}?changes_since=4` });
    expect(cap().method).toBe("GET");
    expect(cap().url).toBe(`${BASE}/v1/search/everywhere/runs/${RUN_ID}?changes_since=4`);
  });
});

describe("docs", () => {
  it("documents search runs, lists and watches with their prices", () => {
    expect(getAvailableTopics()).toContain("search-runs");
    const doc = getDoc("search-runs")!;
    for (const needle of ["POST /v1/search/everywhere", "queries", "groups", "schedule", "max_credits_per_run", "20 credits", "watch_pause", "run_include", "creator_runs", "run_save"]) {
      expect(doc, needle).toContain(needle);
    }
  });
});
