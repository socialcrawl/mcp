import { describe, it, expect, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { endpointKind, findSampleIssues, prepareSample, MAX_SAMPLE_ROWS, MAX_SAMPLE_STRING } from "../resources/sample-gate.js";
import { EXAMPLES, ARCHETYPE_EXAMPLES } from "../data/examples.js";

/** T28 fix round 1: the generator-side gate for bundled samples, lazy loading, URI decoding. */

const sample = (data: unknown): Record<string, unknown> => ({ endpoint: "/v1/x/y", data, redacted: true });

describe("sample gate", () => {
  it("neutralises an error string that names a source", () => {
    const out = prepareSample(sample({ legs: [{ status: "failed", error: "news leg upstream provider-gnews returned 429" }] }));
    expect(out.sample).not.toBeNull();
    const text = JSON.stringify(out.sample);
    expect(text).toContain("source unavailable");
    expect(text).not.toMatch(/provider-|gnews|upstream/i);
    expect(findSampleIssues(text)).toEqual([]);
  });

  it("neutralises upstream wording in warnings, keeps it in ordinary text", () => {
    const out = prepareSample(sample({ _warnings: ["This upstream surface returns titles only"], page: { note: "upstream and downstream systems" } }));
    const text = JSON.stringify(out.sample);
    expect(text).toContain("source unavailable");
    expect(text).toContain("upstream and downstream systems");
  });

  it("excludes a sample with a supplier name outside an error field", () => {
    expect(prepareSample(sample({ items: [{ text: "powered by rapidapi" }] })).sample).toBeNull();
  });

  it("does not flag a host that merely contains a token (imgnews)", () => {
    expect(findSampleIssues(JSON.stringify({ u: "http://imgnews.naver.net/a.jpg" }))).toEqual([]);
  });

  it("flags private emails and phones, accepts the placeholder and business addresses", () => {
    const bad = JSON.stringify({ endpoint: "/v1/x/y", data: { items: [{ a: "n@yano4kaa.a", d: "+33 6 13 10 51 90", f: "(212) 555-1234" }] } });
    expect(findSampleIssues(bad).length).toBeGreaterThanOrEqual(3);
    const good = JSON.stringify({ endpoint: "/v1/x/y", data: { items: [{ b: "redacted@example.com", c: "support@spotify.com", e: "+1-555-0100" }] } });
    expect(findSampleIssues(good)).toEqual([]);
    expect(findSampleIssues(JSON.stringify({ a: "me@private.org" })).length).toBeGreaterThan(0);
    expect(findSampleIssues(JSON.stringify({ a: "+33 6 13 10 51 90" })).length).toBeGreaterThan(0);
  });
  it("blocks identities, profile URLs and URNs in people lists and URNs anywhere", () => {
    const row = { author: { username: "jane_doe", display_name: "Jane Doe", url: "https://www.instagram.com/jane_doe/" } };
    expect(findSampleIssues(JSON.stringify({ data: { items: [row] } }), "instagram/followers").length).toBeGreaterThan(0);
    const clean = { author: { username: "redacted_user", display_name: "Redacted User", url: "https://example.com/redacted" } };
    expect(findSampleIssues(JSON.stringify({ data: { items: [clean] } }), "instagram/followers")).toEqual([]);
    expect(findSampleIssues(JSON.stringify({ u: "urn:li:fsd_profile:ACoAABCdef123456" }), "linkedin/profile").length).toBeGreaterThan(0);
    expect(findSampleIssues(JSON.stringify({ u: "https://www.linkedin.com/in/jane-doe-123" })).length).toBeGreaterThan(0);
    expect(findSampleIssues(JSON.stringify({ u: "https://www.linkedin.com/in/redacted-profile" }))).toEqual([]);
    // An author subtree is user-generated wherever it sits.
    expect(findSampleIssues(JSON.stringify({ data: { items: [row] } }), "instagram/post")).not.toEqual([]);
  });

  it("keeps two rows and caps long strings", () => {
    const items = [1, 2, 3, 4, 5].map((n) => ({ n, blob: "x".repeat(2000) }));
    const a = prepareSample(sample({ items, total: 5 })).sample as { data: { items: Array<{ blob: string }> } };
    expect(a.data.items).toHaveLength(MAX_SAMPLE_ROWS);
    expect(a.data.items[0].blob).toHaveLength(MAX_SAMPLE_STRING + 1);
    expect(a.data.items[0].blob.endsWith("…")).toBe(true);
    const b = prepareSample(sample(items)).sample as { data: unknown[] };
    expect(b.data).toHaveLength(MAX_SAMPLE_ROWS);
  });

  it("everything bundled passes the gate", () => {
    for (const [k, v] of Object.entries({ ...EXAMPLES, ...ARCHETYPE_EXAMPLES })) {
      expect(findSampleIssues(v, k in EXAMPLES ? k : ""), k).toEqual([]);
      const j = JSON.parse(v) as { data?: { items?: unknown[] } | unknown[] };
      const rows = Array.isArray(j.data) ? j.data : j.data?.items;
      if (Array.isArray(rows)) expect(rows.length, k).toBeLessThanOrEqual(MAX_SAMPLE_ROWS);
      expect(v.match(/"[^"\\]{602,}"/), k).toBeNull();
    }
  });
});

describe("lazy samples and URI decoding", () => {
  async function connect(): Promise<Client> {
    const { createServer } = await import("../server.js");
    const server = createServer({ apiKey: "", baseUrl: "https://www.socialcrawl.dev" }, { legacyTools: false });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(a);
    return client;
  }

  it("does not load the samples at startup, only when a sample or schema is read", async () => {
    vi.resetModules();
    let loads = 0;
    vi.doMock("../data/examples.js", async (orig) => {
      loads++;
      return await orig();
    });
    const client = await connect();
    expect(loads).toBe(0);
    await client.listResources();
    await client.readResource({ uri: "socialcrawl://platform/tiktok" });
    expect(loads).toBe(0);
    const key = Object.keys(EXAMPLES)[0];
    const res = await client.readResource({ uri: `socialcrawl://example/${key}` });
    expect((res.contents[0] as { text: string }).text).toContain("redacted");
    const schema = await client.readResource({ uri: "socialcrawl://schema/PostList" });
    expect((schema.contents[0] as { text: string }).text).toContain("PostList");
    expect(loads).toBeGreaterThan(0);
    await client.close();
    vi.doUnmock("../data/examples.js");
  }, 60_000);

  it("a malformed escape is an invalid-params error, not a crash", async () => {
    const client = await connect();
    for (const uri of ["socialcrawl://platform/%E0%A4%A", "socialcrawl://endpoint/tiktok/%E0%A4%A", "socialcrawl://schema/%E0%A4%A"]) {
      await expect(client.readResource({ uri })).rejects.toMatchObject({ code: -32602 });
    }
    await client.close();
  });
});

describe("rows_new alert metric (monitors)", () => {
  it("is documented and accepted by the local alert_rules schema", async () => {
    const { MonitorsInputSchema } = await import("../schemas/tools.js");
    const { getDoc } = await import("../data/docs.js");
    const rule = { metric: "rows_new", op: "gt", value: 0 };
    expect(MonitorsInputSchema.safeParse({ action: "create", recipe: "youtube/channel/videos", webhook_url: "https://example.com/h", alert_rules: [rule] }).success).toBe(true);
    expect(JSON.stringify(MonitorsInputSchema.shape.alert_rules.description)).toContain("rows_new");
    expect(getDoc("monitors")).toContain("rows_new");
  });
});

const issues = (data: unknown, key: string): string[] => findSampleIssues(JSON.stringify({ data }), key);

describe("gate round 2", () => {
  it("removes receipts and meta from the sample", () => {
    const receipts = [{ id: "c1abcdefgh1234567890", text: "I hate Jane Doe @janedoe", author: "janedoe" }];
    const out = prepareSample({ endpoint: "/v1/x/y", data: { label_share: { presets: { q: { receipts } } } }, meta: { label_share: { presets: { q: { receipts } } } }, redacted: true });
    const text = JSON.stringify(out.sample);
    expect(text).not.toMatch(/hate|janedoe|receipts|"meta"/);
  });
  it("the gate fails on verbatim receipt text", () => {
    expect(issues({ comment_recency: { receipts: [{ id: "a1b2c3d4e5f6g7h8i9", text: "a private comment" }] } }, "").length).toBeGreaterThan(0);
    expect(issues({ comment_recency: { receipts: [{ id: "a1b2c3d4e5f6g7h8i9", text: "Sample comment text (redacted)." }] } }, "")).toEqual([]);
  });

  it("(a) checks identities in comment, reply and review rows", () => {
    const row = (u: string) => ({ items: [{ comment: { author: { username: u, display_name: u } } }] });
    expect(issues(row("jane_doe"), "youtube/video/comments").length).toBeGreaterThan(0);
    expect(issues(row("jane_doe"), "twitter/tweet/replies").length).toBeGreaterThan(0);
    expect(issues(row("jane_doe"), "amazon/product/reviews").length).toBeGreaterThan(0);
    expect(issues(row("user_a1b2c3"), "youtube/video/comments")).toEqual([]);
  });

  it("(b) checks a bare-array people list", () => {
    expect(issues([{ username: "jane_doe" }], "instagram/followers").length).toBeGreaterThan(0);
    expect(issues([{ username: "user_a1b2c3" }], "instagram/followers")).toEqual([]);
  });

  it("(c) checks every LinkedIn slug and URN on its own", () => {
    expect(issues({ a: "https://www.linkedin.com/in/williamhgates and https://www.linkedin.com/in/jane-doe-1" }, "").length).toBeGreaterThan(0);
    expect(issues({ a: "ACoAAA8BYqEBCGLg_vT_ca6mMEqkpp9nVffJ3hc ACoAABCdef123456xyz" }, "").length).toBeGreaterThan(0);
    expect(issues({ a: "https://www.linkedin.com/in/williamhgates ACoAAA8BYqEBCGLg_vT_ca6mMEqkpp9nVffJ3hc" }, "")).toEqual([]);
    expect(issues({ a: "https://www.linkedin.com/in/redacted-profile" }, "")).toEqual([]);
  });

  it("(d) pins user_ placeholders and anchors placeholder words to the whole value", () => {
    const one = (v: string) => issues({ items: [{ author: { username: v } }] }, "instagram/followers");
    expect(one("user_a1b2c3")).toEqual([]);
    expect(one("user_a1b2")).not.toEqual([]);
    expect(one("user_zzzzzz")).not.toEqual([]);
    expect(one("Jane Sample")).not.toEqual([]);
    expect(one("example_jane")).not.toEqual([]);
    expect(one("Redacted User")).toEqual([]);
  });

  it("(e) fails on an @handle in comment, review or receipt text", () => {
    const text = (s: string) => ({ items: [{ comment: { text: s } }] });
    expect(issues(text("thanks @janedoe for this"), "youtube/video/comments").length).toBeGreaterThan(0);
    expect(issues(text("Sample comment text (redacted)."), "youtube/video/comments")).toEqual([]);
    expect(issues({ items: [{ review: { text: "ask @shopowner" } }] }, "amazon/product/reviews").length).toBeGreaterThan(0);
  });

  it("positive and negative: user_<hex>, facebook group URL, queried subjects", () => {
    expect(issues({ items: [{ author: { display_name: "user_0a1b2c" } }] }, "facebook/search/people")).toEqual([]);
    expect(issues({ items: [{ author: { display_name: "user_0a1b2" } }] }, "facebook/search/people")).not.toEqual([]);
    expect(issues({ items: [{ post: { url: "https://example.com/redacted" } }] }, "facebook/group/posts")).toEqual([]);
    // A group URL is not a profile.
    expect(issues({ items: [{ post: { url: "https://www.facebook.com/groups/2204685680/posts/1/" } }] }, "facebook/group/posts")).toEqual([]);
    expect(issues({ items: [{ author: { url: "https://www.facebook.com/jane.doe" } }] }, "facebook/search/people")).not.toEqual([]);
    expect(issues({ page: { url: "https://www.linkedin.com/in/ryanroslansky" } }, "linkedin/profile")).toEqual([]);
    expect(issues({ page: { url: "https://www.linkedin.com/in/someoneelse" } }, "linkedin/profile")).not.toEqual([]);
    expect(issues({ post: { author: { username: "williamhgates" } } }, "linkedin/post/with-comments")).toEqual([]);
    expect(issues({ items: [{ post: { author: { username: "williamhgates" } } }] }, "linkedin/profile/complete")).not.toEqual([]);
  });

  it("the supplier list includes hikerapi and is served from src", async () => {
    const { SUPPLIER_TOKENS } = await import("../resources/supplier-tokens.js");
    const fixture = await import("./fixtures/supplier-tokens.js");
    expect(SUPPLIER_TOKENS).toContain("hikerapi");
    expect(fixture.SUPPLIER_TOKENS).toBe(SUPPLIER_TOKENS);
  });

  it("socialcrawl_manage input points at the alert rules", async () => {
    const { ManageInputSchema } = await import("../schemas/tools.js");
    expect(ManageInputSchema.shape.input.description).toContain("rows_new");
  });
});

/** Round 3: default-deny inside user-generated subtrees. */
const run = (data: unknown, key: string): { before: string[]; after: string[]; out: string } => {
  const before = findSampleIssues(JSON.stringify({ data }), key);
  const prepared = prepareSample({ endpoint: `/v1/${key}`, data, redacted: true }).sample;
  const out = JSON.stringify(prepared);
  return { before, after: findSampleIssues(out, key), out };
};
/** The gate alone must catch it: nothing is rewritten any more, a hit fails the build. */
const bypass = (data: unknown, key: string, _gone: string[] = []): void => {
  expect(run(data, key).before.length, "gate must fail").toBeGreaterThan(0);
};

describe("default-deny in UGC subtrees (round 3)", () => {
  it("audience-overlap: bare string arrays of commenters", () => {
    bypass({ creators: { a: { commenters: ["janedoe", "bob_smith"] }, b: { commenters: ["alice.w", "carol99"] } } }, "prism/audience-overlap", ["janedoe", "bob_smith", "alice.w", "carol99"]);
  });
  it("flat identity keys: username, author_name, user.nickname, unique_id, author string, profile.name, firstName/lastName", () => {
    const row = { username: "jdoe", author_name: "Jane Doe", user: { nickname: "JD", unique_id: "jdoe_tt" }, author: "janedoe", profile: { name: "Jane" }, firstName: "Jane", lastName: "Doe" };
    bypass({ items: [row] }, "tiktok/post/comments", ["jdoe", "Jane", "janedoe", "JD", "Doe"]);
  });
  it("comment arrays under non-comment endpoint keys and top_comments", () => {
    bypass({ post: { id: "1" }, comments: [{ text: "love it @jane", user: { unique_id: "jane_tt" } }] }, "tiktok/post", ["love it", "jane_tt"]);
    bypass({ top_comments: [{ text: "nice", author: { name: "Jane Doe" } }] }, "prism/post-report", ["nice", "Jane Doe"]);
  });
  it("catches every URL in a string and an @handle after an emoji; clean safe formats pass", () => {
    expect(run({ items: [{ comment: { text: "great😍@janedoe see https://x.com/ok https://x.com/jane" } }] }, "youtube/video/comments").before.length).toBeGreaterThan(0);
    const clean = { items: [{ comment: { text: "Sample comment text (redacted).", created_at: "2026-09-01T10:00:00Z", language: "en", id: "Abc123Def456Ghi789" } }] };
    expect(run(clean, "youtube/video/comments").before).toEqual([]);
  });
  it("a safe key with the wrong format is flagged", () => {
    expect(run({ items: [{ comment: { created_at: "call me maybe", language: "a long sentence about Jane Doe" } }] }, "youtube/video/comments").before.length).toBeGreaterThan(0);
  });
  it("a group name is not allowlisted by endpoint: it is replaced in UGC", () => {
    bypass({ items: [{ author: { display_name: "PHP" } }] }, "facebook/group", ["PHP"]);
  });
  it("keeps numbers, booleans and null", () => {
    const r = run({ items: [{ comment: { likes: 5, flags: { pinned: false, deleted: null } } }] }, "youtube/video/comments");
    expect(r.out).toContain('"likes":5');
    expect(r.out).toContain('"pinned":false');
    expect(r.out).toContain('"deleted":null');
  });
});

describe("outside UGC subtrees (round 3)", () => {
  it("non-+ phone numbers", () => {
    bypass({ page: { contact: "call 212-555-1234 or 010-1234-5678" } }, "web/scrape", ["212-555-1234", "010-1234-5678"]);
  });
  it("LinkedIn: encoded, /pub/ and every slug; urn:li:member", () => {
    bypass({ a: "https://www.linkedin.com/in/williamhgates then https://www.linkedin.com/in/jane-doe-9" }, "web/scrape", ["jane-doe-9"]);
    bypass({ a: "https%3A%2F%2Fwww.linkedin.com%2Fin%2Fjane-doe-9" }, "web/scrape", ["jane-doe-9"]);
    bypass({ a: "https://www.linkedin.com/pub/jane-doe/1/2/3" }, "web/scrape", ["jane-doe"]);
    bypass({ a: "urn:li:member:123456789" }, "web/scrape", ["123456789"]);
  });
  it("@handle in a comment-like text field after any non-word character", () => {
    bypass({ comment_text: "👍@janedoe wow", message: "hey (@bobsmith)" }, "web/scrape", ["janedoe", "bobsmith"]);
  });
  it("leaves public release-note contributor handles alone", () => {
    const r = run({ release: { notes: "Thanks to @octocat for the fix" } }, "prism/devtool-pulse");
    expect(r.before).toEqual([]);
  });
});

describe("property: any string in any UGC path is flagged", () => {
  it("random strings at random UGC paths are always caught by the gate", () => {
    let seed = 12345;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789_.@ -/:é😍";
    const rstr = (): string => Array.from({ length: 4 + Math.floor(rnd() * 30) }, () => [...alphabet][Math.floor(rnd() * [...alphabet].length)]).join("");
    const segs = ["comments", "replies", "reviews", "commenters", "followers", "following", "likers", "reactions", "people", "members", "top_comments", "attendees", "participants", "audience", "authors", "users", "mentions"];
    // Safe keys (id, type, label, dates ...) legitimately keep well-formed values; they have their own test.
    const keys = ["text", "name", "foo", "bar_baz", "handle", "u", "caption", "author_url"];
    for (let i = 0; i < 300; i++) {
      const seg = segs[Math.floor(rnd() * segs.length)]!;
      const val = rstr();
      const leaf = keys[Math.floor(rnd() * keys.length)]!;
      const data = { wrap: { [seg]: rnd() < 0.3 ? [val, rstr()] : [{ handle: rstr(), [leaf]: val, nested: { [keys[Math.floor(rnd() * keys.length)]!]: rstr() } }] } };
      expect(findSampleIssues(JSON.stringify({ endpoint: "/v1/web/scrape", data }), "web/scrape").length, val).toBeGreaterThan(0);
    }
  });
});

/** Round 4: shape-based classification, global key deny, IPs, closed formats. */
describe("registry-driven classification (round 5)", () => {
  it.each([
    ["kohls/questions", "ugc"], ["youtube/video/comments", "ugc"], ["amazon/reviews", "ugc"],
    ["instagram/search/profiles", "people"], ["tiktok/user/followers", "people"],
    ["linkedin/search/companies", "none"], ["finance/markets", "none"], ["twitter/profile", "none"], ["search/creators", "none"],
    ["us_congress_trades/members", "public"],
  ])("%s is %s", (key, kind) => expect(endpointKind(key)).toBe(kind));

  it.each(["login", "alias", "slug", "uid", "unique_id", "uniqueId", "account_name", "profile_name", "owner_name", "name", "title", "bloggername", "channel_title", "sec_uid", "author_handle", "nicknm"])(
    "people endpoint: key %s holds an identity",
    (k) => bypass({ items: [{ [k]: "janedoe92" }] }, "instagram/search/profiles", ["janedoe92"]),
  );
  it("a person row nested under neutral keys (search/creators, find-accounts)", () => {
    bypass({ results: [{ profile: { handle: "jane.doe92", name: "Jane Doe", bio: "mom of 3 in Austin", url: "https://www.instagram.com/jane.doe92/" } }] }, "search/creators", ["jane.doe92", "Jane Doe", "mom of 3"]);
    bypass({ platforms: [{ candidates: [{ handle: "jane.doe92", display_name: "Jane Doe", link: "https://tiktok.com/@jane.doe92" }] }] }, "prism/find-accounts", ["jane.doe92", "Jane Doe"]);
  });
  it.each(["top_comment", "latest_comment", "topComments", "comment_list", "answers", "likes", "taggedUsers", "fans", "viewers", "stargazers", "contributors", "chat"])(
    "path word %s with identity rows on a plain endpoint",
    (seg) => bypass({ post: { [seg]: [{ handle: "jane_doe", foo: "private words here" }] } }, "tiktok/post", ["private words", "jane_doe"]),
  );
  it("bare string arrays under a user-content word are people", () => {
    bypass({ voters: ["jane_doe", "bob_smith"] }, "web/scrape", ["jane_doe", "bob_smith"]);
  });
  it("rows with only text are not user content: no word and no identity key, nothing changes", () => {
    const data = { items: [{ id: "1", text: "hello world", ticker: "AAPL" }], similar: [{ ticker: "MSFT", name: "Microsoft" }], group: "Tech" };
    expect(run(data, "finance/markets").out).toContain("hello world");
    expect(run(data, "finance/markets").out).toContain("Microsoft");
    expect(run(data, "finance/markets").after).toEqual([]);
  });
  it("handles in URLs and ids on every platform", () => {
    const urls = [
      "https://blog.naver.com/fallharder/223680034620", "https://blog.naver.com/PostView.naver?blogId=cyh5584&logNo=1",
      "https://www.instagram.com/jane.doe92/", "https://www.tiktok.com/@jane.doe92/video/123", "https://x.com/janedoe92/status/1",
      "https://www.youtube.com/@janedoe92", "https://www.threads.net/@janedoe92", "https://www.facebook.com/jane.doe92", "https://www.reddit.com/user/janedoe92",
    ];
    for (const u of urls) bypass({ post: { url: u, id: u } }, "tiktok/search", [u.match(/(fallharder|cyh5584|jane[.]?doe92)/)![0]]);
    expect(run({ post: { url: "https://www.instagram.com/p/DXidPIVDU6M/" } }, "tiktok/search").out).toContain("instagram.com/p/DXidPIVDU6M");
  });
  it("the queried subject keeps its handle everywhere in the sample", () => {
    const data = { author: { username: "elonmusk", display_name: "Elon Musk", url: "https://x.com/elonmusk" }, items: [{ post: { url: "https://x.com/elonmusk/status/1", author: { username: "elonmusk" } } }] };
    const r = run(data, "twitter/user/tweets");
    expect(r.before).toEqual([]);
    expect(r.out).toContain("Elon Musk");
    expect(r.out).toContain("x.com/elonmusk/status/1");
    expect(run({ items: [{ post: { author: { username: "someoneelse", display_name: "Some One" } } }] }, "twitter/user/tweets").before).not.toEqual([]);
  });
  it("public accounts (100k followers, organisation page) keep their identity, small ones do not", () => {
    const row = (followers: number) => ({ items: [{ post: { url: "https://www.tiktok.com/@somecreator/video/1", author: { username: "somecreator", display_name: "Some Creator", followers } } }] });
    expect(run(row(2_000_000), "tiktok/search").out).toContain("somecreator");
    bypass(row(5000), "tiktok/search", ["somecreator", "Some Creator"]);
    expect(issues({ items: [{ post: { author: { username: "acmecorp", is_brand: true } } }] }, "tiktok/search")).toEqual([]);
    // Comment and review authors never keep an identity, however public.
    bypass({ items: [{ comment: { author: { username: "bigstar", followers: 9_000_000 } } }] }, "youtube/video/comments", ["bigstar"]);
  });
  it("public-office datasets keep names", () => {
    const data = { items: [{ first_name: "Nancy", last_name: "Pelosi", display_name: "Nancy Pelosi" }] };
    const r = run(data, "us_congress_trades/members");
    expect(r.out).toContain("Pelosi");
    expect(r.before).toEqual([]);
  });
  it("dates, urls and text keep their type in default-deny rows; the wrong type is flagged", () => {
    const clean = { items: [{ author: { username: "user_a1b2c3", bio: "Sample comment text (redacted).", avatar_url: "https://example.com/avatars/user_a1b2c3.png", joined_at: "2026-09-01 10:00:00 +0000", published_at: "2026-09-01T10:00:00.000Z" } }] };
    expect(run(clean, "instagram/followers").before).toEqual([]);
    expect(run({ items: [{ author: { username: "user_a1b2c3", avatar_url: "https://cdn.example-host.net/jd/a.jpg" } }] }, "instagram/followers").before).not.toEqual([]);
    expect(run({ items: [{ author: { username: "user_a1b2c3", bio: "I live in Austin" } }] }, "instagram/followers").before).not.toEqual([]);
  });
  it("an id that is a handle plus digits is not opaque", () => {
    bypass({ items: [{ comment: { id: "janedoe1234567890" } }] }, "youtube/video/comments", ["janedoe1234567890"]);
    expect(run({ items: [{ comment: { id: "Ugzge340dBgB75hWBm54AaABAg" } }] }, "youtube/video/comments").out).toContain("Ugzge340dBgB75hWBm54AaABAg");
  });
});

describe("global key deny (round 4)", () => {
  it("replaces identity, ip, email and phone keys in camel and snake form on any endpoint", () => {
    const data = { page: { UserNickname: "Marcy", IPAddress: "75.211.3.35", firstName: "Jane", last_name: "Doe", screen_name: "jd", handle: "jdoe", ip: "8.8.4.4", phone: "+14155550123" } };
    bypass(data, "web/scrape", ["Marcy", "75.211.3.35", "Jane", "Doe", "jdoe", "8.8.4.4", "4155550123"]);
  });
  it("exempts the queried subject only on its own endpoint key", () => {
    expect(issues({ author: { username: "williamhgates" } }, "linkedin/profile")).toEqual([]);
    expect(issues({ items: [{ author: { username: "williamhgates" } }] }, "web/scrape")).not.toEqual([]);
  });
});

describe("IP addresses (round 4)", () => {
  it("fails on IPv4 and IPv6 anywhere, except documentation ranges", () => {
    bypass({ page: { note: "seen from 75.211.3.35 and 2a02:8071:5a0::1" } }, "web/scrape", ["75.211.3.35", "2a02:8071"]);
    expect(issues({ page: { note: "192.0.2.1 198.51.100.7 203.0.113.9 2001:db8::1" } }, "web/scrape")).toEqual([]);
    expect(issues({ page: { time: "2026-09-01T10:00:00Z", version: "1.2.3" } }, "web/scrape")).toEqual([]);
  });
  it("no bundled sample holds an IPv4 address or a real ip key", () => {
    for (const [k, v] of Object.entries({ ...EXAMPLES, ...ARCHETYPE_EXAMPLES })) {
      for (const m of v.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? []) expect(m, k).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\./);
      expect(v, k).not.toMatch(/"(IPAddress|ip|ip_address|ipAddress)":"(?!192\.0\.2\.)[^"]+"/);
    }
  });
});

describe("closed formats and placeholders (round 4)", () => {
  const one = (data: unknown): string[] => issues({ items: [{ comment: data }] }, "youtube/video/comments");
  it("the URL placeholder is exact", () => {
    bypass({ items: [{ comment: { text: "https://example.com/ Jane Doe at 12 Elm St" } }] }, "youtube/video/comments", ["Jane Doe"]);
    bypass({ items: [{ author: { url: "https://example.com/r?u=instagram.com/jane.doe" } }] }, "youtube/video/comments", ["jane.doe"]);
    expect(one({ avatar_url: "https://example.com/avatars/user_a1b2c3.png", url: "https://example.com/redacted" })).toEqual([]);
  });
  it("label, status, country, language, platform, sentiment are closed sets", () => {
    for (const [k, v] of [["label", "jane_doe"], ["status", "janedoe92"], ["country", "JaneDoe"], ["language", "Jane"], ["platform", "janedoe"], ["sentiment", "jane"]]) {
      bypass({ items: [{ comment: { [k!]: v } }] }, "youtube/video/comments", [v!]);
    }
    expect(one({ label: "question", status: "active", country: "DE", language: "en", platform: "tiktok", type: "comment", sentiment: "positive" })).toEqual([]);
  });
  it("ids: people-list ids and ids under an author are pseudonyms; opaque comment ids stay", () => {
    bypass({ items: [{ id: "jane.doe", username: "user_a1b2c3" }] }, "instagram/followers", ["jane.doe"]);
    bypass({ items: [{ id: "100012345678901" }] }, "facebook/search/people", ["100012345678901"]);
    bypass({ items: [{ comment: { author: { comment_id: "jane.doe", id: "1234567890" } } }] }, "youtube/video/comments", ["jane.doe", "1234567890"]);
    bypass({ items: [{ comment: { post_id: "janedoe92" } }] }, "youtube/video/comments", ["janedoe92"]);
    const r = run({ items: [{ comment: { id: "18117485308668753", post_id: "DXidPIVDU6M_abc123" } }] }, "youtube/video/comments");
    expect(r.out).toContain("18117485308668753");
    expect(r.after).toEqual([]);
  });
  it("the key is taken from the sample's endpoint when none is passed (archetype samples)", () => {
    const json = JSON.stringify({ endpoint: "/v1/youtube/video/comments", data: { items: [{ comment: { text: "private words" } }] } });
    expect(findSampleIssues(json).length).toBeGreaterThan(0);
  });
});

/** Round 5: the gate must not destroy what is public. Reads the codebase corpus when it sits next to this repo. */
const CORPUS = resolve(import.meta.dirname, "../../../codebase/packages/social-api/src/docs/examples/endpoints");
if (!existsSync(CORPUS)) {
  describe("usefulness (round 5)", () => {
    it("corpus not found: the bundle-vs-corpus checks did NOT run", () => {
      console.warn(`WARNING: codebase sample corpus missing at ${CORPUS}; usefulness checks (bundle share equals corpus share, unchanged strings) were not run.`);
    });
  });
}
describe.runIf(existsSync(CORPUS))("usefulness (round 5)", () => {
  type Leaf = { path: string[]; value: string };
  const leaves = (n: unknown, path: string[], out: Leaf[] = []): Leaf[] => {
    if (typeof n === "string") out.push({ path, value: n });
    else if (Array.isArray(n)) n.forEach((v, i) => leaves(v, [...path, String(i)], out));
    else if (n && typeof n === "object") for (const [k, v] of Object.entries(n)) leaves(v, [...path, k], out);
    return out;
  };
  const load = (file: string): Record<string, unknown> => JSON.parse(readFileSync(resolve(CORPUS, file), "utf8"));
  const identityKey = (k: string): boolean => /(^|_)(nick(name)?|user_?name|screen_?name|handle|first_?name|last_?name|display_?name|full_?name|ip|email|phone|name|title|login|bio)($|_)/i.test(k);

  /** Share of the raw sample's non-identity strings that prepareSample leaves exactly as they were. */
  const unchanged = (file: string): number => {
    const raw = load(file);
    const prepared = prepareSample({ endpoint: raw.endpoint, data: raw.data, pagination: raw.pagination, credits_used: raw.credits_used, redacted: true }).sample!;
    const after = new Map(leaves(prepared.data, ["data"]).map((l) => [l.path.join("."), l.value]));
    const kept = leaves(raw.data, ["data"]).filter((l) => !identityKey(l.path[l.path.length - 1] ?? "") && l.value.length <= MAX_SAMPLE_STRING);
    return kept.length === 0 ? 1 : kept.filter((l) => after.get(l.path.join(".")) === l.value).length / kept.length;
  };

  it.each([
    "finance.markets.json", "sephora.categories.json", "gumtree.categories.json", "amazon.product.json", "google.business-info.json",
    "twitter.profile.json", "twitter.user-tweets.json", "us_congress_trades.members.json", "us_congress_trades.trades.json",
  ])("%s keeps at least 90% of its non-identity strings", (file) => {
    if (!existsSync(resolve(CORPUS, file))) return;
    expect(unchanged(file)).toBeGreaterThanOrEqual(0.9);
  });

  it("prepareSample adds almost no placeholders beyond what the codebase corpus already has", () => {
    const isPh = (s: string): boolean => isPlaceholderForTest(s);
    let total = 0;
    let added = 0;
    for (const file of readdirSync(CORPUS)) {
      if (!file.endsWith(".json")) continue;
      const raw = load(file);
      const prepared = prepareSample({ endpoint: raw.endpoint, data: raw.data, pagination: raw.pagination, credits_used: raw.credits_used, redacted: true }).sample;
      if (!prepared) continue;
      const after = new Map(leaves(prepared.data, ["data"]).map((l) => [l.path.join("."), l.value]));
      for (const l of leaves(raw.data, ["data"])) {
        total++;
        const a = after.get(l.path.join("."));
        if (a !== undefined && isPh(a) && !isPh(l.value)) added++;
      }
    }
    expect(added / total).toBeLessThanOrEqual(0.001);
  });

  it("the bundle's placeholder share equals the corpus share (the codebase redactor is the only redactor)", () => {
    const share = (docs: unknown[]): number => {
      let total = 0;
      let ph = 0;
      for (const d of docs) for (const l of leaves(d, ["data"])) (total++, isPlaceholderForTest(l.value) && ph++);
      return ph / total;
    };
    const bundle = Object.values(EXAMPLES).map((v) => (JSON.parse(v) as { data: unknown }).data);
    const corpus = readdirSync(CORPUS).filter((f) => f.endsWith(".json")).map((f) => load(f).data);
    expect(Math.abs(share(bundle) - share(corpus))).toBeLessThanOrEqual(0.005);
  });
});

const isPlaceholderForTest = (s: string): boolean =>
  /^user_[0-9a-f]{6}$/.test(s) || /^(Sample comment text \(redacted\)\.\s?)+$/.test(s) || /^https:\/\/example\.com\//.test(s) || s === "redacted@example.com" || s === "+1-555-0100" || s === "192.0.2.1";

describe("remaining probe shapes (round 5)", () => {
  it("receipts: any key, and the id, must be placeholders or opaque ids", () => {
    bypass({ receipts: [{ id: "a1b2c3d4e5f6g7h8i9", quote: "a private comment" }] }, "web/scrape", ["a private comment"]);
    bypass({ receipts: [{ id: "a private comment by Jane", text: "Sample comment text (redacted)." }] }, "web/scrape", ["by Jane"]);
  });
  it("quoted-content arrays (label_share, examples, quotes) are user content", () => {
    bypass({ label_share: { presets: { q: { examples: [{ text: "verbatim private" }] } } } }, "web/scrape", ["verbatim private"]);
    bypass({ meta: { quotes: [{ text: "something private" }] } }, "web/scrape", ["something private"]);
  });
  it("a handle inside an id", () => {
    bypass({ post: { id: "jane.doe92_123456" } }, "tiktok/search", ["jane.doe92"]);
    expect(run({ post: { id: "7658005300657638669", url: "https://www.tiktok.com/@user_a1b2c3/video/7658005300657638669" } }, "tiktok/search").before).toEqual([]);
  });
  it("an email in base64 or spelled out", () => {
    bypass({ post: { token: "amFuZS5kb2VAZ21haWwuY29t" } }, "tiktok/search", ["amFuZS5kb2Vh"]);
    bypass({ post: { note: "write to jane.doe at gmail dot com" } }, "tiktok/search", ["jane.doe at gmail"]);
  });
  it("a phone without separators in text, or with middle dots", () => {
    bypass({ post: { text: "call 5125550199 now" } }, "tiktok/search", ["5125550199"]);
    bypass({ post: { text: "call 512·555·0199" } }, "tiktok/search", ["512·555·0199"]);
    expect(run({ post: { created_at_epoch: "1788784863", version: "1.2.3.4" } }, "tiktok/search").before).toEqual([]);
  });
  it("an IPv4 under a key that merely contains 'build'", () => {
    bypass({ build_host: "75.211.3.35" }, "tiktok/search", ["75.211.3.35"]);
    expect(run({ app_version: "11.4.2.1" }, "tiktok/search").before).toEqual([]);
  });
  it("an endpoint missing from the registry falls back to its path words", () => {
    bypass({ items: [{ review: { text: "김민지 직원 친절" } }] }, "google/business/reviews", ["김민지"]);
  });
  it("a numeric Facebook profile id in a comment row", () => {
    bypass({ items: [{ comment: { id: "100012345678901" } }] }, "facebook/post/comments", ["100012345678901"]);
    expect(run({ items: [{ comment: { id: "1789012345678901" } }] }, "facebook/post/comments").after).toEqual([]);
  });
});

/** One redactor: prepareSample only shapes; the gate only checks. */
describe("one redactor (prepareSample shapes, the gate checks)", () => {
  it("prepareSample does not rewrite identities, handles, emails, phones or text", () => {
    const data = { items: [{ comment: { text: "call 512-555-0199 or jane.doe@gmail.com @janedoe", author: { username: "janedoe", display_name: "Jane Doe", url: "https://www.instagram.com/jane.doe92/" } } }] };
    const out = JSON.stringify(prepareSample({ endpoint: "/v1/youtube/video/comments", data, redacted: true }).sample);
    for (const kept of ["512-555-0199", "jane.doe@gmail.com", "@janedoe", "Jane Doe", "instagram.com/jane.doe92"]) expect(out).toContain(kept);
  });
  it("prepareSample still shapes: two rows, capped strings, no meta, no receipts, source errors neutral, supplier samples dropped", () => {
    const items = [1, 2, 3].map((n) => ({ n, blob: "x".repeat(900), receipts: [{ id: "abcd1234", text: "q" }] }));
    const out = prepareSample({ endpoint: "/v1/x/y", data: { items, receipts: [{ id: "a", text: "q" }], _warnings: ["upstream provider-gnews 429"] }, meta: { a: 1 }, redacted: true }).sample as Record<string, unknown>;
    expect(out.meta).toBeUndefined();
    const data = out.data as { items: Array<Record<string, unknown>>; receipts?: unknown; _warnings: string[] };
    expect(data.items).toHaveLength(2);
    expect(String(data.items[0]!.blob)).toHaveLength(MAX_SAMPLE_STRING + 1);
    expect(data.items[0]!.receipts).toBeUndefined();
    expect(data.receipts).toBeUndefined();
    expect(data._warnings).toEqual(["source unavailable"]);
    expect(prepareSample({ endpoint: "/v1/x/y", data: { a: "via rapidapi" }, redacted: true }).sample).toBeNull();
  });
  it("issues name the rule and the path and never repeat the value", () => {
    const json = JSON.stringify({ endpoint: "/v1/web/scrape", data: { page: { contact: "jane.doe@gmail.com", nick: "x" }, note: "seen from 75.211.3.35", link: "https://www.instagram.com/jane.doe92/" } });
    const text = findSampleIssues(json, "web/scrape").join("\n");
    expect(text).toMatch(/email/);
    expect(text).toMatch(/data\.page\.contact/);
    for (const secret of ["jane.doe@gmail.com", "75.211.3.35", "jane.doe92"]) expect(text).not.toContain(secret);
  });
  it("category, product and place rows: a display name is a label, not a person", () => {
    const rows = { items: [{ categoryId: "c1", displayName: "Beauty", seoDisplayName: "All Classifieds", children: [{ text: "For Sale", idName: "for-sale", display_name: "Garden" }] }] };
    expect(issues(rows, "gumtree/categories")).toEqual([]);
    expect(issues({ items: [{ product: { name: "Lamp", display_name: "Desk lamp" } }] }, "amazon/product-search")).toEqual([]);
    expect(issues({ place: { display_name: "Hotel Executive Suites" } }, "google/hotels/search")).toEqual([]);
  });
  it("person and user-content rows still flag identity keys", () => {
    expect(issues({ items: [{ author: { username: "jane_doe", display_name: "Jane Doe" } }] }, "tiktok/search")).not.toEqual([]);
    expect(issues({ items: [{ username: "jane_doe", display_name: "Jane Doe" }] }, "instagram/followers")).not.toEqual([]);
    expect(issues({ items: [{ comment: { author: { display_name: "Jane Doe" } } }] }, "youtube/video/comments")).not.toEqual([]);
  });
});

/** Gate precision: what the corpus legitimately holds must not be flagged. */
describe("gate precision (one redactor)", () => {
  it("lists of enums, urls and skills inside review rows are not people lists", () => {
    expect(issues({ items: [{ review: { images: ["https://img.example-cdn.net/a.jpg"], skills: ["Python"], text: "Sample comment text (redacted)." } }], labels: { presets: ["sentiment", "question"] }, _warnings: ["partial result"] }, "amazon/reviews")).toEqual([]);
  });
  it("question rows: numeric ids and locales pass, the question text does not", () => {
    const row = (extra: object) => ({ items: [{ Id: "8646313", ProductId: "1119487", ContentLocale: "en_US", UserNickname: "user_a1b2c3", ...extra }] });
    expect(issues(row({ QuestionSummary: "Sample comment text (redacted)." }), "kohls/questions")).toEqual([]);
    expect(issues(row({ QuestionSummary: "Does it fit a king bed" }), "kohls/questions")).not.toEqual([]);
  });
  it("cursors, entity ids, country names, languages and statuses are fine", () => {
    const data = { next_cursor: "sc2.eyJzIjoiYSIsImMiOiJVZ3pnZTM0MGRCZ0I3NWhXQm01NEFhQUJBZyJ9".repeat(8), items: [{ review: { entity_id: "com.spotify.music", original_language: "EN", language: "en_US", status: "complete", country: "Pakistan", post_id: "https://api.github.com/repos/react/react/issues/27522" } }] };
    expect(issues(data, "google_play/app-reviews")).toEqual([]);
    expect(issues({ items: [{ comment: { country: "JaneDoe", status: "janedoe92" } }] }, "youtube/video/comments")).not.toEqual([]);
  });
  it("a facebook ads library URL is not a profile; a company username is not a person", () => {
    expect(issues({ post: { url: "https://www.facebook.com/ads/library?id=1702938977100376" } }, "facebook/adlibrary/ad")).toEqual([]);
    expect(issues({ items: [{ companyName: "Graphite Health", companyUsername: "graphite-health", title: "Engineer", skills: ["Python"] }] }, "linkedin/profile/position-skills")).toEqual([]);
  });
  it("a title of a thing is not what a person wrote; a review extract is", () => {
    expect(issues({ items: [{ comment: { ext: { post_title: "theLastOReillyJustDropped", content_language: "en" } } }] }, "reddit/search/comments")).toEqual([]);
    expect(issues({ userReviews: { reviews: [{ extract: "They are a lot smaller than I thought" }] } }, "klarna/reviews/overview")).not.toEqual([]);
  });
  it("business contact fields on a listing are public; the same on a person are not", () => {
    expect(issues({ place: { phone: "+12122060707", email: "info@hotel.com" } }, "google/business/info")).toEqual([]);
    expect(issues({ author: { phone: "+12122060707" } }, "tiktok/search")).not.toEqual([]);
  });
  it("the subject's display name matches the example param ignoring case and spacing", () => {
    expect(issues({ author: { display_name: "Elon Musk" } }, "twitter/profile")).toEqual([]);
    expect(issues({ items: [{ author: { display_name: "Elon Musk" } }] }, "web/scrape")).not.toEqual([]);
  });
});

describe("gate precision, second pass (one redactor)", () => {
  it("a cursor may hold anything; a pipeline date is not a phone number", () => {
    expect(issues({ next_cursor: '{"page_number": 0, "x": "a b"}', items: [{ post: { ext: { published_at: "Fri Oct 02 03:44:38 +0000 2026" } } }] }, "facebook/search/pages")).toEqual([]);
  });
  it("answer rows: numeric text and id lists pass; a short reddit id passes", () => {
    expect(issues({ items: [{ UserNickname: "user_a1b2c3", AnswerIds: ["9005218"], answers: [{ AnswerText: "27" }] }] }, "kohls/questions")).toEqual([]);
    expect(issues({ items: [{ comment: { id: "pcrmpdk", parent_id: "nnbr72r" } }] }, "reddit/post/comments")).toEqual([]);
  });
  it("ad pages are organisations: their profile URL is not a private handle", () => {
    expect(issues({ post: { ext: { ad: { page_profile_uri: "https://www.facebook.com/nike/" } } } }, "facebook/adlibrary/ad")).toEqual([]);
    expect(issues({ post: { url: "https://www.facebook.com/jane.doe92/" } }, "tiktok/search")).not.toEqual([]);
  });
  it("a long document (a README) may link public maintainers, a short comment may not", () => {
    expect(issues({ dossier: { readme: `${"x ".repeat(300)} follow https://twitter.com/jarredsumner` } }, "prism/devtool-pulse")).toEqual([]);
    expect(issues({ items: [{ comment: { text: "see https://twitter.com/jarredsumner" } }] }, "youtube/video/comments")).not.toEqual([]);
  });
  it("evidence lines of a video are the video's own words", () => {
    expect(issues({ suspectedSponsors: [{ evidence: [{ text: "consider therapy with our sponsor" }] }] }, "youtube/video/sponsors")).toEqual([]);
  });
  it("a real address in a URL query is still caught", () => {
    expect(issues({ items: [{ url: "https://r.googlevideo.com/videoplayback?ip=2a00%3A20%3A6356%3Aee27%3Ac40e%3A37ff%3Afe67%3A799b" }] }, "youtube/video/audio")).not.toEqual([]);
  });
});

describe("gate precision, third pass (one redactor)", () => {
  it("the title of the reviewed app is not the reviewer's words", () => {
    expect(issues({ apps: { google_play: { title: "Spotify: Music and Podcasts" } }, reviews: { google_play: [{ id: "a1b2c3d4", text: "Sample comment text (redacted)." }] } }, "prism/app-reviews")).toEqual([]);
    expect(issues({ apps: { google_play: { title: "x" } }, reviews: { google_play: [{ id: "a1b2c3d4", title: "Great app, love it" }] } }, "prism/app-reviews")).not.toEqual([]);
  });
});

describe("probe gaps found with the gate alone (one redactor)", () => {
  it("an author as a plain string or author_name in a comment row", () => {
    expect(issues({ items: [{ comment: { author_name: "Jane Doe" } }] }, "youtube/video/comments")).not.toEqual([]);
    expect(issues({ items: [{ comment: { author: "Jane Doe" } }] }, "youtube/video/comments")).not.toEqual([]);
    expect(issues({ items: [{ comment: { author: "user_a1b2c3" } }] }, "youtube/video/comments")).toEqual([]);
  });
  it("a date key must hold a date", () => {
    expect(issues({ items: [{ comment: { date: "Jane Doe", posted_at: "call me" } }] }, "youtube/video/comments")).not.toEqual([]);
    expect(issues({ items: [{ comment: { date: "2026-09-01", posted_at: "Fri Oct 02 03:44:38 +0000 2026", created_at: "2026-09-01 10:00:00 +0000" } }] }, "youtube/video/comments")).toEqual([]);
  });
});

/** Narrow false-positive fixes: each one has a real leak that must still fail. */
describe("gate false positives (narrow)", () => {
  const author = { username: "nasa", display_name: "NASA", avatar_url: "https://scontent.cdninstagram.com/v/a.jpg" };
  it("the queried item's own author or channel is exempt; the same author in rows is not", () => {
    expect(issues({ post: { author } }, "instagram/post")).toEqual([]);
    expect(issues({ video: { post: { author: { display_name: "Rick Astley" } }, channel: { handle: "letsKWOOWK", url: "https://www.youtube.com/@letsKWOOWK" } } }, "youtube/video/sponsors")).toEqual([]);
    // rows, lists and comment objects are never exempt
    expect(issues({ items: [{ post: { author } }] }, "instagram/post")).not.toEqual([]);
    expect(issues({ items: [{ post: { author } }] }, "tiktok/search")).not.toEqual([]);
    expect(issues({ post: { top_comment: { author: { username: "janedoe", display_name: "Jane Doe" }, text: "Sample comment text (redacted)." } } }, "instagram/post")).not.toEqual([]);
    expect(issues({ post: { comments: [{ author: { username: "janedoe" } }] } }, "instagram/post")).not.toEqual([]);
    expect(issues({ items: [{ comment: { author } }] }, "youtube/video/comments")).not.toEqual([]);
    expect(issues({ items: [{ author }] }, "instagram/followers")).not.toEqual([]);
  });
  it("a LinkedIn slug equal to a request param is the subject's; any other slug is not", () => {
    expect(issues({ page: { url: "https://www.linkedin.com/in/williamhgates" } }, "linkedin/profile/all")).toEqual([]);
    expect(issues({ page: { url: "https://www.linkedin.com/in/someoneelse92" } }, "linkedin/profile/all")).not.toEqual([]);
  });
  it("public status never comes from free text; a stated audience or a 'page' category is spoofable", () => {
    const row = (extra: object) => ({ items: [{ post: { author: { username: "janedoe92", display_name: "Jane Doe", ...extra } } }] });
    expect(issues(row({ caption: "10,359,395 followers" }), "tiktok/search")).not.toEqual([]);
    expect(issues(row({ bio: "2.4M followers" }), "tiktok/search")).not.toEqual([]);
    expect(issues(row({ category: "page", type: "Brand page" }), "tiktok/search")).not.toEqual([]);
    // structured fields still make an account public
    expect(issues(row({ followers: 2_400_000 }), "tiktok/search")).toEqual([]);
    expect(issues(row({ is_brand: true }), "tiktok/search")).toEqual([]);
    expect(issues(row({ followers: 300 }), "tiktok/search")).not.toEqual([]);
  });
  it("linkedin/profile/all: people named in the request urls are the subject's, others are not", () => {
    const row = (slug: string) => ({ interests: [{ elements: [{ title: "Jeff Weiner", link: `https://www.linkedin.com/in/${slug}`, caption: "10,359,395 followers" }] }] });
    expect(issues(row("jeffweiner08"), "linkedin/profile/all")).toEqual([]);
    expect(issues(row("someoneelse92"), "linkedin/profile/all")).not.toEqual([]);
  });
  it("a cafe is a community, not a person; a blog still is", () => {
    expect(issues({ items: [{ post: { id: "https://cafe.naver.com/divclub/64226", url: "https://cafe.naver.com/divclub/64226" } }] }, "naver/cafearticle/search")).toEqual([]);
    expect(issues({ items: [{ post: { url: "https://blog.naver.com/fallharder/223680034620" } }] }, "naver/blog/search")).not.toEqual([]);
    expect(issues({ items: [{ post: { club_name: "divclub", community_name: "stocks" } }] }, "naver/cafearticle/search")).toEqual([]);
    expect(issues({ items: [{ author: { name: "Jane Doe" } }] }, "instagram/followers")).not.toEqual([]);
  });
  it("only the documented placeholder token 'creator' is accepted, exactly", () => {
    const rows = (u: string, id: string) => ({ items: [{ id, username: u, followers: 12000 }] });
    expect(issues(rows("creator", "creator-1"), "prism/handle-audit")).toEqual([]);
    expect(issues(rows("creator", "creator-1"), "instagram/followers")).not.toEqual([]);
    expect(issues(rows("creator_jane", "creator-1"), "prism/handle-audit")).not.toEqual([]);
    expect(issues(rows("creator", "creator-jane"), "prism/handle-audit")).not.toEqual([]);
    // the handle-audit example itself: its own author block is the queried item's
    expect(issues({ handle: "creator", platforms: { tiktok: { author: { id: "creator-1", username: "creator" } } } }, "prism/handle-audit")).toEqual([]);
  });
  it("a creator @mention in a comment row still fails; in the item's own caption it is not checked", () => {
    expect(issues({ items: [{ comment: { text: "video by @sun_sim_" } }] }, "instagram/post/comments")).not.toEqual([]);
    expect(issues({ post: { content: { text: "Join @sun_sim_ on a ride. Video by @sun_sim_" }, author } }, "instagram/post/stats")).toEqual([]);
  });
});

/** Final review: an exemption never carries into rows, person lists, bare lists or user-content arrays. */
describe("exemptions do not inherit into rows (final review)", () => {
  const rows = [{ username: "janedoe92", display_name: "Jane Doe" }];
  it("a public account beside a private people list", () => {
    expect(issues({ user: { follower_count: 250000, username: "bigbrand" }, items: rows }, "instagram/followers")).not.toEqual([]);
    expect(issues({ followers_count: 250000, items: rows }, "instagram/followers")).not.toEqual([]);
    expect(issues({ is_business: true, items: rows }, "instagram/followers")).not.toEqual([]);
  });
  it("a subject or business parent beside private comments or bare lists", () => {
    const author = { username: "elonmusk", display_name: "Elon Musk" };
    expect(issues({ author, comments: [{ author: { username: "janedoe92" }, text: "Sample comment text (redacted)." }] }, "twitter/profile")).not.toEqual([]);
    expect(issues({ author, comments: [{ text: "a private opinion about this" }] }, "instagram/profile/posts/full")).not.toEqual([]);
    expect(issues({ author, commenters: ["janedoe92"] }, "twitter/profile")).not.toEqual([]);
    expect(issues({ is_business: true, comments: [{ text: "a private opinion" }] }, "tiktok/search")).not.toEqual([]);
    expect(issues({ author, comments: [{ username: "janedoe92" }] }, "linkedin/post/with-comments")).not.toEqual([]);
  });
  it("the quoted or retweeted post's author is another person", () => {
    expect(issues({ post: { author: { username: "elonmusk" }, ext: { quoted_post: { author: { username: "janedoe92", display_name: "Jane Doe" } } } } }, "twitter/tweet")).not.toEqual([]);
    expect(issues({ post: { author: { username: "elonmusk" } } }, "twitter/tweet")).toEqual([]);
  });
  it("public-office datasets stay exempt throughout", () => {
    expect(issues({ items: [{ first_name: "Nancy", last_name: "Pelosi" }], politician: { name: "Nancy Pelosi" } }, "us_congress_trades/members")).toEqual([]);
  });
});

describe("final review minors", () => {
  it("the creator placeholder only on handle-audit", () => {
    const rows = { items: [{ id: "creator-1", username: "creator", followers: 12000 }] };
    expect(issues(rows, "prism/handle-audit")).toEqual([]);
    expect(issues(rows, "instagram/followers")).not.toEqual([]);
  });
  it("a free-text query is not a subject; handle/url/id/slug params are", () => {
    // tiktok/search has query=cooking recipes
    expect(issues({ items: [{ post: { author: { username: "cooking", display_name: "cooking" } } }] }, "tiktok/search")).not.toEqual([]);
    expect(issues({ items: [{ post: { author: { username: "elonmusk" } } }] }, "twitter/user/tweets")).toEqual([]);
  });
  it("*_handle and *_nickname are person identity whatever the prefix", () => {
    expect(issues({ items: [{ author: { company_handle: "janedoe92", page_nickname: "Jane" } }] }, "tiktok/search")).not.toEqual([]);
    expect(issues({ items: [{ place: { company_name: "Acme", store_username_hint: "x" } }] }, "yelp/search")).toEqual([]);
  });
  it("DFS is a banned supplier token as a whole word, case-sensitive", async () => {
    const { findBanned } = await import("../resources/supplier-tokens.js");
    expect(findBanned("via DFS labs")).toBe("DFS");
    expect(findBanned("dfs-tiktok")).toBeUndefined();
    expect(findBanned("DFSX")).toBeUndefined();
  });
});

describe("exemption reach: the owner's own lists stay exempt (final review)", () => {
  it("the queried item's own author may carry its own lists (about info, topics)", () => {
    expect(issues({ author: { username: "someone", ext: { group: { about_info: [{ label: "Public", description: "Anyone can see who is in the group" }] }, topicCategories: ["https://en.wikipedia.org/wiki/Lifestyle_(sociology)"] } } }, "facebook/group")).toEqual([]);
    expect(issues({ author: { username: "someone", ext: { topicCategories: ["https://en.wikipedia.org/wiki/Entertainment"] } } }, "youtube/channel")).toEqual([]);
  });
  it("the subject's own picture list on a comments endpoint is not a person row", () => {
    expect(issues({ post: { author: { username: "williamhgates", profilePictures: [{ width: 200, url: "https://media.licdn.com/x.jpg" }] } } }, "linkedin/post/with-comments")).toEqual([]);
  });
  it("an editorial FAQ or a review prompt is not what a person wrote", () => {
    expect(issues({ faq: { questions: [{ question: "What are the types of headphones?", answer: "Over-ear, on-ear and in-ear." }] } }, "klarna/category/guide")).toEqual([]);
    expect(issues({ product: { pros: [{ related_reviews: [{ reviewer: "user_d5bde6", question: "What do you like about Postman?", content: "Sample comment text (redacted)." }] }] } }, "g2/product")).toEqual([]);
    expect(issues({ items: [{ UserNickname: "user_a1b2c3", QuestionSummary: "Does it fit a king bed" }] }, "kohls/questions")).not.toEqual([]);
  });
});
