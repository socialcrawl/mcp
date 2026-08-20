import { describe, it, expect, vi, afterEach } from "vitest";
import { discover, normalizeEndpointId, DISCOVER_ACTION_RESOURCES } from "../tools/discover.js";
import { getEndpointsByPlatform, findEndpoint } from "../data/endpoints.js";
import { REGISTRY_STATS } from "../data/registry-meta.js";
import { getDoc } from "../data/docs.js";
import type { ApiContext } from "../context.js";

const ctx: ApiContext = { apiKey: "sc_test_key", baseUrl: "https://www.socialcrawl.dev" };
const anon: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };

afterEach(() => {
  vi.restoreAllMocks();
});

/** Capture the URL the tool calls and reply with a wrapped envelope. */
function stubEnvelope(data: unknown, status = 200): () => string {
  let url = "";
  vi.stubGlobal("fetch", async (u: string) => {
    url = u;
    return new Response(
      JSON.stringify({ success: status === 200, data, credits_used: 0 }),
      { status },
    );
  });
  return () => url;
}

function forbidFetch(): void {
  vi.stubGlobal("fetch", async () => {
    throw new Error("network call made — this action should have answered locally");
  });
}

describe("the utility endpoints are registered and free", () => {
  it("registers all four", () => {
    const resources = getEndpointsByPlatform("utility").map((e) => e.resource).sort();
    expect(resources).toEqual(["endpoint", "endpoints", "llms", "quickstart"]);
  });

  it("charges nothing for any of them", () => {
    for (const e of getEndpointsByPlatform("utility")) {
      expect(e.pricing.cost, `${e.resource} is not free`).toBe(0);
    }
  });

  it("maps every discover action to a real utility resource", () => {
    for (const [action, resource] of Object.entries(DISCOVER_ACTION_RESOURCES)) {
      if (resource === null) continue;
      expect(
        findEndpoint("utility", resource),
        `action ${action} targets unknown utility/${resource}`,
      ).toBeDefined();
    }
  });
});

describe("normalizeEndpointId", () => {
  it("accepts an id, a path, and a full URL", () => {
    expect(normalizeEndpointId("tiktok/profile")).toBe("tiktok/profile");
    expect(normalizeEndpointId("/v1/tiktok/profile")).toBe("tiktok/profile");
    expect(normalizeEndpointId("https://www.socialcrawl.dev/v1/tiktok/profile")).toBe(
      "tiktok/profile",
    );
  });

  it("strips a query string and trailing slash", () => {
    expect(normalizeEndpointId("/v1/tiktok/profile?handle=x")).toBe("tiktok/profile");
    expect(normalizeEndpointId("/v1/tiktok/profile/")).toBe("tiktok/profile");
  });
});

/**
 * Discovery must work before a key exists — that is the whole point of a
 * free self-describing surface. Without one, every action except `llms`
 * answers from the bundled catalogue instead of failing.
 */
describe("anonymous fallback", () => {
  it("serves quickstart locally without touching the network", async () => {
    forbidFetch();
    const out = await discover(anon, { action: "quickstart" });
    expect(out).toContain("SocialCrawl Quickstart");
    expect(out).toContain("bundled catalogue");
    expect(out).toContain("SOCIALCRAWL_API_KEY");
  });

  it("serves the catalogue locally, filtered", async () => {
    forbidFetch();
    const out = await discover(anon, { action: "catalog", platform: "target" });
    expect(out).toContain("/v1/target/product");
    expect(out).not.toContain("/v1/tiktok/");
  });

  it("serves an endpoint guide locally with its metered rule", async () => {
    forbidFetch();
    const out = await discover(anon, { action: "endpoint", id: "search/news" });
    expect(out).toContain("2-14cr (metered)");
    expect(out).toContain("1 credit per country/angle leg");
    expect(out).toContain("Price-driving parameters");
  });

  it("points at the static corpus for llms, which has no local equivalent", async () => {
    forbidFetch();
    const out = await discover(anon, { action: "llms" });
    expect(out).toContain("llms-full.txt");
    expect(out).toContain("no bundled equivalent");
  });

  it("reports that freshness needs a key", async () => {
    forbidFetch();
    const out = await discover(anon, { action: "freshness" });
    expect(out).toContain("could not reach the live registry");
    expect(out).toContain(String(REGISTRY_STATS.totalEndpoints));
  });

  it("honours live:false even when a key is configured", async () => {
    forbidFetch();
    const out = await discover(ctx, { action: "catalog", platform: "ebay", live: false });
    expect(out).toContain("bundled catalogue");
  });
});

describe("live calls", () => {
  it("calls /v1/utility/quickstart and renders the error taxonomy", async () => {
    const url = stubEnvelope({
      kind: "quickstart",
      base_url: "https://www.socialcrawl.dev/v1",
      auth: { header: "x-api-key", get_key_url: "https://www.socialcrawl.dev/dashboard/api" },
      first_call: { description: "Get TikTok user profile", curl: "curl ..." },
      billing: { tiers: { standard: 1, advanced: 5, premium: 10 }, rules: ["Cache hits cost 0 credits"] },
      errors: [{ code: "RATE_LIMITED", http: 429, meaning: "Too many requests" }],
      rate_limits: { requests_per_minute: 600, concurrent_requests: 50 },
      stats: { platforms: 48, endpoints: 381 },
    });
    const out = await discover(ctx, { action: "quickstart" });
    expect(url()).toContain("/v1/utility/quickstart");
    expect(out).toContain("Answered live");
    expect(out).toContain("`RATE_LIMITED`");
    expect(out).toContain("600 requests/minute");
  });

  it("calls /v1/utility/endpoints with the platform filter", async () => {
    const url = stubEnvelope({
      kind: "endpoint_catalog",
      stats: { platforms: 48, endpoints: 381 },
      filters: { platform: "tiktok", search: null, method: null },
      total: 1,
      endpoints: [
        {
          id: "tiktok/profile",
          path: "/v1/tiktok/profile",
          method: "GET",
          summary: "Get TikTok user profile",
          credits: 1,
          credits_label: "1 (standard)",
          required_params: [],
          one_of: [["handle", "user_id"]],
          optional_params: ["handle", "user_id"],
          paginated: false,
        },
      ],
    });
    const out = await discover(ctx, { action: "catalog", platform: "tiktok" });
    expect(url()).toContain("/v1/utility/endpoints");
    expect(url()).toContain("platform=tiktok");
    expect(out).toContain("Live registry");
    // The live label is metered-aware; prefer it over the bare base number.
    expect(out).toContain("1 (standard)");
    expect(out).toContain("one of `handle`/`user_id`");
  });

  it("prefers the live metered label over the base credits number", async () => {
    stubEnvelope({
      kind: "endpoint_catalog",
      stats: { platforms: 48, endpoints: 381 },
      filters: {},
      total: 1,
      endpoints: [
        {
          id: "web/search",
          path: "/v1/web/search",
          method: "GET",
          summary: "Search the web",
          credits: 2,
          credits_label: "2-120 (metered)",
          paginated: false,
        },
      ],
    });
    const out = await discover(ctx, { action: "catalog" });
    expect(out).toContain("2-120 (metered)");
  });

  it("calls /v1/utility/endpoint with a normalised id", async () => {
    const url = stubEnvelope({
      kind: "endpoint_guide",
      id: "tiktok/profile",
      path: "/v1/tiktok/profile",
      method: "GET",
      summary: "Get TikTok user profile",
      credits: { cost: 1, label: "1 (standard)", tier: "standard", pricing_notes: null, billing_rules: ["Cache hits cost 0 credits"] },
      params: { required: [], one_of: [{ options: ["handle", "user_id"], rule: "Provide at least one" }], optional: [] },
      cache: { ttl_seconds: 900, note: "Identical calls within the TTL are free" },
      response: { archetype: "Author", schema_url: "https://socialcrawl.dev/schemas/author.json" },
      request: { curl: 'curl -H "x-api-key: $KEY" "https://www.socialcrawl.dev/v1/tiktok/profile?handle=x"' },
      related: [{ id: "tiktok/post", summary: "Get TikTok post details" }],
      links: { docs: "https://www.socialcrawl.dev/platforms/tiktok/profile" },
    });
    const out = await discover(ctx, { action: "endpoint", id: "https://www.socialcrawl.dev/v1/tiktok/profile" });
    expect(url()).toContain("id=tiktok%2Fprofile");
    expect(out).toContain("Provide at least one");
    expect(out).toContain("15 min");
    expect(out).toContain("Related endpoints");
  });

  it("passes the llms corpus through as markdown", async () => {
    const url = stubEnvelope({
      kind: "agent_context",
      format: "markdown",
      scope: "all",
      content: "# SocialCrawl API\n\nSome corpus text.",
    });
    const out = await discover(ctx, { action: "llms", platform: "tiktok" });
    expect(url()).toContain("/v1/utility/llms");
    expect(url()).toContain("platform=tiktok");
    expect(out).toContain("Some corpus text.");
  });

  it("requires an id for the endpoint action", async () => {
    forbidFetch();
    expect(await discover(ctx, { action: "endpoint" })).toContain("requires `id`");
  });

  it("rejects an unknown action", async () => {
    expect(await discover(ctx, { action: "nonsense" as never })).toContain("Error:");
  });

  it("falls back to the bundled guide when the live call fails", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    const out = await discover(ctx, { action: "endpoint", id: "tiktok/profile" });
    expect(out).toContain("bundled catalogue");
    expect(out).toContain("Get TikTok user profile");
  });
});

/**
 * The freshness check is the only way an agent can learn that this server's
 * bundled catalogue has fallen behind the live API.
 */
describe("freshness", () => {
  it("probes with a filter that matches nothing so the response stays tiny", async () => {
    const url = stubEnvelope({
      kind: "endpoint_catalog",
      stats: {
        platforms: REGISTRY_STATS.totalPlatforms,
        endpoints: REGISTRY_STATS.totalEndpoints,
      },
      filters: { platform: null, search: " freshness-probe", method: null },
      total: 0,
      endpoints: [],
    });
    const out = await discover(ctx, { action: "freshness" });
    expect(url()).toContain("/v1/utility/endpoints");
    expect(url()).toContain("search=");
    expect(out).toContain("up to date");
  });

  it("flags a stale bundled catalogue and says what to do", async () => {
    stubEnvelope({
      kind: "endpoint_catalog",
      stats: {
        platforms: REGISTRY_STATS.totalPlatforms + 2,
        endpoints: REGISTRY_STATS.totalEndpoints + 17,
      },
      filters: {},
      total: 0,
      endpoints: [],
    });
    const out = await discover(ctx, { action: "freshness" });
    expect(out).toContain("OUT OF DATE");
    expect(out).toContain("+17 endpoints");
    expect(out).toContain("+2 platforms");
    expect(out).toContain("socialcrawl-mcp@latest");
  });
});

describe("the setup docs topic", () => {
  const doc = getDoc("setup")!;

  it("exists and is offered as a topic", () => {
    expect(doc).toBeTruthy();
  });

  it("covers key configuration for both transports", () => {
    expect(doc).toContain("SOCIALCRAWL_API_KEY");
    expect(doc).toContain("Authorization: Bearer");
    expect(doc).toContain("mcp.socialcrawl.dev/mcp");
  });

  it("tells the reader how to verify the setup and stay current", () => {
    expect(doc).toContain("socialcrawl_check_balance");
    expect(doc).toContain('action: "freshness"');
    expect(doc).toContain("socialcrawl-mcp@latest");
  });

  it("explains when bundled data is not enough", () => {
    expect(doc).toContain("Bundled vs live");
  });
});
