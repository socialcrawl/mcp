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
  it("defaults to 30s for a plain sync endpoint", () => {
    expect(timeoutSecondsFor(base({}))).toBe(DEFAULT_TIMEOUT_S);
    // The bundled tiktok/profile carries a 20s budget (dump v4): 20 + 5.
    expect(timeoutSecondsFor(findEndpoint("tiktok", "profile"))).toBe(25);
    expect(DEFAULT_TIMEOUT_S).toBe(30);
    expect(timeoutSecondsFor(undefined)).toBe(30);
  });

  it("prefers recommended_timeout_s when it is a number", () => {
    expect(timeoutSecondsFor(base({ recommended_timeout_s: 45, budget_ms: 9000, streaming: "always" }))).toBe(45);
  });

  it("falls back to budget_ms (ms to s) plus a 5s margin", () => {
    expect(timeoutSecondsFor(base({ budget_ms: 20_000 }))).toBe(25);
    expect(timeoutSecondsFor(base({ budget_ms: 20_001, recommended_timeout_s: null }))).toBe(26);
  });

  it("uses 120s for a streaming endpoint and 30s for an async submit", () => {
    expect(timeoutSecondsFor(base({ streaming: "always" }))).toBe(120);
    expect(timeoutSecondsFor(base({ execution: "async" }))).toBe(30);
  });

  it("caps at 120s whatever the data says", () => {
    expect(timeoutSecondsFor(base({ recommended_timeout_s: 600 }))).toBe(MAX_TIMEOUT_S);
    expect(timeoutSecondsFor(base({ budget_ms: 300_000 }))).toBe(120);
  });

  it("ignores non-positive or non-finite values", () => {
    expect(timeoutSecondsFor(base({ recommended_timeout_s: 0 }))).toBe(30);
    expect(timeoutSecondsFor(base({ recommended_timeout_s: Number.NaN }))).toBe(30);
  });

  it("bundled streaming endpoints all get the streaming default today", () => {
    expect(timeoutSecondsFor(findEndpoint("prism", "answers"))).toBe(120);
    expect(timeoutSecondsFor(findEndpoint("search", "everywhere"))).toBe(120);
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
