import { describe, it, expect, vi, afterEach } from "vitest";
import { makeRequest, apiRequest, formatHttpError } from "../client.js";
import type { ApiContext } from "../context.js";

describe("API client", () => {
  const ctx: ApiContext = { apiKey: "sc_test_key", baseUrl: "https://www.socialcrawl.dev" };
  const anonCtx: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the no-key error for an anonymous context", async () => {
    const result = await makeRequest(anonCtx, { platform: "tiktok", resource: "profile", params: { handle: "test" } });
    expect(result).toContain("No API key configured");
    expect(result).toContain("SOCIALCRAWL_API_KEY");   // stdio guidance still present
    expect(result).toContain("Authorization: Bearer"); // HTTP guidance now present
  });

  it("builds correct URL with params", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    });

    await makeRequest(ctx, { platform: "tiktok", resource: "profile", params: { handle: "charlidamelio" } });
    expect(capturedUrl).toContain("/v1/tiktok/profile");
    expect(capturedUrl).toContain("handle=charlidamelio");
  });

  it("builds correct URL without params", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    });

    await makeRequest(ctx, { platform: "tiktok", resource: "songs/popular" });
    expect(capturedUrl).toContain("/v1/tiktok/songs/popular");
    expect(capturedUrl).not.toContain("?");
  });

  it("maps 401 to invalid API key message", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ success: false, error: { type: "INVALID_API_KEY", message: "Invalid key" } }), { status: 401 }),
    );

    const result = await makeRequest(ctx, { platform: "tiktok", resource: "profile", params: { handle: "test" } });
    expect(result).toContain("Invalid API key");
  });

  it("maps 402 to insufficient credits message", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ success: false, error: { type: "INSUFFICIENT_CREDITS", message: "No credits" }, credits_remaining: 0 }), { status: 402 }),
    );

    const result = await makeRequest(ctx, { platform: "tiktok", resource: "profile", params: { handle: "test" } });
    expect(result).toContain("Insufficient credits");
    expect(result).toContain("socialcrawl.dev/dashboard/billing");
  });

  it("maps 404 to endpoint not found message", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ success: false, error: { type: "ENDPOINT_NOT_FOUND" } }), { status: 404 }),
    );

    const result = await makeRequest(ctx, { platform: "tiktok", resource: "fake", params: {} });
    expect(result).toContain("not found");
    expect(result).toContain("socialcrawl_list_endpoints");
  });

  it("maps 503 to platform unavailable message", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ success: false, error: { type: "PLATFORM_UNAVAILABLE" } }), { status: 503 }),
    );

    const result = await makeRequest(ctx, { platform: "tiktok", resource: "profile", params: { handle: "test" } });
    expect(result).toContain("temporarily unavailable");
  });

  it("maps 502 to upstream error with refund note", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ success: false, error: { type: "UPSTREAM_ERROR" } }), { status: 502 }),
    );

    const result = await makeRequest(ctx, { platform: "tiktok", resource: "profile", params: { handle: "test" } });
    expect(result).toContain("Upstream error");
    expect(result).toContain("auto-refunded");
  });

  it("maps 404 RESOURCE_NOT_FOUND to the server's charge-aware message", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: {
            type: "RESOURCE_NOT_FOUND",
            message:
              "The platform reports no account under this identifier. It has been removed or deactivated, the name was changed, or it never existed. You were not charged for this request.",
          },
        }),
        { status: 404 },
      ),
    );

    const result = await makeRequest(ctx, { platform: "tiktok", resource: "profile", params: { handle: "ghost" } });
    expect(result).toContain("Resource not found");
    expect(result).toContain("You were not charged for this request.");
    expect(result).not.toContain("socialcrawl_list_endpoints");
  });

  it("keeps the refund note on a 404 RESOURCE_NOT_FOUND that carries no message", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ success: false, error: { type: "RESOURCE_NOT_FOUND" } }), { status: 404 }),
    );

    const result = await makeRequest(ctx, { platform: "tiktok", resource: "profile", params: { handle: "ghost" } });
    expect(result).toContain("Resource not found");
    expect(result).toContain("refunded");
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

    const result = await makeRequest(ctx, { platform: "tiktok", resource: "profile", params: { handle: "test" } });
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

    const result = await makeRequest(ctx, {
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

    const result = await makeRequest(ctx, {
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

    const result = await makeRequest(ctx, { platform: "tiktok", resource: "profile", params: { handle: "test" } });
    expect(result).toContain("INTERNAL_ERROR");
    expect(result).toContain("https://www.socialcrawl.dev/docs/errors/internal-error");
  });

  it("forwards idempotencyKey as Idempotency-Key header", async () => {
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    });

    await makeRequest(ctx, {
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

    await makeRequest(ctx, { platform: "tiktok", resource: "profile", params: { handle: "charlidamelio" } });
    expect(capturedHeaders["Idempotency-Key"]).toBeUndefined();
  });

  it("supports the meta platform for /v1/credits/balance", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ success: true, data: { balance: 42 } }), { status: 200 });
    });

    await makeRequest(ctx, { platform: "meta", resource: "credits/balance" });
    expect(capturedUrl).toContain("/v1/credits/balance");
    expect(capturedUrl).not.toContain("?");
  });

  it("uses ctx.baseUrl as the request origin", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    });

    await makeRequest(
      { apiKey: "sc_test_key", baseUrl: "http://localhost:9999" },
      { platform: "tiktok", resource: "profile", params: { handle: "test" } },
    );
    expect(capturedUrl.startsWith("http://localhost:9999/v1/tiktok/profile")).toBe(true);
  });
});

/**
 * 11/09/2026 customer report: MCP errors read "Upstream error fetching data.
 * Credits have been auto-refunded." with no request_id, although the API body
 * carried a top-level `request_id` and a specific `error.message`. Every branch
 * must now pass the server's message, `details.reason`, and the request id on.
 */
describe("formatHttpError keeps the server's message, reason and request_id", () => {
  const opts = { platform: "instagram", resource: "post/transcript" };
  const envelope = (error: Record<string, unknown>, requestId?: string) =>
    JSON.stringify({
      success: false,
      error,
      credits_used: 0,
      ...(requestId ? { request_id: requestId } : {}),
      credits_remaining: 812,
    });

  it("404 RESOURCE_NOT_FOUND: server message, reason and request_id, no invented refund claim", () => {
    const out = formatHttpError(
      404,
      envelope(
        {
          type: "RESOURCE_NOT_FOUND",
          message:
            "The video is unavailable (deleted, private, or it never existed). You were not charged for this request.",
          status: 404,
          doc_url: "https://www.socialcrawl.dev/docs/errors#resource-not-found",
          details: { reason: "video_gone" },
        },
        "req-404abc",
      ),
      opts,
    );
    expect(out.startsWith("Error:")).toBe(true);
    expect(out).toContain("Resource not found");
    expect(out).toContain("The video is unavailable (deleted, private, or it never existed).");
    expect(out).toContain("You were not charged for this request.");
    expect(out).toContain("reason: video_gone");
    expect(out).toContain("request_id: req-404abc");
    expect(out).not.toContain("doesn't exist");
    expect(out).not.toContain("socialcrawl_list_endpoints");
  });

  it("502: passes the upstream-failure message through with the request_id", () => {
    const out = formatHttpError(
      502,
      envelope(
        {
          type: "UPSTREAM_ERROR",
          message:
            "pinterest returned an error for this request and every available source failed. Your credits have been refunded. This is usually transient, retry after 30 seconds.",
          status: 502,
          doc_url: "https://www.socialcrawl.dev/docs/errors#upstream-error",
        },
        "req-502def",
      ),
      { platform: "pinterest", resource: "search" },
    );
    expect(out.startsWith("Error:")).toBe(true);
    expect(out).toContain("pinterest returned an error for this request and every available source failed.");
    expect(out).toContain("retry after 30 seconds.");
    expect(out).toContain("request_id: req-502def");
    expect(out).not.toContain("reason:");
  });

  it("503: uses the server's reason for the outage instead of a generic line", () => {
    const out = formatHttpError(
      503,
      envelope(
        {
          type: "SERVICE_UNAVAILABLE",
          message: "instagram is momentarily rate-limited upstream. Retry after 30s. Your credits have been refunded.",
          status: 503,
        },
        "req-503ghi",
      ),
      opts,
    );
    expect(out.startsWith("Error:")).toBe(true);
    expect(out).toContain("instagram is momentarily rate-limited upstream. Retry after 30s.");
    expect(out).toContain("request_id: req-503ghi");
  });

  it("429: says which limit was hit (rate window, not concurrency)", () => {
    const out = formatHttpError(
      429,
      envelope(
        {
          type: "RATE_LIMITED",
          message:
            "Request rate limit exceeded. Limit: 600 requests per minute. Honor the Retry-After header, then back off with jitter (see /docs/rate-limits).",
          status: 429,
        },
        "req-429jkl",
      ),
      opts,
    );
    expect(out.startsWith("Error:")).toBe(true);
    expect(out).toContain("Limit: 600 requests per minute");
    expect(out).not.toContain("concurrent");
    expect(out).toContain("request_id: req-429jkl");
  });

  it("401: keeps the key-config hint and adds the server's message and request_id", () => {
    const out = formatHttpError(
      401,
      envelope(
        { type: "INVALID_API_KEY", message: "API key not found, revoked, or expired.", status: 401 },
        "req-401mno",
      ),
      opts,
    );
    expect(out.startsWith("Error:")).toBe(true);
    expect(out).toContain("Invalid API key");
    expect(out).toContain("API key not found, revoked, or expired.");
    expect(out).toContain("SOCIALCRAWL_API_KEY");
    expect(out).toContain("request_id: req-401mno");
  });

  it("405: shows the server's allowed-method message", () => {
    const out = formatHttpError(
      405,
      envelope(
        { type: "METHOD_NOT_ALLOWED", message: "/v1/web/crawl requires POST, not GET.", status: 405 },
        "req-405pqr",
      ),
      { platform: "web", resource: "crawl" },
    );
    expect(out).toContain("Method not allowed");
    expect(out).toContain("/v1/web/crawl requires POST, not GET.");
    expect(out).toContain("request_id: req-405pqr");
  });

  it("402 KEY_BUDGET_EXCEEDED: passes the per-key cap message and does not say top up", () => {
    const out = formatHttpError(
      402,
      envelope(
        {
          type: "KEY_BUDGET_EXCEEDED",
          message:
            "This API key has spent its per-key credit limit; the account balance is unaffected. Raise or reset the key's limit in Dashboard > API Keys, or use a key with no limit.",
          status: 402,
        },
        "req-402stu",
      ),
      opts,
    );
    expect(out.startsWith("Error:")).toBe(true);
    expect(out).toContain("per-key credit limit");
    expect(out).not.toContain("Top up");
    expect(out).toContain("request_id: req-402stu");
  });

  it("400: appends the request_id to the validation message", () => {
    const out = formatHttpError(
      400,
      envelope({ type: "INVALID_REQUEST", message: "Missing required parameter: handle", status: 400 }, "req-400vwx"),
      opts,
    );
    expect(out).toContain("Missing required parameter: handle");
    expect(out).toContain("request_id: req-400vwx");
  });

  it("non-JSON body: falls back to the X-Request-Id header", () => {
    const out = formatHttpError(502, "<html><body>Bad Gateway</body></html>", opts, "req-hdr123");
    expect(out.startsWith("Error:")).toBe(true);
    expect(out).toContain("Upstream error");
    expect(out).toContain("request_id: req-hdr123");
  });

  it("prefers the body's request_id over the header when both are present", () => {
    const out = formatHttpError(
      502,
      envelope({ type: "UPSTREAM_ERROR", message: "tiktok returned an error.", status: 502 }, "req-body1"),
      opts,
      "req-header1",
    );
    expect(out).toContain("request_id: req-body1");
    expect(out).not.toContain("req-header1");
  });

  it("no request_id anywhere: omits the line rather than printing a placeholder", () => {
    const out = formatHttpError(
      502,
      envelope({ type: "UPSTREAM_ERROR", message: "tiktok returned an error.", status: 502 }),
      opts,
    );
    expect(out).toContain("tiktok returned an error.");
    expect(out).not.toContain("request_id");
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("null");
  });

  it("no server message: keeps the old fixed guidance for that status", () => {
    const out = formatHttpError(502, envelope({ type: "UPSTREAM_ERROR" }, "req-bare"), opts);
    expect(out).toContain("Upstream error fetching data. Credits have been auto-refunded.");
    expect(out).toContain("request_id: req-bare");
  });
});

describe("request_id reaches the tool result through both request paths", () => {
  const ctx: ApiContext = { apiKey: "sc_test_key", baseUrl: "https://www.socialcrawl.dev" };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("makeRequest reads X-Request-Id when the body is not JSON", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response("upstream connect error", { status: 503, headers: { "X-Request-Id": "req-mk-hdr" } }),
    );
    const out = await makeRequest(ctx, { platform: "tiktok", resource: "profile", params: { handle: "x" } });
    expect(out.startsWith("Error:")).toBe(true);
    expect(out).toContain("request_id: req-mk-hdr");
  });

  it("a fetch-like response without headers still reports the API error", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 401,
      text: async () =>
        JSON.stringify({ error: { type: "INVALID_API_KEY", message: "nope" }, request_id: "req-noheaders" }),
    }));
    const out = await makeRequest(ctx, { platform: "tiktok", resource: "profile", params: { handle: "x" } });
    expect(out).toContain("Invalid API key");
    expect(out).toContain("request_id: req-noheaders");
    expect(out).not.toContain("Unexpected error");
  });

  it("apiRequest carries the body's request_id and server message", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: { type: "UPSTREAM_ERROR", message: "youtube returned an error for this request.", status: 502 },
          request_id: "req-api-body",
        }),
        { status: 502 },
      ),
    );
    const out = await apiRequest(ctx, { method: "POST", path: "/v1/youtube/videos", body: { ids: ["a"] } });
    expect(out.startsWith("Error:")).toBe(true);
    expect(out).toContain("youtube returned an error for this request.");
    expect(out).toContain("request_id: req-api-body");
  });
});
