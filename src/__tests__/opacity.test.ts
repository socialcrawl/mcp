import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { INSTRUCTIONS } from "../instructions.js";
import { getDocs } from "../tools/get-docs.js";
import { getAvailableTopics } from "../data/docs.js";
import { listEndpoints } from "../tools/list-endpoints.js";
import { PLATFORMS } from "../data/platforms.js";
import { ENDPOINTS } from "../data/endpoints.js";
import { findBanned, SUPPLIER_TOKENS } from "./fixtures/supplier-tokens.js";
import { findStructured } from "../tools/find.js";

/** SRC-OPACITY: nothing an agent reads names an upstream data supplier. */
describe("vendor neutrality", () => {
  it("the banned list is not empty (guards a vacuous pass)", () => {
    expect(SUPPLIER_TOKENS.length).toBeGreaterThan(10);
  });

  it.each([
    ["default", false, 7],
    ["legacy", true, 16],
  ] as const)("tools/list (%s surface: names, descriptions, input and output schemas) names no supplier", async (_n, legacyTools, count) => {
    const server = createServer({ apiKey: "", baseUrl: "https://www.socialcrawl.dev" }, { legacyTools });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(a);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(count);
    expect(findBanned(JSON.stringify(tools))).toBeUndefined();
    await client.close();
  });

  it("socialcrawl_find output names no supplier, for a task on every platform", async () => {
    for (const p of PLATFORMS) {
      const out = await findStructured({ apiKey: "", baseUrl: "https://www.socialcrawl.dev" }, { task: `${p.name} data`, limit: 5 });
      expect(findBanned(out.text), p.slug).toBeUndefined();
      expect(findBanned(JSON.stringify(out.structured)), p.slug).toBeUndefined();
    }
  });

  it("instructions name no supplier", () => {
    expect(findBanned(INSTRUCTIONS)).toBeUndefined();
  });

  it.each(getAvailableTopics())("get_docs topic %s names no supplier", (topic) => {
    const first = getDocs(topic, 1);
    const pages = Number(/page 1 of (\d+)|Page 1\/(\d+)/i.exec(first)?.[1] ?? 1);
    expect(findBanned(first), `${topic} p1`).toBeUndefined();
    for (let p = 2; p <= Math.min(pages, 60); p++) {
      expect(findBanned(getDocs(topic, p)), `${topic} p${p}`).toBeUndefined();
    }
  });

  it("list_endpoints detail=full names no supplier, for every platform", () => {
    for (const p of PLATFORMS) {
      for (let page = 1; page <= 20; page++) {
        const out = listEndpoints({ platform: p.slug, detail: "full", page });
        expect(findBanned(out), `${p.slug} p${page}`).toBeUndefined();
        if (!/page \d+ of \d+/i.test(out) || new RegExp(`page ${page} of ${page}\\b`, "i").test(out)) break;
      }
    }
  });

  it("states reliability vendor-neutrally where an endpoint has fallbacks", () => {
    const multi = ENDPOINTS.find((e) => (e.upstream.fallbackKinds?.length ?? 0) > 0)!;
    expect(multi).toBeTruthy();
    const out = listEndpoints({ platform: multi.platform, detail: "full" });
    expect(out).toContain("Reliability:");
    expect(out).toContain("multi-source with automatic fallback; charged once");
    expect(out).not.toContain("Sources:");
  });
});
