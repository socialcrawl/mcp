import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { contextFromEnv, DEFAULT_BASE_URL } from "../context.js";

describe("contextFromEnv (stdio entrypoint only)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SOCIALCRAWL_API_KEY;
    delete process.env.SOCIALCRAWL_BASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("defaults to empty key and the production base URL", () => {
    const ctx = contextFromEnv();
    expect(ctx.apiKey).toBe("");
    expect(ctx.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(DEFAULT_BASE_URL).toBe("https://www.socialcrawl.dev");
  });

  it("reads SOCIALCRAWL_API_KEY and SOCIALCRAWL_BASE_URL when set", () => {
    process.env.SOCIALCRAWL_API_KEY = "sc_env_key";
    process.env.SOCIALCRAWL_BASE_URL = "http://localhost:4000";
    const ctx = contextFromEnv();
    expect(ctx.apiKey).toBe("sc_env_key");
    expect(ctx.baseUrl).toBe("http://localhost:4000");
  });
});
