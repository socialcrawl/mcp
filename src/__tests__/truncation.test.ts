import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRequest } from "../client.js";
import { CHARACTER_LIMIT } from "../constants.js";

describe("Response truncation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, SOCIALCRAWL_API_KEY: "sc_test_key" };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("does not truncate responses under the limit", async () => {
    const shortBody = JSON.stringify({ success: true, data: "short" });
    vi.stubGlobal("fetch", async () => new Response(shortBody, { status: 200 }));

    const result = await makeRequest({ platform: "tiktok", resource: "profile", params: { handle: "test" } });
    expect(result).toBe(shortBody);
    expect(result).not.toContain("truncated");
  });

  it("truncates responses over the character limit", async () => {
    const longBody = "x".repeat(CHARACTER_LIMIT + 1000);
    vi.stubGlobal("fetch", async () => new Response(longBody, { status: 200 }));

    const result = await makeRequest({ platform: "tiktok", resource: "profile", params: { handle: "test" } });
    expect(result).toContain("truncated");
    expect(result).toContain(CHARACTER_LIMIT.toLocaleString());
    expect(result.length).toBeLessThan(longBody.length);
  });

  it("reports full response length when truncating", async () => {
    const fullLength = CHARACTER_LIMIT + 5000;
    const longBody = "x".repeat(fullLength);
    vi.stubGlobal("fetch", async () => new Response(longBody, { status: 200 }));

    const result = await makeRequest({ platform: "tiktok", resource: "profile", params: { handle: "test" } });
    expect(result).toContain(fullLength.toLocaleString());
  });
});
