import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { CHARACTER_LIMIT } from "../constants.js";
import { flattenRows, toCsv } from "../format/csv.js";
import { projectValue } from "../format/fields.js";
import type { ApiContext } from "../context.js";

const KEYED: ApiContext = { apiKey: "sc_test_key_1234567890", baseUrl: "https://www.socialcrawl.dev" };
const OTHER: ApiContext = { apiKey: "sc_other_key_0987654321", baseUrl: "https://www.socialcrawl.dev" };

function igRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `post_${i}`,
    url: `https://instagram.com/p/${i}`,
    text: `caption ${i} ${"lorem ipsum ".repeat(40)}`,
    author: { username: `user${i}`, followers: 1000 + i, bio: "x".repeat(80) },
    published_at: "2026-01-01T00:00:00Z",
    engagement: { likes: i, comments: i * 2, views: i * 10 },
    media: { thumbnail: `https://cdn.example/${i}.jpg`, tags: ["a", "b"] },
  }));
}

function envelope(rows: unknown[], extra: Record<string, unknown> = {}) {
  return {
    success: true,
    data: { items: rows, pagination: { has_more: true, next_cursor: "c2" } },
    credits_used: 1,
    credits_remaining: 99,
    request_id: "req_abc123",
    cached: false,
    ...extra,
  };
}

function stub(payload: unknown) {
  const seen = { urls: [] as string[] };
  vi.stubGlobal("fetch", async (url: string) => {
    seen.urls.push(url);
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  return seen;
}

async function connect(ctx: ApiContext = KEYED): Promise<Client> {
  const server = createServer(ctx);
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  const client = new Client({ name: "shaping", version: "0.0.0" });
  await client.connect(c);
  return client;
}

type Content = Array<{ type: string; text?: string; uri?: string }>;
const textOf = (r: Record<string, unknown>) => (r.content as Content)[0].text as string;
const jsonOf = (text: string) => JSON.parse(/```json\n([\s\S]*)\n```/.exec(text)![1]);
const call = (client: Client, args: Record<string, unknown>) =>
  client.callTool({
    name: "socialcrawl_request",
    arguments: { platform: "instagram", resource: "profile/posts", params: { handle: "nasa" }, ...args },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("row-boundary truncation", () => {
  it("returns valid JSON under the budget for a 200-row page, with a resource link", async () => {
    stub(envelope(igRows(200)));
    const client = await connect();
    const r = await call(client, {});
    const text = textOf(r);
    expect(text).not.toMatch(/Response truncated at/);
    const parsed = jsonOf(text);
    const kept = parsed.data.items.length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(200);
    expect(text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(text).toContain(`rows 1–${kept} of 200 shown; full page stored as resource socialcrawl://results/req_abc123`);
    const link = (r.content as Content).find((c) => c.type === "resource_link");
    expect(link?.uri).toBe("socialcrawl://results/req_abc123");
    const sc = r.structuredContent as Record<string, unknown>;
    expect((sc.rows as unknown[]).length).toBe(kept);
    expect(JSON.stringify(sc).length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    await client.close();
  });

  it("resource read returns the full, unshaped body", async () => {
    stub(envelope(igRows(200)));
    const client = await connect();
    await call(client, {});
    const res = await client.readResource({ uri: "socialcrawl://results/req_abc123" });
    const full = JSON.parse((res.contents[0] as { text: string }).text);
    expect(full.data.items).toHaveLength(200);
    await client.close();
  });

  it("does not let another API key read the stored body", async () => {
    stub(envelope(igRows(200), { request_id: "req_private" }));
    const a = await connect(KEYED);
    await call(a, {});
    const b = await connect(OTHER);
    await expect(b.readResource({ uri: "socialcrawl://results/req_private" })).rejects.toThrow();
    await a.close();
    await b.close();
  });

  it("small pages are untouched: no link, no note", async () => {
    stub(envelope(igRows(3), { request_id: "req_small" }));
    const client = await connect();
    const r = await call(client, {});
    expect((r.content as Content).some((c) => c.type === "resource_link")).toBe(false);
    expect(jsonOf(textOf(r)).data.items).toHaveLength(3);
    expect(textOf(r)).not.toContain("shown;");
    await client.close();
  });

  it("max_items cuts at N rows and links the full page", async () => {
    stub(envelope(igRows(10), { request_id: "req_max" }));
    const client = await connect();
    const r = await call(client, { max_items: 4 });
    expect(jsonOf(textOf(r)).data.items).toHaveLength(4);
    expect(textOf(r)).toContain("rows 1–4 of 10 shown");
    expect((r.content as Content).find((c) => c.type === "resource_link")?.uri).toBe("socialcrawl://results/req_max");
    await client.close();
  });
});

describe("fields projection", () => {
  it("sends fields= to /v1", async () => {
    const seen = stub(envelope(igRows(2), { request_id: "req_f1" }));
    const client = await connect();
    await call(client, { fields: "id,author.username" });
    expect(new URL(seen.urls[0]).searchParams.get("fields")).toBe("id,author.username");
    await client.close();
  });

  it("projects locally when the response was not projected", async () => {
    stub(envelope(igRows(3), { request_id: "req_f2" }));
    const client = await connect();
    const r = await call(client, { fields: "id,author.username,engagement.*" });
    const rows = jsonOf(textOf(r)).data.items;
    // Identity (id, url) is never projected away.
    expect(rows[0]).toEqual({
      id: "post_0",
      url: "https://instagram.com/p/0",
      author: { username: "user0" },
      engagement: { likes: 0, comments: 0, views: 0 },
    });
    await client.close();
  });

  it("does not re-project an already projected response", async () => {
    stub(envelope([{ id: "a", author: { username: "u" } }], { request_id: "req_f3" }));
    const client = await connect();
    const r = await call(client, { fields: "id,author.username" });
    expect(jsonOf(textOf(r)).data.items).toEqual([{ id: "a", author: { username: "u" } }]);
    await client.close();
  });

  it("projectValue handles arrays and missing paths", () => {
    expect(projectValue({ a: [{ b: 1, c: 2 }], d: 3 }, ["a.b", "zz"])).toEqual({ a: [{ b: 1 }] });
  });

  it("does not flag fields as a dropped unknown param", async () => {
    stub(envelope(igRows(1), { request_id: "req_f4" }));
    const client = await connect();
    const r = await call(client, { fields: "id" });
    expect(textOf(r)).not.toMatch(/`fields`.*not declared/);
    await client.close();
  });
});

describe("format", () => {
  it("csv has a stable canonical header and one line per row", async () => {
    stub(envelope(igRows(3), { request_id: "req_csv" }));
    const client = await connect();
    const r = await call(client, { format: "csv" });
    const csv = /```csv\n([\s\S]*)\n```/.exec(textOf(r))![1];
    const lines = csv.split("\n");
    expect(lines).toHaveLength(4);
    const header = lines[0].split(",");
    expect(header.slice(0, 7)).toEqual([
      "id", "url", "text", "author.username", "published_at", "engagement.comments", "engagement.likes",
    ]);
    expect(header).toContain("engagement.views");
    expect(header).toContain("author.followers");
    expect(header).not.toContain("media.tags[]");
    await client.close();
  });

  it("csv truncates at a row boundary and links the full body", async () => {
    stub(envelope(igRows(200), { request_id: "req_csv2" }));
    const client = await connect();
    const r = await call(client, { format: "csv" });
    expect(textOf(r).length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(textOf(r)).toMatch(/rows 1–\d+ of 200 shown/);
    expect((r.content as Content).some((c) => c.type === "resource_link")).toBe(true);
    await client.close();
  });

  it("summary returns counts, columns and a few sample rows, not the page", async () => {
    stub(envelope(igRows(50), { request_id: "req_sum" }));
    const client = await connect();
    const r = await call(client, { format: "summary" });
    const sc = r.structuredContent as { summary: { rows: number; columns: string[]; sample: unknown[] }; rows?: unknown[] };
    expect(sc.summary.rows).toBe(50);
    expect(sc.summary.columns).toContain("engagement.likes");
    expect(sc.summary.sample.length).toBeLessThanOrEqual(3);
    expect(sc.rows).toBeUndefined();
    expect(textOf(r).length).toBeLessThan(6000);
    await client.close();
  });

  it("csv escapes commas, quotes and newlines", () => {
    const csv = toCsv(flattenRows([{ id: "1", text: 'a,"b"\nc' }]));
    expect(csv).toBe('id,text\n1,"a,""b""\nc"');
  });
});

describe("single object bigger than the budget", () => {
  it("stays valid JSON, naming omitted keys", async () => {
    stub({
      success: true,
      data: { id: "x", bio: "short", blob: "y".repeat(CHARACTER_LIMIT * 2), tail: 1 },
      credits_used: 1,
      credits_remaining: 9,
      request_id: "req_obj",
    });
    const client = await connect();
    const r = await call(client, {});
    const parsed = jsonOf(textOf(r));
    expect(parsed.data.id).toBe("x");
    expect(textOf(r).length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(textOf(r)).toContain("socialcrawl://results/req_obj");
    await client.close();
  });
});

describe("fix round 1", () => {
  it("csv keeps paging in structuredContent and the summary line", async () => {
    stub(envelope(igRows(3), { request_id: "req_pg1" }));
    const client = await connect();
    const r = await call(client, { format: "csv" });
    const sc = r.structuredContent as Record<string, unknown>;
    expect(sc.paging).toEqual({ has_more: true, next_cursor: "c2" });
    expect(sc.rows).toBeUndefined();
    expect(textOf(r)).toContain("has_more true");
    await client.close();
  });

  it("summary keeps paging", async () => {
    stub(envelope(igRows(3), { request_id: "req_pg2" }));
    const client = await connect();
    const r = await call(client, { format: "summary" });
    const sc = r.structuredContent as Record<string, unknown>;
    expect(sc.paging).toEqual({ has_more: true, next_cursor: "c2" });
    expect(sc.rows).toBeUndefined();
    expect(textOf(r)).toContain("has_more true");
    expect(textOf(r)).toContain("c2");
    await client.close();
  });

  it("bounds a 100k non-JSON 2xx body, stores it, and links it", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>" + "x".repeat(100_000) + "</html>", { status: 200 }));
    const client = await connect();
    const r = await call(client, {});
    expect(textOf(r).length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(textOf(r)).toContain("socialcrawl://results/");
    const link = (r.content as Content).find((c) => c.type === "resource_link");
    expect(link).toBeDefined();
    const res = await client.readResource({ uri: link!.uri! });
    expect((res.contents[0] as { text: string }).text.length).toBe(100_000 + 13);
    await client.close();
  });

  it("csv text is the full table; structuredContent carries csv_rows, not the csv", async () => {
    stub(envelope(igRows(3), { request_id: "req_c3" }));
    const client = await connect();
    const r = await call(client, { format: "csv" });
    const sc = r.structuredContent as Record<string, unknown>;
    expect(sc.csv).toBeUndefined();
    expect(sc.csv_rows).toBe(3);
    await client.close();
  });

  it("neutralises formula-leading strings but not numbers", () => {
    const csv = toCsv(flattenRows([{ id: "1", text: "=SUM(A1)", a: "@x", b: "-1+2", c: "\tz", n: -5 }]));
    const cells = csv.split("\n")[1];
    expect(cells).toContain("'=SUM(A1)");
    expect(cells).toContain("'@x");
    expect(cells).toContain("'-1+2");
    expect(cells).toContain("'\tz");
    expect(cells.split(",").pop()).toBe("-5");
  });

  it("keeps a huge page-level block within budget as valid JSON", async () => {
    stub({
      success: true,
      data: { items: igRows(2), scan: { blob: "z".repeat(CHARACTER_LIMIT * 2) }, pagination: { has_more: false } },
      credits_used: 1,
      credits_remaining: 9,
      request_id: "req_bigbase",
    });
    const client = await connect();
    const r = await call(client, {});
    expect(textOf(r).length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(() => jsonOf(textOf(r))).not.toThrow();
    expect(textOf(r)).toContain("socialcrawl://results/req_bigbase");
    await client.close();
  });

  it("bounds an oversized string data field", async () => {
    stub({ success: true, data: "q".repeat(CHARACTER_LIMIT * 2), credits_used: 1, request_id: "req_str" });
    const client = await connect();
    const r = await call(client, {});
    expect(textOf(r).length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(() => jsonOf(textOf(r))).not.toThrow();
    expect(textOf(r)).toContain("socialcrawl://results/req_str");
    await client.close();
  });

  it("rejects a malformed resource uri with InvalidParams, not a crash", async () => {
    const client = await connect();
    await expect(client.readResource({ uri: "socialcrawl://results/%E0%A4%A" })).rejects.toThrow(/-32602|Invalid|stored/i);
    await client.close();
  });
});

describe("results store limits", () => {
  it("counts bytes and refuses a single entry over the cap", async () => {
    const { ResultsStore } = await import("../results-store.js");
    const s = new ResultsStore();
    expect(s.put("a", "big", "€".repeat(12 * 1024 * 1024))).toBe(false);
    expect(s.get("a", "big")).toBeUndefined();
    expect(s.put("a", "ok", "small")).toBe(true);
  });
});
