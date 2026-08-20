import { describe, it, expect } from "vitest";
import { paginate, page } from "../paginate.js";
import { getDocs } from "../tools/get-docs.js";
import { listEndpoints } from "../tools/list-endpoints.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { getEndpointsByPlatform } from "../data/endpoints.js";

/**
 * Truncation used to drop content with no way to reach it — the `full` docs
 * reference lost ~92% of itself, and a 44-endpoint platform lost its tail.
 * These tests pin the property that matters: everything is still reachable.
 */
describe("paginate", () => {
  it("leaves short content on a single page", () => {
    expect(paginate("hello")).toEqual(["hello"]);
  });

  it("splits long content on line boundaries", () => {
    const line = "x".repeat(200);
    const content = Array.from({ length: 400 }, () => line).join("\n");
    const pages = paginate(content);
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    // Nothing is lost: rejoining the pages reproduces every line.
    expect(pages.join("\n").split("\n")).toHaveLength(400);
  });

  it("clamps an out-of-range page to the last one", () => {
    const content = Array.from({ length: 400 }, () => "y".repeat(200)).join("\n");
    const last = page(content, 9999, () => "next");
    expect(last).toContain("— end.]");
  });

  it("clamps a zero or negative page to the first one", () => {
    const content = Array.from({ length: 400 }, () => "z".repeat(200)).join("\n");
    expect(page(content, 0, () => "next")).toBe(page(content, 1, () => "next"));
  });
});

describe("socialcrawl_get_docs paging", () => {
  it("pages the full reference instead of truncating it", () => {
    const first = getDocs("full");
    expect(first.length).toBeLessThanOrEqual(CHARACTER_LIMIT + 200);
    expect(first).toMatch(/\[Page 1 of \d+\./);
    expect(first).toContain("page 2");
  });

  it("reaches the end of the full reference", () => {
    const first = getDocs("full");
    const total = Number(first.match(/\[Page 1 of (\d+)\./)![1]);
    expect(total).toBeGreaterThan(1);
    expect(getDocs("full", total)).toContain("— end.]");
  });

  it("keeps a short topic unpaged", () => {
    expect(getDocs("idempotency")).not.toContain("[Page");
  });

  it("lists both guide and platform topics for an unknown one", () => {
    const out = getDocs("nope");
    expect(out).toContain("Guides:");
    expect(out).toContain("Platform topics");
  });
});

describe("socialcrawl_list_endpoints paging", () => {
  it("pages a platform too big for one response and repeats the filters", () => {
    const first = listEndpoints({ platform: "linkedin" });
    expect(first).toMatch(/\[Page 1 of \d+\./);
    expect(first).toContain('platform "linkedin"');
  });

  it("reaches every endpoint across the pages", () => {
    const resources = getEndpointsByPlatform("linkedin").map((e) => e.resource);
    const first = listEndpoints({ platform: "linkedin" });
    const total = Number(first.match(/\[Page 1 of (\d+)\./)![1]);
    let all = "";
    for (let i = 1; i <= total; i += 1) {
      all += listEndpoints({ platform: "linkedin", page: i });
    }
    for (const r of resources) {
      expect(all, `linkedin/${r} unreachable across ${total} pages`).toContain(`\`${r}\``);
    }
  });

  it("keeps a compact listing on one page", () => {
    expect(listEndpoints({ platform: "linkedin", detail: "compact" })).not.toContain("[Page");
  });
});
