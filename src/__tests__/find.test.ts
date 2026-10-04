import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { findStructured } from "../tools/find.js";
import type { ApiContext } from "../context.js";

const ANON: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };
const KEYED: ApiContext = { apiKey: "sc_test_key_1234567890", baseUrl: "https://www.socialcrawl.dev" };

type Routes = Record<string, { status: number; body: unknown }>;

/** Answer by path prefix; anything unrouted is a 404. Records every URL. */
function route(routes: Routes): string[] {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    const path = new URL(url).pathname;
    const hit = Object.entries(routes).find(([p]) => path === p);
    // The router's answer for a route that is not deployed names the path.
    if (!hit) return new Response(JSON.stringify({ success: false, error: { type: "ENDPOINT_NOT_FOUND", message: `Unknown endpoint: ${path}.` } }), { status: 404 });
    return new Response(JSON.stringify(hit[1].body), { status: hit[1].status });
  });
  return urls;
}

type Result = { id: string; params_filled: Record<string, string>; params_missing: string[]; credits: Record<string, unknown>; call?: unknown };
const results = (s: Record<string, unknown>): Result[] => s.results as Result[];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("socialcrawl_find offline (no key)", () => {
  it("ranks tiktok/post/comments first for 'tiktok comments', top 3 by default, no network", async () => {
    const urls = route({});
    const out = await findStructured(ANON, { task: "tiktok comments" });
    expect(out.structured.ok).toBe(true);
    expect(out.structured.source).toBe("local");
    const r = results(out.structured);
    expect(r).toHaveLength(3);
    expect(r[0].id).toBe("tiktok/post/comments");
    expect(r[0].params_missing).toContain("url");
    expect(r[0].credits).toMatchObject({ min: 1, max: 7 });
    expect(urls).toHaveLength(0);
    expect(out.text).toContain("tiktok/post/comments");
  });

  it("fills a URL from the task and ranks that URL's platform", async () => {
    route({});
    const url = "https://www.tiktok.com/@scout2015/video/6718335390845095173";
    const out = await findStructured(ANON, { task: `export the comments on ${url}` });
    const top = results(out.structured)[0];
    expect(top.id).toBe("tiktok/post/comments");
    expect(top.params_filled.url).toBe(url);
    expect(top.params_missing).toEqual([]);
    expect(top.call).toMatchObject({ tool: "socialcrawl_request", arguments: { platform: "tiktok", resource: "post/comments", params: { url } } });
  });

  it("fills an @handle", async () => {
    route({});
    const out = await findStructured(ANON, { task: "tiktok profile of @scout2015" });
    const top = results(out.structured)[0];
    expect(top.id).toBe("tiktok/profile");
    expect(top.params_filled.handle).toBe("scout2015");
    expect(top.params_missing).toEqual([]);
  });

  it("honours platform and limit", async () => {
    route({});
    const out = await findStructured(ANON, { task: "comments", platform: "instagram", limit: 5 });
    const r = results(out.structured);
    expect(r).toHaveLength(5);
    for (const x of r) expect(x.id.startsWith("instagram/")).toBe(true);
  });

  it("suggests a platform for a typo", async () => {
    const out = await findStructured(ANON, { task: "comments", platform: "tiktk" });
    expect(out.text).toMatch(/^Error: Unknown platform "tiktk"/);
    expect(out.structured).toMatchObject({ ok: false, code: "UNKNOWN_PLATFORM" });
    expect(out.structured.did_you_mean).toContain("tiktok");
  });

  it("lists a platform's endpoints without a task, and the platforms without either", async () => {
    const byPlatform = await findStructured(ANON, { platform: "tiktok" });
    expect(byPlatform.text).toContain("post/comments");
    const all = await findStructured(ANON, {});
    expect(all.text).toContain("TikTok");
    expect(all.text).toContain("Instagram");
  });
});

describe("socialcrawl_find with a key", () => {
  it("uses /v1/utility/find when it answers", async () => {
    const urls = route({
      "/v1/utility/find": {
        status: 200,
        body: { success: true, data: { results: [{ id: "instagram/post/comments", score: 0.92, why: "comments on a post" }] } },
      },
    });
    const out = await findStructured(KEYED, { task: "comments under a post" });
    expect(out.structured.source).toBe("api");
    expect(results(out.structured)[0].id).toBe("instagram/post/comments");
    expect(urls.some((u) => u.includes("/v1/utility/find?") && u.includes("task=comments+under+a+post"))).toBe(true);
  });

  it("falls back to the local ranker when the route is not deployed (404)", async () => {
    const urls = route({});
    const out = await findStructured(KEYED, { task: "tiktok comments" });
    expect(out.structured.source).toBe("local");
    expect(results(out.structured)[0].id).toBe("tiktok/post/comments");
    expect(urls.some((u) => u.includes("/v1/utility/find"))).toBe(true);
  });

  it("resolves URLs and handles through /v1/utility/resolve and fills the canonical value", async () => {
    const urls = route({
      "/v1/utility/resolve": {
        status: 200,
        body: {
          success: true,
          data: {
            results: [
              {
                input: "https://vm.tiktok.com/x/",
                platform: "tiktok",
                kind: "post",
                canonical: { url: "https://www.tiktok.com/@a/video/1" },
                endpoints: [
                  { id: "tiktok/post", param: "url", credits: 1 },
                  { id: "tiktok/post/comments", param: "url", credits: 1, metered: true },
                ],
                confidence: "pattern",
                warnings: [],
              },
            ],
            count: 1,
            resolved: 1,
            unresolved: 0,
          },
        },
      },
    });
    const out = await findStructured(KEYED, { task: "comments on https://vm.tiktok.com/x/" });
    const top = results(out.structured)[0];
    expect(top.id).toBe("tiktok/post/comments");
    expect(top.params_filled.url).toBe("https://www.tiktok.com/@a/video/1");
    expect(urls.some((u) => u.includes("/v1/utility/resolve?") && u.includes("vm.tiktok.com"))).toBe(true);
    expect(out.structured.resolved).toBeDefined();
  });

  it("quotes a metered candidate through /v1/utility/estimate, else locally", async () => {
    route({
      "/v1/utility/estimate": {
        status: 200,
        body: { success: true, data: { valid: true, hold: 3, expected_min: 1, expected_max: 3, unit: "credits" } },
      },
    });
    const out = await findStructured(KEYED, { task: "tiktok comments", limit: 1 });
    expect(results(out.structured)[0].credits).toMatchObject({ estimate: 3, source: "api" });
    vi.unstubAllGlobals();
    route({});
    const local = await findStructured(KEYED, { task: "tiktok comments", limit: 1 });
    expect(results(local.structured)[0].credits).toMatchObject({ source: "local" });
  });
});

describe("socialcrawl_find over a client", () => {
  it("returns structuredContent with ranked results", async () => {
    route({});
    const server = createServer(ANON);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: "find", version: "0" });
    await client.connect(a);
    const r = await client.callTool({ name: "socialcrawl_find", arguments: { task: "youtube video transcript" } });
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent as Record<string, unknown>;
    expect(results(s)[0].id).toBe("youtube/video/transcript");
    await client.close();
  });
});

describe("socialcrawl_find: discovery route handling", () => {
  it("remembers a 404 route for the process: the second call skips it", async () => {
    const urls = route({});
    await findStructured(KEYED, { task: "tiktok comments", limit: 1 });
    await findStructured(KEYED, { task: "reddit comments", limit: 1 });
    expect(urls.filter((u) => u.includes("/v1/utility/find")).length).toBe(1);
  });

  it("gives up on a hanging discovery route after 5 s and answers locally", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", (_u: string, init: RequestInit) =>
        new Promise((_r, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("a", "AbortError")))),
      );
      const p = findStructured(KEYED, { task: "youtube video transcript", limit: 1 });
      await vi.advanceTimersByTimeAsync(5_001);
      await vi.advanceTimersByTimeAsync(5_001);
      const out = await p;
      expect(out.structured.source).toBe("local");
      expect(results(out.structured)[0].id).toBe("youtube/video/transcript");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says when the live ranking names an endpoint this server does not bundle", async () => {
    route({
      "/v1/utility/find": { status: 200, body: { success: true, data: { results: [{ id: "newplat/thing", summary: "A new endpoint" }, { id: "tiktok/profile" }] } } },
    });
    const out = await findStructured(KEYED, { task: "something new" });
    expect(out.text).toMatch(/newplat\/thing.*not in this server's bundled catalogue/);
    expect((out.structured.warnings as string[]).some((w) => w.includes("newplat/thing"))).toBe(true);
    expect(results(out.structured)[1].id).toBe("tiktok/profile");
  });

  it("asks /v1/utility/plan for a multi-step task when find is not deployed", async () => {
    const urls = route({
      "/v1/utility/plan": {
        status: 200,
        body: {
          success: true,
          data: {
            recipe: "creator_discovery",
            confidence: 0.8,
            steps: [
              { id: "s1", method: "GET", path: "/v1/tiktok/search/users", params: { query: "skincare" }, missing: [], credits: 1 },
              { id: "s2", method: "GET", path: "/v1/tiktok/profile", params: {}, missing: ["handle"], binds: { handle: "s1.items[].author.username" }, credits: 1 },
            ],
          },
        },
      },
    });
    const out = await findStructured(KEYED, { task: "find skincare creators on tiktok and then get each profile" });
    expect(out.structured.source).toBe("plan");
    expect(results(out.structured).map((r) => r.id)).toEqual(["tiktok/search/users", "tiktok/profile"]);
    expect(results(out.structured)[0].params_filled).toEqual({ query: "skincare" });
    expect(urls.some((u) => u.includes("/v1/utility/plan?query="))).toBe(true);
  });

  it("fills username / user params from an @handle", async () => {
    route({});
    const out = await findStructured(ANON, { task: "twitter user tweets of @jack", limit: 1 });
    const top = results(out.structured)[0];
    expect(top.id).toBe("twitter/user/tweets");
    expect(Object.values(top.params_filled)).toContain("jack");
    expect(top.params_missing).toEqual([]);
  });
});

describe("socialcrawl_find: r/<name>", () => {
  it("names reddit and fills the subreddit param", async () => {
    route({});
    const out = await findStructured(ANON, { task: "r/python top posts", limit: 1 });
    const top = results(out.structured)[0];
    expect(top.id).toBe("reddit/subreddit");
    expect(top.params_filled.subreddit).toBe("python");
    expect(top.params_missing).toEqual([]);
  });
});

describe("socialcrawl_find: uncertain answers from /v1/utility/find", () => {
  it("passes uncertain / reason / source / confidence / note through, top level and per row, and says so first", async () => {
    route({
      "/v1/utility/find": {
        status: 200,
        body: {
          success: true,
          data: {
            uncertain: true,
            reason: "no_match",
            source: "lexical",
            confidence: null,
            note: "No endpoint clearly matches; these are keyword guesses.",
            results: [{ id: "tiktok/profile", uncertain: true, source: "lexical", confidence: null, note: "keyword guess" }],
          },
        },
      },
    });
    const out = await findStructured(KEYED, { task: "something vague" });
    expect(out.text.split("\n")[0]).toBe("Uncertain match: confirm with socialcrawl_endpoint before calling.");
    expect(out.text).toContain("no_match");
    expect(out.text).toContain("keyword guesses");
    expect(out.structured).toMatchObject({
      ok: true,
      source: "api",
      uncertain: true,
      reason: "no_match",
      match_source: "lexical",
      confidence: null,
      note: "No endpoint clearly matches; these are keyword guesses.",
    });
    expect(results(out.structured)[0]).toMatchObject({ id: "tiktok/profile", uncertain: true, source: "lexical", confidence: null, note: "keyword guess" });
  });

  it("returns not_a_data_job as the answer, without falling back to the bundled ranker", async () => {
    route({
      "/v1/utility/find": {
        status: 200,
        body: { success: true, data: { results: [], reason: "not_a_data_job", note: "This is not a data request." } },
      },
    });
    const out = await findStructured(KEYED, { task: "write me a poem about tiktok comments" });
    expect(out.structured).toMatchObject({ ok: true, source: "api", reason: "not_a_data_job", results: [] });
    expect(out.text).toContain("not_a_data_job");
    expect(out.text).not.toContain("tiktok/post/comments");
  });

  it("a refusal says plainly what SocialCrawl cannot do, with no Uncertain match line", async () => {
    route({
      "/v1/utility/find": {
        status: 200,
        body: { success: true, data: { results: [], reason: "not_a_data_job", uncertain: true, note: "This is not a data request." } },
      },
    });
    const out = await findStructured(KEYED, { task: "reply to this tiktok comment" });
    expect(out.text).not.toContain("Uncertain match");
    expect(out.text).toMatch(/only reads public data/);
    expect(out.text).toMatch(/post, reply, like, follow, message/);
    expect(out.text).toMatch(/read the comments/);
  });

  it("keeps the Uncertain match line when results exist and the match is uncertain", async () => {
    route({
      "/v1/utility/find": {
        status: 200,
        body: { success: true, data: { uncertain: true, reason: "no_match", results: [{ id: "tiktok/profile", method: "GET", summary: "p", uncertain: true }] } },
      },
    });
    const out = await findStructured(KEYED, { task: "tiktok thing" });
    expect(out.text).toContain("Uncertain match: confirm with socialcrawl_endpoint before calling.");
  });

  it("still falls back to the bundled ranker on a network error", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const out = await findStructured(KEYED, { task: "tiktok comments", limit: 1 });
    expect(out.structured.source).toBe("local");
    expect(results(out.structured)[0].id).toBe("tiktok/post/comments");
  });

  it("the outputSchema accepts the uncertain fields", async () => {
    const { FindOutputShape } = await import("../schemas/outputs.js");
    const { z } = await import("zod");
    const parsed = z
      .object(FindOutputShape)
      .strict()
      .safeParse({ ok: true, source: "api", uncertain: true, reason: "no_match", match_source: "lexical", confidence: null, note: "n", results: [] });
    expect(parsed.success).toBe(true);
  });
});

describe("socialcrawl_find offline ranking (T26b)", () => {
  type Hit = Result & { method?: string; kind?: string; area?: string; action?: string; actions?: string[]; summary?: string };
  const hits = async (task: string, limit = 3): Promise<Hit[]> => {
    route({});
    const out = await findStructured(ANON, { task, limit });
    return results(out.structured) as Hit[];
  };
  const key = (h: Hit): string => (h.kind === "manage" ? `manage ${h.area}` : `${h.method} ${h.id}`);

  it("a video's comment section beats endpoints that only share path words (video, comment)", async () => {
    const r = await hits("comments on a tiktok video");
    expect(r[0].id).toBe("tiktok/post/comments");
  });

  it("many post URLs across named platforms surface the cross-platform batch endpoint first", async () => {
    const r = await hits("views and likes for 300 TikTok and Instagram post URLs");
    expect(key(r[0])).toBe("POST prism/post-stats");
  });

  it("a count of handles in one call surfaces the batch profile endpoint", async () => {
    const r = await hits("look up 200 tiktok and instagram handles at once");
    expect(r.map(key)).toContain("POST prism/profiles");
  });

  it("a background job is a prism job submitted through socialcrawl_manage", async () => {
    const r = await hits("submit 3,000 profile lookups as a background job");
    expect(key(r[0])).toBe("POST prism/jobs");
    expect(r[0].call).toMatchObject({ tool: "socialcrawl_manage", arguments: { area: "jobs", action: "submit" } });
  });

  it("which of MY accounts posted about X is a cohort, pointed at socialcrawl_manage", async () => {
    const { MANAGE_ACTIONS } = await import("../tools/manage.js");
    const r = await hits("which of my list of customer accounts posted about acme");
    expect(r[0]).toMatchObject({ kind: "manage", area: "cohorts", call: { tool: "socialcrawl_manage", arguments: { area: "cohorts", action: "create" } } });
    expect(r[0].actions).toEqual(MANAGE_ACTIONS.cohorts);
    expect(r[0].summary?.length).toBeGreaterThan(20);
  });

  it("a recurring run with alerts surfaces monitors", async () => {
    const r = await hits("re-run brand mentions for acme every day and alert me when negative share jumps");
    expect(r.map(key)).toContain("manage monitors");
    const m = r.find((h) => h.kind === "manage")!;
    expect(m.call).toMatchObject({ tool: "socialcrawl_manage", arguments: { area: "monitors", action: "create" } });
  });

  it("a page-change alert is a web monitor created through socialcrawl_manage", async () => {
    const r = await hits("watch this pricing page for changes and alert me");
    const m = r.find((h) => key(h) === "POST web/monitors");
    expect(m?.call).toMatchObject({ tool: "socialcrawl_manage", arguments: { area: "web", action: "monitor_create" } });
  });

  it("creators by topic and country rank a discovery (search) endpoint above profile details", async () => {
    for (const task of ["tiktok creators in brazil who post about cooking", "Instagram creators about skincare in Germany"]) {
      const r = await hits(task);
      expect(r[0].id, task).toMatch(/(^|\/)search(\/|$)/);
    }
  });

  it("the text names the manage call for a stateful result", async () => {
    route({});
    const out = await findStructured(ANON, { task: "which of my list of customer accounts posted about acme" });
    expect(out.text).toContain('"tool":"socialcrawl_manage"');
    expect(out.text).toContain("cohorts");
  });
});
