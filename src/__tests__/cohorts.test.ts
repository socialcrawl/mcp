import { describe, it, expect, vi, afterEach } from "vitest";
import { cohorts, creditCeiling, COHORT_IDENTITY_PLATFORMS } from "../tools/cohorts.js";
import { getDoc, getAvailableTopics } from "../data/docs.js";
import type { ApiContext } from "../context.js";

const ctx: ApiContext = { apiKey: "sc_test_key", baseUrl: "https://www.socialcrawl.dev" };
const anonCtx: ApiContext = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };

/** A well-formed id: the API mints a 21-character nanoid. */
const COHORT_ID = "ziJygy91eDlzFJLzzUgIY";
const QUERY_ID = "abcdefghijklmnopqrstu";

afterEach(() => {
  vi.restoreAllMocks();
});

interface Captured {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
}

function stubFetch(status: number, payload: unknown): () => Captured {
  const cap: Captured = { url: "", method: "", headers: {} };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    cap.url = url;
    cap.method = (init.method ?? "GET").toString();
    cap.body = init.body as string | undefined;
    cap.headers = (init.headers as Record<string, string>) ?? {};
    return new Response(status === 204 ? null : JSON.stringify(payload), { status });
  });
  return () => cap;
}

/** Assert a call never leaves the process. */
function forbidFetch(): ReturnType<typeof vi.fn> {
  const spy = vi.fn();
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("socialcrawl_cohorts lifecycle", () => {
  it("requires an API key", async () => {
    const out = await cohorts(anonCtx, { action: "get", cohort_id: COHORT_ID });
    expect(out).toContain("No API key configured");
  });

  it("creates a cohort and reports it costs nothing", async () => {
    const cap = stubFetch(201, { id: COHORT_ID, member_count: 0, retention_days: 30 });
    const out = await cohorts(ctx, { action: "create", name: "August panel", retention_days: 45 });
    expect(cap().method).toBe("POST");
    expect(cap().url).toBe("https://www.socialcrawl.dev/v1/cohorts");
    expect(JSON.parse(cap().body!)).toEqual({ name: "August panel", retention_days: 45 });
    expect(out).toContain("**Credit cost:** 0 credits");
    expect(out).toContain(COHORT_ID);
  });

  it("uploads members as a PUT with the identity array", async () => {
    const cap = stubFetch(200, { inserted: 2, updated: 0, unchanged: 0, member_count: 2 });
    const out = await cohorts(ctx, {
      action: "add_members",
      cohort_id: COHORT_ID,
      members: [
        { external_id: "buyer_1", platform: "instagram", handle: "natgeo" },
        { external_id: "buyer_2", platform: "youtube", handle: "mkbhd" },
      ],
    });
    expect(cap().method).toBe("PUT");
    expect(cap().url).toContain(`/v1/cohorts/${COHORT_ID}/members`);
    expect(JSON.parse(cap().body!).members).toHaveLength(2);
    expect(out).toContain("2 members");
  });

  it("submits a query and flags it as the only metered call", async () => {
    const cap = stubFetch(202, { query_id: QUERY_ID, status: "queued", reserved_credits: 300 });
    const out = await cohorts(ctx, {
      action: "query",
      cohort_id: COHORT_ID,
      keywords: ["acme", "acme pro"],
      date_from: "2026-08-01T00:00:00.000Z",
      max_pages_per_identity: 3,
      max_items_per_identity: 100,
      max_credits: 300,
    });
    expect(cap().method).toBe("POST");
    expect(cap().url).toContain(`/v1/cohorts/${COHORT_ID}/queries`);
    expect(JSON.parse(cap().body!)).toEqual({
      keywords: ["acme", "acme pro"],
      date_from: "2026-08-01T00:00:00.000Z",
      max_pages_per_identity: 3,
      max_items_per_identity: 100,
      max_credits: 300,
    });
    expect(out).toContain("metered");
  });

  it("polls status and pages results through the query-scoped routes", async () => {
    const status = stubFetch(200, { id: QUERY_ID, status: "succeeded" });
    await cohorts(ctx, { action: "query_status", query_id: QUERY_ID });
    expect(status().url).toBe(`https://www.socialcrawl.dev/v1/cohort-queries/${QUERY_ID}`);

    const results = stubFetch(200, { items: [], coverage: [], next_cursor: null });
    const out = await cohorts(ctx, {
      action: "query_results",
      query_id: QUERY_ID,
      limit: 500,
      cursor: "eyJhIjoxfQ",
    });
    expect(results().url).toContain(`/v1/cohort-queries/${QUERY_ID}/results`);
    expect(results().url).toContain("limit=500");
    expect(results().url).toContain("cursor=eyJhIjoxfQ");
    // Coverage is the field that stops a partial crawl reading as "no mentions".
    expect(out).toContain("Read `coverage`");
  });

  it("cancels a query and deletes a cohort", async () => {
    const cancel = stubFetch(200, { id: QUERY_ID, status: "cancelled" });
    const cancelled = await cohorts(ctx, { action: "query_cancel", query_id: QUERY_ID });
    expect(cancel().method).toBe("DELETE");
    expect(cancelled).toContain("refunded");

    const del = stubFetch(204, null);
    await cohorts(ctx, { action: "delete", cohort_id: COHORT_ID });
    expect(del().method).toBe("DELETE");
    expect(del().url).toBe(`https://www.socialcrawl.dev/v1/cohorts/${COHORT_ID}`);
  });
});

describe("idempotency", () => {
  it("sends a generated key on writes and echoes it so a retry can replay", async () => {
    const cap = stubFetch(201, { id: COHORT_ID });
    const out = await cohorts(ctx, { action: "create" });
    const sent = cap().headers["Idempotency-Key"];
    expect(sent).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(out).toContain(sent);
    expect(out).toContain("(generated)");
  });

  it("prefers the caller's own key without labelling it generated", async () => {
    const cap = stubFetch(201, { id: COHORT_ID });
    const key = "11111111-1111-4111-8111-111111111111";
    const out = await cohorts(ctx, { action: "create", idempotencyKey: key });
    expect(cap().headers["Idempotency-Key"]).toBe(key);
    expect(out).not.toContain("(generated)");
  });

  it("never sends an Idempotency-Key on reads", async () => {
    const cap = stubFetch(200, { id: COHORT_ID });
    await cohorts(ctx, { action: "get", cohort_id: COHORT_ID });
    expect(cap().headers["Idempotency-Key"]).toBeUndefined();
  });
});

describe("local validation costs nothing", () => {
  it("SECURITY: rejects a path-traversal id without contacting the API", async () => {
    const spy = forbidFetch();
    for (const evil of ["../credits/balance", `${COHORT_ID}?x=y`, `${COHORT_ID}/queries`, "..", "a b"]) {
      const out = await cohorts(ctx, { action: "delete", cohort_id: evil });
      expect(out).toContain("Invalid cohort_id");
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects an unsupported identity platform before the upload", async () => {
    const spy = forbidFetch();
    const out = await cohorts(ctx, {
      action: "add_members",
      cohort_id: COHORT_ID,
      members: [{ external_id: "a", platform: "pinterest", handle: "x" }],
    });
    expect(out).toContain("Unsupported cohort platform(s): pinterest");
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects an oversized upload chunk and says how to split it", async () => {
    const spy = forbidFetch();
    const members = Array.from({ length: 1001 }, (_, i) => ({
      external_id: `b${i}`,
      platform: "tiktok",
      handle: `h${i}`,
    }));
    const out = await cohorts(ctx, { action: "add_members", cohort_id: COHORT_ID, members });
    expect(out).toContain("1000-per-upload limit");
    expect(spy).not.toHaveBeenCalled();
  });

  it("names every missing query cap rather than failing on the first", async () => {
    const spy = forbidFetch();
    const out = await cohorts(ctx, {
      action: "query",
      cohort_id: COHORT_ID,
      keywords: ["acme"],
      date_from: "2026-08-01T00:00:00.000Z",
    });
    expect(out).toContain("`max_pages_per_identity`");
    expect(out).toContain("`max_items_per_identity`");
    expect(out).toContain("`max_credits`");
    expect(out).toContain("estimate_cost");
    expect(spy).not.toHaveBeenCalled();
  });

  it("enforces the contract's numeric bounds", async () => {
    const spy = forbidFetch();
    const base = {
      action: "query" as const,
      cohort_id: COHORT_ID,
      keywords: ["acme"],
      date_from: "2026-08-01T00:00:00.000Z",
      max_items_per_identity: 100,
      max_credits: 300,
    };
    expect(await cohorts(ctx, { ...base, max_pages_per_identity: 21 })).toContain(
      "between 1 and 20",
    );
    expect(
      await cohorts(ctx, { ...base, max_pages_per_identity: 3, max_items_per_identity: 1001 }),
    ).toContain("between 1 and 1000");
    expect(await cohorts(ctx, { action: "create", retention_days: 5 })).toContain(
      "between 7 and 90",
    );
    expect(
      await cohorts(ctx, { action: "query_results", query_id: QUERY_ID, limit: 501 }),
    ).toContain("between 1 and 500");
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects more than 20 keywords", async () => {
    const spy = forbidFetch();
    const out = await cohorts(ctx, {
      action: "query",
      cohort_id: COHORT_ID,
      keywords: Array.from({ length: 21 }, (_, i) => `k${i}`),
      date_from: "2026-08-01T00:00:00.000Z",
      max_pages_per_identity: 1,
      max_items_per_identity: 10,
      max_credits: 10,
    });
    expect(out).toContain("exceeds the limit of 20");
    expect(spy).not.toHaveBeenCalled();
  });

  it("asks for the id an action needs", async () => {
    expect(await cohorts(ctx, { action: "query_results" })).toContain("requires a `query_id`");
    expect(await cohorts(ctx, { action: "add_members" })).toContain("requires a `cohort_id`");
  });
});

/**
 * The ceiling is a sum over each platform's activity lanes, and a lane with no
 * cursor contributes ONE page however large the budget is. These expectations
 * mirror `calculateQueryCreditCeiling` over the lane table in the backend's
 * `activity-routes.ts` — the two facts most easily got wrong are that LinkedIn
 * does NOT scale with the page budget and that Twitter DOES.
 */
describe("estimate_cost sizes the reservation locally", () => {
  it("separates the fixed lanes from the cursor-paged ones", () => {
    const { total, rows } = creditCeiling(
      { linkedin: 10, instagram: 10, youtube: 10, tiktok: 10, twitter: 10 },
      3,
    );
    // linkedin 10x5 (one fixed page) = 50, instagram 10x(2x3) = 60,
    // youtube 60, tiktok 10x(1x3) = 30, twitter 10x(1x3) = 30.
    expect(total).toBe(230);
    const by = (p: string) => rows.find((r) => r.platform === p)!;
    expect(by("linkedin").perMember).toBe(5);
    expect(by("twitter").perMember).toBe(3);
    expect(by("instagram").perMember).toBe(6);
  });

  it("does not let a bigger page budget inflate a fixed-window lane", () => {
    // LinkedIn's lane carries no cursor, so 1 page and 20 pages cost the same.
    expect(creditCeiling({ linkedin: 100 }, 1).total).toBe(500);
    expect(creditCeiling({ linkedin: 100 }, 20).total).toBe(500);
    // Twitter's lane does carry one, so it scales.
    expect(creditCeiling({ twitter: 100 }, 1).total).toBe(100);
    expect(creditCeiling({ twitter: 100 }, 20).total).toBe(2000);
  });

  it("computes a ceiling from a members array without calling the API", async () => {
    const spy = forbidFetch();
    const out = await cohorts(ctx, {
      action: "estimate_cost",
      max_pages_per_identity: 3,
      members: [
        { external_id: "a", platform: "linkedin", handle: "https://linkedin.com/in/a" },
        { external_id: "b", platform: "twitter", handle: "b" },
      ],
    });
    // linkedin 5 (fixed) + twitter 1x3 = 8.
    expect(out).toContain("**8 credits**");
    expect(out).toContain("no API call, 0 credits");
    expect(spy).not.toHaveBeenCalled();
  });

  it("accepts a platform_counts breakdown instead of the identities", async () => {
    const out = await cohorts(ctx, {
      action: "estimate_cost",
      max_pages_per_identity: 3,
      platform_counts: { instagram: 4000, youtube: 1000 },
    });
    // (4000 + 1000) x 3 pages x 2 lanes = 30,000.
    expect(out).toContain("30,000 credits");
    expect(out).toContain("at least **30000**");
  });

  it("says what it needs when neither input is given", async () => {
    const out = await cohorts(ctx, { action: "estimate_cost", max_pages_per_identity: 3 });
    expect(out).toContain("`members`");
    expect(out).toContain("`platform_counts`");
  });
});

describe("cohort errors are not mislabelled as idempotency problems", () => {
  it("passes a 409 identity conflict through with its own message", async () => {
    stubFetch(409, {
      error: {
        type: "COHORT_IDENTITY_CONFLICT",
        message: "The normalized identity is already assigned to another external ID.",
      },
    });
    const out = await cohorts(ctx, {
      action: "add_members",
      cohort_id: COHORT_ID,
      members: [{ external_id: "a", platform: "tiktok", handle: "x" }],
    });
    expect(out).toContain("COHORT_IDENTITY_CONFLICT");
    expect(out).not.toContain("Idempotency-Key conflict");
  });

  it("passes a 409 not-ready through when results are read too early", async () => {
    stubFetch(409, {
      error: { type: "COHORT_QUERY_NOT_READY", message: "The query has not succeeded." },
    });
    const out = await cohorts(ctx, { action: "query_results", query_id: QUERY_ID });
    expect(out).toContain("COHORT_QUERY_NOT_READY");
  });

  it("still reports a real idempotency conflict as one", async () => {
    stubFetch(409, {
      error: { type: "IDEMPOTENCY_KEY_CONFLICT", message: "key in use" },
    });
    const out = await cohorts(ctx, { action: "create" });
    expect(out).toContain("Idempotency-Key conflict");
  });
});

describe("the cohorts docs topic", () => {
  const doc = getDoc("cohorts")!;

  it("is offered as a topic", () => {
    expect(getAvailableTopics()).toContain("cohorts");
    expect(doc).toBeTruthy();
  });

  it("documents every route the tool can reach", () => {
    for (const path of [
      "POST /v1/cohorts",
      "PUT /v1/cohorts/:id/members",
      "POST /v1/cohorts/:id/queries",
      "GET /v1/cohort-queries/:id",
      "GET /v1/cohort-queries/:id/results",
      "DELETE /v1/cohort-queries/:id",
    ]) {
      expect(doc, `cohorts doc missing ${path}`).toContain(path);
    }
  });

  it("documents the pricing table, the caps, and the coverage contract", () => {
    expect(doc).toContain("Credits per successful page");
    expect(doc).toContain("actual_credits + refunded_credits");
    expect(doc).toContain("window_complete");
    expect(doc).toContain("Members per cohort | 10,000");
    for (const platform of COHORT_IDENTITY_PLATFORMS) {
      expect(doc, `cohorts doc missing platform ${platform}`).toContain(`\`${platform}\``);
    }
  });
});
