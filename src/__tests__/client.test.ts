import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRequest } from "../client.js";

describe("API client", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, SOCIALCRAWL_API_KEY: "sc_test_key" };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns error when API key is empty", async () => {
    process.env.SOCIALCRAWL_API_KEY = "";
    const result = await makeRequest({ platform: "tiktok", resource: "profile", params: { handle: "test" } });
    expect(result).toContain("No API key configured");
    expect(result).toContain("SOCIALCRAWL_API_KEY");
  });

  it("returns error when API key is not set", async () => {
    delete process.env.SOCIALCRAWL_API_KEY;
    const result = await makeRequest({ platform: "tiktok", resource: "profile", params: { handle: "test" } });
    expect(result).toContain("No API key configured");
  });

  it("builds correct URL with params", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    });

    await makeRequest({ platform: "tiktok", resource: "profile", params: { handle: "charlidamelio" } });
    expect(capturedUrl).toContain("/v1/tiktok/profile");
    expect(capturedUrl).toContain("handle=charlidamelio");
  });

  it("builds correct URL without params", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    });

    await makeRequest({ platform: "tiktok", resource: "songs/popular" });
    expect(capturedUrl).toContain("/v1/tiktok/songs/popular");
    expect(capturedUrl).not.toContain("?");
  });

  it("maps 401 to invalid API key message", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ success: false, error: { type: "INVALID_API_KEY", message: "Invalid key" } }), { status: 401 }),
    );

    const result = await makeRequest({ platform: "tiktok", resource: "profile", params: { handle: "test" } });
    expect(result).toContain("Invalid API key");
  });

  it("maps 402 to insufficient credits message", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ success: false, error: { type: "INSUFFICIENT_CREDITS", message: "No credits" }, credits_remaining: 0 }), { status: 402 }),
    );

    const result = await makeRequest({ platform: "tiktok", resource: "profile", params: { handle: "test" } });
    expect(result).toContain("Insufficient credits");
    expect(result).toContain("socialcrawl.dev/dashboard/billing");
  });

  it("maps 404 to endpoint not found message", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ success: false, error: { type: "ENDPOINT_NOT_FOUND" } }), { status: 404 }),
    );

    const result = await makeRequest({ platform: "tiktok", resource: "fake", params: {} });
    expect(result).toContain("not found");
    expect(result).toContain("socialcrawl_list_endpoints");
  });

  it("maps 503 to platform unavailable message", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ success: false, error: { type: "PLATFORM_UNAVAILABLE" } }), { status: 503 }),
    );

    const result = await makeRequest({ platform: "tiktok", resource: "profile", params: { handle: "test" } });
    expect(result).toContain("temporarily unavailable");
  });

  it("maps 502 to upstream error with refund note", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ success: false, error: { type: "UPSTREAM_ERROR" } }), { status: 502 }),
    );

    const result = await makeRequest({ platform: "tiktok", resource: "profile", params: { handle: "test" } });
    expect(result).toContain("Upstream error");
    expect(result).toContain("auto-refunded");
  });
});
