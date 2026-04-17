import { describe, it, expect } from "vitest";
import { PLATFORMS, findPlatform, getAllPlatformSlugs } from "../data/platforms.js";
import { ENDPOINTS, findEndpoint, getEndpointsByPlatform } from "../data/endpoints.js";
import { DOCS, getDoc, getAvailableTopics } from "../data/docs.js";

describe("Platform data integrity", () => {
  it("has exactly 21 platforms", () => {
    expect(PLATFORMS).toHaveLength(21);
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

  it("getAllPlatformSlugs returns 21 slugs", () => {
    expect(getAllPlatformSlugs()).toHaveLength(21);
  });
});

describe("Endpoint data integrity", () => {
  it("has exactly 108 endpoints", () => {
    expect(ENDPOINTS.length).toBe(108);
  });

  it("every endpoint has required fields", () => {
    for (const endpoint of ENDPOINTS) {
      expect(endpoint.platform).toBeTruthy();
      expect(endpoint.resource).toBeTruthy();
      expect(endpoint.method).toBe("GET");
      expect(["standard", "advanced", "premium"]).toContain(endpoint.creditTier);
      expect([1, 5, 10]).toContain(endpoint.creditCost);
      expect(endpoint.archetype).toBeTruthy();
      expect(endpoint.summary).toBeTruthy();
    }
  });

  it("creditCost matches creditTier", () => {
    const tierCosts: Record<string, number> = { standard: 1, advanced: 5, premium: 10 };
    for (const endpoint of ENDPOINTS) {
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
    expect(ep!.params.length).toBeGreaterThan(0);
    expect(ep!.params[0].name).toBe("handle");
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

  it("getAvailableTopics returns at least 26 topics", () => {
    expect(getAvailableTopics().length).toBeGreaterThanOrEqual(26);
  });

  it("getAvailableTopics includes the new idempotency topic", () => {
    expect(getAvailableTopics()).toContain("idempotency");
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
