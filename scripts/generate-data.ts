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
 * Accepts dump schema v3 and v4. v4 adds, per endpoint, `purpose` (summary,
 * returns, use_when, not_for — what the ranker in src/search/rank.ts reads),
 * `taxonomy`, `latency_ms` and `outputs` (the response-field contract, written
 * to src/data/outputs.ts; an absent `meaning` / `fill` / `live` means null).
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
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { findSampleIssues, prepareSample } from "../src/resources/sample-gate.js";

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
  recommended_timeout_s?: number | null;
  budget_ms?: number | null;
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
  responseShape?: { root: string; itemKey?: string };
  hydration?: DumpHydrationLane[];
  judgments?: DumpJudgments;
  featuredParams?: { name: string; benefit: string; example: string }[];
  related?: { id: string; why: string }[];
  // ── schema v4 ──
  purpose?: { summary: string; returns?: string | null; use_when?: string | null; not_for?: string | null };
  taxonomy?: { purpose: string; job_family: string; takes_item_id_from_another_endpoint?: boolean };
  latency_ms?: { p50: number; p95: number; p99: number; n: number; provisional?: boolean; low_sample?: boolean } | null;
  outputs?: DumpOutputs;
  /** The contract's paging facts; absent on an endpoint that does not page. */
  paging?: DumpPaging;
}

/** `pagingOf(entry)` in the backend: every null means unknown, never "none". */
interface DumpPaging {
  style: string;
  page_size: number | null;
  page_size_source?: string | null;
  observed_n?: number | null;
  page_size_max?: number | null;
  max_pages: number | null;
  max_pages_when?: string | null;
  per_n_items: string | null;
  price_basis: string | null;
  credits_per_page?: { min: number; max: number | null } | null;
  credits_per_row?: number | null;
}

interface DumpOutputField {
  path: string;
  type: string;
  nullable: boolean;
  meaning?: string | null;
  fill?: number | null;
  live?: boolean | null;
  opt_in?: string;
  source_hint?: string;
}

interface DumpOutputs {
  archetype: string;
  rows_at?: string | null;
  fields: DumpOutputField[];
  never_filled?: string[];
  page_level?: string[];
  source: string;
  inferred_from?: Record<string, string>;
}

interface DumpJudgments {
  offParam: string;
  labels?: {
    param: string;
    presets: string[];
    free: string[];
    metered: string[];
    rowsPerCredit: number;
    rowPath: string;
  };
  relevance?: {
    param: string;
    values: string[];
    topicParam: string;
    meteredTopicParam: string;
    rowsPerCredit: number;
  };
}

interface DumpHydrationLane {
  param: string;
  token: string;
  sibling: string;
  siblingMethod?: string;
  fills: string[];
  creditsPerItem: number;
  maxItems: number;
  defaultRowLimit?: number;
  rowLimitParam?: string;
  batch?: { size: number; creditCap: number };
  cacheSibling: boolean;
  warnings: { unavailable: string; partial: string };
  replaceApproximate?: string[];
  /**
   * A lane that runs on every call unless `unlessParam=unlessValue` turns it
   * off (YouTube's free exact-date join). Its token is not a caller-sendable
   * `include` value, so it is emitted as `automaticJoins`, not `hydration`.
   */
  defaultOn?: { unlessParam: string; unlessValue: string };
}

interface Dump {
  generatedFrom: string;
  schemaVersion?: number;
  registryFingerprint?: string;
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
  web:
    "Full web scraping, search, and browser automation. Sync scrape (markdown/HTML/screenshot/links), web search with content, site URL mapping, and LLM structured extraction; async crawl, batch-scrape, and autonomous agent jobs with a unified poll/cancel jobs surface; stateful web monitors (change detection on a cadence, delivered to a webhook); interactive browser sessions (open a page, execute code, close); and document parsing. The stateful surface (jobs, monitors, sessions, crawl/batch/agent) is managed through `socialcrawl_manage` with area web, which also serves the sync scrape/search/map/extract endpoints.",
  tiktok:
    "Profiles, videos, comments and replies (incl. direct comment lookup), on-screen video text extraction, keyword/hashtag/top/user/music search plus search suggestions, hashtag details, the trending feed (worldwide or the in-country For You feed), TikTok's own popular-hashtag and Top Videos leaderboards, audience demographics, similar accounts (with an Instagram-graph fallback), followers, following, a user's liked videos, playlists and collections, place-tagged videos, effects and effect feeds, live streams, songs, video transcripts, profile region lookup, and the TikTok Ad Library (ad details, ad search).",
  instagram:
    "Profiles, account transparency details (profile/about), posts, reels, comments and comment replies (incl. direct comment lookup), story highlights, stories, tagged posts, location feeds, followers, following, similar accounts, post likers, post-reshare stats, reels/posts feeds with per-item share counts in one call (profile/reels/full, profile/posts/full), account engagement analytics, universal search across accounts/hashtags/places, popular-post search, reels/hashtag/profile/location/music search (reel search with per-creator cards via include=creator), username suggestions, trending reels and music, audio reels, embed HTML, on-screen text (OCR) from any image or video frame, and AI-powered media transcripts.",
  youtube:
    "Channels, videos, shorts, comments and replies, video sponsors, playlists and playlist items, community posts, keyword/hashtag/advanced search and autocomplete suggestions, trending videos and shorts, channel live streams, channel contact email and country lookup (channel/about — billed only when an address is returned), downloadable media files (audio, video, subtitles, thumbnails), batch video/channel/transcript lookups, and video transcripts.",
  twitter:
    "Profiles, tweets and their replies, tweet search and user search, a user's media tweets, followers, following, retweeters, communities, community tweets, video transcripts, and AI-powered natural-language X search via Grok with citations.",
  linkedin:
    "Personal profiles (single sub-resources, or one-call bundles: profile/all, profile/complete, profile/with-posts) and company pages (incl. lookup by website domain, also-viewed pages, employee counts by location), posts and post-with-comments, reposts, reactions, group and company posts, post comments and replies, Pulse articles with their comments and reactions, people search (keyword or a search-results URL), company and hashtag search, similar members, structured profile sub-resources (experiences, educations, skills, position skills, top position, honors, certifications, publications, volunteers, recommendations, followed companies/groups/schools/newsletters/Top Voices, images, videos, last activity), jobs (job search, company jobs, jobs a member posted, a job's hiring team, job details), company insights and job counts, groups, location/school/industry search, the complete post-history archive walk (profile/posts/archive — metered per post), post transcripts, and the LinkedIn Ad Library (ad details, ad search).",
  facebook:
    "Pages, groups and group posts, posts, comments and replies, photos, reels (incl. the full reels feed with per-item view counts), events and event search, Marketplace (keyword search, location search, item details), video and ad transcripts, keyword search over posts, pages, people, videos and groups (search/*), and the full Facebook Ad Library (ads, company ads, ad search, company search).",
  reddit:
    "Subreddit posts and details, single post detail, post comments, user profiles with their post and comment history, keyword / comment / media search, subreddit discovery search, the cross-source omni-search composite, and post video transcripts.",
  threads:
    "Profiles, posts, post details, post comments, keyword search, and user search.",
  pinterest:
    "Pins, boards, user boards, keyword search, Pinterest Trends by country (top rising search terms), and Pinterest Save-Button counts for any URL (url-stats).",
  twitch:
    "Streamer profiles, clip details, user videos, and broadcast schedules.",
  snapchat:
    "Public user profiles including subscriber count and bio, plus comments on Spotlight posts.",
  truthsocial: "Profiles, user posts, and post details.",
  telegram:
    "Public Telegram channel profiles, channel post feeds, and single post lookups.",
  kick: "Clip details including view count, duration, and category.",
  kwai:
    "Profiles, user posts, and post details from Kwai (Kuaishou's international short-video app).",
  tiktokshop:
    "TikTok Shop product details, product reviews, shop product listings, shop search, and creator showcases.",
  perplexity:
    "Web research via Perplexity Sonar — returns a grounded answer with cited source URLs.",
  google:
    "Google web search, Google Ads Transparency Center (ad details, advertiser search, company ads), Google Business Profile (place info, extended cross-source reviews, owner updates, Q&A), and Google Travel hotels (search + rich hotel details).",
  amazon:
    "Product search, full ASIN product details, on-page reviews, buy-box sellers and offers, Amazon shop/storefront pages, Best Sellers charts by category, current deals, and seller profiles — across ~13 Amazon marketplaces via the country parameter.",
  google_shopping:
    "Google Shopping product search, full product details, price history for a product, reviews aggregated across retailers, and per-seller offers with itemised pricing.",
  google_news:
    "Real-time Google News SERP search — ranked headlines with source, snippet, and timestamp for any query. Multi-source with automatic fallback.",
  economy:
    "Economic and trade data — household spending and travel spending by country and category, US federal spending by state, county or country, US federal contract award search, and a US importer's suppliers and shipments.",
  finance:
    "Financial-instrument data — full quotes, ticker search by name, a markets overview (indices + top movers), instrument news, daily price-history bars, company financial statements, and options chains.",
  google_trends:
    "Google Trends interest data — `explore` returns interest-over-time (and optional geo/related breakdowns) for one or more terms; `rising` returns breakout/rising related queries for a term; `trending` returns Trending Now for a location, filtered by hour window, category, status and sort. Multi-source with automatic fallback.",
  trustpilot:
    "Trustpilot business search and company reviews — brand-reputation data keyed by company domain (shipping, refunds, support sentiment). For product reviews use amazon/reviews or google_shopping/reviews.",
  g2:
    "G2 software marketplace — product pages by slug or URL, product reviews, category product listings and the full category URL index, vendor (seller) profiles with their product catalogue, and a product URL index for crawling.",
  google_play:
    "Google Play app search, full app details, app reviews with developer replies, store charts (top free/paid/grossing), a filterable app listings database, search suggestions, and categories/locations/languages reference data.",
  app_store:
    "Apple App Store app search, full app details, app reviews, store charts (top free/paid/grossing for iPhone and iPad), a filterable app listings database, search suggestions, and categories/locations/languages reference data.",
  tripadvisor:
    "Hotels, restaurants, attractions and cruise ships — search and full detail for each, plus traveler reviews with owner replies, review images, and cross-language auto-translation metadata. Also place lookup by URL, destination autocomplete, and the experience types available in a destination.",
  walmart:
    "Walmart product details, product reviews, keyword search, category browsing, and every seller offering a product — across Walmart marketplaces via the country parameter.",
  target:
    "Target product details by TCIN, product reviews, category browsing, the full category taxonomy, and store lookup near a location.",
  wayfair:
    "Wayfair product search, product details by SKU, and customer reviews.",
  home_depot:
    "Home Depot keyword product search, product details by item id or URL (store- and zip-aware pricing), product reviews with rating, verified-purchase, and free-text filters, and store lookup near a ZIP code.",
  ebay:
    "eBay listing search — including sold and completed listings with realised sale prices and dates — and full listing details by item id, across eBay country sites.",
  etsy:
    "Etsy listings by id or URL, a shop's product catalogue, similar-listing recommendations, and search suggestions.",
  sephora:
    "Sephora product details, customer reviews, keyword search and search suggestions, category browsing with the root/child category tree, brand listings and per-brand products, store lookup near a coordinate, and per-SKU in-store availability.",
  aliexpress:
    "AliExpress product details, keyword search, similar products, customer reviews, per-SKU shipping options, hot products, featured promotions and their product lists, and the category tree.",
  hm:
    "H&M keyword product search and search suggestions, store listings by country, the supported countries/languages table, the category tree, and per-product supplier and factory disclosure.",
  kohls:
    "Kohl's keyword product search, product reviews, product questions and answers, store lookup near a coordinate, and the category tree.",
  klarna:
    "Klarna's shopping comparison graph — product details and every merchant offer for a product, keyword search and suggestions, user reviews, professional reviews and review-score overviews, price history, side-by-side product comparison, category browsing with sub-categories, filters, popular keywords and buying guides, and store listings with their products and filters.",
  gumtree:
    "Gumtree UK classifieds — listing search and details, similar listings, seller profiles and their active ads, search suggestions, trending searches, the category tree with per-category filters, and location autocomplete plus nearest-location lookup.",
  yelp:
    "Yelp business profiles by encid, business reviews, business search (compact and full-card variants), and search suggestions.",
  utility:
    "Free, zero-credit API self-discovery — list and search every endpoint (`endpoints`), get exact usage for any one of them (`endpoint`), the cross-cutting parameters that work across endpoints with their prices (`capabilities`), a priced call plan for a goal in plain words (`plan`), a one-call quickstart (`quickstart`), and an AI-agent context payload (`llms`). Served in-process from the endpoint registry: no network call, 0 credits.",
  linktree:
    "Linktree link-in-bio pages including display name, bio, avatar, and link list.",
  linkbio:
    "Linkbio link-in-bio pages including display name, bio, avatar, and link list.",
  linkme:
    "Linkme link-in-bio pages including display name, bio, avatar, and link list.",
  komi:
    "Komi link-in-bio pages including display name, bio, avatar, and link list.",
  pillar:
    "Pillar link-in-bio pages including display name, bio, avatar, and link list.",
  polymarket:
    "Prediction-market research — a server-side fan-out that expands a topic across multiple queries and ranks the merged Polymarket events.",
  hackernews:
    "Story search, story details, story comment trees, and user profiles. Backed by the public Algolia HN API.",
  quora:
    "Question search and question details, answer search, Space post search, profile search, and Space/topic search.",
  douyin:
    "Douyin (China's TikTok) — video search, creator profiles and their video feeds, single video detail, video comments and comment replies, creator search, and the hot-search trending board. Most lanes are metered per row returned, so cap `limit` before you call.",
  github:
    "Users, repositories, user repos, READMEs, releases, issues, pull requests, issue/PR comments, issue/PR search, and composite repo top-issues/dossier + user profile-velocity reports. Backed by the official GitHub REST API.",
  tavily:
    "Web search with optional LLM-synthesised answer, content extraction from URLs, lightweight sitemap discovery, and full multi-page crawl.",
  naver:
    "Korea's #1 search portal — search corpora (blog, news, encyclopedia, cafe article, Q&A/KiN, local places, image, web), the Korean-language errata and adult-term classifiers, and Naver Data Lab search-trend + shopping-insight time series.",
  xiaohongshu:
    "Xiaohongshu (RED / Little Red Book) — note search, the hot-search trending board, creator profiles and their note lists, full note detail, and top-level note comments. Metered at 5 credits per returned row, so cap `limit` before you call.",
  producthunt:
    "The public Product Hunt launch feed — about 50 current launches in one page, optionally filtered by topic slug.",
  rumble:
    "Video search, channel videos, video details, video comments, and video transcripts.",
  bluesky:
    "Profiles, user posts, post details, and keyword post search (newest-first or top, with date, language and author filters) from the AT Protocol social network.",
  spotify:
    "Artists, tracks, albums, podcasts, podcast episodes, and search across the Spotify catalog.",
  apple_music:
    "Apple Music catalog search, artist, album, and track details, and the per-country Apple Music charts (top songs, albums, music videos, playlists).",
  search:
    "Meta-search lanes: `everywhere` fuses 14 platforms (up to 17 sources in hashtag mode) in a single flat-priced call; `multi` runs each named platform's own native search for one query in one call, priced as the sum of those native pages; `forums` fuses Reddit + Hacker News + Naver KiN/Cafe with top comments inline; `news` plans, localizes, and fans a query out across up to 12 Google News country editions with metered per-leg billing; `creators` fuses TikTok + Threads + Instagram creator discovery, ranked by relevance, followers and verification. LLM-planned, RRF-fused, LLM-reranked, clustered.",
  prism:
    "Cross-platform composite intelligence — server-side recipes that fan out across many platforms and fold the legs into one unified report. Universal URL lookup, full comment harvesting, brand-mention and consumer-demand nowcasts, AI share-of-voice / GEO monitoring, crisis radar and post-mortems, cross-source reputation, share-of-voice, creator vetting and creator cards, handle audits, name-to-accounts resolution (find-accounts), handle/link mention search, adverse-post screening, campaign-brief checks, hook/format lift, term earliness across platforms, a no-keyword country trend board, commenter language mix, comment-sourced buyer leads, multi-engine AI consensus answers, org/repo radar, Korea gap analysis, video/app/product intelligence, batch lookups (post-stats, profiles, comment-lookup), and async background jobs of up to 5,000 items (jobs). Each composite emits a per-leg transparency array; pricing is flat or metered per recipe (see the pricing docs topic and the socialcrawl_estimate tool).",
  content_analysis:
    "Cross-web brand-mention search and 6-axis sentiment intelligence over news, blogs, ecommerce, and message boards — paginated mention feeds, sentiment/summary aggregates, rating distributions, phrase and category trends, plus languages/locations/categories/filters reference data.",
  on_page:
    "Single-URL on-page SEO audit — the technical, content, and meta checks for one page in one call.",
  jobs:
    "Job listings across LinkedIn, Indeed, Bing and Xing — keyword/location search plus single-listing detail for each, LinkedIn organization-id resolution, and salary ranges by job title and country with title suggestions.",
  us_congress_trades:
    "US Congress STOCK Act disclosures — searchable trade feeds (all, latest 48h, recent 7d), the members who have disclosed, per-politician summaries and trades, per-ticker stats and trades, per-state delegation trades, and the full statistics suite: party comparison, sectors, issuers, most-active politicians, most-traded tickers, volume over time, unusual activity, buy/sell ratio, and late-filing reporting gaps.",
};

const root = resolve(import.meta.dirname, "..");
const dump: Dump = JSON.parse(
  readFileSync(resolve(root, "registry-dump.json"), "utf8"),
);

// ── Guard: dump must be schema v3 (judgments, featured params, related) or v4 (+ purpose, outputs) ──
const schemaVersion = dump.schemaVersion ?? 1;
if ((schemaVersion !== 3 && schemaVersion !== 4) || !dump.registryFingerprint) {
  console.error(
    `registry-dump.json is schema v${schemaVersion}; this generator needs v3 or v4 with a registryFingerprint. ` +
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

/**
 * SHA-256 over every active endpoint's method, path and parameter names, as
 * the backend computes it (\`docs/registry-dump.ts\`). Two catalogues with the
 * same fingerprint accept exactly the same calls; the freshness check compares
 * it with the live API's.
 */
export const REGISTRY_FINGERPRINT = ${JSON.stringify(dump.registryFingerprint)};

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
  // Latency contract (dump v4). Absent until the codebase carries it; then it flows through.
  if (typeof e.recommended_timeout_s === "number") {
    lines.push(`    recommended_timeout_s: ${e.recommended_timeout_s},`);
  }
  if (typeof e.budget_ms === "number") lines.push(`    budget_ms: ${e.budget_ms},`);
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
  const renderLanes = (key: string, lanes: DumpHydrationLane[]): void => {
    if (lanes.length === 0) return;
    lines.push(`    ${key}: [`);
    for (const h of lanes) {
      const parts = [
        `param: ${str(h.param)}`,
        `token: ${str(h.token)}`,
        `sibling: ${str(h.sibling)}`,
      ];
      if (h.siblingMethod) parts.push(`siblingMethod: ${str(h.siblingMethod)}`);
      parts.push(`fills: [${h.fills.map(str).join(", ")}]`);
      parts.push(`creditsPerItem: ${h.creditsPerItem}`);
      parts.push(`maxItems: ${h.maxItems}`);
      if (h.defaultRowLimit !== undefined) {
        parts.push(`defaultRowLimit: ${h.defaultRowLimit}`);
      }
      if (h.rowLimitParam) parts.push(`rowLimitParam: ${str(h.rowLimitParam)}`);
      if (h.batch) {
        parts.push(
          `batch: { size: ${h.batch.size}, creditCap: ${h.batch.creditCap} }`,
        );
      }
      parts.push(`cacheSibling: ${h.cacheSibling}`);
      parts.push(
        `warnings: { unavailable: ${str(h.warnings.unavailable)}, partial: ${str(h.warnings.partial)} }`,
      );
      if (h.replaceApproximate && h.replaceApproximate.length > 0) {
        parts.push(
          `replaceApproximate: [${h.replaceApproximate.map(str).join(", ")}]`,
        );
      }
      if (h.defaultOn) {
        parts.push(
          `defaultOn: { unlessParam: ${str(h.defaultOn.unlessParam)}, unlessValue: ${str(h.defaultOn.unlessValue)} }`,
        );
      }
      lines.push(`      { ${parts.join(", ")} },`);
    }
    lines.push("    ],");
  };
  renderLanes("hydration", (e.hydration ?? []).filter((h) => !h.defaultOn));
  renderLanes("automaticJoins", (e.hydration ?? []).filter((h) => h.defaultOn));
  if (e.judgments) {
    const j = e.judgments;
    const parts = [`offParam: ${str(j.offParam)}`];
    if (j.labels) {
      parts.push(
        `labels: { param: ${str(j.labels.param)}, presets: [${j.labels.presets.map(str).join(", ")}], free: [${j.labels.free.map(str).join(", ")}], metered: [${j.labels.metered.map(str).join(", ")}], rowsPerCredit: ${j.labels.rowsPerCredit}, rowPath: ${str(j.labels.rowPath)} }`,
      );
    }
    if (j.relevance) {
      parts.push(
        `relevance: { param: ${str(j.relevance.param)}, values: [${j.relevance.values.map(str).join(", ")}], topicParam: ${str(j.relevance.topicParam)}, meteredTopicParam: ${str(j.relevance.meteredTopicParam)}, rowsPerCredit: ${j.relevance.rowsPerCredit} }`,
      );
    }
    lines.push(`    judgments: { ${parts.join(", ")} },`);
  }
  if (e.featuredParams && e.featuredParams.length > 0) {
    lines.push("    featuredParams: [");
    for (const f of e.featuredParams) {
      lines.push(
        `      { name: ${str(f.name)}, benefit: ${str(f.benefit)}, example: ${str(f.example)} },`,
      );
    }
    lines.push("    ],");
  }
  if (e.related && e.related.length > 0) {
    lines.push("    related: [");
    for (const r of e.related) {
      lines.push(`      { id: ${str(r.id)}, why: ${str(r.why)} },`);
    }
    lines.push("    ],");
  }
  if (e.responseShape) {
    const shapeParts = [`root: ${str(e.responseShape.root)}`];
    if (e.responseShape.itemKey) {
      shapeParts.push(`itemKey: ${str(e.responseShape.itemKey)}`);
    }
    lines.push(`    responseShape: { ${shapeParts.join(", ")} },`);
  }
  if (e.purpose) {
    const p = e.purpose;
    lines.push("    purpose: {");
    lines.push(`      summary: ${str(p.summary)},`);
    for (const k of ["returns", "use_when", "not_for"] as const) {
      lines.push(`      ${k}: ${p[k] ? str(p[k] as string) : "null"},`);
    }
    lines.push("    },");
  }
  if (e.taxonomy) {
    lines.push(
      `    taxonomy: { purpose: ${str(e.taxonomy.purpose)}, job_family: ${str(e.taxonomy.job_family)}, takes_item_id_from_another_endpoint: ${e.taxonomy.takes_item_id_from_another_endpoint === true} },`,
    );
  }
  if (e.latency_ms) {
    const l = e.latency_ms;
    const parts = [`p50: ${l.p50}`, `p95: ${l.p95}`, `p99: ${l.p99}`, `n: ${l.n}`];
    if (l.provisional) parts.push("provisional: true");
    if (l.low_sample) parts.push("low_sample: true");
    lines.push(`    latency_ms: { ${parts.join(", ")} },`);
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

// ── outputs.ts (dump v4) ────────────────────────────────────────────────
// One compact JSON line per endpoint, keyed "METHOD platform/resource". An
// absent meaning / fill / live becomes an explicit null.
const outputKey = (e: DumpEndpoint): string => `${e.method} ${e.platform}/${e.resource}`;
const outputLines = dump.endpoints
  .filter((e) => e.outputs)
  .map((e) => {
    const o = e.outputs!;
    const compact = {
      archetype: o.archetype,
      rows_at: o.rows_at ?? null,
      fields: o.fields.map((f) => ({
        path: f.path,
        type: f.type,
        nullable: f.nullable,
        meaning: f.meaning ?? null,
        fill: f.fill ?? null,
        live: f.live ?? null,
        ...(f.opt_in ? { opt_in: f.opt_in } : {}),
        ...(f.source_hint ? { source_hint: f.source_hint } : {}),
      })),
      never_filled: o.never_filled ?? [],
      page_level: o.page_level ?? [],
      source: o.source,
      ...(o.inferred_from ? { inferred_from: o.inferred_from } : {}),
    };
    return `  ${str(outputKey(e))}: ${JSON.stringify(compact)},`;
  });

// The contract's paging block per endpoint, same key and nulls as the dump.
const pagingLines = dump.endpoints
  .filter((e) => e.paging)
  .map((e) => {
    const p = e.paging!;
    const compact = {
      style: p.style,
      page_size: p.page_size ?? null,
      page_size_source: p.page_size_source ?? null,
      observed_n: p.observed_n ?? null,
      page_size_max: p.page_size_max ?? null,
      max_pages: p.max_pages ?? null,
      max_pages_when: p.max_pages_when ?? null,
      per_n_items: p.per_n_items ?? null,
      price_basis: p.price_basis ?? null,
      credits_per_page: p.credits_per_page ?? null,
      credits_per_row: p.credits_per_row ?? null,
    };
    return `  ${str(outputKey(e))}: ${JSON.stringify(compact)},`;
  });

const outputsTs = `import type { Endpoint, EndpointOutputs, EndpointPaging } from "../types.js";

/**
 * What each endpoint returns: the response-field contract from registry dump
 * schema v4 (outputs), keyed "METHOD platform/resource". Generated by
 * scripts/generate-data.ts — do not hand-edit. Empty when the dump is v3.
 * Source: ${dump.generatedFrom}
 */
export const OUTPUTS: Record<string, EndpointOutputs> = {
${outputLines.join("\n")}
};

/** The output contract for an endpoint, or undefined when the dump had none. */
export function outputsFor(e: Pick<Endpoint, "method" | "platform" | "resource">): EndpointOutputs | undefined {
  return OUTPUTS[\`\${e.method} \${e.platform}/\${e.resource}\`];
}

/**
 * The contract's paging block (registry dump \`paging\`), keyed the same way:
 * page size and where it came from, agreeing captures, depth cap, and the
 * price of N items. Every null means unknown, never "none".
 */
export const PAGING: Record<string, EndpointPaging> = {
${pagingLines.join("\n")}
};

/** The paging facts for an endpoint, or undefined when it does not page. */
export function pagingFor(e: Pick<Endpoint, "method" | "platform" | "resource">): EndpointPaging | undefined {
  return PAGING[\`\${e.method} \${e.platform}/\${e.resource}\`];
}
`;

writeFileSync(resolve(root, "src/data/outputs.ts"), outputsTs);
writeFileSync(resolve(root, "src/data/platforms.ts"), platformsTs);
writeFileSync(resolve(root, "src/data/endpoints.ts"), endpointsTs);
writeFileSync(resolve(root, "src/data/registry-meta.ts"), metaTs);

const metered = dump.endpoints.filter((e) => e.pricing.model === "metered");
const flat = dump.endpoints.filter((e) => e.pricing.model === "flat");
console.log(
  `wrote src/data/platforms.ts (${dump.platforms.length} platforms), ` +
    `src/data/endpoints.ts (${dump.endpoints.length} endpoints — ` +
    `${metered.length} metered, ${flat.length} flat-override) and ` +
    `src/data/registry-meta.ts and src/data/outputs.ts (${outputLines.length} output contracts, ${pagingLines.length} paging blocks, schema v${schemaVersion})`,
);

// ── T28 / MCP-05: reference material for resources and prompts ──────────
//
// Read from the sibling codebase repo (override with SOCIALCRAWL_CODEBASE).
// Each piece is optional: when the codebase is not next to this repo, the
// committed src/data/{recipes,guide,examples}.ts are left as they are.

const excludeFlagged = process.argv.includes("--exclude-flagged");
const codebase = resolve(process.env.SOCIALCRAWL_CODEBASE ?? resolve(root, "../codebase"));
const socialApi = resolve(codebase, "packages/social-api");
const skillDir = resolve(codebase, ".claude/skills/socialcrawl");
const GENERATED_NOTE = "Generated by scripts/generate-data.ts (T28) - do not hand-edit.";

// Recipes (data, with computed cost): packages/social-api/scripts/export-recipes.ts.
const exportRecipes = resolve(socialApi, "scripts/export-recipes.ts");
if (existsSync(exportRecipes)) {
  const out = execFileSync(resolve(root, "node_modules/.bin/tsx"), ["scripts/export-recipes.ts"], {
    cwd: socialApi,
    env: { ...process.env, SKIP_ENV_VALIDATION: "1" },
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  const { recipes } = JSON.parse(out) as { recipes: unknown[] };
  writeFileSync(
    resolve(root, "src/data/recipes.ts"),
    `import type { RecipeData } from "../resources/recipe-types.js";\n\n/** Task recipes with computed cost lines. ${GENERATED_NOTE} */\nexport const RECIPES_DATA: RecipeData[] = ${JSON.stringify(recipes)};\n`,
  );
  console.log(`wrote src/data/recipes.ts (${recipes.length} recipes)`);
}

// Guide (the skill's SKILL.md without frontmatter) and the errors reference.
if (existsSync(resolve(skillDir, "SKILL.md"))) {
  const body = readFileSync(resolve(skillDir, "SKILL.md"), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  const errors = readFileSync(resolve(skillDir, "references/errors.md"), "utf8").trim();
  writeFileSync(
    resolve(root, "src/data/guide.ts"),
    `/** The skill's SKILL.md body and errors reference. ${GENERATED_NOTE} */\nexport const GUIDE = ${JSON.stringify(body)};\n\nexport const ERRORS_GUIDE = ${JSON.stringify(errors)};\n`,
  );
  console.log("wrote src/data/guide.ts");
}

// Redacted samples (own captures only, two rows each) and per-archetype samples.
const examplesDir = resolve(socialApi, "src/docs/examples");
if (existsSync(resolve(examplesDir, "endpoints"))) {
  const samples: Record<string, string> = {};
  const failures: string[] = [];
  let neutralised = 0;
  let dropped = 0;
  for (const f of readdirSync(resolve(examplesDir, "endpoints")).sort()) {
    if (!f.endsWith(".json")) continue;
    const j = JSON.parse(readFileSync(resolve(examplesDir, "endpoints", f), "utf8")) as Record<string, unknown>;
    if (j.redacted !== true || typeof j.endpoint !== "string") continue;
    const key = j.endpoint.replace(/^\/v1\//, "");
    const { sample, notes } = prepareSample({ endpoint: j.endpoint, data: j.data, pagination: j.pagination, credits_used: j.credits_used, redacted: true });
    if (!sample) {
      dropped++;
      continue;
    }
    neutralised += notes.length;
    const json = JSON.stringify(sample);
    const issues = findSampleIssues(json, key);
    if (issues.length > 0) {
      failures.push(`${key}: ${issues.join("; ")}`);
      // Never rewritten here. With --exclude-flagged the sample is left out of the bundle (an interim, not a fix).
      if (excludeFlagged) continue;
    }
    samples[key] = json;
  }
  console.log(`samples: ${neutralised} messages neutralised, ${dropped} dropped`);
  if (failures.length > 0 && !excludeFlagged) {
    // The codebase redactor is the only redactor: nothing is rewritten here and nothing is written.
    throw new Error(
      `sample gate: ${failures.length} unsafe sample(s) would ship (rule and path shown, values never). Fix them in the codebase corpus and run again (or --exclude-flagged to leave them out):\n${failures.join("\n")}`,
    );
  }
  if (failures.length > 0) console.log(`sample gate: ${failures.length} flagged sample(s) EXCLUDED from the bundle:\n${failures.map((f) => f.split(":")[0]).join("\n")}`);
  const archetypes: Record<string, string> = {};
  for (const f of readdirSync(examplesDir).sort()) {
    if (!f.endsWith(".json")) continue;
    const { sample } = prepareSample(JSON.parse(readFileSync(resolve(examplesDir, f), "utf8")) as Record<string, unknown>);
    if (!sample) continue;
    const json = JSON.stringify(sample);
    const issues = findSampleIssues(json);
    if (issues.length > 0) {
      failures.push(`archetype ${f}: ${issues.join("; ")}`);
      if (excludeFlagged) continue;
    }
    archetypes[f.replace(/\.json$/, "")] = json;
  }
  if (failures.length > 0 && !excludeFlagged) {
    throw new Error(`sample gate: ${failures.length} unsafe sample(s) would ship (rule and path shown, values never). Fix them in the codebase corpus and run again (or --exclude-flagged):\n${failures.join("\n")}`);
  }
  writeFileSync(
    resolve(root, "src/data/examples.ts"),
    `/** Redacted sample responses by "platform/resource", as minified JSON, and one per archetype. ${GENERATED_NOTE} */\nexport const EXAMPLES: Record<string, string> = ${JSON.stringify(samples)};\n\nexport const ARCHETYPE_EXAMPLES: Record<string, string> = ${JSON.stringify(archetypes)};\n`,
  );
  console.log(`wrote src/data/examples.ts (${Object.keys(samples).length} samples, ${Object.keys(archetypes).length} archetype samples)`);
}
