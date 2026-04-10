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
});
