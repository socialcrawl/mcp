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

  it("maps 404 RESOURCE_NOT_FOUND to a refund-aware message", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: { type: "RESOURCE_NOT_FOUND", message: "Resource does not exist" },
        }),
        { status: 404 },
      ),
    );

    const result = await makeRequest({ platform: "tiktok", resource: "profile", params: { handle: "ghost" } });
    expect(result).toContain("Resource not found");
    expect(result).toContain("refunded");
    expect(result).not.toContain("socialcrawl_list_endpoints");
  });

  it("maps 405 METHOD_NOT_ALLOWED with the Allow header hint", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: { type: "METHOD_NOT_ALLOWED", message: "Only GET is allowed" },
        }),
        { status: 405 },
      ),
    );

    const result = await makeRequest({ platform: "tiktok", resource: "profile", params: { handle: "test" } });
    expect(result).toContain("Method not allowed");
    expect(result).toContain("GET");
  });

  it("maps 409 IDEMPOTENCY_KEY_CONFLICT", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: { type: "IDEMPOTENCY_KEY_CONFLICT", message: "Key already used by another account" },
        }),
        { status: 409 },
      ),
    );

    const result = await makeRequest({
      platform: "tiktok",
      resource: "profile",
      params: { handle: "test" },
      idempotencyKey: "shared-key",
    });
    expect(result).toContain("Idempotency-Key");
    expect(result).toContain("conflict");
  });

  it("maps 422 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: { type: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH", message: "Key reused with different payload" },
        }),
        { status: 422 },
      ),
    );

    const result = await makeRequest({
      platform: "tiktok",
      resource: "profile",
      params: { handle: "test" },
      idempotencyKey: "reused-key",
    });
    expect(result).toContain("Idempotency-Key");
    expect(result).toContain("different");
  });

  it("includes doc_url in default error formatting when present", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: {
            type: "INTERNAL_ERROR",
            message: "Something went wrong",
            doc_url: "https://www.socialcrawl.dev/docs/errors/internal-error",
          },
        }),
        { status: 500 },
      ),
    );

    const result = await makeRequest({ platform: "tiktok", resource: "profile", params: { handle: "test" } });
    expect(result).toContain("INTERNAL_ERROR");
    expect(result).toContain("https://www.socialcrawl.dev/docs/errors/internal-error");
  });

  it("forwards idempotencyKey as Idempotency-Key header", async () => {
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    });

    await makeRequest({
      platform: "tiktok",
      resource: "profile",
      params: { handle: "charlidamelio" },
      idempotencyKey: "abc-123",
    });
    expect(capturedHeaders["Idempotency-Key"]).toBe("abc-123");
  });

  it("does not send Idempotency-Key header when not provided", async () => {
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    });

    await makeRequest({ platform: "tiktok", resource: "profile", params: { handle: "charlidamelio" } });
    expect(capturedHeaders["Idempotency-Key"]).toBeUndefined();
  });

  it("supports the meta platform for /v1/credits/balance", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ success: true, data: { balance: 42 } }), { status: 200 });
    });

    await makeRequest({ platform: "meta", resource: "credits/balance" });
    expect(capturedUrl).toContain("/v1/credits/balance");
    expect(capturedUrl).not.toContain("?");
  });
});
