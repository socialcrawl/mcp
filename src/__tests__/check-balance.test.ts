import { describe, it, expect, vi, afterEach } from "vitest";
import { checkBalance } from "../tools/check-balance.js";
import type { ApiContext } from "../context.js";

const ctx: ApiContext = { apiKey: "sc_test_key", baseUrl: "https://www.socialcrawl.dev" };
const anonCtx: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("socialcrawl_check_balance tool", () => {
  it("calls /v1/credits/balance with no platform prefix and no query string", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({
          success: true,
          platform: "meta",
          endpoint: "/v1/credits/balance",
          data: { balance: 8432, recent_deductions: { last_24h: 128, last_7d: 1043 } },
          credits_used: 0,
          credits_remaining: 8432,
        }),
        { status: 200 },
      );
    });

    const result = await checkBalance(ctx);
    expect(capturedUrl).toContain("/v1/credits/balance");
    expect(capturedUrl).not.toContain("/v1/meta/");
    expect(capturedUrl).not.toContain("?");
    expect(result).toContain("8432");
  });

  it("returns the No-API-key error for an anonymous context", async () => {
    const result = await checkBalance(anonCtx);
    expect(result).toContain("No API key configured");
  });

  it("formats the balance response with a header noting 0-credit cost", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          success: true,
          platform: "meta",
          endpoint: "/v1/credits/balance",
          data: { balance: 100, recent_deductions: { last_24h: 0, last_7d: 0 } },
          credits_used: 0,
          credits_remaining: 100,
        }),
        { status: 200 },
      ),
    );

    const result = await checkBalance(ctx);
    expect(result).toContain("/v1/credits/balance");
    expect(result).toContain("0 credits");
  });

  it("propagates 401 errors with the Invalid API key message", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({ success: false, error: { type: "INVALID_API_KEY", message: "bad key" } }),
        { status: 401 },
      ),
    );

    const result = await checkBalance(ctx);
    expect(result).toContain("Invalid API key");
  });
});
