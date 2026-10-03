import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import type { ApiContext } from "../context.js";

async function connect(ctx: ApiContext): Promise<Client> {
  const server = createServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function firstText(result: Record<string, unknown>): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
}

describe("createServer factory", () => {
  // The default surface, whatever the shell exports; the legacy surface is covered in surface.test.ts.
  beforeEach(() => {
    vi.stubEnv("SOCIALCRAWL_LEGACY_TOOLS", "");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("registers the seven 2.0 tools", async () => {
    const client = await connect({ apiKey: "", baseUrl: "https://www.socialcrawl.dev" });
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "socialcrawl_account",
      "socialcrawl_collect",
      "socialcrawl_endpoint",
      "socialcrawl_estimate",
      "socialcrawl_find",
      "socialcrawl_manage",
      "socialcrawl_request",
    ]);
    await client.close();
  });

  it("serves discovery tools anonymously", async () => {
    const client = await connect({ apiKey: "", baseUrl: "https://www.socialcrawl.dev" });
    const result = await client.callTool({ name: "socialcrawl_find", arguments: {} });
    expect(firstText(result)).toContain("tiktok");
    await client.close();
  });

  it("returns the friendly no-key error from keyed tools when anonymous", async () => {
    const client = await connect({ apiKey: "", baseUrl: "https://www.socialcrawl.dev" });
    const result = await client.callTool({ name: "socialcrawl_account", arguments: {} });
    expect(firstText(result)).toContain("No API key configured");
    await client.close();
  });

  it("uses the per-context key for keyed tools", async () => {
    let capturedKey = "";
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedKey = (init.headers as Record<string, string>)["x-api-key"];
      return new Response(JSON.stringify({ success: true, data: { balance: 5 } }), { status: 200 });
    });
    const client = await connect({ apiKey: "sc_ctx_key", baseUrl: "https://www.socialcrawl.dev" });
    const result = await client.callTool({ name: "socialcrawl_account", arguments: {} });
    expect(capturedKey).toBe("sc_ctx_key");
    expect(firstText(result)).toContain("5");
    await client.close();
  });
});
