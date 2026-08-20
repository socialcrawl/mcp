/**
 * Regenerate src/data/endpoints.ts, src/data/platforms.ts and
 * src/data/registry-meta.ts from the backend registry dump.
 *
 * Pipeline:
 *   1. In the backend repo:  cd codebase/packages/social-api
 *      pnpm dlx tsx scripts/extract-mcp-data.ts
 *      → writes registry-dump.json at this repo's root.
 *   2. Here:                 npm run generate:data
 *
 * Platform display names, endpoint counts, params (with their bounds and
 * couplings), credit tiers, the full pricing model (ladder / flat / metered
 * band + the exact metered wording), pagination descriptors, cache TTLs,
 * upstream dispatch, and doc strings all come straight from the dump (which is
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
  minimum?: number;
  maximum?: number;
  requires?: string;
  couplesWith?: { param: string; value: string };
  description?: string;
  example?: string;
  in?: "query" | "body";
}

interface DumpPricing {
  cost: number;
  tier: string;
  ladderCost: number;
  model: "ladder" | "flat" | "metered";
  minCost?: number;
  maxCost?: number;
  pageSize?: number;
  description?: string;
}

interface DumpEndpoint {
  platform: string;
  resource: string;
  method: string;
  params?: DumpParam[];
  optionalParams?: DumpOptionalParam[];
  oneOfGroups?: string[][];
  csvConstraints?: Record<string, { max?: number; enumValues?: string[] }>;
  creditTier: string;
  creditCost: number;
  pricing: DumpPricing;
  archetype: string;
  summary: string;
  description: string;
  execution?: string;
  streaming?: string;
  pagination?: {
    style: string;
    nativeParam: string;
    limitParam?: string;
    limitMax?: number;
  };
  paginatable?: boolean;
  singlePage?: string;
  collectUntilN?: string;
  emptyOn404?: boolean;
  cache: { category: string; ttlSeconds: number };
  upstream: { kind: string; fallbackKinds?: string[] };
  family?: string;
  actionLabel?: string;
  group?: string;
  tags?: string[];
  contractDetails?: string[];
  responseFields?: Record<string, string>;
}

interface Dump {
  generatedFrom: string;
  schemaVersion?: number;
  stats: Record<string, number>;
  creditLadder: Record<string, number>;
  cacheTtls: Record<string, number>;
  platforms: {
    slug: string;
    name: string;
    endpointCount: number;
    social?: boolean;
    category?: string;
  }[];
  endpoints: DumpEndpoint[];
}

const PLATFORM_DESCRIPTIONS: Record<string, string> = {
  tiktok:
    "Profiles, videos, comments and replies (incl. direct comment lookup), on-screen video text extraction, keyword/hashtag/top/user search, trending feed, audience demographics, followers, following, live streams, songs, video transcripts, and profile region lookup.",
  instagram:
    "Profiles, posts, reels, comments (incl. direct comment lookup), story highlights, stories, tagged posts, location feeds, followers, following, similar accounts, post likers, post-reshare stats, reels/posts feeds with per-item share counts in one call (profile/reels/full, profile/posts/full), account engagement analytics, reels/hashtag/profile/location/music search, username suggestions, trending reels and music, audio reels, embed HTML, and AI-powered media transcripts.",
  youtube:
    "Channels, videos, shorts, comments and replies, video sponsors, playlists and playlist items, community posts, keyword/hashtag/advanced search and autocomplete suggestions, trending videos and shorts, channel live streams, downloadable media files (audio, video, subtitles, thumbnails), batch video/channel/transcript lookups, and video transcripts.",
  twitter:
    "Profiles, tweets, communities, community tweets, video transcripts, and AI-powered natural-language X search via Grok with citations.",
  linkedin:
    "Personal profiles and company pages, posts, reposts, reactions, group and company posts, post comments and replies, people and company-people search, structured profile sub-resources (experiences, educations, skills, honors, certifications, publications, volunteers, recommendations, interests, images, videos), jobs (job search, company jobs, job details), company insights and job counts, groups, location/school/industry search, post transcripts, and the LinkedIn Ad Library (ad details, ad search).",
  facebook:
    "Pages, posts, comments and replies, group posts, photos, reels (incl. the full reels feed with per-item view counts), events and event search, Marketplace (keyword search, location search, item details), video and ad transcripts, and the full Facebook Ad Library (ads, company ads, ad search, company search).",
  reddit:
    "Subreddit posts and details, single post detail, post comments, keyword search, subreddit search, the cross-source omni-search composite, and post video transcripts.",
  threads:
    "Profiles, posts, post details, post comments, keyword search, and user search.",
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
  google_news:
    "Real-time Google News SERP search — ranked headlines with source, snippet, and timestamp for any query. Backed by a primary news upstream with a DataForSEO Google News fallback and bidirectional query-derived source pinning.",
  google_finance:
    "Financial-instrument data — full quotes, a markets overview (indices + top movers), and ticker search by name. Backed by DataForSEO Google Finance.",
  prism:
    "Cross-platform composite intelligence — server-side recipes that fan out across many platforms and fold the legs into one unified report. Universal URL lookup, full comment harvesting, brand-mention and consumer-demand nowcasts, AI share-of-voice / GEO monitoring, crisis radar and post-mortems, cross-source reputation, share-of-voice, creator vetting and creator cards, handle audits, multi-engine AI consensus answers, org/repo radar, Korea gap analysis, and video/app/product intelligence. Each composite emits a per-leg transparency array; pricing is flat or metered per recipe (see the pricing docs topic and the socialcrawl_pricing tool).",
  amazon:
    "Product search, full ASIN product details, on-page reviews, buy-box sellers and offers, and Amazon shop/storefront pages — across ~13 Amazon marketplaces via the country parameter.",
  google_shopping:
    "Google Shopping product search, full product details, reviews aggregated across retailers, and per-seller offers with itemised pricing.",
  trustpilot:
    "Trustpilot business search and company reviews — brand-reputation data keyed by company domain (shipping, refunds, support sentiment). For product reviews use amazon/reviews or google_shopping/reviews.",
  google_play:
    "Google Play app search, full app details, app reviews with developer replies, store charts (top free/paid/grossing), a filterable app listings database, search suggestions, and categories/locations/languages reference data.",
  app_store:
    "Apple App Store app search, full app details, app reviews, store charts (top free/paid/grossing for iPhone and iPad), a filterable app listings database, search suggestions, and categories/locations/languages reference data.",
  tripadvisor:
    "Place and business search (restaurants, hotels, attractions) and traveler reviews with owner replies, review images, and cross-language auto-translation metadata.",
  utility:
    "Free, zero-credit API self-discovery — list every endpoint (`endpoints`), get exact usage for any one of them (`endpoint`), a one-call quickstart (`quickstart`), and an AI-agent context payload (`llms`). Served in-process from the endpoint registry: no network call, no auth cost, 0 credits.",
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
    "Korea's #1 search portal — search corpora (blog, news, encyclopedia, cafe article, Q&A/KiN, local places, image, web), the Korean-language errata and adult-term classifiers, and Naver Data Lab search-trend + shopping-insight time series.",
  rumble:
    "Video search, channel videos, video details, video comments, and video transcripts.",
  bluesky:
    "Profiles, user posts, and post details from the AT Protocol social network.",
  spotify:
    "Artists, tracks, albums, podcasts, podcast episodes, and search across the Spotify catalog.",
  search:
    "Meta-search lanes: `everywhere` fuses 14 platforms (up to 17 sources in hashtag mode) in a single flat-priced call; `forums` fuses Reddit + Hacker News + Naver 지식iN/카페 with top comments inline; `news` plans, localizes, and fans a query out across up to 12 Google News country editions with metered per-leg billing. LLM-planned, RRF-fused, LLM-reranked, clustered.",
  content_analysis:
    "Cross-web brand-mention search and 6-axis sentiment intelligence over news, blogs, ecommerce, and message boards — paginated mention feeds, sentiment/summary aggregates, rating distributions, phrase and category trends, plus languages/locations/categories/filters reference data.",
  web:
    "Full web scraping, search, and browser automation (Firecrawl-backed). Sync scrape (markdown/HTML/screenshot/links), web search with content, site URL mapping, and LLM structured extraction; async crawl, batch-scrape, and autonomous agent jobs with a unified poll/cancel jobs surface; stateful web monitors (change detection on a cadence, delivered to a webhook); interactive browser sessions (open a page, execute code, close); and document parsing. The stateful surface (jobs, monitors, sessions, crawl/batch/agent) is managed through the dedicated `socialcrawl_web` tool; the sync scrape/search/map/extract endpoints are also available there.",
  google_trends:
    "Google Trends interest data — `explore` returns interest-over-time (and optional geo/related breakdowns) for one or more terms; `rising` returns breakout/rising related queries for a term. Backed by DataForSEO Google Trends.",
  walmart:
    "Walmart product details, product reviews, keyword search, category browsing, and every seller offering a product — across Walmart marketplaces via the country parameter.",
  target:
    "Target product details by TCIN, product reviews, category browsing, the full category taxonomy, and store lookup near a location.",
  home_depot:
    "Home Depot product details by item id or URL (store- and zip-aware pricing) and product reviews with rating, verified-purchase, and free-text filters.",
  ebay:
    "eBay listing search — including sold and completed listings with realised sale prices and dates — and full listing details by item id, across eBay country sites.",
};

const root = resolve(import.meta.dirname, "..");
const dump: Dump = JSON.parse(
  readFileSync(resolve(root, "registry-dump.json"), "utf8"),
);

// ── Guard: dump must be the rich v2 schema ─────────────────────────────
if (dump.schemaVersion !== 2) {
  console.error(
    `registry-dump.json is schema v${dump.schemaVersion ?? 1}; this generator needs v2. ` +
      `Re-run the backend extractor: cd codebase/packages/social-api && pnpm dlx tsx scripts/extract-mcp-data.ts`,
  );
  process.exit(1);
}

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
      `    social: ${p.social ?? true},`,
      ...(p.category ? [`    category: ${str(p.category)},`] : []),
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

// ── registry-meta.ts ────────────────────────────────────────────────────
const metaTs = `/**
 * Registry-wide counts and constants, mirrored from the backend's
 * REGISTRY_STATS / CreditCost / CacheTTL. Generated by
 * scripts/generate-data.ts — do not hand-edit.
 * Source: ${dump.generatedFrom}
 */

/** Live platform / endpoint / tier counts from the backend registry. */
export const REGISTRY_STATS = ${JSON.stringify(dump.stats, null, 2)} as const;

/** The credit-tier ladder. Endpoints may override it flat or meter per query. */
export const CREDIT_LADDER: Record<string, number> = ${JSON.stringify(dump.creditLadder, null, 2)};

/** Response-cache TTL (seconds) per category. A cache hit costs 0 credits. */
export const CACHE_TTLS: Record<string, number> = ${JSON.stringify(dump.cacheTtls, null, 2)};
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
  if (p.minimum !== undefined) parts.push(`minimum: ${p.minimum}`);
  if (p.maximum !== undefined) parts.push(`maximum: ${p.maximum}`);
  if (p.requires) parts.push(`requires: ${str(p.requires)}`);
  if (p.couplesWith) {
    parts.push(
      `couplesWith: { param: ${str(p.couplesWith.param)}, value: ${str(p.couplesWith.value)} }`,
    );
  }
  if (p.description) parts.push(`description: ${str(p.description)}`);
  if (p.example) parts.push(`example: ${str(p.example)}`);
  if (p.in) parts.push(`in: ${str(p.in)}`);
  return `      { ${parts.join(", ")} },`;
}

function renderPricing(p: DumpPricing): string {
  const parts = [
    `cost: ${p.cost}`,
    `tier: ${str(p.tier)}`,
    `ladderCost: ${p.ladderCost}`,
    `model: ${str(p.model)}`,
  ];
  if (p.minCost !== undefined) parts.push(`minCost: ${p.minCost}`);
  if (p.maxCost !== undefined) parts.push(`maxCost: ${p.maxCost}`);
  if (p.pageSize !== undefined) parts.push(`pageSize: ${p.pageSize}`);
  if (p.description) parts.push(`description: ${str(p.description)}`);
  return `    pricing: { ${parts.join(", ")} },`;
}

function renderEndpoint(e: DumpEndpoint): string {
  const lines: string[] = ["  {"];
  lines.push(`    platform: ${str(e.platform)},`);
  lines.push(`    resource: ${str(e.resource)},`);
  lines.push(`    method: ${str(e.method)},`);

  const params = e.params ?? [];
  if (params.length > 0) {
    lines.push("    params: [");
    for (const p of params) lines.push(renderParam(p));
    lines.push("    ],");
  } else {
    lines.push("    params: [],");
  }

  const optionalParams = e.optionalParams ?? [];
  if (optionalParams.length > 0) {
    lines.push("    optionalParams: [");
    for (const p of optionalParams) lines.push(renderOptionalParam(p));
    lines.push("    ],");
  } else {
    lines.push("    optionalParams: [],");
  }

  const groups = (e.oneOfGroups ?? [])
    .map((g) => `[${g.map(str).join(", ")}]`)
    .join(", ");
  lines.push(`    oneOfGroups: [${groups}],`);

  if (e.csvConstraints) {
    const entries = Object.entries(e.csvConstraints).map(([name, c]) => {
      const parts: string[] = [];
      if (c.max !== undefined) parts.push(`max: ${c.max}`);
      if (c.enumValues) {
        parts.push(`enumValues: [${c.enumValues.map(str).join(", ")}]`);
      }
      return `${str(name)}: { ${parts.join(", ")} }`;
    });
    lines.push(`    csvConstraints: { ${entries.join(", ")} },`);
  }

  lines.push(`    creditTier: ${str(e.creditTier)},`);
  lines.push(`    creditCost: ${e.creditCost},`);
  lines.push(renderPricing(e.pricing));
  lines.push(`    archetype: ${str(e.archetype)},`);
  lines.push(`    summary: ${str(e.summary)},`);
  lines.push("    description:");
  lines.push(`      ${str(e.description)},`);

  if (e.execution) lines.push(`    execution: ${str(e.execution)},`);
  if (e.streaming) lines.push(`    streaming: ${str(e.streaming)},`);
  if (e.pagination) {
    const parts = [
      `style: ${str(e.pagination.style)}`,
      `nativeParam: ${str(e.pagination.nativeParam)}`,
    ];
    if (e.pagination.limitParam) {
      parts.push(`limitParam: ${str(e.pagination.limitParam)}`);
    }
    if (e.pagination.limitMax !== undefined) {
      parts.push(`limitMax: ${e.pagination.limitMax}`);
    }
    lines.push(`    pagination: { ${parts.join(", ")} },`);
  }
  if (e.paginatable) lines.push("    paginatable: true,");
  if (e.singlePage) lines.push(`    singlePage: ${str(e.singlePage)},`);
  if (e.collectUntilN) lines.push(`    collectUntilN: ${str(e.collectUntilN)},`);
  if (e.emptyOn404) lines.push("    emptyOn404: true,");

  lines.push(
    `    cache: { category: ${str(e.cache.category)}, ttlSeconds: ${e.cache.ttlSeconds} },`,
  );
  const upstreamParts = [`kind: ${str(e.upstream.kind)}`];
  if (e.upstream.fallbackKinds && e.upstream.fallbackKinds.length > 0) {
    upstreamParts.push(
      `fallbackKinds: [${e.upstream.fallbackKinds.map(str).join(", ")}]`,
    );
  }
  lines.push(`    upstream: { ${upstreamParts.join(", ")} },`);

  if (e.family) lines.push(`    family: ${str(e.family)},`);
  if (e.actionLabel) lines.push(`    actionLabel: ${str(e.actionLabel)},`);
  if (e.group) lines.push(`    group: ${str(e.group)},`);
  if (e.tags && e.tags.length > 0) {
    lines.push(`    tags: [${e.tags.map(str).join(", ")}],`);
  }
  if (e.contractDetails && e.contractDetails.length > 0) {
    lines.push("    contractDetails: [");
    for (const d of e.contractDetails) lines.push(`      ${str(d)},`);
    lines.push("    ],");
  }
  if (e.responseFields) {
    lines.push("    responseFields: {");
    for (const [k, v] of Object.entries(e.responseFields)) {
      lines.push(`      ${str(k)}: ${str(v)},`);
    }
    lines.push("    },");
  }

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

/**
 * Look up an endpoint. The optional \`method\` disambiguates the stateful \`web\`
 * platform, where one resource (e.g. \`monitors/{monitor_id}\`) is served by
 * several methods (GET/PATCH/DELETE). Without a method, GET is preferred, then
 * the first registered variant — so registry-driven GET callers are unaffected.
 */
export function findEndpoint(
  platform: string,
  resource: string,
  method?: string,
): Endpoint | undefined {
  const matches = ENDPOINTS.filter(
    (e) => e.platform === platform && e.resource === resource,
  );
  if (method) return matches.find((e) => e.method === method);
  return matches.find((e) => e.method === "GET") ?? matches[0];
}

export function getEndpointsByPlatform(platform: string): Endpoint[] {
  return ENDPOINTS.filter((e) => e.platform === platform);
}
`;

writeFileSync(resolve(root, "src/data/platforms.ts"), platformsTs);
writeFileSync(resolve(root, "src/data/endpoints.ts"), endpointsTs);
writeFileSync(resolve(root, "src/data/registry-meta.ts"), metaTs);

const metered = dump.endpoints.filter((e) => e.pricing.model === "metered");
const flat = dump.endpoints.filter((e) => e.pricing.model === "flat");
console.log(
  `wrote src/data/platforms.ts (${dump.platforms.length} platforms), ` +
    `src/data/endpoints.ts (${dump.endpoints.length} endpoints — ` +
    `${metered.length} metered, ${flat.length} flat-override) and ` +
    `src/data/registry-meta.ts`,
);
