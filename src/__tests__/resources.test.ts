import { describe, it, expect, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { PLATFORMS } from "../data/platforms.js";
import { ENDPOINTS } from "../data/endpoints.js";
import { EXAMPLES } from "../data/examples.js";
import { RECIPES_DATA } from "../data/recipes.js";
import { endpointStructured } from "../tools/endpoint.js";
import { missingScopesForBody, SCOPES } from "../oauth/scopes.js";
import { findBanned } from "./fixtures/supplier-tokens.js";
import type { ApiContext } from "../context.js";

/** MCP-05 (T28): resources, templates, completions and prompts, over a real client. */

const ANON: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };

async function connect(ctx: ApiContext = ANON): Promise<Client> {
  const server = createServer(ctx, { legacyTools: false });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "resources-test", version: "0" });
  await client.connect(a);
  return client;
}

async function read(client: Client, uri: string): Promise<string> {
  const res = await client.readResource({ uri });
  return (res.contents[0] as { text: string }).text;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const STATIC = ["guide", "recipes", "pricing", "errors", "llms", "quickstart", "capabilities"];
const TEMPLATES = [
  "socialcrawl://platform/{platform}",
  "socialcrawl://endpoint/{platform}/{+resource}",
  "socialcrawl://schema/{archetype}",
  "socialcrawl://example/{platform}/{+resource}",
  "socialcrawl://results/{request_id}",
];

describe("capabilities and listing", () => {
  it("advertises resources, prompts and completions", async () => {
    const client = await connect();
    const caps = client.getServerCapabilities()!;
    expect(caps.resources).toBeTruthy();
    expect(caps.prompts).toBeTruthy();
    expect(caps.completions).toBeTruthy();
    await client.close();
  });

  it("resources/list returns the static references", async () => {
    const client = await connect();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(STATIC.map((s) => `socialcrawl://${s}`).sort());
    for (const r of resources) {
      expect(r.name, r.uri).toBeTruthy();
      expect(r.description, r.uri).toBeTruthy();
      expect(r.mimeType, r.uri).toBeTruthy();
    }
    expect(findBanned(JSON.stringify(resources))).toBeUndefined();
    await client.close();
  });

  it("resources/templates/list returns the five templates", async () => {
    const client = await connect();
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual([...TEMPLATES].sort());
    expect(findBanned(JSON.stringify(resourceTemplates))).toBeUndefined();
    await client.close();
  });
});

describe("static resources", () => {
  it.each(STATIC)("reads %s and names no supplier", async (name) => {
    const client = await connect();
    const text = await read(client, `socialcrawl://${name}`);
    expect(text.length).toBeGreaterThan(200);
    expect(findBanned(text), name).toBeUndefined();
    await client.close();
  });

  it("guide is the skill body without frontmatter", async () => {
    const client = await connect();
    const text = await read(client, "socialcrawl://guide");
    expect(text.startsWith("---")).toBe(false);
    expect(text).toContain("# SocialCrawl API");
    await client.close();
  });

  it("recipes lists every recipe as JSON with typed inputs and cost", async () => {
    const client = await connect();
    const body = JSON.parse(await read(client, "socialcrawl://recipes")) as Array<{ id: string; inputs: unknown[]; cost: unknown }>;
    expect(body.length).toBe(RECIPES_DATA.length);
    expect(body.find((r) => r.id === "brand-listening")?.inputs.length).toBeGreaterThan(0);
    expect(body.every((r) => r.cost !== undefined)).toBe(true);
    await client.close();
  });

  it("covers what the legacy discover topics offered (quickstart, capabilities, llms)", async () => {
    const client = await connect();
    expect(await read(client, "socialcrawl://quickstart")).toMatch(/x-api-key|API key/i);
    expect(await read(client, "socialcrawl://capabilities")).toContain("Cross-cutting parameters");
    expect(await read(client, "socialcrawl://llms")).toContain("llms.txt");
    await client.close();
  });
});

describe("resource templates", () => {
  it("platform/{platform} gives the platform's endpoint table", async () => {
    const client = await connect();
    const text = await read(client, "socialcrawl://platform/tiktok");
    expect(text).toContain("TikTok");
    expect(text).toContain("profile/videos");
    expect(text).toMatch(/credit|cr\b/);
    await expect(client.readResource({ uri: "socialcrawl://platform/nope" })).rejects.toThrow(/Unknown platform/);
    await client.close();
  });

  it("endpoint/{platform}/{resource} renders the same contract as socialcrawl_endpoint", async () => {
    const client = await connect();
    const text = await read(client, "socialcrawl://endpoint/tiktok/profile/videos");
    const tool = await endpointStructured(ANON, { id: "tiktok/profile/videos" });
    expect(text).toBe(tool.text);
    await expect(client.readResource({ uri: "socialcrawl://endpoint/tiktok/nope" })).rejects.toThrow(/Unknown resource/);
    await client.close();
  });

  it("schema/{archetype} lists the fields and a sample", async () => {
    const client = await connect();
    const archetype = ENDPOINTS.find((e) => e.archetype === "PostList")?.archetype ?? "PostList";
    const text = await read(client, `socialcrawl://schema/${archetype}`);
    expect(text).toContain(archetype);
    expect(text).toMatch(/post\.id|post\.url/);
    expect(findBanned(text)).toBeUndefined();
    await expect(client.readResource({ uri: "socialcrawl://schema/Nope" })).rejects.toThrow(/Unknown archetype/);
    await client.close();
  });

  it("example/{platform}/{resource} serves the bundled redacted sample", async () => {
    const client = await connect();
    const key = Object.keys(EXAMPLES).find((k) => k.startsWith("tiktok/"))!;
    const body = JSON.parse(await read(client, `socialcrawl://example/${key}`)) as { data: unknown; redacted: boolean };
    expect(body.redacted).toBe(true);
    expect(body.data).toBeTruthy();
    const without = ENDPOINTS.find((e) => !EXAMPLES[`${e.platform}/${e.resource}`])!;
    await expect(client.readResource({ uri: `socialcrawl://example/${without.platform}/${without.resource}` })).rejects.toThrow(/No bundled sample/);
    await client.close();
  });

  it("bundled samples map onto real endpoints, are redacted and name no supplier", () => {
    const ids = new Set(ENDPOINTS.map((e) => `${e.platform}/${e.resource}`));
    const keys = Object.keys(EXAMPLES);
    expect(keys.length).toBeGreaterThanOrEqual(440);
    expect(keys.filter((k) => !ids.has(k))).toEqual([]);
    for (const [k, v] of Object.entries(EXAMPLES)) {
      expect(JSON.parse(v).redacted, k).toBe(true);
      expect(findBanned(v), k).toBeUndefined();
    }
  });

  it("results/{request_id} is still served (MCP-03)", async () => {
    const client = await connect();
    await expect(client.readResource({ uri: "socialcrawl://results/req_missing" })).rejects.toThrow(/No stored result/);
    await client.close();
  });
});

describe("completions", () => {
  it("completes platform slugs by prefix", async () => {
    const client = await connect();
    const r = await client.complete({
      ref: { type: "ref/resource", uri: "socialcrawl://platform/{platform}" },
      argument: { name: "platform", value: "tik" },
    });
    expect(r.completion.values).toContain("tiktok");
    expect(r.completion.values.every((v) => v.startsWith("tik"))).toBe(true);
    await client.close();
  });

  it("completes resources for the platform already chosen", async () => {
    const client = await connect();
    const r = await client.complete({
      ref: { type: "ref/resource", uri: "socialcrawl://endpoint/{platform}/{+resource}" },
      argument: { name: "resource", value: "profile" },
      context: { arguments: { platform: "tiktok" } },
    });
    expect(r.completion.values).toContain("profile/videos");
    expect(r.completion.values.every((v) => v.startsWith("profile"))).toBe(true);
    const all = await client.complete({
      ref: { type: "ref/resource", uri: "socialcrawl://example/{platform}/{+resource}" },
      argument: { name: "resource", value: "" },
      context: { arguments: { platform: "tiktok" } },
    });
    expect(all.completion.values.length).toBeGreaterThan(0);
    await client.close();
  });

  it("completes archetypes", async () => {
    const client = await connect();
    const r = await client.complete({
      ref: { type: "ref/resource", uri: "socialcrawl://schema/{archetype}" },
      argument: { name: "archetype", value: "Post" },
    });
    expect(r.completion.values).toContain("PostList");
    await client.close();
  });
});

describe("prompts", () => {
  const withinThree = RECIPES_DATA.filter((r) => r.inputs.length <= 3);
  const CARD = ["brand_listening", "creator_discovery", "competitor_monitor", "compare_reviews", "bulk_url_stats", "comment_export"];

  it("prompts/list has the six card prompts and every recipe with up to 3 inputs", async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name);
    for (const n of CARD) expect(names, n).toContain(n);
    for (const r of withinThree) expect(names, r.id).toContain(r.id.replace(/-/g, "_"));
    expect(new Set(names).size).toBe(names.length);
    for (const p of prompts) {
      expect(p.description, p.name).toBeTruthy();
      expect(p.arguments?.every((a) => a.required), p.name).toBe(true);
    }
    expect(findBanned(JSON.stringify(prompts))).toBeUndefined();
    await client.close();
  });

  it("prompts/get expands a recipe into steps, cost and pitfalls", async () => {
    const client = await connect();
    const res = await client.getPrompt({ name: "brand_listening", arguments: { brand: "acme", start_date: "2026-09-01" } });
    const text = (res.messages[0].content as { text: string }).text;
    expect(res.messages[0].role).toBe("user");
    expect(text).toContain("prism/brand-mentions");
    expect(text).toContain('"keyword":"acme"');
    expect(text).toContain("50 credits");
    expect(text).toContain("socialcrawl_estimate");
    expect(text).toContain("Pitfalls");
    expect(text).not.toMatch(/\{(brand|start_date)\}/);
    await client.close();
  });

  it("a monitor recipe shows its setup call and the card aliases resolve", async () => {
    const client = await connect();
    const res = await client.getPrompt({
      name: "competitor_monitor",
      arguments: { handle: "mkbhd", webhook_url: "https://example.com/hook", last_run_date: "2026-09-25" },
    });
    const text = (res.messages[0].content as { text: string }).text;
    expect(text).toContain("/v1/monitors");
    expect(text).toContain("youtube/channel/videos");
    await client.close();
  });

  it("a missing required argument is refused", async () => {
    const client = await connect();
    await expect(client.getPrompt({ name: "brand_listening", arguments: { brand: "acme" } })).rejects.toThrow();
    await client.close();
  });

  it("every prompt expands with its example arguments, fully filled and supplier-free", async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    for (const p of prompts) {
      const recipe = RECIPES_DATA.find((r) => r.id.replace(/-/g, "_") === p.name) ?? RECIPES_DATA.find((r) => (p.arguments ?? []).every((a) => r.inputs.some((i) => i.name === a.name)))!;
      const args = Object.fromEntries((p.arguments ?? []).map((a) => [a.name, recipe.inputs.find((i) => i.name === a.name)?.example ?? "x"]));
      const res = await client.getPrompt({ name: p.name, arguments: args });
      const text = (res.messages[0].content as { text: string }).text;
      expect(text, p.name).not.toMatch(/\{[a-z_]+\}/);
      expect(findBanned(text), p.name).toBeUndefined();
    }
    await client.close();
  });
});

describe("OAuth scopes", () => {
  it("resources/read, resources/list and prompts/get need only a valid token", () => {
    for (const method of ["resources/list", "resources/templates/list", "resources/read", "prompts/list", "prompts/get", "completion/complete"]) {
      expect(missingScopesForBody({ jsonrpc: "2.0", id: 1, method, params: {} }, [SCOPES.read]), method).toEqual([]);
    }
  });
});
