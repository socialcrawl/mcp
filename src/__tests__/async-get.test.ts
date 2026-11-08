import { describe, it, expect, vi, afterEach } from "vitest";
import { request, requestStructured } from "../tools/request.js";
import { requestJobHandle } from "../jobs.js";
import type { ApiContext } from "../context.js";

/**
 * UPGRADE-LOG API-071 (DX-21): any eligible GET runs as a background job with
 * `?async=true` (or `Prefer: respond-async`) — a 202 with `data.job_id`
 * (bj_…), read free at `GET /v1/prism/jobs/{job_id}`. Backend:
 * platforms/prism/jobs/async-get.ts. An endpoint that declares `async` itself
 * (prism/discover) keeps its own meaning.
 */

const ctx: ApiContext = { apiKey: "sc_test_key", baseUrl: "https://www.socialcrawl.dev" };
const JOB = "bj_ziJygy91eDlzFJLzzUgIY";
afterEach(() => vi.unstubAllGlobals());

function stub(status: number, body: unknown): () => string {
  let url = "";
  vi.stubGlobal("fetch", async (u: string) => {
    url = u;
    return new Response(JSON.stringify(body), { status, headers: { "Retry-After": "5" } });
  });
  return () => url;
}

describe("a GET run as a job", () => {
  it("sends async=true and does not call it a dropped param", async () => {
    const url = stub(202, { success: true, data: { job_id: JOB, status: "queued" }, credits_used: 0 });
    const out = await request(ctx, { platform: "twitter", resource: "ai-search", params: { query: "x", async: "true" } });
    expect(new URL(url()).searchParams.get("async")).toBe("true");
    expect(out).not.toMatch(/`async` is not declared on this endpoint and was dropped/);
  });

  it("polls the job at prism/jobs/{job_id}, free, whatever platform submitted it", async () => {
    stub(202, { success: true, data: { job_id: JOB, status: "queued" }, credits_used: 0 });
    const out = await requestStructured(ctx, { platform: "twitter", resource: "ai-search", params: { query: "x", async: "true" } });
    expect(out.text).toContain(`"platform":"prism"`);
    expect(out.text).toContain(`"job_id":"${JOB}"`);
  });

  it("routes any bj_ handle to prism jobs", () => {
    const h = requestJobHandle("twitter", { data: { job_id: JOB, status: "queued" } })!;
    expect(h.poll.arguments).toEqual({ platform: "prism", resource: "jobs/{job_id}", method: "GET", params: { job_id: JOB } });
  });

  it("refuses an async value the API would 400, locally and free", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const out = await request(ctx, { platform: "twitter", resource: "ai-search", params: { query: "x", async: "yes" } });
    expect(spy).not.toHaveBeenCalled();
    expect(out).toMatch(/async takes 1 or true/);
  });
});
