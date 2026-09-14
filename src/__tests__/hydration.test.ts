import { describe, it, expect } from "vitest";
import { ENDPOINTS, findEndpoint } from "../data/endpoints.js";
import { getDoc } from "../data/docs.js";
import { paginate } from "../paginate.js";
import { pricing } from "../tools/pricing.js";
import { listEndpoints } from "../tools/list-endpoints.js";
import {
  csvHas,
  hydratingEndpoints,
  hydrationSlotCount,
  hydrationTokens,
  laneCeilingCredits,
  laneMaxCredits,
  quoteHydration,
} from "../hydration.js";
import { formatCost, priceDrivingParams } from "../pricing.js";

/**
 * Row hydration — the opt-in `include=` joins (backend: `hydrate-list.ts`,
 * `hydrate/pricing.ts`).
 *
 * Two classes of guarantee live here.
 *
 * **The arithmetic must match the backend's**, because the MCP quotes a number
 * a customer budgets against. The hold is not something we approximate from
 * prose: `quoteHydration` is a port of `hydrationUpfrontCostAll`, and if the
 * two ever disagree the MCP is lying about money. The reconciliation test
 * below is the one that catches that — it re-derives every metered band from
 * the lanes and checks it against the band the registry authored.
 *
 * **The surfaces must not hide a join.** 26 endpoints stopped being a flat
 * ladder price the day they learned to hydrate; an agent that cannot see the
 * token pays for a page and then pays again, per row, to fill it in.
 */

const ENDPOINTS_WITH_JOINS = hydratingEndpoints();

describe("the hydration lanes are present and well-formed", () => {
  it("ships the lanes the backend declares", () => {
    // A floor, not an equality: a new lane must not silently fail to appear,
    // but the count moves with every hydration wave and is not itself news.
    expect(ENDPOINTS_WITH_JOINS.length).toBeGreaterThanOrEqual(28);
  });

  it("gives every lane a sibling, a rate, a cap and warning tokens", () => {
    for (const e of ENDPOINTS_WITH_JOINS) {
      for (const lane of e.hydration!) {
        const where = `${e.platform}/${e.resource} include=${lane.token}`;
        expect(lane.token, `${where}: empty token`).toBeTruthy();
        expect(lane.param, `${where}: no opt-in param`).toBe("include");
        expect(lane.fills.length, `${where}: joins nothing`).toBeGreaterThan(0);
        expect(lane.creditsPerItem, `${where}: no per-row rate`).toBeGreaterThan(0);
        expect(lane.maxItems, `${where}: no row cap`).toBeGreaterThan(0);
        expect(lane.warnings.unavailable, `${where}: no warning token`).toBeTruthy();
        expect(lane.warnings.partial, `${where}: no partial token`).toBeTruthy();
      }
    }
  });

  it("points every lane at a sibling that exists in this build", () => {
    for (const e of ENDPOINTS_WITH_JOINS) {
      for (const lane of e.hydration!) {
        const slash = lane.sibling.indexOf("/");
        const platform = lane.sibling.slice(0, slash);
        const resource = lane.sibling.slice(slash + 1);
        expect(
          findEndpoint(platform, resource, lane.siblingMethod),
          `${e.platform}/${e.resource} joins to ${lane.sibling}, which this build does not carry`,
        ).toBeDefined();
        // A join is priced at the sibling's work, so it only makes sense on
        // the same platform — a cross-platform join would be a different
        // product (that is what Prism is for).
        expect(platform, `${e.platform}/${e.resource} joins off-platform`).toBe(e.platform);
      }
    }
  });

  it("declares every lane's token as an accepted value of `include`", () => {
    for (const e of ENDPOINTS_WITH_JOINS) {
      const spec = e.optionalParams.find((p) => p.name === "include");
      expect(spec, `${e.platform}/${e.resource} hydrates but declares no \`include\` param`).toBeDefined();
      const allowed = new Set(
        [...(spec!.enumValues ?? []), ...(e.csvConstraints?.include?.enumValues ?? [])].map((v) =>
          v.toLowerCase(),
        ),
      );
      for (const token of hydrationTokens(e)) {
        expect(
          allowed.has(token.toLowerCase()),
          `${e.platform}/${e.resource}: \`${token}\` is a lane but not an accepted \`include\` value, so the API would 400 it`,
        ).toBe(true);
      }
    }
  });

  it("lets a multi-token endpoint actually send both tokens", () => {
    for (const e of ENDPOINTS_WITH_JOINS) {
      if (e.hydration!.length < 2) continue;
      const csv = e.csvConstraints?.include;
      expect(
        csv,
        `${e.platform}/${e.resource} offers ${e.hydration!.length} tokens but declares no CSV constraint on \`include\``,
      ).toBeDefined();
      expect(
        csv!.max ?? Infinity,
        `${e.platform}/${e.resource}: CSV max is below its own token count`,
      ).toBeGreaterThanOrEqual(e.hydration!.length);
    }
  });
});

describe("the quote matches the backend's pricer", () => {
  it("charges nothing extra without a token", () => {
    for (const e of ENDPOINTS_WITH_JOINS) {
      const quote = quoteHydration(e, undefined);
      expect(
        quote.held,
        `${e.platform}/${e.resource} charges for a join the caller never asked for`,
      ).toBe(e.pricing.cost);
      expect(quote.lanes).toHaveLength(0);
    }
  });

  it("reconciles the full-page ceiling with the registry's own metered band", () => {
    // The strongest check available: two independent derivations of the same
    // number. `maxCost` is authored on the backend's pricing descriptor; the
    // right-hand side is rebuilt here from the lanes. A drift in either is a
    // wrong price quoted to a customer.
    //
    // Endpoints whose meter has a second, non-hydration component (a deep
    // `limit` lane on Threads, query relaxation on Threads search) price
    // strictly above their joins, so they are asserted as a bound.
    for (const e of ENDPOINTS_WITH_JOINS) {
      if (e.pricing.maxCost === undefined) continue;
      const fromLanes =
        e.pricing.cost + e.hydration!.reduce((sum, l) => sum + laneMaxCredits(l), 0);
      expect(
        e.pricing.maxCost,
        `${e.platform}/${e.resource}: band ceiling ${e.pricing.maxCost} is below what its lanes can hold (${fromLanes})`,
      ).toBeGreaterThanOrEqual(fromLanes);
    }
  });

  it("reconciles exactly on a lane that is the whole meter", () => {
    // Pinterest search is a clean case: 1cr page, one lane, 1cr x 25 rows.
    const e = findEndpoint("pinterest", "search")!;
    expect(formatCost(e.pricing)).toBe("1-26cr (metered)");
    expect(quoteHydration(e, "engagement").held).toBe(26);
    expect(quoteHydration(e, "engagement", 5).held).toBe(6);
    expect(quoteHydration(e, undefined).held).toBe(1);
  });

  it("caps a batch sibling at the cheaper of per-row and per-chunk", () => {
    // YouTube joins to a 50-id batch sibling capped at 5 credits a chunk, so
    // 50 rows cost 5 and not 50 — the join can never cost more than calling
    // the sibling directly would.
    const e = findEndpoint("youtube", "playlist")!;
    const engagement = e.hydration!.find((l) => l.token === "engagement")!;
    expect(engagement.batch).toEqual({ size: 50, creditCap: 5 });
    expect(laneMaxCredits(engagement)).toBe(5);
    expect(quoteHydration(e, "engagement,channel").held).toBe(11);
    expect(quoteHydration(e, "engagement").held).toBe(6);
  });

  it("honours a lane's default row cap rather than the whole page", () => {
    // The Instagram similar roster holds its top 20 by default, not all 80 —
    // the fix for a join that refused callers who could afford what they would
    // actually have paid.
    const e = findEndpoint("instagram", "similar")!;
    const lane = e.hydration![0];
    expect(lane.defaultRowLimit).toBe(20);
    expect(lane.maxItems).toBe(80);
    expect(hydrationSlotCount(lane)).toBe(20);
    expect(hydrationSlotCount(lane, 80)).toBe(80);
    expect(quoteHydration(e, "profile").held).toBe(e.pricing.cost + 20);
    expect(quoteHydration(e, "profile", 80).held).toBe(e.pricing.cost + 80);
  });

  it("clamps a row cap to the lane's own maximum", () => {
    const e = findEndpoint("linkedin", "search/people")!;
    const lane = e.hydration![0];
    expect(hydrationSlotCount(lane, 999)).toBe(lane.maxItems);
    expect(quoteHydration(e, "profile", 999).held).toBe(e.pricing.cost + 4 * lane.maxItems);
    expect(quoteHydration(e, "profile", 3).held).toBe(22);
  });

  it("matches CSV tokens the way the backend does — trimmed, case-insensitive", () => {
    expect(csvHas("foo, Engagement", "engagement")).toBe(true);
    expect(csvHas("engagement,channel", "channel")).toBe(true);
    expect(csvHas("engagements", "engagement")).toBe(false);
    expect(csvHas(undefined, "engagement")).toBe(false);
  });

  it("names an unknown token instead of silently pricing it at zero", () => {
    const e = findEndpoint("pinterest", "search")!;
    const quote = quoteHydration(e, "engagement,nonsense");
    expect(quote.unknownTokens).toEqual(["nonsense"]);
    expect(quote.held).toBe(26);
  });

  it("never quotes a floor above the ceiling", () => {
    for (const e of ENDPOINTS_WITH_JOINS) {
      for (const lane of e.hydration!) {
        expect(laneCeilingCredits(lane)).toBeLessThanOrEqual(laneMaxCredits(lane));
      }
    }
  });
});

describe("no surface hides a join", () => {
  it("names `include` as a price driver on every hydrating endpoint", () => {
    for (const e of ENDPOINTS_WITH_JOINS) {
      expect(
        priceDrivingParams(e),
        `${e.platform}/${e.resource} does not report \`include\` as moving the bill`,
      ).toContain("include");
    }
  });

  it("prices every lane through the pricing tool's endpoint action", () => {
    for (const e of ENDPOINTS_WITH_JOINS) {
      const out = pricing({
        action: "endpoint",
        platform: e.platform,
        resource: e.resource,
      });
      expect(out, `${e.platform}/${e.resource} pricing omits the join`).toContain("Row hydration");
      for (const lane of e.hydration!) {
        expect(
          out,
          `${e.platform}/${e.resource} pricing omits the \`${lane.token}\` token`,
        ).toContain(`include=${lane.token}`);
      }
    }
  });

  it("quotes an exact hold when the caller says what they will send", () => {
    const out = pricing({
      action: "endpoint",
      platform: "linkedin",
      resource: "search/people",
      include: "profile",
      rows: 3,
    });
    expect(out).toContain("## Your quote");
    expect(out).toContain("holds **22 credits**");
  });

  it("catalogues every lane in the pricing tool's hydration action", () => {
    const out = pricing({ action: "hydration" });
    for (const e of ENDPOINTS_WITH_JOINS) {
      for (const lane of e.hydration!) {
        expect(
          out,
          `hydration catalogue omits ${e.platform}/${e.resource} include=${lane.token}`,
        ).toContain(`/v1/${e.platform}/${e.resource}`);
      }
    }
  });

  it("scopes the hydration catalogue to one platform", () => {
    const out = pricing({ action: "hydration", platform: "pinterest" });
    expect(out).toContain("/v1/pinterest/search");
    expect(out).not.toContain("/v1/linkedin/");
  });

  it("documents every lane in the `hydration` docs topic", () => {
    const doc = getDoc("hydration")!;
    expect(paginate(doc).length).toBe(1);
    for (const e of ENDPOINTS_WITH_JOINS) {
      expect(doc, `hydration doc omits ${e.platform}/${e.resource}`).toContain(
        `/v1/${e.platform}/${e.resource}`,
      );
    }
    expect(doc).toContain("data.hydration");
    expect(doc).toContain("credits_held");
  });

  it("summarises the joins in the pricing doc", () => {
    const doc = getDoc("pricing")!;
    expect(doc).toContain("## Row hydration");
    for (const e of ENDPOINTS_WITH_JOINS) {
      expect(doc).toContain(`/v1/${e.platform}/${e.resource}`);
    }
  });

  it("filters to hydrating endpoints in list_endpoints", () => {
    const out = listEndpoints({ hydrating: true, detail: "compact" });
    expect(out).toContain("include=");
    // A non-hydrating endpoint must not survive the filter.
    expect(out).not.toContain("/v1/tiktok/profile ");
  });

  it("shows the join in a platform's full endpoint reference", () => {
    const out = listEndpoints({ platform: "pinterest", detail: "full" });
    expect(out).toContain("**Row join:**");
    expect(out).toContain("include=engagement");
  });
});

describe("the joins reconcile with the rest of the data layer", () => {
  it("meters every endpoint that offers a join", () => {
    // A join moves the bill, so a hydrating endpoint cannot still be quoted as
    // a flat ladder rate — that was exactly the drift this wave fixed.
    for (const e of ENDPOINTS_WITH_JOINS) {
      expect(
        e.pricing.model,
        `${e.platform}/${e.resource} offers a row join but is still priced as ${e.pricing.model}`,
      ).toBe("metered");
    }
  });

  it("leaves every other endpoint's price untouched by hydration", () => {
    for (const e of ENDPOINTS) {
      if ((e.hydration?.length ?? 0) > 0) continue;
      expect(quoteHydration(e, "engagement").held).toBe(e.pricing.cost);
    }
  });
});
