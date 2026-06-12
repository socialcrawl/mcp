/**
 * Regenerate src/data/endpoints.ts and src/data/platforms.ts from the
 * backend registry dump.
 *
 * Pipeline:
 *   1. In the backend repo:  cd codebase/packages/social-api
 *      pnpm dlx tsx scripts/extract-mcp-data.ts
 *      → writes registry-dump.json at this repo's root.
 *   2. Here:                 npm run generate:data
 *
 * Platform display names, endpoint counts, params, credit tiers/costs,
 * archetypes, and doc strings all come straight from the dump (which is
 * derived from the live registry — the backend's single source of truth).
 * Platform DESCRIPTIONS are maintained in this script: the script fails
 * loudly when the dump contains a platform without a description so new
 * platforms can't ship undocumented.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface DumpParam {
  name: string;
  required: boolean;
  description: string;
  example: string;
}

interface DumpOptionalParam {
  name: string;
  type: string;
  enumValues?: string[];
  description?: string;
  example?: string;
}

interface DumpEndpoint {
  platform: string;
  resource: string;
  method: string;
  params: DumpParam[];
  optionalParams: DumpOptionalParam[];
  oneOfGroups: string[][];
  creditTier: string;
  creditCost: number;
  archetype: string;
  summary: string;
  description: string;
}

interface Dump {
  generatedFrom: string;
  stats: Record<string, number>;
  platforms: { slug: string; name: string; endpointCount: number }[];
  endpoints: DumpEndpoint[];
}

const PLATFORM_DESCRIPTIONS: Record<string, string> = {
  tiktok:
    "Profiles, videos, comments and replies, keyword/hashtag/top/user search, trending feed, audience demographics, followers, following, live streams, songs, video transcripts, and profile region lookup.",
  instagram:
    "Profiles, posts, reels, comments, story highlights, reels/hashtag/profile search, trending reels, audio reels, embed HTML, and AI-powered media transcripts.",
  youtube:
    "Channels, videos, shorts, comments and replies, video sponsors, playlists, community posts, keyword/hashtag search, trending shorts, channel live streams, and video transcripts.",
  twitter:
    "Profiles, tweets, communities, community tweets, video transcripts, and AI-powered natural-language X search via Grok with citations.",
  linkedin:
    "Personal profiles, company pages, posts, company posts, post search, post transcripts, and LinkedIn Ad Library (ad details, ad search).",
  facebook:
    "Pages, posts, comments and replies, group posts, photos, reels, events and event search, Marketplace (keyword search, location search, item details), video and ad transcripts, and the full Facebook Ad Library (ads, company ads, ad search, company search).",
  reddit:
    "Subreddit posts and details, post comments, keyword search, subreddit search, and post video transcripts.",
  threads:
    "Profiles, posts, post details, keyword search, and user search.",
  pinterest:
    "Pins, boards, user boards, keyword search, and Pinterest Save-Button counts for any URL (url-stats).",
  twitch:
    "Streamer profiles, clip details, user videos, and broadcast schedules.",
  snapchat: "Public user profiles including subscriber count and bio.",
  truthsocial: "Profiles, user posts, and post details.",
  kick: "Clip details including view count, duration, and category.",
  kwai: "Profiles, user posts, and post details from Kwai (Kuaishou's international short-video app).",
  tiktokshop:
    "TikTok Shop product details, product reviews, shop product listings, shop search, and creator showcases.",
  perplexity:
    "Web research via Perplexity Sonar — returns a grounded answer with cited source URLs.",
  google:
    "Google web search, Google Ads Transparency Center (ad details, advertiser search, company ads), Google Business Profile (place info, extended cross-source reviews, owner updates, Q&A), and Google Travel hotels (search + rich hotel details).",
  amazon:
    "Product search, full ASIN product details, on-page reviews, buy-box sellers and offers, and Amazon shop/storefront pages — across ~13 Amazon marketplaces via the country parameter.",
  google_shopping:
    "Google Shopping product search, full product details, reviews aggregated across retailers, and per-seller offers with itemised pricing.",
  trustpilot:
    "Trustpilot business search and company reviews — brand-reputation data keyed by company domain (shipping, refunds, support sentiment). For product reviews use amazon/reviews or google_shopping/reviews.",
  google_play:
    "Google Play app search, full app details, app reviews with developer replies, store charts (top free/paid/grossing), a filterable app listings database, and categories/locations/languages reference data.",
  app_store:
    "Apple App Store app search, full app details, app reviews, store charts (top free/paid/grossing for iPhone and iPad), a filterable app listings database, and categories/locations/languages reference data.",
  tripadvisor:
    "Place and business search (restaurants, hotels, attractions) and traveler reviews with owner replies, review images, and cross-language auto-translation metadata.",
  utility:
    "AI-powered utility tools including age and gender detection from image URLs.",
  linktree:
    "Linktree link-in-bio pages including display name, bio, avatar, and link list.",
  linkbio:
    "Linkbio link-in-bio pages including display name, bio, avatar, and link list.",
  linkme:
    "Linkme link-in-bio pages including display name, bio, avatar, and link list.",
  komi: "Komi link-in-bio pages including display name, bio, avatar, and link list.",
  pillar:
    "Pillar link-in-bio pages including display name, bio, avatar, and link list.",
  polymarket:
    "Prediction-market research — a server-side fan-out that expands a topic across multiple queries and ranks the merged Polymarket events.",
  hackernews:
    "Story search, story details, story comment trees, and user profiles. Backed by the public Algolia HN API.",
  github:
    "Users, repositories, user repos, READMEs, releases, issues, pull requests, issue/PR comments, issue/PR search, and composite repo top-issues/dossier + user profile-velocity reports. Backed by the official GitHub REST API.",
  tavily:
    "Web search with optional LLM-synthesised answer, content extraction from URLs, lightweight sitemap discovery, and full multi-page crawl.",
  naver:
    "Korea's #1 search portal — 11 search corpora: blog, news, book, encyclopedia, cafe article, Q&A (KiN), local places, shopping, document, image, and web search.",
  rumble:
    "Video search, channel videos, video details, video comments, and video transcripts.",
  bluesky:
    "Profiles, user posts, and post details from the AT Protocol social network.",
  spotify:
    "Artists, tracks, albums, podcasts, podcast episodes, and search across the Spotify catalog.",
  search:
    "Meta-search across 12+ platforms in a single call (up to 15 sources in hashtag mode). LLM-planned, RRF-fused, LLM-reranked, clustered. Flat 20 credits per call.",
  content_analysis:
    "Cross-web brand-mention search and 6-axis sentiment intelligence over news, blogs, ecommerce, and message boards — paginated mention feeds, sentiment/summary aggregates, rating distributions, phrase and category trends, plus languages/locations/categories/filters reference data.",
};

const root = resolve(import.meta.dirname, "..");
const dump: Dump = JSON.parse(
  readFileSync(resolve(root, "registry-dump.json"), "utf8"),
);

// ── Guard: every platform must have a description ──────────────────────
const missing = dump.platforms.filter((p) => !PLATFORM_DESCRIPTIONS[p.slug]);
if (missing.length > 0) {
  console.error(
    `Missing PLATFORM_DESCRIPTIONS entries for: ${missing.map((p) => p.slug).join(", ")}`,
  );
  process.exit(1);
}

const str = (s: string): string => JSON.stringify(s);

// ── platforms.ts ────────────────────────────────────────────────────────
const platformBlocks = dump.platforms
  .map((p) =>
    [
      "  {",
      `    slug: ${str(p.slug)},`,
      `    name: ${str(p.name)},`,
      `    endpointCount: ${p.endpointCount},`,
      `    description:`,
      `      ${str(PLATFORM_DESCRIPTIONS[p.slug])},`,
      "  },",
    ].join("\n"),
  )
  .join("\n");

const platformsTs = `import type { Platform } from "../types.js";

/**
 * All SocialCrawl platforms with ACTIVE endpoints, derived from the
 * backend registry. Generated by scripts/generate-data.ts — do not
 * hand-edit. Descriptions are maintained in that script.
 * Source: ${dump.generatedFrom}
 */
export const PLATFORMS: Platform[] = [
${platformBlocks}
];

export function findPlatform(slug: string): Platform | undefined {
  return PLATFORMS.find((p) => p.slug === slug);
}

export function getAllPlatformSlugs(): string[] {
  return PLATFORMS.map((p) => p.slug);
}
`;

// ── endpoints.ts ────────────────────────────────────────────────────────
function renderParam(p: DumpParam): string {
  return `      { name: ${str(p.name)}, required: true, description: ${str(p.description)}, example: ${str(p.example)} },`;
}

function renderOptionalParam(p: DumpOptionalParam): string {
  const parts = [`name: ${str(p.name)}`, `type: ${str(p.type)}`];
  if (p.enumValues) {
    parts.push(`enumValues: [${p.enumValues.map(str).join(", ")}]`);
  }
  if (p.description) parts.push(`description: ${str(p.description)}`);
  if (p.example) parts.push(`example: ${str(p.example)}`);
  return `      { ${parts.join(", ")} },`;
}

function renderEndpoint(e: DumpEndpoint): string {
  const lines: string[] = ["  {"];
  lines.push(`    platform: ${str(e.platform)},`);
  lines.push(`    resource: ${str(e.resource)},`);
  lines.push(`    method: "GET",`);
  if (e.params.length > 0) {
    lines.push("    params: [");
    for (const p of e.params) lines.push(renderParam(p));
    lines.push("    ],");
  } else {
    lines.push("    params: [],");
  }
  if (e.optionalParams.length > 0) {
    lines.push("    optionalParams: [");
    for (const p of e.optionalParams) lines.push(renderOptionalParam(p));
    lines.push("    ],");
  } else {
    lines.push("    optionalParams: [],");
  }
  const groups = e.oneOfGroups
    .map((g) => `[${g.map(str).join(", ")}]`)
    .join(", ");
  lines.push(`    oneOfGroups: [${groups}],`);
  lines.push(`    creditTier: ${str(e.creditTier)},`);
  lines.push(`    creditCost: ${e.creditCost},`);
  lines.push(`    archetype: ${str(e.archetype)},`);
  lines.push(`    summary: ${str(e.summary)},`);
  lines.push("    description:");
  lines.push(`      ${str(e.description)},`);
  lines.push("  },");
  return lines.join("\n");
}

const endpointSections: string[] = [];
for (const platform of dump.platforms) {
  const eps = dump.endpoints.filter((e) => e.platform === platform.slug);
  endpointSections.push(
    `  // --- ${platform.slug} (${eps.length} endpoint${eps.length === 1 ? "" : "s"}) ---`,
  );
  for (const e of eps) endpointSections.push(renderEndpoint(e));
}

const endpointsTs = `import type { Endpoint } from "../types.js";

/**
 * All ACTIVE SocialCrawl endpoints, derived from the backend registry.
 * Source: ${dump.generatedFrom}
 * Generated by scripts/generate-data.ts from registry-dump.json — see
 * that script's header for the full regeneration pipeline. Do not
 * hand-edit.
 */
export const ENDPOINTS: Endpoint[] = [
${endpointSections.join("\n")}
];

export function findEndpoint(platform: string, resource: string): Endpoint | undefined {
  return ENDPOINTS.find((e) => e.platform === platform && e.resource === resource);
}

export function getEndpointsByPlatform(platform: string): Endpoint[] {
  return ENDPOINTS.filter((e) => e.platform === platform);
}
`;

writeFileSync(resolve(root, "src/data/platforms.ts"), platformsTs);
writeFileSync(resolve(root, "src/data/endpoints.ts"), endpointsTs);

console.log(
  `wrote src/data/platforms.ts (${dump.platforms.length} platforms) and src/data/endpoints.ts (${dump.endpoints.length} endpoints)`,
);
