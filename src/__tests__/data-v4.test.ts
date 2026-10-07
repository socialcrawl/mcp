import { describe, it, expect } from "vitest";
import { ENDPOINTS, findEndpoint } from "../data/endpoints.js";
import { outputsFor, pagingFor } from "../data/outputs.js";
import { REGISTRY_STATS } from "../data/registry-meta.js";
import type { EndpointPurpose, EndpointTaxonomy } from "../types.js";

/**
 * Registry dump schema v4 (purpose, taxonomy, outputs, latency) flows into the
 * bundled data, so the ranker and the endpoint contract read it offline.
 */
describe("dump v4 data", () => {
  it("every endpoint carries a purpose with a summary", () => {
    expect(ENDPOINTS).toHaveLength(REGISTRY_STATS.totalEndpoints);
    for (const e of ENDPOINTS) {
      expect(e.purpose?.summary, `${e.platform}/${e.resource}`).toBeTruthy();
    }
  });

  it("carries returns / use_when / not_for and the taxonomy", () => {
    const comments = findEndpoint("tiktok", "post/comments")!;
    expect(comments.purpose!.returns).toMatch(/comments/i);
    expect(comments.purpose!.use_when).toMatch(/comment/i);
    expect(comments.taxonomy?.job_family).toBe("engagement_thread");
    const li = findEndpoint("linkedin", "profile")!;
    expect(li.purpose!.not_for).toMatch(/^Not for/);
  });

  it("carries measured latency where the registry has it", () => {
    const withLatency = ENDPOINTS.filter((e) => e.latency_ms);
    expect(withLatency.length).toBeGreaterThan(10);
    const p = findEndpoint("tiktok", "profile")!;
    expect(p.latency_ms!.p50).toBeGreaterThan(0);
  });

  it("exposes the output contract per endpoint, absent meaning/fill/live as null", () => {
    const out = outputsFor(findEndpoint("tiktok", "post/comments")!)!;
    expect(out.rows_at).toBe("data.items[].comment");
    expect(out.archetype).toBe("CommentList");
    const text = out.fields.find((f) => f.path === "comment.text");
    expect(text).toBeDefined();
    expect(typeof text!.type).toBe("string");
    const language = out.fields.find((f) => f.path === "computed.language")!;
    expect(language.meaning).toBeNull();
    expect(language.fill).toBeNull();
    expect(language.live).toBeNull();
    const optIn = out.fields.find((f) => f.opt_in);
    expect(optIn?.opt_in).toMatch(/=/);
  });

  it("has an outputs entry for every endpoint", () => {
    for (const e of ENDPOINTS) expect(outputsFor(e), `${e.platform}/${e.resource}`).toBeDefined();
  });

  it("carries the contract paging block (page size, source, captures, depth, price)", () => {
    const followers = pagingFor(findEndpoint("instagram", "followers")!)!;
    expect(followers).toMatchObject({
      style: "cursor",
      page_size: 50,
      page_size_source: "declared",
      observed_n: null,
      max_pages: null,
      per_n_items: "ceil(N/50) x 5-10",
      price_basis: "per_page",
      credits_per_page: { min: 5, max: 10 },
      credits_per_row: null,
    });
    expect(pagingFor(findEndpoint("instagram", "profile/posts/full")!)!.page_size).toBe(12);
    expect(pagingFor(findEndpoint("tiktok", "profile")!)).toBeUndefined();
    const sized = ENDPOINTS.filter((e) => pagingFor(e)?.page_size);
    expect(sized.length).toBeGreaterThanOrEqual(127);
  });
});

/**
 * A registry endpoint can ship before its purpose copy or taxonomy label is
 * written; the dump then carries nulls. The bundled types must accept them
 * (`tsc` over src/data/endpoints.ts is the build gate), so one incomplete
 * endpoint cannot break the build.
 */
describe("incomplete purpose and taxonomy", () => {
  it("types every purpose copy and taxonomy label as nullable", () => {
    const purpose: EndpointPurpose = { summary: null, returns: null, use_when: null, not_for: null };
    const taxonomy: EndpointTaxonomy = { purpose: null, job_family: null, takes_item_id_from_another_endpoint: false };
    expect(Object.values(purpose).every((v) => v === null)).toBe(true);
    expect(taxonomy.purpose ?? taxonomy.job_family).toBeNull();
  });

  it("falls back to the endpoint summary wherever a purpose summary is missing", () => {
    for (const e of ENDPOINTS) expect(e.purpose?.summary ?? e.summary, `${e.platform}/${e.resource}`).toBeTruthy();
  });
});

describe("endpoint contract with a null purpose summary", () => {
  it("falls back to the endpoint summary", async () => {
    const { contractFor } = await import("../tools/endpoint.js");
    const base = findEndpoint("tiktok", "profile")!;
    const e = { ...base, purpose: { summary: null, returns: null, use_when: null, not_for: null } };
    expect((contractFor(e).purpose as { summary: string }).summary).toBe(base.summary);
  });
});
