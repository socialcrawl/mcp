import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { request, requestStructured } from "../tools/request.js";
import { web } from "../tools/web.js";
import type { ApiContext } from "../context.js";

const ctx: ApiContext = { apiKey: "sc_test_key_1234567890", baseUrl: "https://www.socialcrawl.dev" };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A fake SSE body delivered as separate network chunks, no network involved. */
function sse(frames: unknown[], headers: Record<string, string> = {}): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", ...headers } });
}

const ANSWER_FRAMES = [
  { type: "leg", leg: { endpoint: "perplexity", status: 200, credits_used: 3, latency_ms: 900, error: null } },
  { type: "result", key: "answers_by_engine", value: { perplexity: "The final answer." } },
  { type: "leg", leg: { endpoint: "tavily", status: 200, credits_used: 2, latency_ms: 700, error: null } },
  { type: "done", summary: { coverage: 1, credits_used: 15, partial_failure: false, refunded: false } },
];

function recordFetch(make: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init, headers: (init.headers as Record<string, string>) ?? {} });
    return make(url, init);
  });
  return calls;
}

describe("SSE endpoints", () => {
  it("prism/answers: asks for a stream and returns the assembled answer", async () => {
    const calls = recordFetch(() => sse(ANSWER_FRAMES));
    const out = await requestStructured(ctx, { platform: "prism", resource: "answers", params: { query: "is x safe" } });
    expect(calls[0].headers.Accept).toBe("text/event-stream");
    expect(out.text).not.toMatch(/^Error/m);
    expect(out.text).toContain("The final answer.");
    const sc = out.structured as Record<string, any>;
    expect(sc.ok).toBe(true);
    expect(sc.credits.used).toBe(15);
    expect(sc.data.answers_by_engine.perplexity).toBe("The final answer.");
    expect(sc.data.legs).toHaveLength(2);
  });

  it("video-intel streams only when include carries transcript", async () => {
    const json = () => new Response(JSON.stringify({ success: true, data: { id: 1 }, credits_used: 5 }), { status: 200 });
    const calls = recordFetch(json);
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    await request(ctx, { platform: "prism", resource: "video-intel", params: { url } });
    expect(calls[0].headers.Accept).toBeUndefined();
    await request(ctx, { platform: "prism", resource: "video-intel", params: { url, include: "transcript" } });
    expect(calls[1].headers.Accept).toBe("text/event-stream");
  });

  it("assembles a stream even when the server streams unasked", async () => {
    recordFetch(() => sse([{ type: "ranked_final", items: [{ id: "c1" }] }, { type: "done", summary: { credits_used: 20 } }]));
    const out = await requestStructured(ctx, { platform: "search", resource: "everywhere", params: { query: "matcha" } });
    const sc = out.structured as Record<string, any>;
    expect(sc.ok).toBe(true);
    expect(sc.rows).toEqual([{ id: "c1" }]);
  });

  it("reports one progress notification per chunk, increasing", async () => {
    recordFetch(() => sse(ANSWER_FRAMES));
    const seen: { progress: number; message?: string }[] = [];
    await requestStructured(ctx, {
      platform: "prism",
      resource: "answers",
      params: { query: "q" },
      onProgress: (p) => seen.push(p),
    });
    expect(seen).toHaveLength(ANSWER_FRAMES.length);
    expect(seen.map((s) => s.progress)).toEqual([1, 2, 3, 4]);
    expect(seen[0].message).toMatch(/perplexity/);
  });

  it("a stream error with nothing delivered is a failure, not an empty success", async () => {
    recordFetch(() =>
      sse([
        { type: "error", code: "INTERNAL_ERROR", message: "fan-out crashed" },
        { type: "done", summary: { coverage: 0, refunded: true } },
      ]),
    );
    const out = await requestStructured(ctx, { platform: "prism", resource: "answers", params: { query: "q" } });
    expect((out.structured as Record<string, any>).ok).toBe(false);
    expect(out.text).toMatch(/fan-out crashed/);
  });
});

describe("progress over a real MCP client", () => {
  it("emits notifications/progress when the call carries a progressToken", async () => {
    recordFetch(() => sse(ANSWER_FRAMES));
    const server = createServer(ctx);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(ct);
    const ticks: number[] = [];
    const res = await client.callTool(
      { name: "socialcrawl_request", arguments: { platform: "prism", resource: "answers", params: { query: "q" } } },
      undefined,
      { onprogress: (p) => ticks.push(p.progress) },
    );
    expect(res.isError).toBeFalsy();
    expect(ticks.length).toBe(ANSWER_FRAMES.length);
    expect(((res.structuredContent ?? {}) as Record<string, any>).data.answers_by_engine.perplexity).toBe("The final answer.");
  });

  it("sends no progress and still works without a token", async () => {
    recordFetch(() => sse(ANSWER_FRAMES));
    const server = createServer(ctx);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(ct);
    const res = await client.callTool({
      name: "socialcrawl_request",
      arguments: { platform: "prism", resource: "answers", params: { query: "q" } },
    });
    expect(res.isError).toBeFalsy();
  });
});

describe("per-endpoint timeouts", () => {
  /** A fetch that never answers on its own and rejects when its signal aborts. */
  function hang(): { calls: number } {
    const state = { calls: 0 };
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => {
      state.calls++;
      return new Promise((_res, rej) => {
        init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      });
    });
    return state;
  }

  it("a plain endpoint still times out at 30s", async () => {
    vi.useFakeTimers();
    hang();
    // youtube/video carries no latency budget in the registry, so it keeps the default.
    const p = request(ctx, { platform: "youtube", resource: "video", params: { url: "https://youtu.be/x" } });
    await vi.advanceTimersByTimeAsync(30_001);
    expect(await p).toContain("timed out after 30 seconds");
  });

  it("a streaming endpoint is allowed 120s", async () => {
    vi.useFakeTimers();
    hang();
    let settled = false;
    const p = request(ctx, { platform: "prism", resource: "answers", params: { query: "q" } }).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await p).toContain("timed out after 120 seconds");
  });

  it("search/everywhere succeeds at 45s", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      () => new Promise((res) => setTimeout(() => res(new Response(JSON.stringify({ success: true, data: { items: [{ id: 1 }] }, credits_used: 20 }))), 45_000)),
    );
    const p = requestStructured(ctx, { platform: "search", resource: "everywhere", params: { query: "q" } });
    await vi.advanceTimersByTimeAsync(45_001);
    expect(((await p).structured as Record<string, any>).ok).toBe(true);
  });
});

describe("async job handles", () => {
  const body = {
    endpoint: "prism/profiles",
    items: [{ platform: "tiktok", handle: "a" }],
  };

  it("prism/jobs POST returns the handle with a structured poll hint and honours Retry-After", async () => {
    recordFetch(
      () =>
        new Response(JSON.stringify({ success: true, data: { job_id: "job_abc123", status: "queued" }, credits_used: 1 }), {
          status: 202,
          headers: { "Retry-After": "7" },
        }),
    );
    const out = await requestStructured(ctx, { platform: "prism", resource: "jobs", method: "POST", body });
    const sc = out.structured as Record<string, any>;
    expect(sc.ok).toBe(true);
    expect(sc.job).toEqual({
      id: "job_abc123",
      status: "queued",
      // A spend-scoped token can always call socialcrawl_request; manage needs the manage scope too.
      poll: {
        tool: "socialcrawl_request",
        arguments: { platform: "prism", resource: "jobs/{job_id}", method: "GET", params: { job_id: "job_abc123" } },
        after_s: 7,
      },
    });
    expect(out.text).toMatch(/job_abc123/);
    expect(out.text).toMatch(/Poll/);
  });

  it("defaults the poll delay when no Retry-After is sent", async () => {
    recordFetch(() => new Response(JSON.stringify({ success: true, data: { job_id: "job_z", status: "queued" } }), { status: 202 }));
    const out = await requestStructured(ctx, { platform: "prism", resource: "jobs", method: "POST", body });
    expect(((out.structured as Record<string, any>).job).poll.after_s).toBe(5);
  });

  it("no poll hint once a job is terminal", async () => {
    recordFetch(() => new Response(JSON.stringify({ success: true, data: { job_id: "job_z", status: "completed" } }), { status: 200 }));
    const out = await requestStructured(ctx, { platform: "prism", resource: "jobs", method: "POST", body });
    expect((out.structured as Record<string, any>).job).toBeUndefined();
  });

  it("socialcrawl_web crawl names job_get with the id", async () => {
    recordFetch(
      () =>
        new Response(JSON.stringify({ success: true, data: { job_id: "job_web1", status: "queued" } }), {
          status: 202,
          headers: { "Retry-After": "3" },
        }),
    );
    const text = await web(ctx, { action: "crawl", input: { url: "https://example.com" } });
    expect(text).toContain("job_web1");
    expect(text).toContain('"action":"job_get"');
    expect(text).toContain('"tool":"socialcrawl_manage"');
    expect(text).toContain('"area":"web"');
    expect(text).toContain('"after_s":3');
  });
});

describe("Retry-After on errors", () => {
  it("surfaces retry_after_s in the text tail and the structured error", async () => {
    recordFetch(
      () =>
        new Response(JSON.stringify({ error: { type: "RATE_LIMITED", message: "Slow down." } }), {
          status: 429,
          headers: { "Retry-After": "12" },
        }),
    );
    const out = await requestStructured(ctx, { platform: "tiktok", resource: "profile", params: { handle: "x" } });
    expect(out.text).toContain("retry_after_s: 12");
    expect((out.structured as Record<string, any>).retry_after_s).toBe(12);
  });
});

/** SSE body that sends some frames then stalls forever; records reader cancellation. */
function stalledSse(frames: unknown[], state: { cancelled: boolean }): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "x-request-id": "req-slow" } });
}

describe("timeout text", () => {
  it("says the server may still complete and bill, and where to check", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) =>
      new Promise((_r, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("a", "AbortError")))),
    );
    const p = request(ctx, { platform: "tiktok", resource: "profile", params: { handle: "x" } });
    await vi.advanceTimersByTimeAsync(30_001);
    const text = await p;
    expect(text).toMatch(/may still complete/i);
    expect(text).toMatch(/bill/i);
    expect(text).toMatch(/refund/i);
    expect(text).toContain("socialcrawl_account");
    expect(text).toContain("view=transactions");
    expect(text).toMatch(/No partial data/i);
  });

  it("includes partial stream data already read, and cancels the reader", async () => {
    vi.useFakeTimers();
    const state = { cancelled: false };
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => {
      void init;
      return Promise.resolve(stalledSse([{ type: "result", key: "answers_by_engine", value: { perplexity: "half an answer" } }], state));
    });
    const p = request(ctx, { platform: "prism", resource: "answers", params: { query: "q" } });
    await vi.advanceTimersByTimeAsync(120_001);
    const text = await p;
    expect(text).toContain("half an answer");
    expect(text).toContain("req-slow");
    expect(text).toMatch(/timed out after 120 seconds/);
    expect(state.cancelled).toBe(true);
  });

  it("apiRequest paths (web / POST) carry the same guidance", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) =>
      new Promise((_r, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("a", "AbortError")))),
    );
    const p = web(ctx, { action: "scrape", input: { url: "https://example.com" } });
    // web/scrape's registry budget (28s) plus the 5s margin.
    await vi.advanceTimersByTimeAsync(33_001);
    const text = await p;
    expect(text).toMatch(/may still complete/i);
    expect(text).toContain("view=transactions");
  });
});

describe("mid-stream error after data", () => {
  it("is isError with the partial data in structuredContent", async () => {
    recordFetch(() =>
      sse([
        { type: "result", key: "answers_by_engine", value: { perplexity: "kept" } },
        { type: "error", code: "UPSTREAM_ERROR", message: "tavily leg died" },
        { type: "done", summary: { coverage: 0.5, credits_used: 9 } },
      ]),
    );
    const server = createServer(ctx);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(ct);
    const res = await client.callTool({
      name: "socialcrawl_request",
      arguments: { platform: "prism", resource: "answers", params: { query: "q" } },
    });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, any>;
    expect(sc.ok).toBe(false);
    expect(sc.partial).toBe(true);
    expect(sc.code).toBe("UPSTREAM_ERROR");
    expect(sc.data.answers_by_engine.perplexity).toBe("kept");
    expect(sc.credits.used).toBe(9);
    expect((res.content as Array<{ text: string }>)[0].text).toMatch(/partial/i);
  });
});

describe("stream caps through the request path", () => {
  it("a flood of chunks is cut, marked truncated, and still returns what was read", async () => {
    const frames = Array.from({ length: 2500 }, (_, i) => ({ type: "items", source: "s", items: [{ id: i }], duration_ms: 1 }));
    recordFetch(() => sse(frames));
    const out = await requestStructured(ctx, { platform: "search", resource: "everywhere", params: { query: "q" } });
    const sc = out.structured as Record<string, any>;
    expect(sc.ok).toBe(true);
    expect(sc.warnings.join(" ")).toMatch(/cap/);
    expect(sc.rows.length).toBeLessThanOrEqual(2000);
    expect(sc.rows.length).toBeGreaterThan(0);
  });
});
