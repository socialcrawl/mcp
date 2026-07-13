import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extractApiKey } from "../auth.js";

describe("extractApiKey", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Poison the env to prove the extractor never reads it.
    process.env = { ...originalEnv, SOCIALCRAWL_API_KEY: "sc_operator_secret" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("reads Authorization: Bearer", () => {
    expect(extractApiKey({ authorization: "Bearer sc_abc123" })).toBe("sc_abc123");
  });

  it("is case-insensitive on the Bearer scheme and trims whitespace", () => {
    expect(extractApiKey({ authorization: "bearer   sc_abc123  " })).toBe("sc_abc123");
  });

  it("reads x-api-key", () => {
    expect(extractApiKey({ "x-api-key": "sc_xyz789" })).toBe("sc_xyz789");
  });

  it("prefers Authorization over x-api-key when both are present", () => {
    expect(extractApiKey({ authorization: "Bearer sc_a", "x-api-key": "sc_b" })).toBe("sc_a");
  });

  it("ignores non-Bearer Authorization schemes", () => {
    expect(extractApiKey({ authorization: "Basic dXNlcjpwYXNz" })).toBe("");
  });

  it("falls through to x-api-key when Authorization is non-Bearer or an empty Bearer", () => {
    expect(extractApiKey({ authorization: "Basic dXNlcjpwYXNz", "x-api-key": "sc_fallback" })).toBe("sc_fallback");
    expect(extractApiKey({ authorization: "Bearer   ", "x-api-key": "sc_fallback" })).toBe("sc_fallback");
  });

  it("trims whitespace around an x-api-key value", () => {
    expect(extractApiKey({ "x-api-key": "  sc_xyz789  " })).toBe("sc_xyz789");
  });

  it("ignores a repeated x-api-key header (array form)", () => {
    expect(extractApiKey({ "x-api-key": ["sc_a", "sc_b"] as unknown as string })).toBe("");
  });

  it("SECURITY: returns empty string — never the process env key — when no headers are sent", () => {
    expect(extractApiKey({})).toBe("");
  });
});
