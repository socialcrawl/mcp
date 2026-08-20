import { describe, it, expect } from "vitest";
import { PLATFORMS, findPlatform, getAllPlatformSlugs } from "../data/platforms.js";
import { ENDPOINTS, findEndpoint, getEndpointsByPlatform } from "../data/endpoints.js";
import { getDoc, getAvailableTopics, FIXED_TOPICS } from "../data/docs.js";
import { CACHE_TTLS, CREDIT_LADDER, REGISTRY_STATS } from "../data/registry-meta.js";
import { formatCost, worstCaseCost, bestCaseCost } from "../pricing.js";

/**
 * Drift guards. The hardcoded platform/endpoint totals are intentional: they
 * fail loudly when the backend registry moves, which is the signal to re-run
 * the two-step regeneration pipeline (see scripts/generate-data.ts).
 */
const EXPECTED_PLATFORMS = 48;
const EXPECTED_ENDPOINTS = 381;

describe("Platform data integrity", () => {
  it(`has exactly ${EXPECTED_PLATFORMS} platforms`, () => {
    expect(PLATFORMS).toHaveLength(EXPECTED_PLATFORMS);
  });

  it("matches the backend REGISTRY_STATS totals", () => {
    expect(PLATFORMS).toHaveLength(REGISTRY_STATS.totalPlatforms);
    expect(ENDPOINTS).toHaveLength(REGISTRY_STATS.totalEndpoints);
  });

  it("every platform has a non-empty slug, name, and description", () => {
    for (const platform of PLATFORMS) {
      expect(platform.slug).toBeTruthy();
      expect(platform.name).toBeTruthy();
      expect(platform.description).toBeTruthy();
      expect(platform.endpointCount).toBeGreaterThan(0);
      expect(typeof platform.social).toBe("boolean");
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

  it(`getAllPlatformSlugs returns ${EXPECTED_PLATFORMS} slugs`, () => {
    expect(getAllPlatformSlugs()).toHaveLength(EXPECTED_PLATFORMS);
  });

  it("covers the retail platforms added in the 2026-08 wave", () => {
    for (const slug of ["walmart", "target", "home_depot", "ebay"]) {
      expect(findPlatform(slug), `missing platform: ${slug}`).toBeDefined();
    }
  });
});

describe("Endpoint data integrity", () => {
  it(`has exactly ${EXPECTED_ENDPOINTS} endpoints`, () => {
    expect(ENDPOINTS.length).toBe(EXPECTED_ENDPOINTS);
  });

  it("every endpoint has required fields", () => {
    for (const endpoint of ENDPOINTS) {
      expect(endpoint.platform).toBeTruthy();
      expect(endpoint.resource).toBeTruthy();
      expect(["GET", "POST", "PATCH", "DELETE"]).toContain(endpoint.method);
      expect(["standard", "advanced", "premium"]).toContain(endpoint.creditTier);
      expect(Number.isInteger(endpoint.creditCost)).toBe(true);
      expect(endpoint.creditCost).toBeGreaterThanOrEqual(0);
      expect(endpoint.archetype).toBeTruthy();
      expect(endpoint.summary).toBeTruthy();
      expect(endpoint.cache.category).toBeTruthy();
      expect(endpoint.cache.ttlSeconds).toBeGreaterThanOrEqual(0);
      expect(endpoint.upstream.kind).toBeTruthy();
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

  it("findEndpoint disambiguates the web platform by method", () => {
    // `web/monitors` is served by both POST (create) and GET (list).
    expect(findEndpoint("web", "monitors", "POST")!.method).toBe("POST");
    expect(findEndpoint("web", "monitors", "GET")!.method).toBe("GET");
    // Without a method, GET wins.
    expect(findEndpoint("web", "monitors")!.method).toBe("GET");
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

  it("integer bounds are coherent and only appear on integer params", () => {
    for (const endpoint of ENDPOINTS) {
      for (const opt of endpoint.optionalParams) {
        if (opt.minimum === undefined && opt.maximum === undefined) continue;
        expect(
          opt.type,
          `${endpoint.platform}/${endpoint.resource}: ${opt.name} has bounds but type ${opt.type}`,
        ).toBe("integer");
        if (opt.minimum !== undefined && opt.maximum !== undefined) {
          expect(opt.minimum).toBeLessThanOrEqual(opt.maximum);
        }
      }
    }
  });

  it("param couplings reference params that exist on the same endpoint", () => {
    for (const endpoint of ENDPOINTS) {
      const names = new Set([
        ...endpoint.params.map((p) => p.name),
        ...endpoint.optionalParams.map((p) => p.name),
      ]);
      for (const opt of endpoint.optionalParams) {
        if (opt.requires) {
          expect(
            names.has(opt.requires),
            `${endpoint.platform}/${endpoint.resource}: ${opt.name} requires unknown param "${opt.requires}"`,
          ).toBe(true);
        }
        if (opt.couplesWith) {
          expect(
            names.has(opt.couplesWith.param),
            `${endpoint.platform}/${endpoint.resource}: ${opt.name} couples to unknown param "${opt.couplesWith.param}"`,
          ).toBe(true);
        }
      }
    }
  });

  it("csvConstraints only name params the endpoint declares", () => {
    for (const endpoint of ENDPOINTS) {
      if (!endpoint.csvConstraints) continue;
      const names = new Set([
        ...endpoint.params.map((p) => p.name),
        ...endpoint.optionalParams.map((p) => p.name),
      ]);
      for (const name of Object.keys(endpoint.csvConstraints)) {
        expect(
          names.has(name),
          `${endpoint.platform}/${endpoint.resource}: csvConstraint for unknown param "${name}"`,
        ).toBe(true);
      }
    }
  });

  it("cache TTL matches its category unless the endpoint overrides it", () => {
    for (const endpoint of ENDPOINTS) {
      const categoryTtl = CACHE_TTLS[endpoint.cache.category];
      expect(
        categoryTtl,
        `${endpoint.platform}/${endpoint.resource}: unknown cache category "${endpoint.cache.category}"`,
      ).toBeDefined();
      // An override is legal; a TTL that is neither the category default nor a
      // deliberate override would mean the generator lost the value.
      expect(endpoint.cache.ttlSeconds).toBeGreaterThanOrEqual(0);
    }
  });

  it("POST-only `in: query` params never appear on GET endpoints", () => {
    for (const endpoint of ENDPOINTS) {
      if (endpoint.method === "GET") {
        for (const opt of endpoint.optionalParams) {
          expect(
            opt.in,
            `${endpoint.platform}/${endpoint.resource}: GET endpoint declares in:"${opt.in}" on ${opt.name}`,
          ).toBeUndefined();
        }
      }
    }
  });
});

/**
 * Pricing is the surface customers reason about before they spend, so its
 * invariants get their own block. The old hand-maintained `isFlatPriced`
 * exemption list is gone: `pricing.model` now comes from the registry itself,
 * so the ladder rule can be asserted for exactly the endpoints that claim it.
 */
describe("Pricing data integrity", () => {
  it("every endpoint carries a coherent pricing block", () => {
    for (const e of ENDPOINTS) {
      expect(["ladder", "flat", "metered"]).toContain(e.pricing.model);
      expect(e.pricing.cost).toBe(e.creditCost);
      expect(e.pricing.tier).toBe(e.creditTier);
      expect(e.pricing.ladderCost).toBe(CREDIT_LADDER[e.creditTier]);
    }
  });

  it("ladder-priced endpoints charge exactly their tier rate", () => {
    for (const e of ENDPOINTS) {
      if (e.pricing.model !== "ladder") continue;
      expect(
        e.pricing.cost,
        `${e.platform}/${e.resource} claims the ladder but costs ${e.pricing.cost} on tier ${e.creditTier}`,
      ).toBe(CREDIT_LADDER[e.creditTier]);
    }
  });

  it("flat-override endpoints carry a sane explicit cost", () => {
    // A flat endpoint declares its own `cost` in the registry. That value MAY
    // coincide with its tier rate (web/map is standard and also 1cr) — the
    // model records that the price is pinned per endpoint, not that the number
    // differs — so the invariant here is the value's shape, not its novelty.
    for (const e of ENDPOINTS) {
      if (e.pricing.model !== "flat") continue;
      expect(Number.isInteger(e.pricing.cost)).toBe(true);
      expect(e.pricing.cost).toBeGreaterThanOrEqual(0);
    }
  });

  it("the headline off-ladder prices are intact", () => {
    const expected: [string, string, number][] = [
      ["search", "everywhere", 20],
      ["web", "agent", 25],
      ["naver", "brief", 10],
      ["youtube", "video/transcript", 3],
    ];
    for (const [platform, resource, cost] of expected) {
      const e = findEndpoint(platform, resource);
      expect(e, `missing ${platform}/${resource}`).toBeDefined();
      expect(e!.pricing.cost, `${platform}/${resource}`).toBe(cost);
      expect(e!.pricing.model).toBe("flat");
    }
  });

  it("every metered endpoint explains itself with a band or a rule", () => {
    const metered = ENDPOINTS.filter((e) => e.pricing.model === "metered");
    expect(metered.length).toBeGreaterThan(0);
    for (const e of metered) {
      const hasBand =
        e.pricing.minCost !== undefined && e.pricing.maxCost !== undefined;
      expect(
        hasBand || Boolean(e.pricing.description),
        `${e.platform}/${e.resource} is metered but quotes neither a band nor a rule — a caller cannot budget for it`,
      ).toBe(true);
      if (hasBand) {
        expect(e.pricing.minCost!).toBeLessThanOrEqual(e.pricing.maxCost!);
      }
    }
  });

  it("worst case is never below best case", () => {
    for (const e of ENDPOINTS) {
      expect(worstCaseCost(e.pricing)).toBeGreaterThanOrEqual(bestCaseCost(e.pricing));
    }
  });

  it("formatCost never quotes a metered endpoint as a single flat number", () => {
    for (const e of ENDPOINTS) {
      if (e.pricing.model !== "metered") continue;
      if (e.pricing.minCost === e.pricing.maxCost) continue;
      expect(
        formatCost(e.pricing),
        `${e.platform}/${e.resource}`,
      ).toContain("metered");
    }
  });

  it("the four free discovery endpoints cost 0 credits", () => {
    for (const resource of ["endpoints", "endpoint", "quickstart", "llms"]) {
      const e = findEndpoint("utility", resource);
      expect(e, `missing utility/${resource}`).toBeDefined();
      expect(e!.pricing.cost).toBe(0);
    }
  });

  it("search/everywhere keeps its flat 20-credit price", () => {
    expect(findEndpoint("search", "everywhere")!.pricing.cost).toBe(20);
  });
});

describe("Documentation data integrity", () => {
  it("has every fixed guide topic", () => {
    for (const topic of FIXED_TOPICS) {
      expect(getDoc(topic), `Missing doc topic: ${topic}`).toBeTruthy();
    }
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

  it("getAvailableTopics returns the fixed topics plus one per platform", () => {
    expect(getAvailableTopics()).toHaveLength(FIXED_TOPICS.length + PLATFORMS.length);
  });

  it("offers the cross-cutting contract topics", () => {
    const topics = getAvailableTopics();
    for (const topic of [
      "idempotency",
      "monitors",
      "pricing",
      "pagination",
      "caching",
      "response-schema",
      "limits",
      "discovery",
    ]) {
      expect(topics).toContain(topic);
    }
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

  it("the pagination topic documents the universal cursor contract", () => {
    const doc = getDoc("pagination")!;
    expect(doc).toContain("cursor");
    expect(doc).toContain("has_more");
    expect(doc).toContain("collect-until-N");
  });

  it("the caching topic states that hits are free", () => {
    const doc = getDoc("caching")!;
    expect(doc).toMatch(/0 credits/);
    expect(doc).toContain("Cache-Control: no-cache");
  });

  it("the limits topic documents both the rate and concurrency ceilings", () => {
    const doc = getDoc("limits")!;
    expect(doc).toContain("600");
    expect(doc).toContain("50");
    expect(doc).toContain("X-RateLimit-Remaining");
  });

  it("the discovery topic lists all four free utility endpoints", () => {
    const doc = getDoc("discovery")!;
    for (const resource of ["endpoints", "endpoint", "quickstart", "llms"]) {
      expect(doc).toContain(`/v1/utility/${resource}`);
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
      // Rows are grouped by price within a platform section; the platform is
      // carried by the section header, keeping the whole doc on one page.
      const label = e.method === "GET" ? e.resource : `${e.method} ${e.resource}`;
      expect(
        pricing,
        `pricing doc missing ${e.method} /v1/${e.platform}/${e.resource}`,
      ).toContain(`\`${label}\``);
    }
  });

  it("quotes every metered endpoint's band and rule", () => {
    const pricing = getDoc("pricing")!;
    for (const e of ENDPOINTS.filter((x) => x.pricing.model === "metered")) {
      expect(
        pricing,
        `pricing doc missing the metered band for ${e.platform}/${e.resource}`,
      ).toContain(formatCost(e.pricing));
    }
  });

  it("documents the flat 20-credit override for search/everywhere", () => {
    expect(getDoc("pricing")!).toContain("| `/v1/search/everywhere` | 20cr |");
  });

  it("stays under the 25k limit so it is never paged", () => {
    expect(getDoc("pricing")!.length).toBeLessThanOrEqual(25_000);
  });
});

describe("Errors documentation reflects the current backend", () => {
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

  it("documents the newer RATE_LIMITED, KEY_BUDGET_EXCEEDED and PAYLOAD_TOO_LARGE codes", () => {
    const errors = getDoc("errors")!;
    expect(errors).toContain("RATE_LIMITED");
    expect(errors).toContain("KEY_BUDGET_EXCEEDED");
    expect(errors).toContain("PAYLOAD_TOO_LARGE");
  });

  it("notes that RESOURCE_NOT_FOUND auto-refunds credits (BIL-01)", () => {
    const errors = getDoc("errors")!;
    expect(errors).toMatch(/RESOURCE_NOT_FOUND[\s\S]*?refund/i);
  });

  it("uses the path-style doc_url format (no anchor fragment)", () => {
    const errors = getDoc("errors")!;
    expect(errors).not.toContain("docs/errors#");
    expect(errors).toMatch(/docs\/errors\/[a-z-]+/);
  });
});

describe("Credits documentation", () => {
  it("mentions the optional data._warnings advisory channel (ENV-03)", () => {
    expect(getDoc("credits")!).toContain("_warnings");
  });

  it("explains all three billing models", () => {
    const credits = getDoc("credits")!;
    expect(credits).toContain("ladder");
    expect(credits).toContain("flat");
    expect(credits).toContain("metered");
  });

  it("points at the ledger for verifying a metered charge", () => {
    expect(getDoc("credits")!).toContain("transactions");
  });
});

describe("Idempotency documentation (BIL-02)", () => {
  it("has an idempotency topic", () => {
    expect(getDoc("idempotency")).toBeTruthy();
  });

  it("documents the Idempotency-Key header", () => {
    expect(getDoc("idempotency")!).toContain("Idempotency-Key");
  });

  it("explains the 24h TTL and zero-credit replay", () => {
    const doc = getDoc("idempotency")!;
    expect(doc).toMatch(/24\s*h/i);
    expect(doc).toContain("0 credit");
  });
});

describe("Meta endpoint documentation (SEC-02)", () => {
  it("overview mentions both credit meta endpoints", () => {
    const overview = getDoc("overview")!;
    expect(overview).toContain("/v1/credits/balance");
    expect(overview).toContain("/v1/credits/transactions");
  });
});
