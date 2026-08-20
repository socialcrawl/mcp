import { describe, it, expect } from "vitest";
import { ENDPOINTS, findEndpoint, getEndpointsByPlatform } from "../data/endpoints.js";
import { PLATFORMS } from "../data/platforms.js";
import { WEB_ACTION_RESOURCES } from "../tools/web.js";
import { getDoc } from "../data/docs.js";
import { pricing } from "../tools/pricing.js";
import { listEndpoints } from "../tools/list-endpoints.js";

/**
 * Surface-coverage guarantee: every endpoint the backend serves is reachable
 * through some tool, priced by the pricing tool, and documented.
 *
 * This is the test that fails when the backend adds an endpoint and nobody
 * re-runs the regeneration pipeline — or when a new stateful family lands that
 * `socialcrawl_request` cannot express and no dedicated tool covers yet.
 */

/**
 * `web/parse` is a multipart/form-data upload: the handler requires a real
 * `File` part, which a JSON-only MCP input cannot carry. It is deliberately
 * documented rather than exposed, and this is the single sanctioned exception.
 */
const MULTIPART_ONLY = new Set(["web/parse"]);

describe("every endpoint is callable through a tool", () => {
  it("routes every non-web endpoint through socialcrawl_request", () => {
    for (const e of ENDPOINTS) {
      if (e.platform === "web") continue;
      // `request` resolves the endpoint with findEndpoint before calling out;
      // if that lookup fails, the endpoint is unreachable through the tool.
      expect(
        findEndpoint(e.platform, e.resource, e.method),
        `${e.method} ${e.platform}/${e.resource} is not resolvable by socialcrawl_request`,
      ).toBeDefined();
    }
  });

  it("maps every web endpoint to a socialcrawl_web action", () => {
    const covered = new Set(WEB_ACTION_RESOURCES.map((r) => `${r.method} ${r.resource}`));
    for (const e of getEndpointsByPlatform("web")) {
      if (MULTIPART_ONLY.has(`${e.platform}/${e.resource}`)) continue;
      expect(
        covered.has(`${e.method} ${e.resource}`),
        `web ${e.method} ${e.resource} has no socialcrawl_web action`,
      ).toBe(true);
    }
  });

  it("every socialcrawl_web action points at a real route", () => {
    for (const spec of WEB_ACTION_RESOURCES) {
      // Two actions (job_errors, crawl_preview) are stateful-router-only helper
      // routes with no registry row; everything else must resolve.
      const isHelper =
        spec.resource === "jobs/{job_id}/errors" || spec.resource === "crawl/params-preview";
      if (isHelper) continue;
      expect(
        findEndpoint("web", spec.resource, spec.method),
        `socialcrawl_web action targets unknown web endpoint ${spec.method} ${spec.resource}`,
      ).toBeDefined();
    }
  });
});

describe("every endpoint is priced", () => {
  it("appears in the pricing overview or its platform table", () => {
    for (const platform of PLATFORMS) {
      const table = pricing({ action: "platform", platform: platform.slug });
      for (const e of getEndpointsByPlatform(platform.slug)) {
        const label = e.method === "GET" ? e.resource : `${e.method} ${e.resource}`;
        expect(table, `${platform.slug} pricing table missing ${label}`).toContain(`\`${label}\``);
      }
    }
  });

  it("resolves a per-endpoint pricing detail for every endpoint", () => {
    for (const e of ENDPOINTS) {
      const out = pricing({
        action: "endpoint",
        platform: e.platform,
        resource: e.resource,
        method: e.method,
      });
      expect(out, `no pricing detail for ${e.method} ${e.platform}/${e.resource}`).not.toContain(
        "Error:",
      );
    }
  });
});

describe("every endpoint is documented", () => {
  it("appears in its platform docs topic", () => {
    for (const platform of PLATFORMS) {
      const doc = getDoc(platform.slug)!;
      for (const e of getEndpointsByPlatform(platform.slug)) {
        expect(
          doc,
          `${platform.slug} docs missing ${e.method} /v1/${e.platform}/${e.resource}`,
        ).toContain(`## ${e.method} /v1/${e.platform}/${e.resource}`);
      }
    }
  });

  it("appears in its platform listing, across pages", () => {
    for (const platform of PLATFORMS) {
      const first = listEndpoints({ platform: platform.slug });
      const match = first.match(/\[Page 1 of (\d+)\./);
      const total = match ? Number(match[1]) : 1;
      let all = "";
      for (let i = 1; i <= total; i += 1) {
        all += listEndpoints({ platform: platform.slug, page: i });
      }
      for (const e of getEndpointsByPlatform(platform.slug)) {
        expect(
          all,
          `${platform.slug} listing missing ${e.method} ${e.resource}`,
        ).toContain(`\`${e.method} ${e.resource}\``);
      }
    }
  });
});

describe("every parameter is surfaced", () => {
  it("prints every required and optional param in the platform listing", () => {
    for (const platform of PLATFORMS) {
      const first = listEndpoints({ platform: platform.slug });
      const match = first.match(/\[Page 1 of (\d+)\./);
      const total = match ? Number(match[1]) : 1;
      let all = "";
      for (let i = 1; i <= total; i += 1) {
        all += listEndpoints({ platform: platform.slug, page: i });
      }
      for (const e of getEndpointsByPlatform(platform.slug)) {
        for (const p of [...e.params, ...e.optionalParams]) {
          expect(
            all,
            `${platform.slug} listing missing param \`${p.name}\` of ${e.method} ${e.resource}`,
          ).toContain(`\`${p.name}\``);
        }
      }
    }
  });

  it("prints every enum value so an agent never has to guess", () => {
    for (const platform of PLATFORMS) {
      const first = listEndpoints({ platform: platform.slug });
      const match = first.match(/\[Page 1 of (\d+)\./);
      const total = match ? Number(match[1]) : 1;
      let all = "";
      for (let i = 1; i <= total; i += 1) {
        all += listEndpoints({ platform: platform.slug, page: i });
      }
      for (const e of getEndpointsByPlatform(platform.slug)) {
        for (const opt of e.optionalParams) {
          if (opt.type !== "enum" || !opt.enumValues) continue;
          expect(
            all,
            `${platform.slug} listing missing enum values for \`${opt.name}\` of ${e.resource}`,
          ).toContain(opt.enumValues.join("|"));
        }
      }
    }
  });
});
