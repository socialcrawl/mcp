import { PLATFORMS } from "../data/platforms.js";
import { ENDPOINTS } from "../data/endpoints.js";
import { REGISTRY_STATS } from "../data/registry-meta.js";
import { bestCaseCost, worstCaseCost } from "../pricing.js";
import type { Platform } from "../types.js";

/**
 * Platform catalogue. Grouped by the registry's own manifest category so a
 * 48-platform table reads as a map of the surface rather than one flat wall,
 * and every row carries its own cost range so a caller can pick a platform
 * against a budget without a second lookup.
 */

const CATEGORY_LABELS: Record<string, string> = {
  major: "Major social",
  additional: "Additional social & media",
  commerce: "Commerce, apps, places & reputation",
  adLibraries: "Ad libraries & transparency",
  linkPages: "Link-in-bio pages",
  utility: "Research, web, composites & utility",
};

const CATEGORY_ORDER = [
  "major",
  "additional",
  "commerce",
  "adLibraries",
  "linkPages",
  "utility",
];

function costRange(slug: string): string {
  const eps = ENDPOINTS.filter((e) => e.platform === slug);
  if (eps.length === 0) return "-";
  const min = Math.min(...eps.map((e) => bestCaseCost(e.pricing)));
  const max = Math.max(...eps.map((e) => worstCaseCost(e.pricing)));
  return min === max ? `${min}cr` : `${min}-${max}cr`;
}

function table(platforms: Platform[]): string[] {
  return [
    "| Platform | Slug | Endpoints | Credits/call | Data available |",
    "|----------|------|-----------|--------------|----------------|",
    ...platforms.map(
      (p) =>
        `| ${p.name} | \`${p.slug}\` | ${p.endpointCount} | ${costRange(p.slug)} | ${p.description} |`,
    ),
  ];
}

export function listPlatforms(): string {
  const totalEndpoints = PLATFORMS.reduce((sum, p) => sum + p.endpointCount, 0);

  const lines: string[] = [
    "# SocialCrawl — Supported Platforms",
    "",
    `${PLATFORMS.length} platforms, ${totalEndpoints} endpoints, one API key and one response envelope. ` +
      `${REGISTRY_STATS.socialPlatforms} are social platforms; the rest are commerce, app stores, places, business reputation, news/finance, web research and scraping, prediction markets, Korean search, content analysis, and cross-platform composites.`,
    "",
    `Credit tiers: standard ${REGISTRY_STATS.standardEndpoints} · advanced ${REGISTRY_STATS.advancedEndpoints} · premium ${REGISTRY_STATS.premiumEndpoints} endpoints. ` +
      "The `Credits/call` column is the full range across a platform's endpoints, with metered endpoints shown at their ceiling — use `socialcrawl_pricing` for exact per-endpoint costs.",
    "",
  ];

  const seen = new Set<string>();
  for (const category of CATEGORY_ORDER) {
    const group = PLATFORMS.filter((p) => p.category === category);
    if (group.length === 0) continue;
    group.forEach((p) => seen.add(p.slug));
    lines.push(`## ${CATEGORY_LABELS[category] ?? category}`, "");
    lines.push(...table(group));
    lines.push("");
  }

  const uncategorised = PLATFORMS.filter((p) => !seen.has(p.slug));
  if (uncategorised.length > 0) {
    lines.push("## Other", "");
    lines.push(...table(uncategorised));
    lines.push("");
  }

  lines.push(
    "Next: `socialcrawl_list_endpoints` with a platform slug (or a `search` term to look across all platforms) for endpoints and parameters; `socialcrawl_pricing` for costs; `socialcrawl_get_docs` with a platform slug for full platform docs.",
  );

  return lines.join("\n");
}
