import { describe, it, expect, vi, afterEach } from "vitest";
import { monitors } from "../tools/monitors.js";
import type { ApiContext } from "../context.js";

const ctx: ApiContext = { apiKey: "sc_test_key", baseUrl: "https://www.socialcrawl.dev" };
const anonCtx: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };

afterEach(() => {
  vi.restoreAllMocks();
});

interface Captured {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
}

function stubFetch(status: number, payload: unknown): () => Captured {
  const cap: Captured = { url: "", method: "", headers: {} };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    cap.url = url;
    cap.method = (init.method ?? "GET").toString();
    cap.body = init.body as string | undefined;
    cap.headers = (init.headers as Record<string, string>) ?? {};
    return new Response(status === 204 ? null : JSON.stringify(payload), { status });
  });
  return () => cap;
}

describe("socialcrawl_monitors tool", () => {
  it("requires an API key", async () => {
    const result = await monitors(anonCtx, { action: "list" });
    expect(result).toContain("No API key configured");
  });

  it("SECURITY: rejects a path-traversal id without contacting the API", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const evil of ["../credits/balance", "mon_1?x=y", "mon_1/runs", "..", "a b"]) {
      const result = await monitors(ctx, { action: "delete", id: evil });
      expect(result).toContain("Invalid monitor id");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("create POSTs to /v1/monitors with a JSON body and maps preset cadence", async () => {
    const get = stubFetch(201, { monitor: { id: "mon_1" }, webhook_secret: "whsec_x" });
    const result = await monitors(ctx, {
      action: "create",
      recipe: "prism/brand-mentions",
      params: { keyword: "acme" },
      cadence: "daily",
      webhook_url: "https://example.com/hook",
    });
    const cap = get();
    expect(cap.method).toBe("POST");
    expect(cap.url).toContain("/v1/monitors");
    expect(cap.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(cap.body!);
    expect(body.recipe).toBe("prism/brand-mentions");
    expect(body.cadence).toBe("daily");
    expect(body.params).toEqual({ keyword: "acme" });
    expect(result).toContain("mon_1");
  });

  it("create maps a cron string to the { cron } cadence shape", async () => {
    const get = stubFetch(201, { monitor: { id: "mon_2" } });
    await monitors(ctx, {
      action: "create",
      recipe: "tiktok/profile",
      cadence: "0 9 * * 1",
      webhook_url: "https://example.com/hook",
    });
    const body = JSON.parse(get().body!);
    expect(body.cadence).toEqual({ cron: "0 9 * * 1" });
  });

  it("create rejects an unknown recipe locally without calling the API", async () => {
    let called = false;
    vi.stubGlobal("fetch", async () => {
      called = true;
      return new Response("{}", { status: 200 });
    });
    const result = await monitors(ctx, {
      action: "create",
      recipe: "tiktok/not-a-real-endpoint",
      cadence: "daily",
      webhook_url: "https://example.com/hook",
    });
    expect(result).toContain("Unknown recipe");
    expect(called).toBe(false);
  });

  it("create reports missing required fields", async () => {
    const result = await monitors(ctx, { action: "create", recipe: "tiktok/profile" });
    expect(result).toContain("Missing required parameter");
    expect(result).toContain("cadence");
    expect(result).toContain("webhook_url");
  });

  it("id-requiring actions error without an id", async () => {
    for (const action of ["get", "runs", "timeseries", "pause", "resume", "delete"] as const) {
      const result = await monitors(ctx, { action });
      expect(result).toContain("requires a monitor `id`");
    }
  });

  it("list GETs with status/limit query params", async () => {
    const get = stubFetch(200, { items: [], next_cursor: null });
    await monitors(ctx, { action: "list", status: "active", limit: 50 });
    const cap = get();
    expect(cap.method).toBe("GET");
    expect(cap.url).toContain("status=active");
    expect(cap.url).toContain("limit=50");
  });

  it("runs GETs the nested runs path with include=result", async () => {
    const get = stubFetch(200, { items: [] });
    await monitors(ctx, { action: "runs", id: "mon_1", include: "result" });
    const cap = get();
    expect(cap.url).toContain("/v1/monitors/mon_1/runs");
    expect(cap.url).toContain("include=result");
  });

  it("timeseries GETs the timeseries path with metric projection", async () => {
    const get = stubFetch(200, { series: [] });
    await monitors(ctx, { action: "timeseries", id: "mon_1", metric: "negative_share,volume" });
    const cap = get();
    expect(cap.url).toContain("/v1/monitors/mon_1/timeseries");
    expect(cap.url).toContain("metric=");
  });

  it("pause and resume PATCH the right status", async () => {
    const getP = stubFetch(200, { id: "mon_1", status: "paused" });
    await monitors(ctx, { action: "pause", id: "mon_1" });
    expect(getP().method).toBe("PATCH");
    expect(JSON.parse(getP().body!).status).toBe("paused");

    const getR = stubFetch(200, { id: "mon_1", status: "active" });
    await monitors(ctx, { action: "resume", id: "mon_1" });
    expect(JSON.parse(getR().body!).status).toBe("active");
  });

  it("delete sends DELETE and handles a 204 No Content", async () => {
    const get = stubFetch(204, null);
    const result = await monitors(ctx, { action: "delete", id: "mon_1" });
    expect(get().method).toBe("DELETE");
    expect(result).toContain("204");
  });

  it("surfaces a 404 not-found for an unowned monitor", async () => {
    stubFetch(404, { error: { type: "RESOURCE_NOT_FOUND", message: "Monitor not found." } });
    const result = await monitors(ctx, { action: "get", id: "mon_missing" });
    expect(result).toContain("not found");
  });
});

/** Stub fetch with a raw text body (the export route answers CSV / NDJSON). */
function stubText(status: number, text: string): () => Captured {
  const cap: Captured = { url: "", method: "", headers: {} };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    cap.url = url;
    cap.method = (init.method ?? "GET").toString();
    cap.body = init.body as string | undefined;
    cap.headers = (init.headers as Record<string, string>) ?? {};
    return new Response(text, { status });
  });
  return () => cap;
}

describe("track monitors (numbers only)", () => {
  const track = {
    metrics: ["items[].post.engagement.views", "items[].post.engagement.likes"],
    row_key: "post.id",
    max_rows: 150,
  };

  it("creates a download-only track monitor without a webhook_url", async () => {
    const get = stubFetch(201, { monitor: { id: "mon_t" }, webhook_secret: null });
    const result = await monitors(ctx, {
      action: "create",
      recipe: "tiktok/profile/videos",
      params: { handle: "khaby.lame" },
      cadence: "daily",
      track,
    });
    const cap = get();
    expect(cap.method).toBe("POST");
    expect(cap.url).toBe("https://www.socialcrawl.dev/v1/monitors");
    const body = JSON.parse(cap.body!);
    expect(body.track).toEqual(track);
    expect(body).not.toHaveProperty("webhook_url");
    expect(result).toContain("mon_t");
  });

  it("still requires webhook_url when there is no track", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await monitors(ctx, { action: "create", recipe: "tiktok/profile", cadence: "daily" });
    expect(result).toContain("webhook_url");
    expect(result).toContain("unless `track`");
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends webhook_format, webhook_rows and a rows_new alert rule", async () => {
    const get = stubFetch(201, { monitor: { id: "mon_rows" } });
    await monitors(ctx, {
      action: "create",
      recipe: "tiktok/profile/videos",
      params: { handle: "khaby.lame" },
      cadence: "hourly",
      webhook_url: "https://example.com/hook",
      track,
      webhook_format: "rows",
      webhook_rows: "new",
      alert_rules: [
        { metric: "rows_new", op: "gt", value: 0 },
        { metric: "items[].post.engagement.views", op: "pct_change_gt", value: 50, window: "1d" },
      ],
    });
    const body = JSON.parse(get().body!);
    expect(body.webhook_format).toBe("rows");
    expect(body.webhook_rows).toBe("new");
    expect(body.webhook_url).toBe("https://example.com/hook");
    expect(body.alert_rules).toEqual([
      { metric: "rows_new", op: "gt", value: 0 },
      { metric: "items[].post.engagement.views", op: "pct_change_gt", value: 50, window: "1d" },
    ]);
  });

  it("passes relative now-<N>h param tokens through for the API to resolve per run", async () => {
    const get = stubFetch(201, { monitor: { id: "mon_c" } });
    await monitors(ctx, {
      action: "create",
      recipe: "prism/profile/comments",
      params: { url: "https://www.instagram.com/nasa/", since: "now-3h" },
      cadence: "hourly",
      webhook_url: "https://example.com/hook",
      track: { metrics: ["items[].comment.engagement.likes"] },
      webhook_rows: "new",
    });
    const body = JSON.parse(get().body!);
    expect(body.recipe).toBe("prism/profile/comments");
    expect(body.params.since).toBe("now-3h");
  });

  it("rejects the create bodies the API would 400, without a round trip", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const base = { action: "create" as const, recipe: "tiktok/profile/videos", cadence: "daily" };
    const hook = "https://example.com/hook";

    // rows format needs track
    expect(await monitors(ctx, { ...base, webhook_url: hook, webhook_format: "rows" })).toContain(
      "needs `track`",
    );
    // webhook_rows new needs an items[] metric and a webhook
    expect(
      await monitors(ctx, { ...base, webhook_url: hook, track: { metrics: ["total"] }, webhook_rows: "new" }),
    ).toContain("items[].<path>");
    expect(await monitors(ctx, { ...base, track, webhook_rows: "new" })).toContain(
      "only applies to webhook deliveries",
    );
    // a download-only monitor cannot carry webhook-only fields
    expect(await monitors(ctx, { ...base, track, webhook_format: "full" })).toContain(
      "only apply to webhook deliveries",
    );
    // rows_new: track only, gt/gte only
    expect(
      await monitors(ctx, { ...base, webhook_url: hook, alert_rules: [{ metric: "rows_new", op: "gt", value: 0 }] }),
    ).toContain("needs `track`");
    expect(
      await monitors(ctx, { ...base, track, alert_rules: [{ metric: "rows_new", op: "lt", value: 1 }] }),
    ).toContain("only the ops gt and gte");
    // a track monitor's rules must name a tracked metric
    expect(
      await monitors(ctx, { ...base, track, alert_rules: [{ metric: "author.followers", op: "gt", value: 1 }] }),
    ).toContain("is not in track.metrics");
    // metrics / max_rows bounds
    expect(await monitors(ctx, { ...base, track: { metrics: [] } })).toContain("1 to 20 paths");
    expect(
      await monitors(ctx, {
        ...base,
        track: { metrics: Array.from({ length: 21 }, (_, i) => `items[].m${i}`) },
      }),
    ).toContain("1 to 20 paths");
    expect(await monitors(ctx, { ...base, track: { metrics: ["total"], max_rows: 201 } })).toContain(
      "between 1 and 200",
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects a POST-only recipe that the runner cannot re-run", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await monitors(ctx, {
      action: "create",
      recipe: "youtube/videos",
      cadence: "daily",
      webhook_url: "https://example.com/hook",
    });
    expect(result).toContain("cannot be monitored");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("runs include, timeseries row, export", () => {
  it("runs accepts include=numbers and include=result,numbers", async () => {
    const get = stubFetch(200, { items: [] });
    await monitors(ctx, { action: "runs", id: "mon_1", include: "numbers" });
    expect(get().url).toContain("include=numbers");

    const both = stubFetch(200, { items: [] });
    await monitors(ctx, { action: "runs", id: "mon_1", include: "result,numbers" });
    expect(both().url).toContain(`include=${encodeURIComponent("result,numbers")}`);
  });

  it("runs rejects an unknown include locally", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await monitors(ctx, { action: "runs", id: "mon_1", include: "everything" });
    expect(result).toContain("'result', 'numbers', or 'result,numbers'");
    expect(spy).not.toHaveBeenCalled();
  });

  it("timeseries forwards the row= filter", async () => {
    const get = stubFetch(200, { series: [] });
    await monitors(ctx, { action: "timeseries", id: "mon_1", row: "7301,7302" });
    const cap = get();
    expect(cap.method).toBe("GET");
    expect(cap.url).toContain("/v1/monitors/mon_1/timeseries");
    expect(cap.url).toContain(`row=${encodeURIComponent("7301,7302")}`);
  });

  it("export GETs CSV by default and renders the raw body", async () => {
    const csv = "run_at,row_id,metric,value\n2026-10-01T00:00:00Z,7301,items[].post.engagement.views,1200\n";
    const get = stubText(200, csv);
    const result = await monitors(ctx, {
      action: "export",
      id: "mon_1",
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-20T00:00:00Z",
    });
    const cap = get();
    expect(cap.method).toBe("GET");
    expect(cap.url).toContain("/v1/monitors/mon_1/export?");
    expect(cap.url).toContain("format=csv");
    expect(cap.url).toContain("from=");
    expect(cap.url).toContain("to=");
    expect(cap.body).toBeUndefined();
    expect(result).toContain("```csv");
    expect(result).toContain("run_at,row_id,metric,value");
    expect(result).toContain("export is free");
  });

  it("export asks for NDJSON when format=ndjson", async () => {
    const get = stubText(200, '{"row_id":"_","total":1733}\n');
    const result = await monitors(ctx, { action: "export", id: "mon_1", format: "ndjson" });
    expect(get().url).toContain("format=ndjson");
    expect(result).toContain('"total":1733');
  });

  it("export requires an id", async () => {
    expect(await monitors(ctx, { action: "export" })).toContain("requires a monitor `id`");
  });
});

describe("plan cap", () => {
  it("passes a 403 MONITOR_LIMIT_REACHED through with the server's message", async () => {
    stubFetch(403, {
      error: {
        type: "MONITOR_LIMIT_REACHED",
        message: "Active-monitor limit reached (3 on the Free plan). Pause or delete a monitor to free a slot.",
      },
    });
    const result = await monitors(ctx, {
      action: "create",
      recipe: "tiktok/profile",
      cadence: "daily",
      webhook_url: "https://example.com/hook",
    });
    expect(result).toContain("MONITOR_LIMIT_REACHED");
    expect(result).toContain("3 on the Free plan");
  });
});

describe("the monitors docs topic", () => {
  it("documents the new surface", async () => {
    const { getDoc } = await import("../data/docs.js");
    const doc = getDoc("monitors")!;
    for (const needle of [
      "GET /v1/monitors/:id/export",
      "track",
      "webhook_format",
      "webhook_rows",
      "rows_new",
      "now-<N>h",
      "include=numbers",
      "dry_run",
      "Free 3, Starter 10, Growth 25, Pro 100, Enterprise 500",
      "MONITOR_LIMIT_REACHED",
    ]) {
      expect(doc, `monitors doc missing ${needle}`).toContain(needle);
    }
  });
});
