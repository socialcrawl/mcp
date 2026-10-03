import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { shapeEnvelope } from "../format/shape.js";
import { looksProjected, projectValue } from "../format/fields.js";
import { createServer } from "../server.js";

/**
 * Canonical rows are rooted (`{ comment: {...}, computed: {...} }`), so field
 * paths are root-qualified (`comment.text`). Uses the real redacted
 * tiktok/post/comments example response.
 */
const EXAMPLE = JSON.parse(readFileSync(new URL("./fixtures/tiktok.post-comments.json", import.meta.url), "utf8")) as Record<string, unknown>;
type Row = Record<string, Record<string, unknown>>;
const itemsOf = (env: Record<string, unknown>): Row[] => (env.data as { items: Row[] }).items;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("root-qualified fields on canonical rows", () => {
  it("keeps the requested leaves and the row's identity", () => {
    const r = shapeEnvelope(EXAMPLE, { fields: "comment.text,comment.engagement.likes", budget: 100_000 });
    const row = itemsOf(r.envelope)[0];
    expect(Object.keys(row)).toEqual(["comment"]);
    expect(row.comment.text).toBeTruthy();
    expect(row.comment.engagement).toEqual({ likes: expect.any(Number) });
    expect(row.comment.id).toBeTruthy();
    expect(r.warnings ?? []).toEqual([]);
  });

  it("never re-projects rows the API already projected (rooted or flat), and never strips id/url", () => {
    const rooted = { success: true, data: { items: [{ comment: { id: "1", url: null, text: "hi" } }] } };
    expect(itemsOf(shapeEnvelope(rooted, { fields: "comment.text", budget: 100_000 }).envelope)).toEqual([
      { comment: { id: "1", url: null, text: "hi" } },
    ]);
    const flat = { success: true, data: { items: [{ id: "1", url: "u", status: "done" }] } };
    expect(itemsOf(shapeEnvelope(flat, { fields: "status", budget: 100_000 }).envelope)).toEqual([{ id: "1", url: "u", status: "done" }]);
    expect(looksProjected([{ id: "1", url: "u", status: "done" }], ["status"])).toBe(true);
  });

  it("keeps a whole subtree named after one of its children", () => {
    expect(projectValue({ a: { b: 1, c: 2 } }, ["a.b", "a"])).toEqual({ a: { b: 1, c: 2 } });
  });

  it("warns, naming the row root, when unrooted paths match nothing", () => {
    const r = shapeEnvelope(EXAMPLE, { fields: "id,text,author.username", budget: 100_000 });
    expect(r.warnings?.[0]).toMatch(/matched nothing/);
    expect(r.warnings?.[0]).toContain("comment.text");
    expect(r.warnings?.[0]).toContain("socialcrawl_endpoint");
  });

  it("csv leads with the canonical columns of a rooted row", () => {
    const r = shapeEnvelope(EXAMPLE, { format: "csv", budget: 100_000 });
    const header = r.csv!.split("\n")[0].split(",");
    expect(header.slice(0, 7)).toEqual([
      "comment.id",
      "comment.url",
      "comment.text",
      "comment.author.username",
      "comment.published_at",
      "comment.engagement.likes",
      "comment.engagement.replies",
    ]);
  });

  it("summary computes engagement stats on rooted rows", () => {
    const r = shapeEnvelope(EXAMPLE, { format: "summary", budget: 100_000 });
    const stats = (r.summary as { engagement: Record<string, { n: number }> }).engagement;
    expect(stats["comment.engagement.likes"].n).toBe(2);
  });

  it("socialcrawl_request surfaces the empty-projection warning", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(EXAMPLE), { status: 200 }));
    const server = createServer({ apiKey: "sc_test_key_1234567890", baseUrl: "https://www.socialcrawl.dev" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: "f", version: "0" });
    await client.connect(a);
    const res = await client.callTool({
      name: "socialcrawl_request",
      arguments: { platform: "tiktok", resource: "post/comments", params: { url: "https://www.tiktok.com/@a/video/1" }, fields: "text" },
    });
    const warnings = (res.structuredContent as { warnings?: string[] }).warnings ?? [];
    expect(warnings.some((w) => w.includes("comment.text"))).toBe(true);
    await client.close();
  });
});

describe("fix round 2: identity under the row root, partial unknown paths", () => {
  it("keeps the row root's id/url even when fields name another root", () => {
    const r = shapeEnvelope(EXAMPLE, { fields: "computed.language", budget: 100_000 });
    const row = itemsOf(r.envelope)[0];
    expect(row.computed.language).toBe("en");
    expect(row.comment.id).toBeTruthy();
    expect(Object.keys(row.comment).sort()).toEqual(["id", "url"]);
  });

  it("warns about the paths that matched nothing when others did", () => {
    const r = shapeEnvelope(EXAMPLE, { fields: "comment.text,comment.nope", budget: 100_000 });
    expect(itemsOf(r.envelope)[0].comment.text).toBeTruthy();
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings![0]).toContain("comment.nope");
    expect(r.warnings![0]).not.toContain("comment.text,");
  });
});
