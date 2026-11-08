import { describe, it, expect, vi, afterEach } from "vitest";
import { findEndpoint } from "../data/endpoints.js";
import { resolveEndpoint } from "../endpoint-resolve.js";
import { FEED_PATH_ALIASES, planParamAliases } from "../param-aliases.js";
import { request } from "../tools/request.js";
import type { ApiContext } from "../context.js";

/**
 * UPGRADE-LOG API-051: the API accepts `sort`, `country`, `limit`, `since`
 * and `until` under their common names (and the sibling date spellings),
 * moving each onto the lane's own name and saying so in `data._warnings`;
 * and `{platform}/profile/posts` (plus a few other guessed feed paths) is
 * served as that platform's posts feed. A port of
 * packages/social-api/src/validation/param-aliases.ts,
 * validation/request-params/index.ts (DATE_FILTER_ALIASES,
 * HOUSE_WINDOW_ALIASES) and router/platform-alias.ts (FEED_PATH_ALIASES).
 */

const ctx: ApiContext = { apiKey: "sc_test_key", baseUrl: "https://www.socialcrawl.dev" };
afterEach(() => vi.unstubAllGlobals());

function okFetch(): () => string {
  let url = "";
  vi.stubGlobal("fetch", async (u: string) => {
    url = u;
    return new Response(JSON.stringify({ success: true, data: { items: [] }, credits_used: 1 }), { status: 200 });
  });
  return () => url;
}

describe("planParamAliases", () => {
  it("moves `sort` onto a lane's sort enum (tiktok/profile/videos sort_by)", () => {
    const e = findEndpoint("tiktok", "profile/videos")!;
    expect(planParamAliases(e, { handle: "a", sort: "popular" })).toEqual([{ from: "sort", to: "sort_by" }]);
  });

  it("moves `limit` onto an integer `count` where `limit` is not declared", () => {
    const e = findEndpoint("kwai", "user/posts")!;
    expect(planParamAliases(e, { limit: "20" })).toEqual([{ from: "limit", to: "count" }]);
  });

  it("moves a dated `since` onto `start_date`, and leaves an undated one", () => {
    const e = findEndpoint("tavily", "search")!;
    expect(planParamAliases(e, { query: "x", since: "2026-10-01" })).toEqual([{ from: "since", to: "start_date" }]);
    expect(planParamAliases(e, { query: "x", since: "yesterday" })).toEqual([]);
  });

  it("never aliases a name the endpoint declares, or onto a target already sent", () => {
    const e = findEndpoint("tiktok", "profile/videos")!;
    expect(planParamAliases(e, { sort_by: "latest" })).toEqual([]);
    expect(planParamAliases(e, { sort: "latest", sort_by: "popular" })).toEqual([]);
  });

  it("never writes onto a read-only spelling (gl, geo, market, num)", () => {
    // Every target in the country list after `country` must be a declared,
    // writable name; `gl` is read from a caller but never written to.
    const e = findEndpoint("tiktok", "profile/videos")!;
    expect(planParamAliases(e, { gl: "US" }).map((a) => a.to)).not.toContain("gl");
  });
});

describe("feed path aliases", () => {
  it("mirrors the backend table, every target an active endpoint on the same platform", () => {
    expect(Object.keys(FEED_PATH_ALIASES).length).toBe(14);
    for (const [from, to] of Object.entries(FEED_PATH_ALIASES)) {
      const [p, ...rest] = to.split("/");
      expect(findEndpoint(p!, rest.join("/")), to).toBeDefined();
      expect(from.split("/")[0]).toBe(p);
      const [fp, ...frest] = from.split("/");
      expect(findEndpoint(fp!, frest.join("/")), `${from} must not shadow a real endpoint`).toBeUndefined();
    }
  });

  it("resolves tiktok/profile/posts to tiktok/profile/videos and x/… to twitter/…", () => {
    const r = resolveEndpoint("tiktok", "profile/posts", undefined)!;
    expect(`${r.endpoint.platform}/${r.endpoint.resource}`).toBe("tiktok/profile/videos");
    expect(r.aliasOf).toBe("tiktok/profile/posts");
    const x = resolveEndpoint("x", "user/tweets", undefined)!;
    expect(`${x.endpoint.platform}/${x.endpoint.resource}`).toBe("twitter/user/tweets");
    const xa = resolveEndpoint("x", "profile/posts", undefined)!;
    expect(`${xa.endpoint.platform}/${xa.endpoint.resource}`).toBe("twitter/user/tweets");
  });
});

describe("socialcrawl_request with a common name", () => {
  it("says the API reads `sort` as `sort_by` instead of claiming it is dropped", async () => {
    okFetch();
    const out = await request(ctx, { platform: "tiktok", resource: "profile/videos", params: { handle: "a", sort: "popular" } });
    expect(out).toContain("`sort` is sent as `sort_by`");
    expect(out).not.toMatch(/`sort` is not declared on this endpoint and was dropped/);
  });

  it("still says a truly unknown param is dropped", async () => {
    okFetch();
    const out = await request(ctx, { platform: "tiktok", resource: "profile/videos", params: { handle: "a", bogus_param: "1" } });
    expect(out).toMatch(/`bogus_param` is not declared on this endpoint and was dropped/);
  });

  it("calls the real feed for a guessed profile/posts path and says so", async () => {
    const url = okFetch();
    const out = await request(ctx, { platform: "tiktok", resource: "profile/posts", params: { handle: "a" } });
    expect(new URL(url()).pathname).toBe("/v1/tiktok/profile/videos");
    expect(out).toContain("tiktok/profile/posts");
    expect(out).toContain("tiktok/profile/videos");
  });
});
