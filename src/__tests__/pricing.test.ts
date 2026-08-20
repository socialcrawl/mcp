import { describe, it, expect } from "vitest";
import { pricing } from "../tools/pricing.js";
import { ENDPOINTS, findEndpoint } from "../data/endpoints.js";
import {
  bestCaseCost,
  formatCost,
  meteredRule,
  priceDrivingParams,
  worstCaseCost,
} from "../pricing.js";

describe("pricing helpers", () => {
  it("quotes a ladder endpoint at its tier rate", () => {
    expect(formatCost(findEndpoint("tiktok", "profile")!.pricing)).toBe("1cr (standard)");
  });

  it("quotes a flat override without pretending it is the tier rate", () => {
    expect(formatCost(findEndpoint("search", "everywhere")!.pricing)).toBe("20cr (flat)");
  });

  it("quotes a metered endpoint as a band, never as its base", () => {
    const news = findEndpoint("search", "news")!;
    // The static base is 1cr; the real charge is 2-14. Quoting the base would
    // understate every single call.
    expect(news.pricing.cost).toBe(1);
    expect(formatCost(news.pricing)).toBe("2-14cr (metered)");
    expect(bestCaseCost(news.pricing)).toBe(2);
    expect(worstCaseCost(news.pricing)).toBe(14);
  });

  it("labels a free endpoint as free", () => {
    expect(formatCost(findEndpoint("utility", "quickstart")!.pricing)).toBe("0cr (free)");
  });

  it("prefers the registry's authored rule over generic wording", () => {
    const audit = findEndpoint("prism", "handle-audit")!;
    expect(meteredRule(audit.pricing)).toContain("+1 credit per selected platform");
  });

  it("falls back to the band when no rule is authored", () => {
    const scrape = findEndpoint("web", "scrape")!;
    expect(scrape.pricing.description).toBeUndefined();
    expect(meteredRule(scrape.pricing)).toContain("between 1 and 5 credits");
  });

  it("identifies the parameters that move the bill", () => {
    const news = findEndpoint("search", "news")!;
    const drivers = priceDrivingParams(news);
    expect(drivers).toContain("countries");
    expect(drivers).toContain("max_legs");
  });
});

describe("socialcrawl_pricing overview", () => {
  const doc = pricing({ action: "overview" });

  it("states all three billing models", () => {
    expect(doc).toContain("| ladder |");
    expect(doc).toContain("| flat |");
    expect(doc).toContain("| metered |");
  });

  it("lists every metered endpoint with a band", () => {
    for (const e of ENDPOINTS.filter((x) => x.pricing.model === "metered")) {
      expect(doc, `${e.platform}/${e.resource} missing from the metered table`).toContain(
        `/v1/${e.platform}/${e.resource}`,
      );
    }
  });

  it("lists every free endpoint", () => {
    for (const e of ENDPOINTS.filter((x) => x.pricing.cost === 0)) {
      expect(doc).toContain(`/v1/${e.platform}/${e.resource}`);
    }
  });

  it("documents the refund rules that change the real charge", () => {
    expect(doc).toContain("Cache hits are free");
    expect(doc).toContain("Empty results are refunded");
    expect(doc).toContain("deduct a ceiling and refund down");
  });
});

describe("socialcrawl_pricing endpoint detail", () => {
  it("explains a metered endpoint's rule, drivers, and worst case", () => {
    const out = pricing({ action: "endpoint", platform: "prism", resource: "comments" });
    expect(out).toContain("Metered");
    expect(out).toContain("1 credit per comment page scanned");
    expect(out).toContain("Price-driving parameters");
    expect(out).toContain("Worst case for budgeting");
  });

  it("explains a plain ladder endpoint and its free cache window", () => {
    const out = pricing({ action: "endpoint", platform: "tiktok", resource: "profile" });
    expect(out).toContain("ladder rate");
    expect(out).toContain("0 credits");
  });

  it("disambiguates a web resource by method", () => {
    const post = pricing({
      action: "endpoint",
      platform: "web",
      resource: "monitors",
      method: "POST",
    });
    expect(post).toContain("POST /v1/web/monitors");
  });

  it("suggests near matches for a mistyped resource", () => {
    const out = pricing({ action: "endpoint", platform: "tiktok", resource: "profil" });
    expect(out).toContain("Error:");
    expect(out).toContain("Did you mean");
  });

  it("requires both platform and resource", () => {
    expect(pricing({ action: "endpoint", platform: "tiktok" })).toContain("Error:");
  });
});

describe("socialcrawl_pricing platform table", () => {
  it("prices every endpoint on the platform", () => {
    const out = pricing({ action: "platform", platform: "walmart" });
    expect(out).toContain("Walmart");
    for (const e of ENDPOINTS.filter((x) => x.platform === "walmart")) {
      expect(out).toContain(`\`${e.resource}\``);
    }
  });

  it("rejects an unknown platform", () => {
    expect(pricing({ action: "platform", platform: "nope" })).toContain("Error:");
  });
});

describe("socialcrawl_pricing list", () => {
  it("respects a budget ceiling using the metered worst case", () => {
    const out = pricing({ action: "list", maxCost: 1, limit: 200 });
    // prism/comments floors at 2cr and can reach 200cr — it must not appear in
    // a 1-credit budget just because its base cost is 1.
    expect(out).not.toContain("/v1/prism/comments");
    expect(out).toContain("/v1/tiktok/profile");
  });

  it("filters by billing model", () => {
    const out = pricing({ action: "list", model: "free", limit: 200 });
    expect(out).toContain("/v1/utility/llms");
    expect(out).not.toContain("/v1/search/everywhere");
  });

  it("ranks the most expensive endpoints first by default", () => {
    const out = pricing({ action: "list", limit: 3 });
    expect(out).toContain("prism");
    expect(out).toContain("cost_desc");
  });

  it("reports the total worst-case spend of the listed rows", () => {
    expect(pricing({ action: "list", platform: "target" })).toContain("would deduct at most");
  });

  it("says so when nothing matches", () => {
    const out = pricing({ action: "list", search: "zzzznotathing" });
    expect(out).toContain("No endpoints match");
  });

  it("rejects an unknown action", () => {
    expect(pricing({ action: "nonsense" as never })).toContain("Error:");
  });
});
