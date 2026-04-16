import { describe, it, expect } from "vitest";
import { request } from "../tools/request.js";

describe("Pre-flight validation", () => {
  it("rejects unknown platform", async () => {
    const result = await request({ platform: "fakebook", resource: "profile" });
    expect(result).toContain("Unknown platform");
    expect(result).toContain("socialcrawl_list_platforms");
  });

  it("rejects unknown resource for valid platform", async () => {
    const result = await request({ platform: "tiktok", resource: "nonexistent" });
    expect(result).toContain("Unknown resource");
    expect(result).toContain("socialcrawl_list_endpoints");
  });

  it("rejects missing required params", async () => {
    const result = await request({ platform: "tiktok", resource: "profile", params: {} });
    expect(result).toContain("Missing required parameter");
    expect(result).toContain("handle");
  });

  it("rejects when no params provided but endpoint requires them", async () => {
    const result = await request({ platform: "tiktok", resource: "profile" });
    expect(result).toContain("Missing required parameter");
  });

  it("passes validation for endpoints with no required params", async () => {
    const result = await request({ platform: "tiktok", resource: "songs/popular" });
    expect(result).toContain("No API key configured");
  });

  it("rejects oneOf endpoint when no group member is provided", async () => {
    const result = await request({
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
    const result = await request({
      platform: "facebook",
      resource: "profile/posts",
      params: { url: "https://www.facebook.com/Meta" },
    });
    // Should skip preflight and reach the API-key-required stage.
    expect(result).toContain("No API key configured");
  });
});
