import { describe, it, expect, vi, afterEach } from "vitest";
import { ENDPOINTS, findEndpoint } from "../data/endpoints.js";
import { REGISTRY_FINGERPRINT } from "../data/registry-meta.js";
import { getDoc } from "../data/docs.js";
import {
  capabilityIndex,
  judgedEndpoints,
  judgmentHoldMax,
  quoteJudgments,
} from "../judgments.js";
import { hydrationTokens } from "../hydration.js";
import { pricing } from "../tools/pricing.js";
import { request } from "../tools/request.js";
import { listEndpoints } from "../tools/list-endpoints.js";
import { discover } from "../tools/discover.js";
import type { ApiContext } from "../context.js";

const ctx: ApiContext = { apiKey: "sc_test_key", baseUrl: "https://www.socialcrawl.dev" };
const noKey: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function captureFetch(payload: unknown = { success: true, data: {} }): () => { url: string; method: string } {
  let seen = { url: "", method: "" };
  vi.stubGlobal("fetch", async (u: string, init?: RequestInit) => {
    seen = { url: u, method: init?.method ?? "GET" };
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  return () => seen;
}

const ep = (platform: string, resource: string, method?: string) => {
  const e = findEndpoint(platform, resource, method);
  if (!e) throw new Error(`missing ${method ?? ""} ${platform}/${resource}`);
  return e;
};

describe("schema v3 data", () => {
  it("carries the registry fingerprint", () => {
    expect(REGISTRY_FINGERPRINT).toMatch(/^[0-9a-f]{64}$/);
  });

  it("points every related id at a real endpoint", () => {
    const ids = new Set(ENDPOINTS.map((e) => `${e.platform}/${e.resource}`));
    for (const e of ENDPOINTS) {
      for (const r of e.related ?? []) {
        expect(ids.has(r.id), `${e.platform}/${e.resource} → ${r.id}`).toBe(true);
        expect(r.why.length).toBeGreaterThan(0);
      }
    }
  });

  it("only features params the endpoint declares", () => {
    for (const e of ENDPOINTS) {
      const names = new Set([...e.params, ...e.optionalParams].map((p) => p.name));
      for (const f of e.featuredParams ?? []) {
        expect(names.has(f.name), `${e.platform}/${e.resource} features undeclared ${f.name}`).toBe(true);
      }
    }
  });

  it("declares the label / relevance params on every judged endpoint", () => {
    expect(judgedEndpoints().length).toBeGreaterThan(40);
    for (const e of judgedEndpoints()) {
      const names = new Set([...e.params, ...e.optionalParams].map((p) => p.name));
      if (e.judgments!.labels) expect(names.has("label"), `${e.platform}/${e.resource}`).toBe(true);
      if (e.judgments!.relevance) expect(names.has("relevance"), `${e.platform}/${e.resource}`).toBe(true);
      expect(names.has("judgments"), `${e.platform}/${e.resource}`).toBe(true);
    }
  });

  it("keeps automatic joins out of the include tokens", () => {
    const yt = ep("youtube", "search");
    expect(yt.automaticJoins?.map((l) => l.token)).toEqual(["dates"]);
    expect(hydrationTokens(yt)).not.toContain("dates");
    expect(yt.automaticJoins![0].defaultOn).toEqual({ unlessParam: "exact_dates", unlessValue: "false" });
  });
});

describe("judgment holds mirror the backend", () => {
  // The judged-row caps are mirrored by hand; each lane's authored rule states
  // its own hold, so the two must agree or a backend change went unnoticed.
  it("matches every authored 'holds N extra credits' for labels and relevance", () => {
    for (const e of judgedEndpoints()) {
      const rule = e.pricing.description ?? "";
      const sentences = rule.split(/(?<=\.)\s+/);
      for (const sentence of sentences) {
        if (!/(label=|relevant_to=)/.test(sentence)) continue;
        const m = /holds (\d+) extra credits/.exec(sentence);
        if (!m) continue;
        expect(Number(m[1]), `${e.platform}/${e.resource}: "${sentence.slice(0, 80)}…"`).toBe(
          judgmentHoldMax(e),
        );
      }
    }
  });

  it("charges nothing for free presets", () => {
    const q = quoteJudgments(ep("tiktok", "profile/videos"), { label: "sponsored,niche" });
    expect(q.held).toBe(0);
    expect(q.freePresets).toEqual(["sponsored", "niche"]);
  });

  it("holds 4 for a metered post preset on a 100-row lane", () => {
    const q = quoteJudgments(ep("tiktok", "profile/videos"), { label: "mention", brand: "Acme" });
    expect(q.labelHold).toBe(4);
    expect(q.paidPresets).toEqual(["mention"]);
  });

  it("meters intent only with offer=", () => {
    const e = ep("instagram", "profile/posts");
    expect(quoteJudgments(e, { label: "intent" }).held).toBe(0);
    expect(quoteJudgments(e, { label: "intent", offer: "web design" }).held).toBe(4);
  });

  it("meters relevance only with relevant_to, and notes relevant_to alone", () => {
    const e = ep("reddit", "search");
    expect(quoteJudgments(e, { relevance: "filter" }).held).toBe(0);
    expect(quoteJudgments(e, { relevance: "filter", relevant_to: "the slot game" }).relevanceHold).toBe(4);
    const alone = quoteJudgments(e, { relevant_to: "x" });
    expect(alone.held).toBe(0);
    expect(alone.notes.join(" ")).toContain("only applies with");
  });

  it("uses the larger caps on the wide lanes", () => {
    expect(judgmentHoldMax(ep("tiktok", "search"))).toBe(5);
    expect(judgmentHoldMax(ep("linkedin", "search/posts"))).toBe(8);
    expect(judgmentHoldMax(ep("search", "multi"))).toBe(8);
  });

  it("flags mention without a brand and the defaults-off switch", () => {
    const e = ep("twitter", "search/tweets");
    expect(quoteJudgments(e, { label: "mention" }).notes.join(" ")).toContain("brand=");
    expect(quoteJudgments(e, { judgments: "off" }).defaultsOff).toBe(true);
  });
});

describe("socialcrawl_pricing judgments + exact quotes", () => {
  it("lists every judged endpoint", () => {
    const out = pricing({ action: "judgments" });
    for (const e of judgedEndpoints()) expect(out).toContain(`/v1/${e.platform}/${e.resource}\``);
  });

  it("itemises a call with joins, a metered label and max_pages, and budgets the job", () => {
    const out = pricing({
      action: "endpoint",
      platform: "youtube",
      resource: "search",
      params: { query: "x", include: "engagement,channel", label: "mention", brand: "Acme", max_pages: "3" },
      calls: 10,
    });
    expect(out).toContain("up to **15cr** × 3 pages = up to **45cr** per call");
    expect(out).toContain("up to **450 credits**");
  });

  it("budgets a band it cannot explain at the ceiling", () => {
    const out = pricing({ action: "endpoint", platform: "tiktok", resource: "search", params: { limit: "120" } });
    expect(out).toContain("up to **42cr**");
  });

  it("documents judgments and jobs as topics", () => {
    expect(getDoc("judgments")).toContain("judgments=off");
    expect(getDoc("batch-jobs")).toContain("/v1/prism/jobs");
    expect(getDoc("jobs")).toContain("Jobs");
    expect(getDoc("credits")).toContain("max_pages");
    expect(getDoc("pagination")).toContain("stop_at_id");
  });
});

describe("socialcrawl_request: paths, methods, judgments", () => {
  it("substitutes a {path} param from params and keeps it off the query", async () => {
    const seen = captureFetch();
    await request(ctx, { platform: "prism", resource: "jobs/{job_id}", params: { job_id: "job_123" } });
    expect(seen().url).toContain("/v1/prism/jobs/job_123");
    expect(seen().url).not.toContain("job_id=");
  });

  it("accepts the concrete path form", async () => {
    const seen = captureFetch();
    const out = await request(ctx, { platform: "prism", resource: "jobs/job_abc" });
    expect(seen().url).toContain("/v1/prism/jobs/job_abc");
    expect(out).toContain("GET /v1/prism/jobs/job_abc");
  });

  it("sends a body to the POST variant and no body to the GET list", async () => {
    const seen = captureFetch();
    await request(ctx, {
      platform: "prism",
      resource: "jobs",
      body: { endpoint: "prism/profiles", items: [{ platform: "tiktok", handle: "scout2015" }] },
    });
    expect(seen().method).toBe("POST");
    await request(ctx, { platform: "prism", resource: "jobs" });
    expect(seen().method).toBe("GET");
  });

  it("quotes a metered judgment hold in the header", async () => {
    captureFetch();
    const out = await request(ctx, {
      platform: "tiktok",
      resource: "profile/videos",
      params: { handle: "scout2015", label: "mention", brand: "Acme" },
    });
    expect(out).toContain("**Judgments:** held 4cr for `label=mention`");
  });

  it("says the default judgments are free when none are asked for", async () => {
    captureFetch();
    const out = await request(ctx, { platform: "reddit", resource: "search", params: { query: "espresso" } });
    expect(out).toContain("Free judgments on every row");
  });

  it("rejects an unknown label preset locally", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network call made");
    });
    const out = await request(ctx, {
      platform: "instagram",
      resource: "post/comments",
      params: { url: "https://www.instagram.com/p/abc/", label: "vibes" },
    });
    expect(out).toContain("Invalid parameter value");
  });
});

describe("discovery: capabilities, plan, listings", () => {
  it("answers capabilities from bundled data without a key", async () => {
    const out = await discover(noKey, { action: "capabilities" });
    expect(out).toContain("`label` (post rows)");
    expect(out).toContain("`seen`");
    expect(out).toContain("`max_pages`");
  });

  it("filters capabilities by param", async () => {
    const out = await discover(noKey, { action: "capabilities", param: "relevance" });
    expect(out).toContain("relevant_to");
    expect(out).not.toContain("`label` (post rows)");
  });

  it("needs a query for plan and explains the keyless fallback", async () => {
    expect(await discover(ctx, { action: "plan" })).toContain("requires `query`");
    expect(await discover(noKey, { action: "plan", query: "track Acme" })).toContain("needs an API key");
  });

  it("renders a live plan", async () => {
    captureFetch({
      success: true,
      data: {
        kind: "call_plan",
        recipe: "brand_monitoring",
        uncertain: false,
        reason: "planned",
        confidence: 0.9,
        steps: [{ id: "s1", method: "GET", path: "/v1/reddit/search", params: { query: "Acme" }, missing: [], credits: 1, run: "ready", curl: "curl …" }],
        ask: [],
        cannot: [],
        alternatives: [],
        cheaper: null,
        deeper: null,
      },
    });
    const out = await discover(ctx, { action: "plan", query: "track Acme on Reddit" });
    expect(out).toContain("`GET /v1/reddit/search` — 1cr");
  });

  it("indexes every capability against declaring endpoints", () => {
    const idx = capabilityIndex();
    const label = idx.filter((c) => c.param === "label").map((c) => c.family).sort();
    expect(label).toEqual(["comment", "post", "review"]);
    for (const c of idx) expect(c.endpoints.length).toBeGreaterThan(0);
  });

  it("shows featured params, judgments and related endpoints in a listing", () => {
    const out = listEndpoints({ platform: "twitter", search: "search/tweets", detail: "full" });
    expect(out).toContain("**Worth knowing:**");
    expect(out).toContain("**Labels (`label=`");
    expect(out).toContain("**Related:**");
  });

  it("finds endpoints by parameter name", () => {
    const out = listEndpoints({ search: "stop_at_id" });
    expect(out).toContain("/v1/instagram/profile/posts");
  });
});
