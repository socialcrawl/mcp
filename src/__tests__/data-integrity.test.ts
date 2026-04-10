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
  it("has at least 100 endpoints", () => {
    expect(ENDPOINTS.length).toBeGreaterThanOrEqual(100);
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
});
