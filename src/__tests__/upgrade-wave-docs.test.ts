import { describe, it, expect } from "vitest";
import { getDoc } from "../data/docs.js";

/**
 * The 2.2.0 wave's behaviour changes that live in the router, not in any one
 * endpoint's registry copy, so the generated data cannot carry them: each must
 * reach the docs topic an agent reads for that subject.
 */
describe("2.2.0 router behaviour is documented", () => {
  it("batch-jobs: any GET runs as a job with async=true, polled free (API-071)", () => {
    const doc = getDoc("batch-jobs")!;
    expect(doc).toContain("async=true");
    expect(doc).toContain("Prefer: respond-async");
    expect(doc).toContain("/v1/prism/jobs/{job_id}");
  });

  it("pagination: next_page_credits and typical_page_size (API-050)", () => {
    const doc = getDoc("pagination")!;
    expect(doc).toContain("next_page_credits");
    expect(doc).toContain("typical_page_size");
  });

  it("errors: common param names are renamed, feed paths aliased, bad single-source input is a free 400 (API-051, API-105)", () => {
    const doc = getDoc("errors")!;
    expect(doc).toMatch(/sort.*country.*limit.*since.*until/s);
    expect(doc).toContain("profile/posts");
    expect(doc).toContain("INVALID_REQUEST");
  });

  it("response-schema: format=raw carries no source billing fields (API-104)", () => {
    const doc = getDoc("response-schema")!;
    expect(doc).toContain("format=raw");
    expect(doc).toContain("credits_remaining");
  });
});
