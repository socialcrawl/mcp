import { describe, it, expect, vi, afterEach } from "vitest";
import { web } from "../tools/web.js";
import { request } from "../tools/request.js";
import { findEndpoint, getEndpointsByPlatform } from "../data/endpoints.js";
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

describe("web data layer", () => {
  it("registers 22 web endpoints", () => {
    expect(getEndpointsByPlatform("web")).toHaveLength(22);
  });

  it("findEndpoint disambiguates a stateful resource by method", () => {
    const get = findEndpoint("web", "monitors/{monitor_id}", "GET");
    const del = findEndpoint("web", "monitors/{monitor_id}", "DELETE");
    expect(get?.method).toBe("GET");
    expect(del?.method).toBe("DELETE");
  });
});

describe("socialcrawl_web tool", () => {
  it("requires an API key", async () => {
    const result = await web(anonCtx, { action: "scrape", input: { url: "https://example.com" } });
    expect(result).toContain("No API key configured");
  });

  it("scrape GETs /v1/web/scrape with query params and its 1cr price", async () => {
    const get = stubFetch(200, { success: true, data: { page: {} } });
    const result = await web(ctx, {
      action: "scrape",
      input: { url: "https://example.com", formats: "markdown,screenshot" },
    });
    const cap = get();
    expect(cap.method).toBe("GET");
    expect(cap.url).toContain("/v1/web/scrape");
    expect(cap.url).toContain("url=https");
    expect(cap.url).toContain("formats=markdown");
    // scrape is metered (1-5cr depending on the requested formats), so the
    // header must quote the band, never the 1cr base.
    expect(result).toContain("1-5cr (metered)");
  });

  it("crawl POSTs a JSON body and reports the async job", async () => {
    const get = stubFetch(202, { success: true, data: { job_id: "job_1", status: "queued" } });
    const result = await web(ctx, { action: "crawl", input: { url: "https://example.com", limit: 20 } });
    const cap = get();
    expect(cap.method).toBe("POST");
    expect(cap.url).toContain("/v1/web/crawl");
    expect(cap.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(cap.body!)).toEqual({ url: "https://example.com", limit: 20 });
    expect(result).toContain("job_1");
  });

  it("agent surfaces its flat 25cr price", async () => {
    const get = stubFetch(202, { success: true, data: { job_id: "job_2" } });
    const result = await web(ctx, { action: "agent", input: { url: "https://x.com", prompt: "do a thing" } });
    expect(get().method).toBe("POST");
    expect(result).toContain("25cr (flat)");
  });

  it("job_get interpolates the id into the path", async () => {
    const get = stubFetch(200, { success: true, data: { job_id: "job_1", status: "completed" } });
    await web(ctx, { action: "job_get", id: "job_1" });
    expect(get().url).toContain("/v1/web/jobs/job_1");
  });

  it("session_execute POSTs code to the execute path", async () => {
    const get = stubFetch(200, { success: true, data: {} });
    await web(ctx, { action: "session_execute", id: "sess_1", input: { code: "await page.title()" } });
    const cap = get();
    expect(cap.method).toBe("POST");
    expect(cap.url).toContain("/v1/web/sessions/sess_1/execute");
    expect(JSON.parse(cap.body!).code).toBe("await page.title()");
  });

  it("id-requiring actions error without an id", async () => {
    for (const action of ["job_get", "monitor_delete", "session_close"] as const) {
      const result = await web(ctx, { action });
      expect(result).toContain("requires an `id`");
    }
  });

  it("reports missing required input fields", async () => {
    const result = await web(ctx, { action: "search", input: {} });
    expect(result).toContain("requires `input.query`");
  });

  it("extract requires a schema or prompt", async () => {
    const result = await web(ctx, { action: "extract", input: { url: "https://example.com" } });
    expect(result).toContain("schema");
  });

  it("SECURITY: rejects a path-traversal id without contacting the API", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const evil of ["../credits/balance", "job_1?x=y", "job_1/errors", ".."]) {
      const result = await web(ctx, { action: "job_cancel", id: evil });
      expect(result).toContain("Invalid id");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("method-aware socialcrawl_request", () => {
  it("routes the web platform to the socialcrawl_web tool", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await request(ctx, { platform: "web", resource: "scrape", params: { url: "https://x.com" } });
    expect(result).toContain("socialcrawl_web");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs a batch endpoint body and routes an in:query param to the query string", async () => {
    const get = stubFetch(200, { success: true, data: { items: [] } });
    const result = await request(ctx, {
      platform: "youtube",
      resource: "videos",
      params: { hl: "en" },
      body: { ids: ["dQw4w9WgXcQ", "9bZkp7q19f0"] },
    });
    const cap = get();
    expect(cap.method).toBe("POST");
    expect(cap.url).toContain("/v1/youtube/videos");
    expect(cap.url).toContain("hl=en");
    const body = JSON.parse(cap.body!);
    expect(body.ids).toEqual(["dQw4w9WgXcQ", "9bZkp7q19f0"]);
    expect(body.hl).toBeUndefined();
    expect(result).toContain("POST /v1/youtube/videos");
  });

  it("coerces a JSON-string array in the body into a real array", async () => {
    const get = stubFetch(200, { success: true, data: {} });
    await request(ctx, {
      platform: "prism",
      resource: "profiles",
      body: { items: '[{"platform":"tiktok","handle":"@scout2015"}]' },
    });
    const body = JSON.parse(get().body!);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items[0].handle).toBe("@scout2015");
  });

  it("still GETs a normal registry endpoint with query params", async () => {
    const get = stubFetch(200, { success: true, data: {} });
    await request(ctx, { platform: "tiktok", resource: "profile", params: { handle: "charlidamelio" } });
    const cap = get();
    expect(cap.method).toBe("GET");
    expect(cap.url).toContain("/v1/tiktok/profile?handle=charlidamelio");
  });
});

/**
 * Two stateful-router routes are not registry endpoints, so they carry no
 * pricing row: both are free helpers that make an expensive async job safer to
 * run (inspect what failed; dry-run what a crawl would submit).
 */
describe("socialcrawl_web free helper actions", () => {
  it("job_errors reads a job's per-page failure feed", async () => {
    const get = stubFetch(200, {
      success: true,
      data: { errors: [{ url: "https://x.com/a", status: 403 }], robots_blocked: [] },
    });
    const result = await web(ctx, { action: "job_errors", id: "job_1" });
    const cap = get();
    expect(cap.method).toBe("GET");
    expect(cap.url).toContain("/v1/web/jobs/job_1/errors");
    expect(result).toContain("0cr (free)");
    expect(result).toContain("robots_blocked");
  });

  it("job_errors requires an id", async () => {
    const result = await web(ctx, { action: "job_errors" });
    expect(result).toContain("requires an `id`");
  });

  it("crawl_preview POSTs the crawl body without submitting a job", async () => {
    const get = stubFetch(200, {
      success: true,
      data: { url: "https://example.com", limit: 10 },
    });
    const result = await web(ctx, {
      action: "crawl_preview",
      input: { url: "https://example.com", limit: 10 },
    });
    const cap = get();
    expect(cap.method).toBe("POST");
    expect(cap.url).toContain("/v1/web/crawl/params-preview");
    expect(JSON.parse(cap.body!)).toEqual({ url: "https://example.com", limit: 10 });
    expect(result).toContain("0cr (free)");
  });

  it("crawl_preview requires a url", async () => {
    const result = await web(ctx, { action: "crawl_preview", input: {} });
    expect(result).toContain("requires `input.url`");
  });

  it("crawl quotes its metered per-page rule", async () => {
    stubFetch(202, { success: true, data: { job_id: "job_3" } });
    const result = await web(ctx, { action: "crawl", input: { url: "https://example.com" } });
    expect(result).toContain("**Rule:**");
    expect(result).toContain("1 credit per page crawled");
    expect(result).toContain("**Async:**");
  });
});
