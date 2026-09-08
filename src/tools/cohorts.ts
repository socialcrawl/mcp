import { randomUUID } from "node:crypto";
import { apiRequest } from "../client.js";
import type { ApiContext } from "../context.js";

/**
 * Stateful Cohorts family (`/v1/cohorts/*` + `/v1/cohort-queries/*`).
 *
 * Cohorts answer a narrower question than open social listening: "which of
 * THESE specific public identities is talking about my keywords?" The caller
 * uploads a panel of platform-qualified public handles, submits a bounded
 * keyword query, and reads back per-member matches plus a coverage record for
 * every member — including the ones that matched nothing.
 *
 * Like monitors and the stateful web surface, these are NOT registry endpoints
 * (they mix POST/PUT/GET/DELETE with `:id` path params and an async lifecycle),
 * so they live in this dedicated tool rather than `socialcrawl_request`.
 *
 * Billing: every lifecycle call is 0 credits. Only the query is metered — it
 * reserves a worst-case ceiling at submission and refunds down to the pages
 * that actually succeeded.
 */

export type CohortAction =
  | "create"
  | "get"
  | "delete"
  | "add_members"
  | "query"
  | "query_status"
  | "query_results"
  | "query_cancel"
  | "estimate_cost";

export interface CohortMemberInput {
  external_id: string;
  platform: string;
  handle: string;
}

export interface CohortsParams {
  action: CohortAction;
  cohort_id?: string;
  query_id?: string;
  /** Retry-safe writes. Auto-generated when omitted; the key used is echoed back. */
  idempotencyKey?: string;
  // create
  name?: string;
  retention_days?: number;
  // add_members / estimate_cost
  members?: CohortMemberInput[];
  platform_counts?: Record<string, number>;
  // query
  keywords?: string[];
  date_from?: string;
  date_to?: string;
  max_pages_per_identity?: number;
  max_items_per_identity?: number;
  max_credits?: number;
  platforms?: string[];
  // query_results
  limit?: number;
  cursor?: string;
}

/**
 * The ten platforms a cohort identity may name. Anything else is rejected at
 * upload with 400 COHORT_IDENTITY_PLATFORM_UNSUPPORTED, so checking locally
 * turns a wasted round trip into an immediate, specific error.
 * Source: packages/social-api/src/platforms/cohorts/contract.ts.
 */
export const COHORT_IDENTITY_PLATFORMS = [
  "instagram",
  "tiktok",
  "youtube",
  "twitter",
  "threads",
  "bluesky",
  "truth-social",
  "kwai",
  "twitch",
  "linkedin",
] as const;

/**
 * The reservation ceiling, per member, per identity platform.
 *
 * The backend computes it as a sum over that platform's ACTIVITY LANES:
 *
 *   ceiling += lane.costPerPage * (lane.cursorParam === null ? 1 : maxPages)
 *
 * (`calculateQueryCreditCeiling` in packages/social-api/src/platforms/cohorts/
 * service.ts, over the lane table in `activity-routes.ts`). So a platform
 * contributes a FIXED part for its lanes that cannot be paged, plus a PER-PAGE
 * part for the lanes that can — two numbers, not one rate.
 *
 * Read from the registry rather than guessed: LinkedIn's `profile/posts` lane
 * carries no cursor, so it counts ONE page at 5 credits however large the page
 * budget is; Twitter's `user/tweets` lane DOES carry a cursor, so it scales
 * with the budget. Instagram and YouTube each run two cursor-paged lanes, so
 * they cost 2 per page-round.
 */
const LANE_COST: Record<string, { fixed: number; perPage: number }> = {
  bluesky: { fixed: 1, perPage: 0 }, // user/posts, no cursor
  instagram: { fixed: 0, perPage: 2 }, // profile/posts + profile/reels
  kwai: { fixed: 0, perPage: 1 }, // user/posts
  linkedin: { fixed: 5, perPage: 0 }, // profile/posts, fixed window, 5cr
  threads: { fixed: 1, perPage: 0 }, // user/posts, no cursor
  tiktok: { fixed: 0, perPage: 1 }, // profile/videos
  "truth-social": { fixed: 0, perPage: 1 }, // user/posts
  twitch: { fixed: 1, perPage: 0 }, // user/videos, no cursor
  twitter: { fixed: 0, perPage: 1 }, // user/tweets — DOES page
  youtube: { fixed: 0, perPage: 2 }, // channel/videos + channel/shorts
};

/** Contract limits, enforced locally so a bad call never costs a round trip. */
export const COHORT_LIMITS = {
  memberUploadPerCall: 1_000,
  membersPerCohort: 10_000,
  cohortsPerKey: 100,
  keywords: 20,
  maxPagesPerIdentity: 20,
  maxItemsPerIdentity: 1_000,
  maxCredits: 1_000_000,
  resultsLimit: 500,
  retentionDaysMin: 7,
  retentionDaysMax: 90,
} as const;

/**
 * SECURITY: ids are interpolated into the upstream URL path. The API mints
 * either a 21-character nanoid or a UUID; restricting to that shape stops a
 * crafted id like "../credits/balance" from redirecting a DELETE at another
 * resource. Mirrors the zod schema so non-MCP callers get the same guarantee.
 */
const COHORT_ID_RE = /^[0-9A-Za-z]{21}$|^[0-9a-fA-F-]{36}$/;

function pruneQuery(q: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/**
 * Worst-case reservation for a query, computed from the panel's platform mix.
 * This is the number `max_credits` has to clear: submission fails with a 400
 * (before any credit is held) when the computed ceiling exceeds it.
 */
export function creditCeiling(
  counts: Record<string, number>,
  maxPagesPerIdentity: number,
): {
  total: number;
  rows: {
    platform: string;
    members: number;
    perMember: number;
    formula: string;
    subtotal: number;
  }[];
} {
  const rows = Object.entries(counts)
    .filter(([, members]) => members > 0)
    .map(([platform, members]) => {
      const lane = LANE_COST[platform] ?? { fixed: 0, perPage: 1 };
      const perMember = lane.fixed + lane.perPage * maxPagesPerIdentity;
      const parts: string[] = [];
      if (lane.fixed > 0) parts.push(`${lane.fixed} fixed`);
      if (lane.perPage > 0) parts.push(`${lane.perPage} x ${maxPagesPerIdentity} pages`);
      return {
        platform,
        members,
        perMember,
        formula: parts.join(" + ") || "0",
        subtotal: members * perMember,
      };
    })
    .sort((a, b) => b.subtotal - a.subtotal);
  return { total: rows.reduce((sum, r) => sum + r.subtotal, 0), rows };
}

function countByPlatform(input: CohortsParams): Record<string, number> | string {
  if (input.platform_counts && Object.keys(input.platform_counts).length > 0) {
    return input.platform_counts;
  }
  if (input.members && input.members.length > 0) {
    const counts: Record<string, number> = {};
    for (const m of input.members) {
      counts[m.platform] = (counts[m.platform] ?? 0) + 1;
    }
    return counts;
  }
  return "Error: `estimate_cost` needs either `members` (the panel you are about to upload) or `platform_counts` (e.g. { instagram: 4000, youtube: 1000 }) to size the reservation.";
}

/** Reject unsupported platforms up front rather than paying for a 400. */
function unsupportedPlatforms(platforms: string[]): string[] {
  const allowed = new Set<string>(COHORT_IDENTITY_PLATFORMS);
  return [...new Set(platforms.filter((p) => !allowed.has(p)))];
}

export async function cohorts(ctx: ApiContext, input: CohortsParams): Promise<string> {
  const { action } = input;

  const needsCohort = new Set<CohortAction>(["get", "delete", "add_members", "query"]);
  const needsQuery = new Set<CohortAction>(["query_status", "query_results", "query_cancel"]);

  if (needsCohort.has(action) && !input.cohort_id) {
    return `Error: The "${action}" action requires a \`cohort_id\`. It is returned by the "create" action.`;
  }
  if (needsQuery.has(action) && !input.query_id) {
    return `Error: The "${action}" action requires a \`query_id\`. It is returned by the "query" action.`;
  }
  for (const [label, value] of [
    ["cohort_id", input.cohort_id],
    ["query_id", input.query_id],
  ] as const) {
    if (value !== undefined && !COHORT_ID_RE.test(value)) {
      return `Error: Invalid ${label} "${value}". Ids are the 21-character id or UUID returned by the API.`;
    }
  }
  const cohortId = input.cohort_id ? encodeURIComponent(input.cohort_id) : undefined;
  const queryId = input.query_id ? encodeURIComponent(input.query_id) : undefined;

  // POST/PUT require an Idempotency-Key (UUID). Generating one when the caller
  // omits it keeps the call legal; echoing it back is what makes a retry safe,
  // because reusing it replays the original instead of creating a second
  // cohort or reserving a second query.
  const writeActions = new Set<CohortAction>(["create", "add_members", "query"]);
  const idempotencyKey = writeActions.has(action)
    ? (input.idempotencyKey ?? randomUUID())
    : undefined;

  let response: string;
  let label: string;
  let costNote = "0 credits";

  switch (action) {
    case "estimate_cost": {
      const counts = countByPlatform(input);
      if (typeof counts === "string") return counts;
      const pages = input.max_pages_per_identity;
      if (pages === undefined) {
        return "Error: `estimate_cost` needs `max_pages_per_identity` — the per-member page budget the query will request (1-20).";
      }
      if (!Number.isInteger(pages) || pages < 1 || pages > COHORT_LIMITS.maxPagesPerIdentity) {
        return `Error: \`max_pages_per_identity\` must be an integer between 1 and ${COHORT_LIMITS.maxPagesPerIdentity}.`;
      }
      const bad = unsupportedPlatforms(Object.keys(counts));
      if (bad.length > 0) {
        return `Error: Unsupported cohort platform(s): ${bad.join(", ")}. Cohort identities must be one of ${COHORT_IDENTITY_PLATFORMS.join(", ")}.`;
      }
      const { total, rows } = creditCeiling(counts, pages);
      const members = rows.reduce((sum, r) => sum + r.members, 0);
      return [
        "## SocialCrawl Cohorts — credit ceiling estimate",
        "**Operation:** local calculation (no API call, 0 credits)",
        "",
        `A query over **${members.toLocaleString()} members** at **${pages} page${pages === 1 ? "" : "s"} per identity** reserves at most **${total.toLocaleString()} credits**.`,
        "",
        "| Platform | Members | Credits per member | Ceiling |",
        "|----------|---------|--------------------|---------|",
        ...rows.map(
          (r) =>
            `| ${r.platform} | ${r.members.toLocaleString()} | ${r.perMember} (${r.formula}) | ${r.subtotal.toLocaleString()} |`,
        ),
        `| **Total** | **${members.toLocaleString()}** | | **${total.toLocaleString()}** |`,
        "",
        `Pass \`max_credits\` of at least **${total}** or submission fails with a 400 before any credit is held. You are then charged only for pages that actually succeed; the unspent reservation is refunded once the query reaches a terminal state, so \`actual_credits + refunded_credits\` always equals \`reserved_credits\`.`,
        "",
        "The ceiling sums each platform's activity lanes: a lane with no cursor can only ever fetch one page, so it contributes a fixed amount however large the page budget is. **LinkedIn** is one fixed 5-credit page (its lane has no cursor — raising the budget does not deepen it, or cost more). **Bluesky, Threads and Twitch** are one fixed 1-credit page each. **Instagram** and **YouTube** run two cursor-paged lanes, so 2 per page. **TikTok, Twitter, Kwai and Truth Social** are one cursor-paged lane at 1 per page.",
      ].join("\n");
    }

    case "create": {
      const body: Record<string, unknown> = {};
      if (input.name) body.name = input.name;
      if (input.retention_days !== undefined) {
        if (
          !Number.isInteger(input.retention_days) ||
          input.retention_days < COHORT_LIMITS.retentionDaysMin ||
          input.retention_days > COHORT_LIMITS.retentionDaysMax
        ) {
          return `Error: \`retention_days\` must be an integer between ${COHORT_LIMITS.retentionDaysMin} and ${COHORT_LIMITS.retentionDaysMax} (default 30).`;
        }
        body.retention_days = input.retention_days;
      }
      response = await apiRequest(ctx, {
        method: "POST",
        path: "/v1/cohorts",
        body,
        idempotencyKey,
        errorPlatform: "cohorts",
      });
      label = "POST /v1/cohorts";
      break;
    }

    case "get": {
      response = await apiRequest(ctx, {
        method: "GET",
        path: `/v1/cohorts/${cohortId}`,
        errorPlatform: "cohorts",
      });
      label = `GET /v1/cohorts/${input.cohort_id}`;
      break;
    }

    case "delete": {
      response = await apiRequest(ctx, {
        method: "DELETE",
        path: `/v1/cohorts/${cohortId}`,
        errorPlatform: "cohorts",
      });
      label = `DELETE /v1/cohorts/${input.cohort_id}`;
      break;
    }

    case "add_members": {
      const members = input.members ?? [];
      if (members.length === 0) {
        return "Error: `add_members` requires a non-empty `members` array of { external_id, platform, handle } objects.";
      }
      if (members.length > COHORT_LIMITS.memberUploadPerCall) {
        return `Error: ${members.length} members in one call exceeds the ${COHORT_LIMITS.memberUploadPerCall}-per-upload limit. Split the panel into chunks of ${COHORT_LIMITS.memberUploadPerCall} and call add_members once per chunk (a cohort holds up to ${COHORT_LIMITS.membersPerCohort.toLocaleString()} members).`;
      }
      // `external_id` is optional in the API schema, but it is the only thing
      // that joins a match back to the caller's own records — so it is worth
      // saying when it is absent rather than silently uploading blind rows.
      const missing = members.findIndex((m) => !m || !m.platform || !m.handle);
      if (missing !== -1) {
        return `Error: members[${missing}] is missing \`platform\` or \`handle\`. Both are required on every member; \`external_id\` is optional but is what joins a match back to your own records.`;
      }
      const bad = unsupportedPlatforms(members.map((m) => m.platform));
      if (bad.length > 0) {
        return `Error: Unsupported cohort platform(s): ${bad.join(", ")}. Cohort identities must be one of ${COHORT_IDENTITY_PLATFORMS.join(", ")}.`;
      }
      response = await apiRequest(ctx, {
        method: "PUT",
        path: `/v1/cohorts/${cohortId}/members`,
        body: { members },
        idempotencyKey,
        errorPlatform: "cohorts",
      });
      label = `PUT /v1/cohorts/${input.cohort_id}/members (${members.length} members)`;
      break;
    }

    case "query": {
      const missing: string[] = [];
      if (!input.keywords || input.keywords.length === 0) missing.push("`keywords`");
      if (!input.date_from) missing.push("`date_from` (a full RFC3339 timestamp, not a bare date)");
      if (input.max_pages_per_identity === undefined) missing.push("`max_pages_per_identity`");
      if (input.max_items_per_identity === undefined) missing.push("`max_items_per_identity`");
      if (input.max_credits === undefined) missing.push("`max_credits`");
      if (missing.length > 0) {
        return `Error: Missing required parameter(s) for query: ${missing.join(", ")}. None of the three caps has a default — use action "estimate_cost" to size \`max_credits\` before you submit.`;
      }
      if (input.keywords!.length > COHORT_LIMITS.keywords) {
        return `Error: ${input.keywords!.length} keywords exceeds the limit of ${COHORT_LIMITS.keywords}. Matching is literal and whole-word, so pass only the surface forms you need.`;
      }
      if (
        !Number.isInteger(input.max_pages_per_identity!) ||
        input.max_pages_per_identity! < 1 ||
        input.max_pages_per_identity! > COHORT_LIMITS.maxPagesPerIdentity
      ) {
        return `Error: \`max_pages_per_identity\` must be an integer between 1 and ${COHORT_LIMITS.maxPagesPerIdentity}.`;
      }
      if (
        !Number.isInteger(input.max_items_per_identity!) ||
        input.max_items_per_identity! < 1 ||
        input.max_items_per_identity! > COHORT_LIMITS.maxItemsPerIdentity
      ) {
        return `Error: \`max_items_per_identity\` must be an integer between 1 and ${COHORT_LIMITS.maxItemsPerIdentity}.`;
      }
      if (
        !Number.isInteger(input.max_credits!) ||
        input.max_credits! < 1 ||
        input.max_credits! > COHORT_LIMITS.maxCredits
      ) {
        return `Error: \`max_credits\` must be an integer between 1 and ${COHORT_LIMITS.maxCredits.toLocaleString()}.`;
      }
      if (input.platforms && input.platforms.length > 0) {
        const bad = unsupportedPlatforms(input.platforms);
        if (bad.length > 0) {
          return `Error: Unsupported cohort platform(s): ${bad.join(", ")}. Cohort identities must be one of ${COHORT_IDENTITY_PLATFORMS.join(", ")}.`;
        }
      }
      if (input.date_to && Date.parse(input.date_to) < Date.parse(input.date_from!)) {
        return "Error: `date_to` is earlier than `date_from`.";
      }
      const body: Record<string, unknown> = {
        keywords: input.keywords,
        date_from: input.date_from,
        max_pages_per_identity: input.max_pages_per_identity,
        max_items_per_identity: input.max_items_per_identity,
        max_credits: input.max_credits,
      };
      if (input.date_to) body.date_to = input.date_to;
      if (input.platforms && input.platforms.length > 0) body.platforms = input.platforms;

      response = await apiRequest(ctx, {
        method: "POST",
        path: `/v1/cohorts/${cohortId}/queries`,
        body,
        idempotencyKey,
        errorPlatform: "cohorts",
      });
      label = `POST /v1/cohorts/${input.cohort_id}/queries`;
      costNote =
        "metered — reserves the worst-case ceiling now, charges only for pages that succeed, refunds the rest once terminal";
      break;
    }

    case "query_status": {
      response = await apiRequest(ctx, {
        method: "GET",
        path: `/v1/cohort-queries/${queryId}`,
        errorPlatform: "cohorts",
      });
      label = `GET /v1/cohort-queries/${input.query_id}`;
      break;
    }

    case "query_results": {
      if (
        input.limit !== undefined &&
        (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > COHORT_LIMITS.resultsLimit)
      ) {
        return `Error: \`limit\` must be an integer between 1 and ${COHORT_LIMITS.resultsLimit} (default 100).`;
      }
      const query = pruneQuery({
        limit: input.limit?.toString(),
        cursor: input.cursor,
      });
      response = await apiRequest(ctx, {
        method: "GET",
        path: `/v1/cohort-queries/${queryId}/results`,
        query,
        errorPlatform: "cohorts",
      });
      label = `GET /v1/cohort-queries/${input.query_id}/results`;
      break;
    }

    case "query_cancel": {
      response = await apiRequest(ctx, {
        method: "DELETE",
        path: `/v1/cohort-queries/${queryId}`,
        errorPlatform: "cohorts",
      });
      label = `DELETE /v1/cohort-queries/${input.query_id}`;
      costNote =
        "0 to cancel — pages already fetched stay billable, the unspent reservation is refunded once";
      break;
    }

    default: {
      return `Error: Unknown action "${action as string}". Valid actions: create, get, delete, add_members, query, query_status, query_results, query_cancel, estimate_cost.`;
    }
  }

  const headerLines = [
    "## SocialCrawl Cohorts",
    `**Operation:** \`${label}\``,
    `**Credit cost:** ${costNote}`,
  ];
  if (idempotencyKey) {
    headerLines.push(
      `**Idempotency-Key:** \`${idempotencyKey}\`${input.idempotencyKey ? "" : " (generated)"} — resend this exact key to replay this call instead of creating a second ${action === "query" ? "reservation" : "resource"}.`,
    );
  }
  if (action === "query_results") {
    headerLines.push(
      "**Read `coverage`, not just `items`:** it carries one record per member, including the ones that matched nothing, and `window_complete: false` means there may be posts you did not see. Page with `next_cursor` until it is null — later pages can carry coverage with an empty `items` array.",
    );
  }
  const header = `${headerLines.join("\n")}\n\n`;

  if (response.startsWith("Error:")) {
    return `${header}${response}`;
  }

  try {
    const parsed = JSON.parse(response) as Record<string, unknown>;
    return `${header}\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
  } catch {
    return `${header}${response}`;
  }
}
