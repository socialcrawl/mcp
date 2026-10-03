import { ENDPOINTS } from "../data/endpoints.js";
import { OUTPUTS } from "../data/outputs.js";
import { PLATFORMS } from "../data/platforms.js";
import type { Endpoint } from "../types.js";
import { manageDocs } from "./manage-docs.js";
import type { ManageDoc } from "./manage-docs.js";
import { buildIndex, didYouMean, rank } from "./rank.js";
import type { RankDoc, RankIndex, RankOptions, RankPattern, RankPlatform } from "./rank.js";

/**
 * The bundled catalogue bound to the ranker in `rank.ts`: one document per
 * endpoint (id, purpose fields, tags, plus archetype / param names / label
 * presets as low-weight extra text), one per stateful family that
 * socialcrawl_manage runs outside the registry (`manage-docs.ts`), and the
 * platform phrases the ranker boosts. An endpoint is a list when its
 * archetype or paging says so, its output contract puts the rows in an array,
 * or its purpose says it returns a list; it is cross-platform when its job
 * family is a cross-platform composite or its family owns its whole platform.
 */

/** Everyday words that are also platform names: only a multi-word name or an alias names them. */
const GENERIC = new Set([
  "web",
  "finance",
  "utility",
  "search",
  "jobs",
  "target",
  "threads",
  "kick",
  "pillar",
  "prism",
  "content_analysis",
  "on_page",
]);

/** Short names agents use for a platform. */
const ALIASES: Record<string, string[]> = {
  twitter: ["x", "x twitter"],
  instagram: ["ig", "insta"],
  youtube: ["yt"],
  facebook: ["fb"],
  hackernews: ["hn"],
  app_store: ["app store", "appstore", "ios app store", "iphone", "ios"],
  google_play: ["play store", "google play store", "android"],
  us_congress_trades: ["congress"],
  xiaohongshu: ["rednote", "xhs"],
  hm: ["hm"],
  web: ["website", "web page", "webpage"],
  threads: ["threads app"],
  jobs: ["job boards"],
};

/** Words that name a platform but stay in the query as search words. */
const SOFT_ALIASES: Record<string, string[]> = {
  twitter: ["tweet", "tweets", "retweet", "retweets"],
  finance: ["stock", "stocks", "ticker"],
  reddit: ["subreddit", "subreddits"],
  google: ["google maps", "maps"],
  google_trends: ["trends", "trend"],
};

/** Raw-query patterns: `r/<name>` is a subreddit. */
const PATTERNS: RankPattern[] = [{ re: /(^|[\s(])\/?r\/[a-z0-9_]{2,21}\b/i, platform: "reddit", term: "subreddit" }];

let cached: { index: RankIndex; endpoints: Endpoint[]; manage: ManageDoc[] } | undefined;

function catalog(): { index: RankIndex; endpoints: Endpoint[]; manage: ManageDoc[] } {
  if (cached) return cached;
  const endpoints = ENDPOINTS;
  const manage = manageDocs();
  // A family that owns every endpoint of its platform (a composite platform) fans out across platforms.
  const familyPlatforms = new Set(
    endpoints.filter((e) => e.family !== undefined && endpoints.every((x) => x.platform !== e.platform || x.family === e.family)).map((e) => e.platform),
  );
  const docs: RankDoc[] = endpoints.map((e) => ({
    id: `${e.platform}/${e.resource}`,
    platform: e.platform,
    method: e.method,
    summary: e.purpose?.summary ?? e.summary,
    returns: e.purpose?.returns ?? null,
    use_when: e.purpose?.use_when ?? null,
    tags: e.tags ?? [],
    // A list: its archetype or paging says so, its output contract puts the rows in an array, or it says it returns a list.
    list:
      /List$|SearchResults|Results$/.test(e.archetype) ||
      !!e.pagination ||
      !!e.paginatable ||
      (OUTPUTS[`${e.method} ${e.platform}/${e.resource}`]?.rows_at ?? "").includes("[]") ||
      /^returns (?:the |a |one )?(?:ranked )?list of\b/i.test(e.purpose?.returns ?? ""),
    // A POST that takes many ids (youtube/videos, prism/profiles); web and job submits are not batches.
    batch: e.method === "POST" && e.platform !== "web" && !e.resource.startsWith("jobs") && [...e.params, ...e.optionalParams].some((p) => /^(ids|urls|items|handles|video_ids|channel_ids)$/.test(p.name)),
    cross: e.taxonomy?.job_family === "cross_platform_composite" || familyPlatforms.has(e.platform),
    extra: [
      e.archetype,
      e.actionLabel ?? "",
      e.group ?? "",
      ...e.params.map((p) => p.name),
      ...e.optionalParams.map((p) => p.name),
      ...(e.judgments?.labels?.presets ?? []),
    ].join(" "),
  }));
  // The stateful families socialcrawl_manage runs (monitors, cohorts) rank beside the endpoints.
  const manageRankDocs: RankDoc[] = manage.map((m) => ({
    id: m.area,
    platform: m.area,
    summary: m.summary,
    returns: m.detail,
    use_when: m.usage,
    anyPlatform: true,
    extra: m.actions.join(" "),
  }));
  const platforms: RankPlatform[] = PLATFORMS.map((p) => ({
    slug: p.slug,
    name: p.name,
    aliases: ALIASES[p.slug],
    softAliases: SOFT_ALIASES[p.slug],
    generic: GENERIC.has(p.slug),
  }));
  cached = { index: buildIndex([...docs, ...manageRankDocs], platforms, PATTERNS), endpoints, manage };
  return cached;
}

export interface EndpointHit {
  id: string;
  score: number;
  endpoint: Endpoint;
}

/** A ranked answer to a task: an endpoint, or a stateful family run through socialcrawl_manage. */
export type TaskHit = EndpointHit | { id: string; score: number; manage: ManageDoc };

/** Endpoints and stateful families ranked for a task, best first. */
export function searchTasks(query: string, opts: RankOptions = {}): TaskHit[] {
  const { index, endpoints, manage } = catalog();
  return rank(index, query, opts).map((h) =>
    h.index < endpoints.length
      ? { id: h.id, score: h.score, endpoint: endpoints[h.index] }
      : { id: h.id, score: h.score, manage: manage[h.index - endpoints.length] },
  );
}

/** Endpoints ranked for a task, best first. */
export function searchEndpoints(query: string, opts: RankOptions = {}): EndpointHit[] {
  const { limit, ...rest } = opts;
  const hits = searchTasks(query, rest).filter((h): h is EndpointHit => "endpoint" in h);
  return limit !== undefined ? hits.slice(0, limit) : hits;
}

/** Platform slugs close to a mistyped one (slug, display name or alias), best first. */
export function suggestPlatforms(input: string, max = 3): string[] {
  const keys: string[] = [];
  const slugOf: string[] = [];
  for (const p of PLATFORMS) {
    for (const k of [p.slug, p.name, ...(ALIASES[p.slug] ?? []), ...(SOFT_ALIASES[p.slug] ?? [])]) {
      keys.push(k);
      slugOf.push(p.slug);
    }
  }
  const out: string[] = [];
  for (const k of didYouMean(input, keys, keys.length)) {
    const slug = slugOf[keys.indexOf(k)];
    if (!out.includes(slug)) out.push(slug);
    if (out.length >= max) break;
  }
  return out;
}

/** Endpoint ids on a platform that best match a mistyped resource: ranked, then by spelling. */
export function suggestEndpoints(platform: string, resource: string, max = 5): string[] {
  const out: string[] = [];
  const add = (id: string): void => {
    if (!out.includes(id) && out.length < max) out.push(id);
  };
  for (const h of searchEndpoints(resource.replace(/[{}]/g, " "), { platform, limit: max })) add(h.id);
  const ids = ENDPOINTS.filter((e) => e.platform === platform).map((e) => `${e.platform}/${e.resource}`);
  for (const id of didYouMean(`${platform}/${resource}`, ids, max)) add(id);
  return out;
}
