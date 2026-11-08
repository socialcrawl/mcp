import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "../data/endpoints.js";
import { HELD_CONTACT_WALK_ENDPOINTS, stripHeldSurfaces } from "../held-surfaces.js";

/**
 * UPGRADE-LOG API-074: `include=contacts` (the contact walk, with `roles`,
 * `min_confidence`, `max_duration`) is in the registry but HELD — legal gate
 * open, not announced. A regeneration publishes whatever the registry declares,
 * so the generator strips it. These guards fail the moment it leaks back.
 */

const HELD_PARAMS = ["roles", "min_confidence", "max_duration"];
const CONTACT_WALK = /include=contacts|`contacts`|contact walk|contact_lookup|contact_status|contact_items|contact_retry/;

describe("held surface API-074 (include=contacts) — generated data", () => {
  it("names the eight registry endpoints the hold covers", () => {
    expect([...HELD_CONTACT_WALK_ENDPOINTS].sort()).toEqual(
      [
        "facebook/profile",
        "instagram/profile",
        "instagram/profile/about",
        "linkbio/page",
        "pillar/page",
        "tiktok/profile",
        "twitter/profile",
        "youtube/channel/about",
      ].sort(),
    );
  });

  it("no endpoint declares the contact-walk params", () => {
    for (const e of ENDPOINTS) {
      if (!HELD_CONTACT_WALK_ENDPOINTS.has(`${e.platform}/${e.resource}`)) continue;
      const names = e.optionalParams.map((p) => p.name);
      for (const held of HELD_PARAMS) expect(names, `${e.platform}/${e.resource}`).not.toContain(held);
    }
  });

  it("no include enum offers `contacts` on a held endpoint", () => {
    for (const e of ENDPOINTS) {
      if (!HELD_CONTACT_WALK_ENDPOINTS.has(`${e.platform}/${e.resource}`)) continue;
      expect(e.csvConstraints?.include?.enumValues ?? [], `${e.platform}/${e.resource}`).not.toContain("contacts");
      expect(e.csvConstraints?.roles, `${e.platform}/${e.resource}`).toBeUndefined();
    }
  });

  it("no copy on a held endpoint or prism/jobs describes the contact walk", () => {
    for (const e of ENDPOINTS) {
      const id = `${e.platform}/${e.resource}`;
      if (!HELD_CONTACT_WALK_ENDPOINTS.has(id) && !(e.platform === "prism" && e.resource.startsWith("jobs"))) continue;
      const copy = [
        e.description,
        e.summary,
        e.pricing.description ?? "",
        ...e.optionalParams.map((p) => p.description ?? ""),
        ...(e.contractDetails ?? []),
      ].join("\n");
      expect(copy, id).not.toMatch(CONTACT_WALK);
    }
  });
});

describe("stripHeldSurfaces", () => {
  const base = {
    platform: "tiktok",
    resource: "profile",
    method: "GET",
    description: "Get a profile.",
    pricing: {
      model: "metered",
      description:
        "1 credit per call. `include=account` holds 2 more. `include=contacts` costs no extra credits, whatever the contact lookup answers. A call that fails costs nothing.",
    },
    optionalParams: [
      {
        name: "include",
        type: "string",
        description:
          "Comma list. `contacts` adds author.ext.contacts and data.contact_lookup, and runs the contact walk. `account` adds author.joined_at for 2 extra credits",
      },
      { name: "roles", type: "string", description: "Comma list of own, management, agency" },
      { name: "min_confidence", type: "string" },
      { name: "max_duration", type: "string" },
      { name: "region", type: "string" },
    ],
    csvConstraints: {
      include: { max: 2, enumValues: ["contacts", "account"] },
      roles: { max: 3, enumValues: ["own", "management", "agency"] },
    },
  };

  it("drops the params, the enum value, the coupled constraint and the sentences, keeping the rest", () => {
    const [out] = stripHeldSurfaces([structuredClone(base)]);
    expect(out.optionalParams.map((p) => p.name)).toEqual(["include", "region"]);
    expect(out.csvConstraints).toEqual({ include: { max: 1, enumValues: ["account"] } });
    expect(out.pricing.description).toBe(
      "1 credit per call. `include=account` holds 2 more. A call that fails costs nothing.",
    );
    expect(out.optionalParams[0].description).toBe(
      "Comma list. `account` adds author.joined_at for 2 extra credits",
    );
  });

  it("removes `include` entirely when contacts was its only value", () => {
    const only = structuredClone(base);
    only.platform = "twitter";
    only.optionalParams[0].description = "Comma list. `contacts` adds author.ext.contacts and data.contact_lookup, and runs the contact walk";
    only.csvConstraints.include = { max: 1, enumValues: ["contacts"] };
    const [out] = stripHeldSurfaces([only]);
    expect(out.optionalParams.map((p) => p.name)).toEqual(["region"]);
    expect(out.csvConstraints).toBeUndefined();
  });

  it("leaves endpoints outside the hold untouched", () => {
    const other = { ...structuredClone(base), platform: "prism", resource: "creators" };
    const [out] = stripHeldSurfaces([other]);
    expect(out).toEqual(other);
  });
});

// The guide is the in-repo skill's SKILL.md and the recipes come from the
// codebase: both carry the held surfaces too (UPGRADE-LOG trap 1), so the
// generator strips them on the way in.
describe("held surfaces — bundled guide and recipes", () => {
  it("the guide names neither the contact walk nor Listening", async () => {
    const { GUIDE } = await import("../data/guide.js");
    expect(GUIDE).not.toMatch(/include=contacts|contact_lookup|\/v1\/listening|listening\.md|listener/);
    // What surrounds the cut survives.
    expect(GUIDE).toContain("POST /v1/search/everywhere");
    expect(GUIDE).toContain("a keyword or topic alert is never a Monitor");
  });

  it("no recipe uses include=contacts", async () => {
    const { RECIPES_DATA } = await import("../data/recipes.js");
    expect(JSON.stringify(RECIPES_DATA)).not.toMatch(/include=contacts|"include":"contacts"/);
    expect(RECIPES_DATA.length).toBeGreaterThan(40);
  });

  it("stripHeldGuide drops lines and clauses, keeping the rest", async () => {
    const { stripHeldGuide } = await import("../held-surfaces.js");
    const md = [
      "| A | `GET /v1/youtube/channel/about?include=contacts` |",
      "| keep | row |",
      "| Alert (Listening) | [listening.md](references/listening.md) |",
      "**Alerts:** for a digest, call `POST /v1/search/everywhere`; for a listener, call `POST /v1/listening/streams`; a keyword alert is never a Monitor.",
    ].join("\n");
    expect(stripHeldGuide(md)).toBe(
      ["| keep | row |", "**Alerts:** for a digest, call `POST /v1/search/everywhere`; a keyword alert is never a Monitor."].join("\n"),
    );
  });
});
