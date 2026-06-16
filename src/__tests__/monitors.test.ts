import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { monitors } from "../tools/monitors.js";

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
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, SOCIALCRAWL_API_KEY: "sc_test_key" };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("requires an API key", async () => {
    delete process.env.SOCIALCRAWL_API_KEY;
    const result = await monitors({ action: "list" });
    expect(result).toContain("No API key configured");
  });

  it("create POSTs to /v1/monitors with a JSON body and maps preset cadence", async () => {
    const get = stubFetch(201, { monitor: { id: "mon_1" }, webhook_secret: "whsec_x" });
    const result = await monitors({
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
    await monitors({
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
    const result = await monitors({
      action: "create",
      recipe: "tiktok/not-a-real-endpoint",
      cadence: "daily",
      webhook_url: "https://example.com/hook",
    });
    expect(result).toContain("Unknown recipe");
    expect(called).toBe(false);
  });

  it("create reports missing required fields", async () => {
    const result = await monitors({ action: "create", recipe: "tiktok/profile" });
    expect(result).toContain("Missing required parameter");
    expect(result).toContain("cadence");
    expect(result).toContain("webhook_url");
  });

  it("id-requiring actions error without an id", async () => {
    for (const action of ["get", "runs", "timeseries", "pause", "resume", "delete"] as const) {
      const result = await monitors({ action });
      expect(result).toContain("requires a monitor `id`");
    }
  });

  it("list GETs with status/limit query params", async () => {
    const get = stubFetch(200, { items: [], next_cursor: null });
    await monitors({ action: "list", status: "active", limit: 50 });
    const cap = get();
    expect(cap.method).toBe("GET");
    expect(cap.url).toContain("status=active");
    expect(cap.url).toContain("limit=50");
  });

  it("runs GETs the nested runs path with include=result", async () => {
    const get = stubFetch(200, { items: [] });
    await monitors({ action: "runs", id: "mon_1", include: "result" });
    const cap = get();
    expect(cap.url).toContain("/v1/monitors/mon_1/runs");
    expect(cap.url).toContain("include=result");
  });

  it("timeseries GETs the timeseries path with metric projection", async () => {
    const get = stubFetch(200, { series: [] });
    await monitors({ action: "timeseries", id: "mon_1", metric: "negative_share,volume" });
    const cap = get();
    expect(cap.url).toContain("/v1/monitors/mon_1/timeseries");
    expect(cap.url).toContain("metric=");
  });

  it("pause and resume PATCH the right status", async () => {
    const getP = stubFetch(200, { id: "mon_1", status: "paused" });
    await monitors({ action: "pause", id: "mon_1" });
    expect(getP().method).toBe("PATCH");
    expect(JSON.parse(getP().body!).status).toBe("paused");

    const getR = stubFetch(200, { id: "mon_1", status: "active" });
    await monitors({ action: "resume", id: "mon_1" });
    expect(JSON.parse(getR().body!).status).toBe("active");
  });

  it("delete sends DELETE and handles a 204 No Content", async () => {
    const get = stubFetch(204, null);
    const result = await monitors({ action: "delete", id: "mon_1" });
    expect(get().method).toBe("DELETE");
    expect(result).toContain("204");
  });

  it("surfaces a 404 not-found for an unowned monitor", async () => {
    stubFetch(404, { error: { type: "RESOURCE_NOT_FOUND", message: "Monitor not found." } });
    const result = await monitors({ action: "get", id: "mon_missing" });
    expect(result).toContain("not found");
  });
});
