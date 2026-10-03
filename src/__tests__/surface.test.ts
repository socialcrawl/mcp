import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { TOOL_SCOPES } from "../oauth/scopes.js";
import { INSTRUCTIONS } from "../instructions.js";
import type { ApiContext } from "../context.js";

/**
 * MCP-04: the consolidated surface. Seven tools by default, the old names
 * only behind SOCIALCRAWL_LEGACY_TOOLS=1, and a tools/list an agent can read
 * in under 5k tokens.
 */

const ANON: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };

const NEW_TOOLS = [
  "socialcrawl_find",
  "socialcrawl_endpoint",
  "socialcrawl_estimate",
  "socialcrawl_request",
  "socialcrawl_collect",
  "socialcrawl_account",
  "socialcrawl_manage",
];

const LEGACY_TOOLS = [
  "socialcrawl_list_platforms",
  "socialcrawl_list_endpoints",
  "socialcrawl_check_balance",
  "socialcrawl_monitors",
  "socialcrawl_web",
  "socialcrawl_cohorts",
  "socialcrawl_pricing",
  "socialcrawl_discover",
  "socialcrawl_get_docs",
];

async function listTools(opts?: { legacyTools?: boolean }) {
  const server = createServer(ANON, opts);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "surface", version: "0" });
  await client.connect(a);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("default tool surface", () => {
  // The default surface whatever the shell exports.
  beforeEach(() => {
    vi.stubEnv("SOCIALCRAWL_LEGACY_TOOLS", "");
  });

  it("registers exactly the seven tools", async () => {
    const names = (await listTools()).map((t) => t.name).sort();
    expect(names).toEqual([...NEW_TOOLS].sort());
  });

  it("tools/list stays under 5,000 tokens (chars / 4)", async () => {
    // Measured on the default surface: the legacy flag explicitly off, whatever the shell has.
    vi.stubEnv("SOCIALCRAWL_LEGACY_TOOLS", "");
    const chars = JSON.stringify(await listTools()).length;
    expect(Math.round(chars / 4)).toBeLessThanOrEqual(5000);
  });

  it("has no 67-value platform enum anywhere", async () => {
    const json = JSON.stringify(await listTools());
    expect(json).not.toContain('"xiaohongshu"');
  });

  it("annotates each tool honestly", async () => {
    const hints = Object.fromEntries((await listTools()).map((t) => [t.name, t.annotations]));
    for (const name of ["socialcrawl_find", "socialcrawl_endpoint", "socialcrawl_estimate"]) {
      expect(hints[name], name).toMatchObject({ readOnlyHint: true, idempotentHint: true, destructiveHint: false });
    }
    expect(hints.socialcrawl_account).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    for (const name of ["socialcrawl_request", "socialcrawl_collect"]) {
      expect(hints[name], name).toMatchObject({ readOnlyHint: false, idempotentHint: false, openWorldHint: true });
    }
    expect(hints.socialcrawl_manage).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  });

  it("every registered tool has an OAuth scope mapping", async () => {
    for (const t of await listTools({ legacyTools: true })) {
      expect(TOOL_SCOPES[t.name], t.name).toBeDefined();
    }
  });

  it("instructions name the new tools only, within 2,000 characters", () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(2000);
    expect(INSTRUCTIONS).toContain("socialcrawl_find");
    expect(INSTRUCTIONS).toContain("socialcrawl_endpoint");
    expect(INSTRUCTIONS).toContain("socialcrawl_estimate");
    for (const old of LEGACY_TOOLS) expect(INSTRUCTIONS).not.toContain(old);
  });
});

describe("fields guidance", () => {
  it("examples are root-qualified and point at socialcrawl_endpoint's paths", async () => {
    const tools = await listTools();
    for (const name of ["socialcrawl_request", "socialcrawl_collect"]) {
      const props = (tools.find((t) => t.name === name)!.inputSchema as { properties: Record<string, { description?: string }> }).properties;
      expect(props.fields.description, name).toMatch(/post\.id|comment\.text/);
      expect(props.fields.description, name).toContain("socialcrawl_endpoint");
      expect(props.fields.description, name).not.toMatch(/'id,text/);
    }
    expect(INSTRUCTIONS).toMatch(/fields.*exactly as socialcrawl_endpoint lists them/);
  });
});

describe("legacy flag", () => {
  it("SOCIALCRAWL_LEGACY_TOOLS=1 also registers the old names", async () => {
    vi.stubEnv("SOCIALCRAWL_LEGACY_TOOLS", "1");
    const names = (await listTools()).map((t) => t.name);
    for (const n of [...NEW_TOOLS, ...LEGACY_TOOLS]) expect(names, n).toContain(n);
    expect(names).toHaveLength(NEW_TOOLS.length + LEGACY_TOOLS.length);
  });

  it("the option overrides the environment", async () => {
    vi.stubEnv("SOCIALCRAWL_LEGACY_TOOLS", "1");
    expect((await listTools({ legacyTools: false })).map((t) => t.name).sort()).toEqual([...NEW_TOOLS].sort());
  });

  it("legacy wrappers still answer", async () => {
    const server = createServer(ANON, { legacyTools: true });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: "legacy", version: "0" });
    await client.connect(a);
    const r = await client.callTool({ name: "socialcrawl_list_platforms", arguments: {} });
    expect(r.isError).toBeFalsy();
    await client.close();
  });
});
