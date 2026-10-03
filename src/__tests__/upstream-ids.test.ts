import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { ENDPOINTS } from "../data/endpoints.js";
import { PLATFORMS } from "../data/platforms.js";
import { endpointStructured } from "../tools/endpoint.js";
import { findBanned } from "../resources/supplier-tokens.js";

/**
 * The registry data carries upstream dispatch ids (`upstream.kind`, `fallbackKinds`,
 * e.g. dfs-* and apify-*). They are for routing inside the API; no agent-facing
 * output may repeat one. (Plain names such as tavily or github are public platform
 * names; the supplier names themselves are held by the opacity tests.)
 */
const ids = [...new Set(ENDPOINTS.flatMap((e) => [e.upstream.kind, ...(e.upstream.fallbackKinds ?? [])]))].filter((k) => /[-\d]/.test(k) && k.length >= 4);

function leaks(text: string): string[] {
  const lower = text.toLowerCase();
  return ids.filter((id) => lower.includes(id.toLowerCase()));
}

describe("upstream dispatch ids never reach an agent", () => {
  it("there are dispatch ids to look for, including dfs-* and apify-*", () => {
    expect(ids.some((i) => i.startsWith("dfs-"))).toBe(true);
    expect(ids.some((i) => i.startsWith("apify-"))).toBe(true);
  });

  it("every resource, template read, prompt and endpoint tool output is free of them", async () => {
    const server = createServer({ apiKey: "", baseUrl: "https://www.socialcrawl.dev" }, { legacyTools: true });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(a);
    const found: string[] = [];
    const check = (where: string, text: string): void => {
      for (const id of leaks(text)) found.push(`${where}: ${id}`);
      const banned = findBanned(text);
      if (banned) found.push(`${where}: banned ${banned}`);
    };
    check("tools/list", JSON.stringify((await client.listTools()).tools));
    for (const r of (await client.listResources()).resources) check(r.uri, ((await client.readResource({ uri: r.uri })).contents[0] as { text: string }).text);
    for (const p of PLATFORMS) check(`platform/${p.slug}`, ((await client.readResource({ uri: `socialcrawl://platform/${p.slug}` })).contents[0] as { text: string }).text);
    for (const e of ENDPOINTS) {
      const id = `${e.platform}/${e.resource}`;
      check(`endpoint/${id}`, ((await client.readResource({ uri: `socialcrawl://endpoint/${id}` })).contents[0] as { text: string }).text);
      const out = await endpointStructured({ apiKey: "", baseUrl: "https://www.socialcrawl.dev" }, { id });
      check(`tool endpoint ${id}`, out.text + JSON.stringify(out.structured));
    }
    for (const p of (await client.listPrompts()).prompts) {
      const args = Object.fromEntries((p.arguments ?? []).map((x) => [x.name, "example"]));
      const res = await client.getPrompt({ name: p.name, arguments: args });
      check(`prompt ${p.name}`, JSON.stringify(res.messages));
    }
    await client.close();
    expect(found).toEqual([]);
  }, 120_000);
});
