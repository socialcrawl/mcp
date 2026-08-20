import { describe, it, expect, vi, afterEach } from "vitest";
import { request } from "../tools/request.js";
import { listEndpoints } from "../tools/list-endpoints.js";
import { findEndpoint } from "../data/endpoints.js";
import type { ApiContext } from "../context.js";

const ctx: ApiContext = { apiKey: "sc_test_key", baseUrl: "https://www.socialcrawl.dev" };

afterEach(() => {
  vi.restoreAllMocks();
});

/** Fails the test if the client ever reaches the network. */
function forbidFetch(): void {
  vi.stubGlobal("fetch", async () => {
    throw new Error("network call made — validation should have rejected this locally");
  });
}

function okFetch(payload: unknown = { success: true, data: {} }): () => string {
  let url = "";
  vi.stubGlobal("fetch", async (u: string) => {
    url = u;
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  return () => url;
}

/**
 * The local validator mirrors the backend's pre-billing rules. Every case here
 * is one the API would answer with a free 400 — catching it locally saves the
 * round trip, and (more importantly) stops an agent looping on a call that can
 * never succeed.
 */
describe("socialcrawl_request local validation", () => {
  it("rejects an unknown enum value without calling the API", async () => {
    forbidFetch();
    const out = await request(ctx, {
      platform: "reddit",
      resource: "subreddit",
      params: { subreddit: "programming", sort: "definitely-not-a-sort" },
    });
    expect(out).toContain("Invalid parameter value");
    expect(out).toContain("Allowed values:");
    expect(out).toContain("No credits were charged");
  });

  it("rejects an integer outside its declared range", async () => {
    forbidFetch();
    const out = await request(ctx, {
      platform: "search",
      resource: "news",
      params: { query: "samsung", max_legs: "99" },
    });
    expect(out).toContain("above the maximum of 12");
  });

  it("rejects a value below the declared minimum", async () => {
    forbidFetch();
    const out = await request(ctx, {
      platform: "search",
      resource: "news",
      params: { query: "samsung", depth: "1" },
    });
    expect(out).toContain("below the minimum of 10");
  });

  it("rejects a non-numeric integer", async () => {
    forbidFetch();
    const out = await request(ctx, {
      platform: "search",
      resource: "news",
      params: { query: "samsung", depth: "many" },
    });
    expect(out).toContain("is not an integer");
  });

  it("still enforces required params and oneOf groups", async () => {
    forbidFetch();
    const missing = await request(ctx, { platform: "tiktok", resource: "profile" });
    expect(missing).toContain("Missing required parameter");
    expect(missing).toContain("one of");
  });

  it("suggests near matches for an unknown resource", async () => {
    forbidFetch();
    const out = await request(ctx, { platform: "tiktok", resource: "profil" });
    expect(out).toContain("Unknown resource");
    expect(out).toContain("Closest matches");
  });

  it("lets a valid call through and reports the price", async () => {
    const url = okFetch();
    const out = await request(ctx, {
      platform: "tiktok",
      resource: "profile",
      params: { handle: "charlidamelio" },
    });
    expect(url()).toContain("handle=charlidamelio");
    expect(out).toContain("**Price:** 1cr (standard)");
  });

  it("quotes the metered band and rule on a metered endpoint", async () => {
    okFetch();
    const out = await request(ctx, {
      platform: "search",
      resource: "news",
      params: { query: "samsung galaxy" },
    });
    expect(out).toContain("2-14cr (metered)");
    expect(out).toContain("Metered rule:");
    expect(out).toContain("refunded to the actual charge");
  });

  it("flags undeclared params instead of silently forwarding them", async () => {
    okFetch();
    const out = await request(ctx, {
      platform: "tiktok",
      resource: "profile",
      params: { handle: "charlidamelio", bogus_param: "x" },
    });
    expect(out).toContain("`bogus_param`");
    expect(out).toContain("ignored");
  });

  it("does not flag the universal cursor/limit aliases", async () => {
    okFetch();
    const out = await request(ctx, {
      platform: "tiktok",
      resource: "profile",
      params: { handle: "charlidamelio", cursor: "sc.abc" },
    });
    expect(out).not.toContain("`cursor`");
  });

  it("keeps refusing the web platform", async () => {
    forbidFetch();
    const out = await request(ctx, { platform: "web", resource: "scrape", params: { url: "https://x.com" } });
    expect(out).toContain("socialcrawl_web");
  });
});

describe("csv constraint validation", () => {
  const csvEndpoint = () =>
    // Naver Data Lab is the live user of csvConstraints (entry count + per-entry
    // enum). Resolve it from the data so this test tracks the registry.
    Object.values(
      Object.fromEntries(
        (["search-trend", "shopping-insight/category", "shopping-insight/keyword"] as const)
          .map((r) => [r, findEndpoint("naver", r)] as const)
          .filter(([, e]) => e?.csvConstraints),
      ),
    )[0];

  it("has at least one endpoint carrying CSV constraints", () => {
    expect(csvEndpoint()).toBeDefined();
  });

  it("rejects too many comma-separated entries", async () => {
    const e = csvEndpoint()!;
    const [param, constraint] = Object.entries(e.csvConstraints!).find(
      ([, c]) => c.max !== undefined,
    )!;
    forbidFetch();
    const params: Record<string, string> = {};
    for (const p of e.params) params[p.name] = p.example;
    params[param] = Array.from({ length: constraint.max! + 2 }, (_, i) => `v${i}`).join(",");
    const out = await request(ctx, {
      platform: e.platform,
      resource: e.resource,
      params,
    });
    expect(out).toContain("comma-separated value(s)");
  });
});

describe("socialcrawl_list_endpoints", () => {
  it("searches across every platform when none is given", () => {
    const out = listEndpoints({ search: "transcript" });
    expect(out).toContain("Endpoint search");
    expect(out).toContain("/v1/youtube/video/transcript");
    expect(out).toContain("/v1/tiktok/post/transcript");
  });

  it("narrows a search to one platform", () => {
    const out = listEndpoints({ platform: "youtube", search: "transcript" });
    expect(out).toContain("/v1/youtube/video/transcript");
    expect(out).not.toContain("/v1/tiktok/");
  });

  it("filters by method", () => {
    const out = listEndpoints({ search: "batch", method: "POST" });
    expect(out).toContain("POST");
    expect(out).not.toContain("| GET |");
  });

  it("filters by budget using the metered worst case", () => {
    const out = listEndpoints({ platform: "prism", maxCost: 5 });
    expect(out).not.toContain("`brand-mentions`");
  });

  it("prints parameter bounds, enums, and couplings in full detail", () => {
    const out = listEndpoints({ platform: "search" });
    expect(out).toContain("range 1-12");
    expect(out).toContain("enum: day|week|month|year");
  });

  it("prints the paging contract for a paginated endpoint", () => {
    const out = listEndpoints({ platform: "reddit" });
    expect(out).toContain("**Paging:**");
    expect(out).toContain("universal alias");
  });

  it("prints the metered rule alongside the endpoint", () => {
    const out = listEndpoints({ platform: "prism", search: "handle-audit", detail: "full" });
    expect(out).toContain("**Metered:**");
    expect(out).toContain("+1 credit per selected platform");
  });

  it("still accepts a bare platform slug for backward compatibility", () => {
    expect(listEndpoints("tiktok")).toContain("TikTok");
  });

  it("reports an unknown platform", () => {
    expect(listEndpoints({ platform: "nope" })).toContain("Unknown platform");
  });

  it("says so when a search matches nothing", () => {
    expect(listEndpoints({ search: "zzzznotathing" })).toContain("No endpoints match");
  });
});
