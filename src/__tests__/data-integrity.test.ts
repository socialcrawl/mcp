import { describe, it, expect } from "vitest";
import { PLATFORMS, findPlatform, getAllPlatformSlugs } from "../data/platforms.js";
import { ENDPOINTS, findEndpoint, getEndpointsByPlatform } from "../data/endpoints.js";
import { getDoc, getAvailableTopics } from "../data/docs.js";

describe("Platform data integrity", () => {
  it("has exactly 44 platforms", () => {
    expect(PLATFORMS).toHaveLength(44);
  });

  it("every platform has a non-empty slug, name, and description", () => {
    for (const platform of PLATFORMS) {
      expect(platform.slug).toBeTruthy();
      expect(platform.name).toBeTruthy();
      expect(platform.description).toBeTruthy();
      expect(platform.endpointCount).toBeGreaterThan(0);
    }
  });

  it("has no duplicate platform slugs", () => {
    const slugs = PLATFORMS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("findPlatform returns correct platform", () => {
    const tiktok = findPlatform("tiktok");
    expect(tiktok).toBeDefined();
    expect(tiktok!.name).toBe("TikTok");
  });

  it("findPlatform returns undefined for unknown slug", () => {
    expect(findPlatform("nonexistent")).toBeUndefined();
  });

  it("getAllPlatformSlugs returns 44 slugs", () => {
    expect(getAllPlatformSlugs()).toHaveLength(44);
  });
});

describe("Endpoint data integrity", () => {
  it("has exactly 357 endpoints", () => {
    expect(ENDPOINTS.length).toBe(357);
  });

  // Composite (prism) recipes, the per-platform `profile/full` cards, the
  // meta-search lanes (search/*), `naver/brief`, `youtube/video/transcript`
  // (re-sourced to a cheaper upstream at a flat 3cr), and the content_analysis
  // aggregate endpoints (flat 20cr CONTENT_ANALYSIS_COST — DataForSEO-metered,
  // the standard 1cr reference endpoints stay on the ladder) carry flat or
  // metered prices that intentionally break the 1/5/10 tier ladder. Everything
  // else must follow the ladder — this predicate is the single exemption seam.
  const isFlatPriced = (e: (typeof ENDPOINTS)[number]): boolean =>
    e.platform === "prism" ||
    e.platform === "search" ||
    // The stateful web platform: management ops are 0cr, agent is 25cr, search
    // is 2cr — all off the 1/5/10 ladder.
    e.platform === "web" ||
    e.resource === "profile/full" ||
    (e.platform === "naver" && e.resource === "brief") ||
    (e.platform === "youtube" && e.resource === "video/transcript") ||
    // Batch transcript fan-out — metered 3cr per successful id.
    (e.platform === "youtube" && e.resource === "transcripts") ||
    // Comment lookup — metered 2cr (TikTok tier).
    (e.platform === "tiktok" && e.resource === "comment") ||
    (e.platform === "content_analysis" && e.creditTier === "advanced");

  it("every endpoint has required fields", () => {
    for (const endpoint of ENDPOINTS) {
      expect(endpoint.platform).toBeTruthy();
      expect(endpoint.resource).toBeTruthy();
      expect(["GET", "POST", "PATCH", "DELETE"]).toContain(endpoint.method);
      expect(["standard", "advanced", "premium"]).toContain(endpoint.creditTier);
      // Costs are non-negative integers; flat-priced composites override the
      // 1/5/10 ladder (validated per-endpoint in "creditCost matches creditTier").
      expect(Number.isInteger(endpoint.creditCost)).toBe(true);
      expect(endpoint.creditCost).toBeGreaterThanOrEqual(0);
      expect(endpoint.archetype).toBeTruthy();
      expect(endpoint.summary).toBeTruthy();
    }
  });

  it("creditCost matches creditTier", () => {
    const tierCosts: Record<string, number> = { standard: 1, advanced: 5, premium: 10 };
    for (const endpoint of ENDPOINTS) {
      // Flat-priced composites / meta-search override the tier ladder.
      if (isFlatPriced(endpoint)) continue;
      expect(endpoint.creditCost).toBe(tierCosts[endpoint.creditTier]);
    }
  });

  it("every endpoint belongs to a known platform", () => {
    const slugs = new Set(getAllPlatformSlugs());
    for (const endpoint of ENDPOINTS) {
      expect(slugs.has(endpoint.platform)).toBe(true);
    }
  });

  it("every platform has endpoints matching its declared count", () => {
    for (const platform of PLATFORMS) {
      const endpoints = getEndpointsByPlatform(platform.slug);
      expect(endpoints.length).toBe(platform.endpointCount);
    }
  });

  it("every param has name, description, and example", () => {
    for (const endpoint of ENDPOINTS) {
      for (const param of endpoint.params) {
        expect(param.name).toBeTruthy();
        expect(param.description).toBeTruthy();
        expect(param.example).toBeTruthy();
      }
    }
  });

  it("findEndpoint returns correct endpoint", () => {
    const ep = findEndpoint("tiktok", "profile");
    expect(ep).toBeDefined();
    expect(ep!.archetype).toBe("Author");
    // handle/user_id are a oneOf group: at least one must be provided.
    expect(ep!.oneOfGroups).toEqual([["handle", "user_id"]]);
    expect(ep!.optionalParams.map((p) => p.name)).toContain("handle");
  });

  it("findEndpoint returns undefined for unknown resource", () => {
    expect(findEndpoint("tiktok", "nonexistent")).toBeUndefined();
  });

  it("every oneOfGroups member is present in optionalParams", () => {
    for (const endpoint of ENDPOINTS) {
      if (endpoint.oneOfGroups.length === 0) continue;
      const optionalNames = new Set(endpoint.optionalParams.map((p) => p.name));
      for (const group of endpoint.oneOfGroups) {
        for (const member of group) {
          expect(
            optionalNames.has(member),
            `${endpoint.platform}/${endpoint.resource}: oneOf member "${member}" not in optionalParams`,
          ).toBe(true);
        }
      }
    }
  });

  it("no oneOfGroups member appears in required params", () => {
    for (const endpoint of ENDPOINTS) {
      if (endpoint.oneOfGroups.length === 0) continue;
      const requiredNames = new Set(endpoint.params.map((p) => p.name));
      for (const group of endpoint.oneOfGroups) {
        for (const member of group) {
          expect(
            requiredNames.has(member),
            `${endpoint.platform}/${endpoint.resource}: oneOf member "${member}" wrongly listed as required`,
          ).toBe(false);
        }
      }
    }
  });

  it("every optional param has a name and type", () => {
    for (const endpoint of ENDPOINTS) {
      for (const opt of endpoint.optionalParams) {
        expect(opt.name).toBeTruthy();
        expect(["string", "boolean", "integer", "enum"]).toContain(opt.type);
        if (opt.type === "enum") {
          expect(opt.enumValues).toBeDefined();
          expect(opt.enumValues!.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("Documentation data integrity", () => {
  it("has overview, full, authentication, credits, and errors topics", () => {
    expect(getDoc("overview")).toBeTruthy();
    expect(getDoc("full")).toBeTruthy();
    expect(getDoc("authentication")).toBeTruthy();
    expect(getDoc("credits")).toBeTruthy();
    expect(getDoc("errors")).toBeTruthy();
  });

  it("has documentation for every platform", () => {
    for (const platform of PLATFORMS) {
      const doc = getDoc(platform.slug);
      expect(doc, `Missing docs for platform: ${platform.slug}`).toBeTruthy();
    }
  });

  it("getDoc returns undefined for unknown topic", () => {
    expect(getDoc("nonexistent")).toBeUndefined();
  });

  it("getAvailableTopics returns 8 fixed topics + one per platform", () => {
    expect(getAvailableTopics()).toHaveLength(8 + PLATFORMS.length);
  });

  it("getAvailableTopics includes the idempotency, monitors, and pricing topics", () => {
    expect(getAvailableTopics()).toContain("idempotency");
    expect(getAvailableTopics()).toContain("monitors");
    expect(getAvailableTopics()).toContain("pricing");
  });

  it("has a monitors documentation topic covering all 7 operations", () => {
    const doc = getDoc("monitors")!;
    expect(doc).toBeTruthy();
    for (const op of [
      "POST /v1/monitors",
      "GET /v1/monitors/:id/runs",
      "GET /v1/monitors/:id/timeseries",
      "PATCH /v1/monitors/:id",
      "DELETE /v1/monitors/:id",
    ]) {
      expect(doc).toContain(op);
    }
  });
});

describe("Pricing documentation", () => {
  it("has a pricing topic", () => {
    expect(getDoc("pricing")).toBeTruthy();
  });

  it("lists every endpoint with its credit cost", () => {
    const pricing = getDoc("pricing")!;
    for (const e of ENDPOINTS) {
      // Rows list `resource` only (method prefixed when not GET); the platform
      // is carried by the section header, keeping the doc under 25k.
      const label = e.method === "GET" ? e.resource : `${e.method} ${e.resource}`;
      expect(
        pricing,
        `pricing doc missing ${e.method} /v1/${e.platform}/${e.resource}`,
      ).toContain(`| \`${label}\` | ${e.creditCost}cr | ${e.creditTier} |`);
    }
  });

  it("documents the flat 20-credit override for search/everywhere", () => {
    const pricing = getDoc("pricing")!;
    expect(pricing).toContain("| flat override | 20 credits | `/v1/search/everywhere` |");
  });

  it("stays under the 25k truncation limit so it is never cut off", () => {
    expect(getDoc("pricing")!.length).toBeLessThanOrEqual(25_000);
  });
});

describe("Errors documentation reflects 2026-04-17 backend", () => {
  it("documents METHOD_NOT_ALLOWED (405)", () => {
    const errors = getDoc("errors")!;
    expect(errors).toContain("METHOD_NOT_ALLOWED");
    expect(errors).toContain("405");
  });

  it("documents IDEMPOTENCY_KEY_CONFLICT (409)", () => {
    const errors = getDoc("errors")!;
    expect(errors).toContain("IDEMPOTENCY_KEY_CONFLICT");
    expect(errors).toContain("409");
  });

  it("documents IDEMPOTENCY_KEY_PAYLOAD_MISMATCH (422)", () => {
    const errors = getDoc("errors")!;
    expect(errors).toContain("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
    expect(errors).toContain("422");
  });

  it("notes that RESOURCE_NOT_FOUND auto-refunds credits (BIL-01)", () => {
    const errors = getDoc("errors")!;
    // The RESOURCE_NOT_FOUND row should mention refund / auto-refund.
    expect(errors).toMatch(/RESOURCE_NOT_FOUND[\s\S]*?refund/i);
  });

  it("uses the path-style doc_url format (no anchor fragment)", () => {
    const errors = getDoc("errors")!;
    expect(errors).not.toContain("docs/errors#");
    expect(errors).toMatch(/docs\/errors\/[a-z-]+/);
  });
});

describe("Credits documentation reflects 2026-04-17 backend", () => {
  it("mentions the optional data._warnings advisory channel (ENV-03)", () => {
    const credits = getDoc("credits")!;
    expect(credits).toContain("_warnings");
  });
});

describe("Idempotency documentation (BIL-02)", () => {
  it("has an idempotency topic", () => {
    expect(getDoc("idempotency")).toBeTruthy();
  });

  it("documents the Idempotency-Key header", () => {
    const doc = getDoc("idempotency")!;
    expect(doc).toContain("Idempotency-Key");
  });

  it("explains the 24h TTL and zero-credit replay", () => {
    const doc = getDoc("idempotency")!;
    expect(doc).toMatch(/24\s*h/i);
    expect(doc).toContain("0 credit");
  });
});

describe("Meta endpoint documentation (SEC-02)", () => {
  it("overview mentions /v1/credits/balance", () => {
    const overview = getDoc("overview")!;
    expect(overview).toContain("/v1/credits/balance");
  });
});
