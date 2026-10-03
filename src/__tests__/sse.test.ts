import { describe, it, expect } from "vitest";
import { readSse, assembleSse, MAX_SSE_EVENTS, MAX_SSE_BYTES, MAX_SSE_BUFFER_BYTES } from "../sse.js";
import { parseRetryAfter } from "../client.js";

function streamOf(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

describe("readSse", () => {
  it("parses frames split across network chunks, CRLF, comments and multi-line data", async () => {
    const res = streamOf([
      'data: {"type":"leg","n":1}\n\n: keepalive\n\nda',
      'ta: {"type":"result",\r\ndata: "key":"a","value":2}\r\n\r\n',
      'event: custom\ndata: plain text\n\n',
    ]);
    const seen: unknown[] = [];
    await readSse(res, (e) => seen.push(e));
    expect(seen).toEqual([
      { type: "leg", n: 1 },
      { type: "result", key: "a", value: 2 },
      { type: "custom", data: "plain text" },
    ]);
  });

  it("flushes a final frame with no trailing blank line", async () => {
    const seen: unknown[] = [];
    await readSse(streamOf(['data: {"type":"done","summary":{}}']), (e) => seen.push(e));
    expect(seen).toHaveLength(1);
  });

  it("ignores empty data and the [DONE] sentinel", async () => {
    const seen: unknown[] = [];
    await readSse(streamOf(["data:\n\ndata: [DONE]\n\n"]), (e) => seen.push(e));
    expect(seen).toEqual([]);
  });
});

describe("assembleSse", () => {
  it("folds prism chunks into one envelope", () => {
    const out = assembleSse([
      { type: "leg", leg: { endpoint: "perplexity", status: 200, credits_used: 3, latency_ms: 10, error: null } },
      { type: "result", key: "answers_by_engine", value: { perplexity: "A" } },
      { type: "result", key: "agreement_matrix", value: [[1]] },
      { type: "done", summary: { coverage: 1, credits_used: 15, partial_failure: false, refunded: false } },
    ]);
    expect(out.error).toBeUndefined();
    expect(out.envelope.success).toBe(true);
    expect(out.envelope.credits_used).toBe(15);
    const data = out.envelope.data as Record<string, unknown>;
    expect(data.answers_by_engine).toEqual({ perplexity: "A" });
    expect(data.agreement_matrix).toEqual([[1]]);
    expect((data.legs as unknown[]).length).toBe(1);
    expect((data.summary as Record<string, unknown>).coverage).toBe(1);
  });

  it("folds search chunks: ranked_final becomes items, enrichment keyed by candidate", () => {
    const out = assembleSse([
      { type: "meta", request_id: "req_1", query: "q", plan: {}, sources_planned: ["reddit"] },
      { type: "items", source: "reddit", items: [{ id: "x" }], duration_ms: 5 },
      { type: "ranked_final", items: [{ id: "c1" }, { id: "c2" }] },
      { type: "clusters", clusters: [{ id: "k" }] },
      { type: "comments_enriched", candidate_id: "c1", source: "reddit", comments: [{ excerpt: "hi" }] },
      { type: "source_failed", source: "x", error: { code: "E", message: "m" } },
      { type: "warning", message: "careful" },
      { type: "done", summary: { credits_charged: 20, credits_used: 20, coverage: 0.9 } },
    ]);
    const data = out.envelope.data as Record<string, any>;
    expect(out.envelope.request_id).toBe("req_1");
    expect(data.items).toEqual([{ id: "c1" }, { id: "c2" }]);
    expect(data.clusters).toEqual([{ id: "k" }]);
    expect(data.enrichment.comments.c1).toEqual([{ excerpt: "hi" }]);
    expect(data.sources_failed.x).toEqual({ code: "E", message: "m" });
    expect(out.envelope.warnings).toContain("careful");
    expect(out.envelope.credits_used).toBe(20);
  });

  it("falls back to merged per-source items when there is no ranked_final", () => {
    const out = assembleSse([
      { type: "items", source: "a", items: [{ id: 1 }], duration_ms: 1 },
      { type: "items", source: "b", items: [{ id: 2 }], duration_ms: 1 },
      { type: "done", summary: {} },
    ]);
    expect((out.envelope.data as any).items).toHaveLength(2);
  });

  it("an error chunk with no data is an error, naming the refund state", () => {
    const out = assembleSse([
      { type: "error", code: "INTERNAL_ERROR", message: "boom" },
      { type: "done", summary: { coverage: 0, refunded: true } },
    ]);
    expect(out.error).toMatch(/INTERNAL_ERROR/);
    expect(out.error).toMatch(/boom/);
    expect(out.error).toMatch(/refunded/i);
  });

  it("an error after partial data keeps the data and warns", () => {
    const out = assembleSse([
      { type: "result", key: "video", value: { id: 1 } },
      { type: "error", code: "UPSTREAM", message: "leg died" },
      { type: "done", summary: { coverage: 0.5, credits_used: 5 } },
    ]);
    expect(out.error).toBeUndefined();
    expect(out.envelope.warnings).toEqual(expect.arrayContaining([expect.stringContaining("leg died")]));
  });

  it("warns when the stream ended without done", () => {
    const out = assembleSse([{ type: "result", key: "video", value: 1 }]);
    expect(out.envelope.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/without a terminal/)]));
  });
});

/** A stream that never closes by itself; records whether the reader was cancelled. */
function openStream(frames: string[]): { res: Response; state: { cancelled: boolean } } {
  const enc = new TextEncoder();
  const state = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { res: new Response(body, { headers: { "content-type": "text/event-stream" } }), state };
}

describe("readSse hardening", () => {
  it("names its caps", () => {
    expect(MAX_SSE_EVENTS).toBe(2000);
    expect(MAX_SSE_BYTES).toBe(8 * 1024 * 1024);
    expect(MAX_SSE_BUFFER_BYTES).toBeGreaterThan(0);
  });

  it("keeps a CRLF pair split across chunks as one line break", async () => {
    const seen: unknown[] = [];
    await readSse(streamOf(["data: x\r", "\ndata: y\r\n\r\n"]), (e) => seen.push(e));
    expect(seen).toEqual([{ type: "message", data: "x\ny" }]);
  });

  it("stops and cancels the reader at the event cap", async () => {
    const { res, state } = openStream(Array.from({ length: 10 }, (_, i) => `data: {"type":"x","i":${i}}\n\n`));
    const seen: unknown[] = [];
    const out = await readSse(res, (e) => seen.push(e), { maxEvents: 3 });
    expect(seen).toHaveLength(3);
    expect(out.truncated).toBe("events");
    expect(state.cancelled).toBe(true);
  });

  it("stops at the byte cap", async () => {
    const { res, state } = openStream(Array.from({ length: 10 }, () => `data: {"type":"x","pad":"${"a".repeat(100)}"}\n\n`));
    const out = await readSse(res, () => undefined, { maxBytes: 250 });
    expect(out.truncated).toBe("bytes");
    expect(state.cancelled).toBe(true);
  });

  it("caps an unterminated frame buffer", async () => {
    const { res, state } = openStream(["data: " + "a".repeat(500), "a".repeat(500)]);
    const out = await readSse(res, () => undefined, { maxBufferBytes: 600 });
    expect(out.truncated).toBe("frame");
    expect(state.cancelled).toBe(true);
  });

  it("cancels the reader when the signal aborts, and throws AbortError", async () => {
    const { res, state } = openStream(['data: {"type":"x"}\n\n']);
    const ac = new AbortController();
    const p = readSse(res, () => undefined, { signal: ac.signal });
    setTimeout(() => ac.abort(), 5);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(state.cancelled).toBe(true);
  });

  it("cancels the reader when the handler throws", async () => {
    const { res, state } = openStream(['data: {"type":"x"}\n\n']);
    await expect(
      readSse(res, () => {
        throw new Error("handler broke");
      }),
    ).rejects.toThrow("handler broke");
    expect(state.cancelled).toBe(true);
  });
});

describe("assembleSse hardening", () => {
  it("falls back to the raw data for a non-JSON error frame", () => {
    const out = assembleSse([{ type: "error", data: "plain failure text" }]);
    expect(out.error).toMatch(/plain failure text/);
  });

  it("marks an error after data as partial, keeping the data", () => {
    const out = assembleSse([
      { type: "result", key: "video", value: { id: 1 } },
      { type: "error", code: "UPSTREAM", message: "leg died" },
      { type: "done", summary: { credits_used: 5 } },
    ]);
    expect(out.error).toBeUndefined();
    expect(out.envelope.partial).toBe(true);
    expect(out.envelope.stream_error).toEqual({ code: "UPSTREAM", message: "leg died" });
  });

  it("flags a truncated read", () => {
    const out = assembleSse([{ type: "result", key: "a", value: 1 }], { truncated: "events" });
    expect(out.envelope.stream_truncated).toBe("events");
    expect(out.envelope.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/cap/)]));
  });
});

describe("parseRetryAfter", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  it("reads delta-seconds and IMF-fixdate", () => {
    expect(parseRetryAfter("12")).toBe(12);
    expect(parseRetryAfter("Fri, 02 Oct 2026 12:00:30 GMT", now)).toBe(30);
  });
  it("rejects anything else, including loose date strings and negatives", () => {
    expect(parseRetryAfter("2026-10-02")).toBeUndefined();
    expect(parseRetryAfter("tomorrow")).toBeUndefined();
    expect(parseRetryAfter("-5")).toBeUndefined();
    expect(parseRetryAfter("1e3")).toBeUndefined();
  });
});
