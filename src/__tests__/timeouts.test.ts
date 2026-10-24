import { describe, it, expect } from "vitest";
import { timeoutSecondsFor, MAX_TIMEOUT_S, DEFAULT_TIMEOUT_S, wantsStream } from "../timeouts.js";
import { findEndpoint } from "../data/endpoints.js";
import type { Endpoint } from "../types.js";

// A plain sync endpoint with no latency data (dump v4 gives tiktok/profile a budget).
const base = (over: Partial<Endpoint>): Endpoint => ({
  ...(findEndpoint("tiktok", "profile") as Endpoint),
  budget_ms: undefined,
  recommended_timeout_s: undefined,
  ...over,
});

describe("timeoutSecondsFor", () => {
  it("defaults to the 60s floor the API recommends for a plain sync endpoint", () => {
    expect(timeoutSecondsFor(base({}))).toBe(DEFAULT_TIMEOUT_S);
    // A fast endpoint's measured latency is not a deadline: the floor holds.
    expect(timeoutSecondsFor(findEndpoint("tiktok", "profile"))).toBe(60);
    expect(DEFAULT_TIMEOUT_S).toBe(60);
    expect(timeoutSecondsFor(undefined)).toBe(60);
  });

  it("prefers recommended_timeout_s (plus a 5s margin) when it is a number", () => {
    expect(timeoutSecondsFor(base({ recommended_timeout_s: 90, budget_ms: 9000, streaming: "always" }))).toBe(95);
    expect(timeoutSecondsFor(base({ recommended_timeout_s: 45 }))).toBe(60);
  });

  it("falls back to budget_ms (ms to s) plus a 5s margin, above the floor", () => {
    expect(timeoutSecondsFor(base({ budget_ms: 70_000 }))).toBe(75);
    expect(timeoutSecondsFor(base({ budget_ms: 70_001, recommended_timeout_s: null }))).toBe(76);
    expect(timeoutSecondsFor(base({ budget_ms: 20_000 }))).toBe(60);
  });

  it("uses 120s for an unmeasured streaming endpoint and the floor for an async submit", () => {
    expect(timeoutSecondsFor(base({ streaming: "always" }))).toBe(120);
    expect(timeoutSecondsFor(base({ execution: "async" }))).toBe(60);
  });

  it("caps at 120s whatever the data says", () => {
    expect(timeoutSecondsFor(base({ recommended_timeout_s: 600 }))).toBe(MAX_TIMEOUT_S);
    expect(timeoutSecondsFor(base({ budget_ms: 300_000 }))).toBe(120);
  });

  it("ignores non-positive or non-finite values", () => {
    expect(timeoutSecondsFor(base({ recommended_timeout_s: 0 }))).toBe(60);
    expect(timeoutSecondsFor(base({ recommended_timeout_s: Number.NaN }))).toBe(60);
  });

  it("bundled streaming endpoints get their measured recommendation, never below the floor", () => {
    for (const [p, r] of [["prism", "answers"], ["search", "everywhere"]] as const) {
      const e = findEndpoint(p, r)!;
      const t = timeoutSecondsFor(e);
      expect(t).toBeGreaterThanOrEqual(60);
      expect(t).toBeLessThanOrEqual(120);
      if (e.recommended_timeout_s) expect(t).toBeGreaterThan(Math.min(e.recommended_timeout_s, 115));
    }
  });
});

describe("wantsStream", () => {
  it("is true for streaming=always", () => {
    expect(wantsStream(findEndpoint("prism", "answers"), { query: "q" })).toBe(true);
  });
  it("is true only when the registry's trigger param carries the value", () => {
    const e = findEndpoint("prism", "video-intel");
    expect(wantsStream(e, { url: "u", include: "commenter_profiles,transcript" })).toBe(true);
    expect(wantsStream(e, { url: "u", include: "commenter_profiles" })).toBe(false);
    expect(wantsStream(e, { url: "u" })).toBe(false);
  });
  it("leaves accept-header endpoints on JSON", () => {
    expect(wantsStream(findEndpoint("search", "everywhere"), { query: "q" })).toBe(false);
  });
  it("is false with no endpoint or no streaming", () => {
    expect(wantsStream(undefined, {})).toBe(false);
    expect(wantsStream(findEndpoint("tiktok", "profile"), {})).toBe(false);
  });
});
