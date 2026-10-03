import { describe, it, expect, vi, afterEach } from "vitest";
import { noteRoute, routeMissing, ROUTE_MISSING_TTL_MS } from "../discovery-routes.js";
import { endpointStructured } from "../tools/endpoint.js";
import type { ApiContext } from "../context.js";

const BASE = "https://www.socialcrawl.dev";
const PATH = "/v1/utility/endpoint";
/** What apiRequest renders for an HTTP error: message line plus the status / error_code tail. */
const err = (status: number, type: string, message: string): string => `Error: ${message}\nstatus: ${status}\nerror_code: ${type}`;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("route-not-deployed memo", () => {
  it("marks a route missing only on the router's ENDPOINT_NOT_FOUND for that route's own path", () => {
    noteRoute(BASE, PATH, err(404, "ENDPOINT_NOT_FOUND", "Unknown endpoint: /v1/utility/endpoint."));
    expect(routeMissing(BASE, PATH)).toBe(true);
  });

  it("never on a deployed route's 404 for an unknown id", () => {
    noteRoute(BASE, PATH, err(404, "RESOURCE_NOT_FOUND", "Unknown endpoint 'tiktok/nope'. GET /v1/utility/endpoints returns the full catalog."));
    noteRoute(BASE, PATH, err(404, "NOT_FOUND", "Unknown endpoint 'tiktok/nope'."));
    expect(routeMissing(BASE, PATH)).toBe(false);
  });

  it("never on another path's ENDPOINT_NOT_FOUND, a 405, or a 404 without an error code", () => {
    noteRoute(BASE, PATH, err(404, "ENDPOINT_NOT_FOUND", "Unknown endpoint: /v1/tiktok/nope."));
    noteRoute(BASE, PATH, err(405, "METHOD_NOT_ALLOWED", "Method not allowed"));
    noteRoute(BASE, PATH, "Error: not found\nstatus: 404");
    expect(routeMissing(BASE, PATH)).toBe(false);
  });

  it("forgets after the TTL, so a newly deployed route is picked up", () => {
    vi.useFakeTimers();
    noteRoute(BASE, PATH, err(404, "ENDPOINT_NOT_FOUND", "Unknown endpoint: /v1/utility/endpoint."));
    expect(routeMissing(BASE, PATH)).toBe(true);
    vi.advanceTimersByTime(ROUTE_MISSING_TTL_MS + 1);
    expect(routeMissing(BASE, PATH)).toBe(false);
  });

  it("an unknown-id 404 from the deployed endpoint route does not stop the next live contract", async () => {
    const ctx: ApiContext = { apiKey: "sc_test_key_1234567890", baseUrl: BASE };
    let calls = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      calls++;
      if (url.includes("tiktok%2Fpost%2Fcomments")) {
        return new Response(JSON.stringify({ success: true, data: { credits: { pricing_notes: "live rule" } } }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ success: false, error: { type: "RESOURCE_NOT_FOUND", message: "Unknown endpoint 'tiktok/profile'." } }),
        { status: 404 },
      );
    });
    const first = await endpointStructured(ctx, { id: "tiktok/profile" });
    expect(first.structured.source).toBe("bundled");
    const second = await endpointStructured(ctx, { id: "tiktok/post/comments" });
    expect(second.structured.source).toBe("live");
    expect(calls).toBe(2);
  });
});

describe("route path matching", () => {
  it("does not take /v1/utility/endpoints for /v1/utility/endpoint", () => {
    noteRoute(BASE, PATH, err(404, "ENDPOINT_NOT_FOUND", "Unknown endpoint: /v1/utility/endpoints/x."));
    expect(routeMissing(BASE, PATH)).toBe(false);
  });
});
