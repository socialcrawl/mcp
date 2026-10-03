import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../server.js";
import { resetSessionSpend, sessionTotal, recordSpend, confirmThreshold } from "../session-spend.js";
import type { ApiContext } from "../context.js";

/**
 * MCP-07 `socialcrawl_collect` and MCP-08 cost guard, driven over a real
 * client with a fake fetch. Nothing here touches the network.
 */

const KEYED: ApiContext = { apiKey: "sc_test_key_1234567890", baseUrl: "https://www.socialcrawl.dev" };
const COMMENTS = "tiktok/post/comments";
const URL_PARAM = { url: "https://www.tiktok.com/@a/video/1" };
/** Declares a page size, so the walk projects pages the way a real call would. */
const PAGED = { ...URL_PARAM, limit: 3 };

interface Page {
  ids?: string[];
  more?: boolean;
  used?: number;
  status?: number;
}

/** The comments endpoint declares `cursor` as an integer, so cursors here are numeric strings.
 * Serves `pages` in order for /v1 calls; utility/estimate is 404 unless `estimate` is given. */
function fakeApi(pages: Page[], estimate?: { status: number; body: unknown }) {
  const seen = { estimate: [] as string[], pages: [] as string[] };
  let i = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.includes("/v1/utility/estimate")) {
      seen.estimate.push(url);
      const e = estimate ?? { status: 404, body: { success: false, error: { type: "ENDPOINT_NOT_FOUND", message: "not found" } } };
      return new Response(JSON.stringify(e.body), { status: e.status });
    }
    seen.pages.push(url);
    const p = pages[Math.min(i, pages.length - 1)];
    i++;
    if (p.status && p.status !== 200) {
      return new Response(
        JSON.stringify({ success: false, error: { type: "INSUFFICIENT_CREDITS", message: "out of credits" }, credits_remaining: 0 }),
        { status: p.status },
      );
    }
    const items = (p.ids ?? []).map((id) => ({ id, text: `row ${id}` }));
    return new Response(
      JSON.stringify({
        success: true,
        data: { items, pagination: { has_more: p.more ?? false, next_cursor: p.more ? String(i * 10) : null } },
        credits_used: p.used ?? 1,
        credits_remaining: 90,
        request_id: `req-${i}`,
      }),
      { status: 200 },
    );
  });
  return seen;
}

async function connect(ctx: ApiContext = KEYED, withElicit?: (msg: string) => "accept" | "decline"): Promise<{ client: Client; elicited: string[] }> {
  const server = createServer(ctx);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const elicited: string[] = [];
  const client = new Client(
    { name: "collect-test", version: "0.0.0" },
    withElicit ? { capabilities: { elicitation: { form: {} } } } : undefined,
  );
  if (withElicit) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      elicited.push(req.params.message);
      const action = withElicit(req.params.message);
      return action === "accept" ? { action, content: { confirm: true } } : { action };
    });
  }
  await client.connect(ct);
  return { client, elicited };
}

const text = (r: Record<string, unknown>): string => (r.content as Array<{ text: string }>)[0].text;
const structured = (r: Record<string, unknown>): Record<string, any> => r.structuredContent as Record<string, any>;

async function readResource(client: Client, r: Record<string, unknown>): Promise<string> {
  const link = (r.content as Array<{ type: string; uri?: string }>).find((c) => c.type === "resource_link");
  expect(link, "resource_link").toBeDefined();
  const res = await client.readResource({ uri: link!.uri! });
  return (res.contents[0] as { text: string }).text;
}

const savedEnv = process.env.SOCIALCRAWL_CONFIRM_ABOVE;
beforeEach(() => {
  resetSessionSpend();
  delete process.env.SOCIALCRAWL_CONFIRM_ABOVE;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (savedEnv === undefined) delete process.env.SOCIALCRAWL_CONFIRM_ABOVE;
  else process.env.SOCIALCRAWL_CONFIRM_ABOVE = savedEnv;
});

describe("session spend tally", () => {
  it("accumulates per key and resets", () => {
    expect(sessionTotal("k1")).toBe(0);
    expect(recordSpend("k1", 3)).toBe(3);
    expect(recordSpend("k1", 2)).toBe(5);
    expect(sessionTotal("k2")).toBe(0);
    recordSpend("k1", Number.NaN);
    recordSpend("k1", -4);
    expect(sessionTotal("k1")).toBe(5);
    resetSessionSpend();
    expect(sessionTotal("k1")).toBe(0);
  });

  it("confirmThreshold defaults to 100 and reads SOCIALCRAWL_CONFIRM_ABOVE", () => {
    expect(confirmThreshold()).toBe(100);
    process.env.SOCIALCRAWL_CONFIRM_ABOVE = "25";
    expect(confirmThreshold()).toBe(25);
    process.env.SOCIALCRAWL_CONFIRM_ABOVE = "nonsense";
    expect(confirmThreshold()).toBe(100);
  });

  it("session_total rises in request results and shows in the account tool", async () => {
    fakeApi([{ ids: ["a"], used: 1 }, { ids: ["b"], used: 2 }]);
    const { client } = await connect();
    const args = { platform: "tiktok", resource: "post/comments", params: URL_PARAM };
    const r1 = await client.callTool({ name: "socialcrawl_request", arguments: args });
    expect(structured(r1).credits.session_total).toBe(1);
    const r2 = await client.callTool({ name: "socialcrawl_request", arguments: args });
    expect(structured(r2).credits.used).toBe(2);
    expect(structured(r2).credits.session_total).toBe(3);

    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true, data: { balance: 90 } }), { status: 200 }));
    const bal = await client.callTool({ name: "socialcrawl_account", arguments: {} });
    expect(structured(bal).credits.session_total).toBe(3);
    await client.close();
  });
});

describe("socialcrawl_collect walk", () => {
  it("stops at N items, passing the cursor each page, and stores JSONL", async () => {
    const seen = fakeApi([
      { ids: ["a", "b", "c"], more: true },
      { ids: ["d", "e", "f"], more: true },
      { ids: ["g", "h", "i"], more: true },
    ]);
    const { client } = await connect();
    const r = await client.callTool({ name: "socialcrawl_collect", arguments: { id: COMMENTS, params: PAGED, items: 7 } });
    expect(r.isError).toBeFalsy();
    expect(seen.pages).toHaveLength(3);
    expect(new URL(seen.pages[0]).searchParams.get("cursor")).toBeNull();
    expect(new URL(seen.pages[1]).searchParams.get("cursor")).toBe("10");
    expect(new URL(seen.pages[2]).searchParams.get("cursor")).toBe("20");
    const s = structured(r);
    expect(s).toMatchObject({ ok: true, endpoint: COMMENTS, stop_reason: "items", format: "jsonl" });
    expect(s.items).toMatchObject({ collected: 7, requested: 7 });
    expect(s.pages).toBe(3);
    expect(s.credits.used).toBe(3);
    expect(s.credits.session_total).toBe(3);
    const body = await readResource(client, r);
    const lines = body.trim().split("\n");
    expect(lines).toHaveLength(7);
    expect(JSON.parse(lines[0]).id).toBe("a");
    expect(s.paging.has_more).toBe(true);
    await client.close();
  });

  it("stops when has_more is false", async () => {
    const seen = fakeApi([{ ids: ["a", "b"], more: true }, { ids: ["c"], more: false }]);
    const { client } = await connect();
    const r = await client.callTool({ name: "socialcrawl_collect", arguments: { id: COMMENTS, params: PAGED, items: 50 } });
    expect(seen.pages).toHaveLength(2);
    expect(structured(r)).toMatchObject({ ok: true, stop_reason: "exhausted" });
    expect(structured(r).items.collected).toBe(3);
    expect(structured(r).paging.has_more).toBe(false);
    await client.close();
  });

  it("dedupes rows by id across pages", async () => {
    fakeApi([{ ids: ["a", "b"], more: true }, { ids: ["b", "c"], more: false }]);
    const { client } = await connect();
    const r = await client.callTool({ name: "socialcrawl_collect", arguments: { id: COMMENTS, params: PAGED, items: 10 } });
    expect(structured(r).items.collected).toBe(3);
    expect(structured(r).items.duplicates).toBe(1);
    const ids = (await readResource(client, r)).trim().split("\n").map((l) => JSON.parse(l).id);
    expect(ids).toEqual(["a", "b", "c"]);
    await client.close();
  });

  it("stops when a page adds nothing new (cursor loop)", async () => {
    const seen = fakeApi([{ ids: ["a"], more: true }, { ids: ["a"], more: true }, { ids: ["a"], more: true }]);
    const { client } = await connect();
    const r = await client.callTool({ name: "socialcrawl_collect", arguments: { id: COMMENTS, params: PAGED, items: 10 } });
    expect(seen.pages).toHaveLength(2);
    expect(structured(r).stop_reason).toBe("no_new_rows");
    await client.close();
  });

  it("stops at max_credits and returns the cursor to resume", async () => {
    const seen = fakeApi([{ ids: ["a"], more: true }, { ids: ["b"], more: true }, { ids: ["c"], more: true }]);
    const { client } = await connect();
    const r = await client.callTool({
      name: "socialcrawl_collect",
      arguments: { id: COMMENTS, params: PAGED, items: 100, max_credits: 2 },
    });
    // A plain page holds 1 credit, so two pages fit in 2 and a third would not.
    expect(seen.pages).toHaveLength(2);
    expect(structured(r)).toMatchObject({ ok: true, stop_reason: "budget" });
    expect(structured(r).credits.used).toBe(2);
    expect(structured(r).paging).toMatchObject({ has_more: true, next_cursor: "20" });
    await client.close();
  });

  it("stops on 402 and keeps what it collected", async () => {
    fakeApi([{ ids: ["a", "b"], more: true }, { status: 402 }]);
    const { client } = await connect();
    const r = await client.callTool({ name: "socialcrawl_collect", arguments: { id: COMMENTS, params: PAGED, items: 10 } });
    expect(r.isError).toBeFalsy();
    expect(structured(r)).toMatchObject({ ok: true, stop_reason: "insufficient_credits" });
    expect(structured(r).items.collected).toBe(2);
    expect(structured(r).warnings.join(" ")).toMatch(/402|credits/i);
    await client.close();
  });

  it("without max_credits, short pages stop at the projected exposure instead of walking on", async () => {
    // items 6, page size 3 -> projected 2 pages x 1cr = 2cr; pages return 1 row each.
    const seen = fakeApi([{ ids: ["a"], more: true }, { ids: ["b"], more: true }, { ids: ["c"], more: true }, { ids: ["d"], more: true }]);
    const { client } = await connect();
    const r = await client.callTool({ name: "socialcrawl_collect", arguments: { id: COMMENTS, params: PAGED, items: 6 } });
    expect(seen.pages).toHaveLength(2);
    expect(structured(r).stop_reason).toBe("budget");
    expect(structured(r).credits.used).toBe(2);
    expect(structured(r).warnings.join(" ")).toMatch(/max_credits|confirm/);
    expect(structured(r).paging.next_cursor).toBe("20");
    await client.close();
  });

  it("respects the confirmed amount as the budget", async () => {
    process.env.SOCIALCRAWL_CONFIRM_ABOVE = "2";
    // items 12, page size 3 -> projected 4 pages = 4cr, above the threshold; confirmed at 4.
    const seen = fakeApi([{ ids: ["a"], more: true }, { ids: ["b"], more: true }, { ids: ["c"], more: true }, { ids: ["d"], more: true }, { ids: ["e"], more: true }, { ids: ["f"], more: true }]);
    const { client } = await connect();
    const r = await client.callTool({ name: "socialcrawl_collect", arguments: { id: COMMENTS, params: PAGED, items: 12, confirm: true } });
    expect(seen.pages).toHaveLength(4);
    expect(structured(r).stop_reason).toBe("budget");
    await client.close();
  });

  it("counts the hold when a page reports no credits_used", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n++;
      return new Response(
        JSON.stringify({ success: true, data: { items: [{ id: `r${n}` }], pagination: { has_more: true, next_cursor: String(n * 10) } } }),
        { status: 200 },
      );
    });
    const { client } = await connect();
    const r = await client.callTool({ name: "socialcrawl_collect", arguments: { id: COMMENTS, params: PAGED, items: 50, max_credits: 3 } });
    expect(n).toBe(3);
    expect(structured(r).stop_reason).toBe("budget");
    expect(structured(r).credits.used).toBe(3);
    expect(structured(r).credits.estimated).toBe(true);
    expect(structured(r).credits.session_total).toBe(3);
    await client.close();
  });

  it("counts the hold for a billed page whose body is not JSON", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n++;
      return new Response("<html>oops</html>", { status: 200 });
    });
    const { client } = await connect();
    const r = await client.callTool({ name: "socialcrawl_request", arguments: { platform: "tiktok", resource: "post/comments", params: URL_PARAM } });
    expect(structured(r).credits.session_total).toBe(1);
    expect(structured(r).credits.estimated).toBe(true);
    const c = await client.callTool({ name: "socialcrawl_collect", arguments: { id: COMMENTS, params: PAGED, items: 5 } });
    expect(structured(c).credits.used).toBe(1);
    expect(structured(c).credits.estimated).toBe(true);
    expect(structured(c).stop_reason).toBe("error");
    await client.close();
  });

  it("supports csv output", async () => {
    fakeApi([{ ids: ["a", "b"], more: false }]);
    const { client } = await connect();
    const r = await client.callTool({ name: "socialcrawl_collect", arguments: { id: COMMENTS, params: PAGED, items: 5, format: "csv" } });
    expect(structured(r).format).toBe("csv");
    const body = await readResource(client, r);
    expect(body.split("\n")[0]).toMatch(/^id,/);
    expect(body.trim().split("\n")).toHaveLength(3);
    await client.close();
  });

  it("rejects an endpoint that does not page, and a malformed id, without calling the API", async () => {
    const seen = fakeApi([{ ids: ["a"] }]);
    const { client } = await connect();
    const a = await client.callTool({ name: "socialcrawl_collect", arguments: { id: "tiktok/profile", params: { handle: "x" }, items: 5 } });
    expect(a.isError).toBe(true);
    expect(text(a)).toMatch(/does not paginate|cannot be walked/);
    const b = await client.callTool({ name: "socialcrawl_collect", arguments: { id: "nonsense", items: 5 } });
    expect(b.isError).toBe(true);
    expect(seen.pages).toHaveLength(0);
    await client.close();
  });
});

describe("cost guard: max_credits", () => {
  it("collect refuses before any page when the quoted hold exceeds max_credits", async () => {
    const seen = fakeApi([{ ids: ["a"] }]);
    const { client } = await connect();
    const r = await client.callTool({
      name: "socialcrawl_collect",
      arguments: { id: "tiktok/search", params: { query: "x", limit: 120 }, items: 50, max_credits: 10 },
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/exceeds max_credits/);
    expect(text(r)).toMatch(/No credits were charged/);
    expect(structured(r).code).toBe("OVER_MAX_CREDITS");
    expect(seen.pages).toHaveLength(0);
    await client.close();
  });

  it("request refuses locally and does not bill", async () => {
    const seen = fakeApi([{ ids: ["a"] }]);
    const { client } = await connect();
    const r = await client.callTool({
      name: "socialcrawl_request",
      arguments: { platform: "linkedin", resource: "profile/posts", params: { url: "https://www.linkedin.com/in/williamhgates/", limit: 80 }, max_credits: 20 },
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/exceeds max_credits/);
    expect(seen.pages).toHaveLength(0);
    await client.close();
  });

  it("uses utility/estimate when it exists, and falls back to the local quote on 404", async () => {
    // Estimate says 8, under max_credits 10: proceeds although the local ceiling is 42.
    const seen = fakeApi([{ ids: ["a"], more: false }], { status: 200, body: { success: true, data: { ok: true, valid: true, hold: 8 } } });
    const { client } = await connect();
    const ok = await client.callTool({
      name: "socialcrawl_collect",
      arguments: { id: "tiktok/search", params: { query: "x", limit: 120 }, items: 1, max_credits: 10 },
    });
    expect(ok.isError).toBeFalsy();
    expect(seen.estimate).toHaveLength(1);
    expect(seen.pages).toHaveLength(1);
    await client.close();
  });

  it("a cheap call never spends a round trip on the estimate", async () => {
    const seen = fakeApi([{ ids: ["a"], more: false }]);
    const { client } = await connect();
    await client.callTool({ name: "socialcrawl_request", arguments: { platform: "tiktok", resource: "profile", params: { handle: "x" }, max_credits: 50 } });
    expect(seen.estimate).toHaveLength(0);
    await client.close();
  });
});

describe("cost guard: confirmation above the threshold", () => {
  const dear = { platform: "linkedin", resource: "profile/posts", params: { url: "https://www.linkedin.com/in/williamhgates/", limit: 80 } };

  it("a call quoted at 200 with the threshold at 100 never bills without confirmation (no elicitation)", async () => {
    const seen = fakeApi([{ ids: ["a"] }]);
    const { client } = await connect();
    const r = await client.callTool({ name: "socialcrawl_request", arguments: dear });
    expect(seen.pages).toHaveLength(0);
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/confirm: true/);
    expect(text(r)).toMatch(/200/);
    expect(structured(r)).toMatchObject({ ok: false, code: "CONFIRMATION_REQUIRED", retryable: false });
    expect(structured(r).credits.quoted_max).toBe(200);
    expect(sessionTotal(KEYED.apiKey)).toBe(0);
    await client.close();
  });

  it("confirm:true bills", async () => {
    const seen = fakeApi([{ ids: ["a"], used: 10 }]);
    const { client } = await connect();
    const r = await client.callTool({ name: "socialcrawl_request", arguments: { ...dear, confirm: true } });
    expect(seen.pages).toHaveLength(1);
    expect(structured(r).ok).toBe(true);
    expect(structured(r).credits.session_total).toBe(10);
    await client.close();
  });

  it("honours SOCIALCRAWL_CONFIRM_ABOVE", async () => {
    process.env.SOCIALCRAWL_CONFIRM_ABOVE = "500";
    const seen = fakeApi([{ ids: ["a"], used: 10 }]);
    const { client } = await connect();
    const r = await client.callTool({ name: "socialcrawl_request", arguments: dear });
    expect(seen.pages).toHaveLength(1);
    expect(structured(r).ok).toBe(true);
    await client.close();
  });

  it("elicits when the client supports it: accept bills", async () => {
    const seen = fakeApi([{ ids: ["a"], used: 10 }]);
    const { client, elicited } = await connect(KEYED, () => "accept");
    const r = await client.callTool({ name: "socialcrawl_request", arguments: dear });
    expect(elicited).toHaveLength(1);
    expect(elicited[0]).toMatch(/200/);
    expect(seen.pages).toHaveLength(1);
    expect(structured(r).ok).toBe(true);
    await client.close();
  });

  it("elicits when the client supports it: decline does not bill", async () => {
    const seen = fakeApi([{ ids: ["a"] }]);
    const { client, elicited } = await connect(KEYED, () => "decline");
    const r = await client.callTool({ name: "socialcrawl_request", arguments: dear });
    expect(elicited).toHaveLength(1);
    expect(seen.pages).toHaveLength(0);
    expect(text(r)).toMatch(/not confirmed|declined/i);
    expect(structured(r).code).toBe("CONFIRMATION_REQUIRED");
    await client.close();
  });

  it("collect asks once for the whole walk, then walks without re-asking", async () => {
    const seen = fakeApi([{ ids: ["a"], more: true }, { ids: ["b"], more: false }]);
    process.env.SOCIALCRAWL_CONFIRM_ABOVE = "2";
    const { client, elicited } = await connect(KEYED, () => "accept");
    const r = await client.callTool({ name: "socialcrawl_collect", arguments: { id: COMMENTS, params: PAGED, items: 50 } });
    expect(elicited).toHaveLength(1);
    expect(seen.pages).toHaveLength(2);
    expect(structured(r).ok).toBe(true);
    await client.close();
  });

  it("collect without elicitation returns the quote and bills nothing until confirm:true", async () => {
    const seen = fakeApi([{ ids: ["a"], more: false }]);
    process.env.SOCIALCRAWL_CONFIRM_ABOVE = "2";
    const { client } = await connect();
    const first = await client.callTool({ name: "socialcrawl_collect", arguments: { id: COMMENTS, params: PAGED, items: 50 } });
    expect(seen.pages).toHaveLength(0);
    expect(structured(first).code).toBe("CONFIRMATION_REQUIRED");
    const second = await client.callTool({ name: "socialcrawl_collect", arguments: { id: COMMENTS, params: PAGED, items: 50, confirm: true } });
    expect(seen.pages).toHaveLength(1);
    expect(structured(second).ok).toBe(true);
    await client.close();
  });
});
