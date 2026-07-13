import { describe, it, expect, vi, afterEach } from "vitest";
import { request } from "../tools/request.js";
import type { ApiContext } from "../context.js";

const ctx: ApiContext = { apiKey: "sc_test_key", baseUrl: "https://www.socialcrawl.dev" };
const anonCtx: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Pre-flight validation", () => {
  it("rejects unknown platform", async () => {
    const result = await request(anonCtx, { platform: "fakebook", resource: "profile" });
    expect(result).toContain("Unknown platform");
    expect(result).toContain("socialcrawl_list_platforms");
  });

  it("rejects unknown resource for valid platform", async () => {
    const result = await request(anonCtx, { platform: "tiktok", resource: "nonexistent" });
    expect(result).toContain("Unknown resource");
    expect(result).toContain("socialcrawl_list_endpoints");
  });

  it("rejects missing required params", async () => {
    const result = await request(anonCtx, { platform: "tiktok", resource: "profile", params: {} });
    expect(result).toContain("Missing required parameter");
    expect(result).toContain("handle");
  });

  it("rejects when no params provided but endpoint requires them", async () => {
    const result = await request(anonCtx, { platform: "tiktok", resource: "profile" });
    expect(result).toContain("Missing required parameter");
  });

  it("passes validation for endpoints with no required params", async () => {
    const result = await request(anonCtx, { platform: "youtube", resource: "shorts/trending" });
    expect(result).toContain("No API key configured");
  });

  it("rejects oneOf endpoint when no group member is provided", async () => {
    const result = await request(anonCtx, {
      platform: "facebook",
      resource: "profile/posts",
      params: {},
    });
    expect(result).toContain("Missing required parameter");
    expect(result).toContain("one of");
    expect(result).toContain("url");
    expect(result).toContain("pageId");
  });

  it("passes validation for oneOf endpoint when one group member is provided", async () => {
    const result = await request(anonCtx, {
      platform: "facebook",
      resource: "profile/posts",
      params: { url: "https://www.facebook.com/Meta" },
    });
    // Should skip preflight and reach the API-key-required stage.
    expect(result).toContain("No API key configured");
  });
});

describe("request tool — idempotency forwarding", () => {
  it("forwards idempotencyKey to the API client as Idempotency-Key header", async () => {
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    });

    await request(ctx, {
      platform: "tiktok",
      resource: "profile",
      params: { handle: "charlidamelio" },
      idempotencyKey: "tool-key-xyz",
    });

    expect(capturedHeaders["Idempotency-Key"]).toBe("tool-key-xyz");
  });
});
