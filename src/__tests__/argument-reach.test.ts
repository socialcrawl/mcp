import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ZodObject, ZodRawShape } from "zod";

/**
 * Every argument a tool declares must reach its handler. The tool modules are
 * replaced with spies so the only thing under test is the wiring in
 * `server.ts` — the layer that silently dropped `hydrating`.
 */

const { received, spy, structuredSpy } = vi.hoisted(() => {
  const received = { args: undefined as unknown };
  const spy = (name: string) =>
    vi.fn((...args: unknown[]) => {
      received.args = args;
      return `ok:${name}`;
    });
  // Tools that declare an outputSchema return text plus a structured twin.
  const structuredSpy = (name: string) => {
    const inner = spy(name);
    return vi.fn((...args: unknown[]) => ({ text: inner(...args), structured: { ok: true } }));
  };
  return { received, spy, structuredSpy };
});

vi.mock("../tools/list-platforms.js", () => ({ listPlatforms: spy("list_platforms") }));
vi.mock("../tools/list-endpoints.js", () => ({ listEndpoints: spy("list_endpoints") }));
vi.mock("../tools/request.js", () => ({ requestStructured: structuredSpy("request") }));
vi.mock("../tools/collect.js", () => ({ collectStructured: structuredSpy("collect") }));
vi.mock("../tools/check-balance.js", () => ({ checkBalanceStructured: structuredSpy("check_balance") }));
vi.mock("../tools/monitors.js", () => ({ monitors: spy("monitors") }));
vi.mock("../tools/web.js", () => ({ web: spy("web") }));
vi.mock("../tools/cohorts.js", () => ({ cohorts: spy("cohorts") }));
vi.mock("../tools/get-docs.js", () => ({ getDocs: spy("get_docs") }));
vi.mock("../tools/pricing.js", () => ({ pricingStructured: structuredSpy("pricing") }));
vi.mock("../tools/discover.js", () => ({ discover: spy("discover") }));
vi.mock("../tools/find.js", () => ({ findStructured: structuredSpy("find") }));
vi.mock("../tools/endpoint.js", () => ({ endpointStructured: structuredSpy("endpoint") }));
vi.mock("../tools/estimate.js", () => ({ estimateStructured: structuredSpy("estimate") }));
vi.mock("../tools/account.js", () => ({ accountStructured: structuredSpy("account") }));
vi.mock("../tools/manage.js", () => ({ manage: structuredSpy("manage") }));

import { createServer } from "../server.js";
import * as S from "../schemas/tools.js";

type Case = {
  tool: string;
  schema: ZodObject<ZodRawShape>;
  /** Arguments every call needs to satisfy the schema on its own. */
  base?: Record<string, unknown>;
  /** One valid sentinel per declared argument. */
  sentinels: Record<string, unknown>;
  /** Normalise the handler's call args into a { argument: value } record. */
  seen: (args: unknown[]) => Record<string, unknown>;
  /** Registered only with SOCIALCRAWL_LEGACY_TOOLS. */
  legacy?: boolean;
};

const asObject = (args: unknown[]) => args[args.length - 1] as Record<string, unknown>;

const CASES: Case[] = [
  {
    tool: "socialcrawl_find",
    schema: S.FindInputSchema,
    sentinels: { task: "sentinel task", platform: "tiktok", limit: 4 },
    seen: asObject,
  },
  {
    tool: "socialcrawl_endpoint",
    schema: S.EndpointInputSchema,
    base: { id: "tiktok/profile" },
    sentinels: { id: "tiktok/sentinel", method: "POST", page: 2 },
    seen: asObject,
  },
  {
    tool: "socialcrawl_estimate",
    schema: S.EstimateInputSchema,
    sentinels: {
      id: "tiktok/post/comments",
      method: "POST",
      params: { url: "https://x.test/1", limit: 20, label: ["spam", "toxic"] },
      body: { ids: ["a"] },
      calls: 30,
      items: 500,
      plan: [{ id: "tiktok/profile", params: { handle: "a" }, repeat: 3 }],
    },
    seen: asObject,
  },
  {
    tool: "socialcrawl_account",
    schema: S.AccountInputSchema,
    sentinels: { view: "transactions", limit: 7, cursor: "cur", request_id: "req-1" },
    seen: asObject,
  },
  {
    tool: "socialcrawl_manage",
    schema: S.ManageInputSchema,
    base: { area: "monitors", action: "list" },
    sentinels: { area: "web", action: "sentinel_action", id: "id_1", input: { url: "https://x.test" }, idempotencyKey: "0123456789abcdef-sentinel", dry_run: true },
    seen: asObject,
  },
  { tool: "socialcrawl_list_platforms", schema: S.ListPlatformsInputSchema, sentinels: {}, seen: asObject, legacy: true },
  {
    legacy: true,
    tool: "socialcrawl_list_endpoints",
    schema: S.ListEndpointsInputSchema,
    sentinels: {
      platform: "tiktok",
      search: "sentinel",
      method: "POST",
      maxCost: 7,
      hydrating: true,
      detail: "compact",
      page: 3,
    },
    seen: asObject,
  },
  {
    tool: "socialcrawl_request",
    schema: S.RequestInputSchema,
    base: { platform: "tiktok", resource: "profile" },
    sentinels: {
      platform: "tiktok",
      resource: "sentinel",
      method: "POST",
      params: { a: "b", n: 1, flag: true },
      body: { x: 1 },
      idempotencyKey: "0123456789abcdef-sentinel",
      fields: "id,author.username",
      max_items: 5,
      format: "csv",
      max_credits: 12,
      confirm: true,
    },
    seen: asObject,
  },
  {
    tool: "socialcrawl_collect",
    schema: S.CollectInputSchema,
    base: { id: "tiktok/post/comments", items: 5 },
    sentinels: {
      id: "tiktok/post/comments",
      params: { url: "https://x.test/1", n: 2 },
      items: 40,
      max_credits: 15,
      format: "csv",
      confirm: true,
      fields: "id,text",
      result_id: "res-sentinel",
      offset: 3,
      limit: 9,
    },
    seen: asObject,
  },
  {
    legacy: true,
    tool: "socialcrawl_check_balance",
    schema: S.CheckBalanceInputSchema,
    sentinels: { view: "transactions", limit: 7, cursor: "cur", requestId: "req-1" },
    seen: asObject,
  },
  {
    legacy: true,
    tool: "socialcrawl_get_docs",
    schema: S.GetDocsInputSchema,
    sentinels: { topic: "pricing", page: 4 },
    // getDocs(topic, page) is positional.
    seen: (args) => ({ topic: args[0], page: args[1] }),
  },
];

async function connect(legacyTools = false): Promise<Client> {
  const server = createServer({ apiKey: "sc_test_key_1234567890", baseUrl: "https://www.socialcrawl.dev" }, { legacyTools });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  const client = new Client({ name: "reach", version: "0.0.0" });
  await client.connect(c);
  return client;
}

beforeEach(() => {
  received.args = undefined;
});

describe("every declared argument reaches its handler", () => {
  for (const c of CASES) {
    const keys = Object.keys(c.schema.shape);
    it(`${c.tool} has a sentinel for every schema key`, () => {
      expect(Object.keys(c.sentinels).sort()).toEqual([...keys].sort());
    });
    for (const key of keys) {
      it(`${c.tool}.${key}`, async () => {
        const single = { ...c.base, [key]: c.sentinels[key] };
        expect(c.schema.safeParse(single).success).toBe(true);
        const client = await connect(c.legacy === true);
        const result = await client.callTool({ name: c.tool, arguments: single });
        expect(result.isError).toBeFalsy();
        expect(c.seen(received.args as unknown[])[key]).toEqual(c.sentinels[key]);
        await client.close();
      });
    }
  }

  // The remaining tools hand the whole parsed object to the handler, so a
  // dropped key is impossible by construction; assert it stays that way.
  for (const [tool, schema] of [
    ["socialcrawl_monitors", S.MonitorsInputSchema],
    ["socialcrawl_web", S.WebInputSchema],
    ["socialcrawl_cohorts", S.CohortsInputSchema],
    ["socialcrawl_pricing", S.PricingInputSchema],
    ["socialcrawl_discover", S.DiscoverInputSchema],
  ] as const) {
    it(`${tool} forwards the whole argument object`, async () => {
      const client = await connect(true);
      const shape = (schema as ZodObject<ZodRawShape>).shape;
      const args: Record<string, unknown> = {};
      // First enum-ish key we can fill generically: use `action` when present.
      if ("action" in shape) {
        const field = shape.action as unknown as { options?: string[]; unwrap?: () => { options: string[] } };
        args.action = (field.options ?? field.unwrap!().options)[0];
      }
      await client.callTool({ name: tool, arguments: args });
      const got = asObject(received.args as unknown[]);
      for (const [k, v] of Object.entries(args)) expect(got[k]).toEqual(v);
      await client.close();
    });
  }
});
