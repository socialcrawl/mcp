import type { Endpoint, OptionalParam } from "./types.js";

/**
 * UPGRADE-LOG API-051 — the names the API accepts for a param it spells
 * differently, ported from the backend so the MCP tells an agent the truth
 * about a param it did not declare: renamed by the API (and noted in
 * `data._warnings`), or dropped.
 *
 * Sources: packages/social-api/src/validation/param-aliases.ts
 * (PARAM_SYNONYMS, SOURCE_ONLY, TARGET_ONLY, PROXY_REGION_LANES,
 * COUNTRY_LOCATION_LANES, isValidTarget), validation/request-params/index.ts
 * (DATE_FILTER_ALIASES, HOUSE_WINDOW_ALIASES, applied before the concept
 * aliases) and router/platform-alias.ts (FEED_PATH_ALIASES).
 *
 * The MCP sends the caller's names unchanged: the API does the renaming, so
 * the two can never disagree about the value. This only predicts the outcome.
 */

type Concept = "sort" | "country" | "limit";

const PARAM_SYNONYMS: Record<Concept, readonly string[]> = {
  sort: ["sort", "sort_by", "sortBy", "order_by", "orderBy", "sort_order", "sort_type", "order", "sort_rows"],
  country: ["country", "region", "country_code", "countryCode", "location", "countries", "regions", "gl", "geo", "market"],
  limit: ["limit", "page_size", "per_page", "max_results", "items_per_page", "hitsPerPage", "display", "size", "count", "num"],
};
/** Read as the idea when sent, never written to. */
const SOURCE_ONLY = new Set(["gl", "geo", "market", "num"]);
/** Written to where they mean the idea, never read from a caller. */
const TARGET_ONLY = new Set(["location", "countries", "regions", "size", "display"]);
/** Lanes whose `region` is the proxy country, not a row filter. */
const PROXY_REGION_LANES = new Set([
  "instagram/post",
  "tiktok/effect/videos",
  "tiktok/location/posts",
  "tiktok/post",
  "tiktok/profile/videos",
  "tiktok/search",
  "tiktok/search/hashtag",
  "tiktok/search/music",
  "tiktok/search/top",
  "tiktok/trending",
  "youtube/search",
]);
/** Lanes whose `location` is a country. */
const COUNTRY_LOCATION_LANES = new Set(["google/keyword-volume", "google_trends/explore", "google_trends/rising", "google_trends/trending"]);
/** The row-walk params are never a rename target. */
const WALK_PARAMS = new Set(["max_items", "max_pages", "max_credits"]);
const DIRECTION_VALUES = new Set(["asc", "desc"]);

/** Sibling spellings of the same filter, in the order the API tries them. */
const DATE_FILTER_ALIASES: readonly (readonly [string, string])[] = [
  ["date_posted", "publish_time"],
  ["publish_time", "date_posted"],
  ["order", "sortBy"],
  ["sortBy", "order"],
  ["from_date", "from"],
  ["from", "from_date"],
  ["to_date", "to"],
  ["to", "to_date"],
  ["time_range", "timeframe"],
  ["timeframe", "time_range"],
  ["published_after", "from_date"],
  ["published_before", "to_date"],
  ["published_after", "start_date"],
  ["published_before", "end_date"],
  ["published_after", "date_from"],
  ["published_before", "date_to"],
  ["published_after", "from"],
  ["published_before", "to"],
  ["published_after", "since"],
  ["published_before", "until"],
  ["since", "from_date"],
  ["until", "to_date"],
  ["from_date", "start_date"],
  ["to_date", "end_date"],
  ["start_date", "since"],
  ["end_date", "until"],
  ["from_date", "since"],
  ["to_date", "until"],
  ["date_from", "since"],
  ["date_to", "until"],
];
/** `since`/`until` onto a lane's own window names — only when the value is a date. */
const HOUSE_WINDOW_ALIASES: readonly (readonly [string, string])[] = [
  ["since", "start_date"],
  ["until", "end_date"],
  ["since", "date_from"],
  ["until", "date_to"],
  ["since", "from"],
  ["until", "to"],
  ["since", "startDate"],
  ["until", "endDate"],
];

/**
 * Paths with no endpoint of their own that the API serves as that platform's
 * posts feed (one call, one cache slot). `x/…` is `twitter/…` first.
 */
export const FEED_PATH_ALIASES: Readonly<Record<string, string>> = {
  "bluesky/profile/posts": "bluesky/user/posts",
  "facebook/page/posts": "facebook/profile/posts",
  "facebook/user/posts": "facebook/profile/posts",
  "gab/profile/posts": "gab/user/posts",
  "instagram/user/posts": "instagram/profile/posts",
  "kwai/profile/posts": "kwai/user/posts",
  "rumble/profile/posts": "rumble/channel/videos",
  "threads/profile/posts": "threads/user/posts",
  "tiktok/profile/posts": "tiktok/profile/videos",
  "tiktok/user/posts": "tiktok/profile/videos",
  "truthsocial/profile/posts": "truthsocial/user/posts",
  "twitch/profile/posts": "twitch/user/videos",
  "twitter/profile/posts": "twitter/user/tweets",
  "twitter/users/tweets": "twitter/user/tweets",
};

/** `x` is the API's other name for `twitter`. */
export const PLATFORM_ALIASES: Readonly<Record<string, string>> = { x: "twitter" };

const isPresent = (v: unknown): boolean => v !== undefined && v !== null && v !== "";
const isWindowDate = (v: unknown): boolean => {
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(s) && !Number.isNaN(Date.parse(s));
};

function specOf(e: Endpoint, name: string): OptionalParam | { name: string; type: string; enumValues?: string[] } | undefined {
  const opt = e.optionalParams.find((p) => p.name === name);
  if (opt) return opt;
  return e.params.find((p) => p.name === name) ? { name, type: "string" } : undefined;
}

function isValidTarget(e: Endpoint, concept: Concept, name: string): boolean {
  if (SOURCE_ONLY.has(name) || WALK_PARAMS.has(name)) return false;
  const spec = specOf(e, name);
  if (!spec) return false;
  const lane = `${e.platform}/${e.resource}`;
  if (concept === "sort") {
    return spec.type === "enum" && (spec.enumValues ?? []).some((v) => !DIRECTION_VALUES.has(v.toLowerCase()));
  }
  if (concept === "country") {
    if (name === "region" && PROXY_REGION_LANES.has(lane)) return false;
    if (name === "location" && !COUNTRY_LOCATION_LANES.has(lane)) return false;
    return spec.type === "string" || spec.type === "enum";
  }
  return spec.type === "integer" || (spec.type === "enum" && (spec.enumValues ?? []).every((v) => /^\d+$/.test(v)));
}

/**
 * The renames the API will make on this call: `{from, to}` per param sent
 * under a name the endpoint does not declare, in the API's own order.
 */
export function planParamAliases(e: Endpoint, sent: Record<string, unknown>): { from: string; to: string }[] {
  const declared = new Set([...e.params.map((p) => p.name), ...e.optionalParams.map((p) => p.name)]);
  const query: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sent)) if (isPresent(v)) query[k] = v;
  const out: { from: string; to: string }[] = [];

  const windows = HOUSE_WINDOW_ALIASES.filter(([from]) => isPresent(query[from]) && isWindowDate(query[from]));
  for (const [from, to] of [...DATE_FILTER_ALIASES, ...windows]) {
    if (isPresent(query[from]) && !isPresent(query[to]) && declared.has(to) && !declared.has(from)) {
      query[to] = query[from];
      delete query[from];
      out.push({ from, to });
    }
  }

  for (const [from, value] of Object.entries(query)) {
    if (declared.has(from) || TARGET_ONLY.has(from) || !isPresent(value)) continue;
    const concept = (Object.keys(PARAM_SYNONYMS) as Concept[]).find((c) => PARAM_SYNONYMS[c].includes(from));
    if (!concept) continue;
    const to = PARAM_SYNONYMS[concept].find((n) => n !== from && !isPresent(query[n]) && isValidTarget(e, concept, n));
    if (!to) continue;
    query[to] = value;
    delete query[from];
    out.push({ from, to });
  }
  return out;
}
