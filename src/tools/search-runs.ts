import type { z } from "zod";
import type { ApiContext } from "../context.js";
import { RUN_ID_RE, WATCH_ID_RE } from "../schemas/async.js";
import type { CreatorRunsInputSchema, SearchRunsInputSchema } from "../schemas/async.js";
import { LONG_READ_TIMEOUT_MS, pruneQuery, render, resolveFollowUrl, sendRequest } from "./async-common.js";
import type { AsyncRequestOptions } from "./async-common.js";

/**
 * `socialcrawl_manage` areas `search_runs` and `creator_runs`: background work
 * that lives OUTSIDE the endpoint registry, so it never reaches the registry
 * dump and is hand-written here against the route code.
 *
 * - **Search runs** (`/v1/search/everywhere/runs/*`, UPGRADE-LOG API-073,
 *   API-077, API-091). A `POST search/everywhere` with `queries` or `groups`
 *   is a background list: 20 credits per search, charged as each runs, paused
 *   at `max_credits`. Reads are free; `more` (the next page of every search)
 *   bills 20 per search that has one; `include` (comments, authors, body for
 *   chosen rows) bills per read under `max_credits`. Both take `dry_run`.
 * - **Watches** (`/v1/search/everywhere/watches/*`). A `POST
 *   search/everywhere` with `schedule` fires a list on a cadence and delivers
 *   only rows the watch never delivered. Managing is free; each fire bills like
 *   the list. Pause/resume use the discover schedule routes a watch is built on.
 * - **Creator runs** (`/v1/prism/creators/runs/*`, API-062/082). Reads are
 *   free; `save` stores the delivered creators as author lists (free, 30 days)
 *   and answers `data.next.follow`, a ready `POST prism/discover` schedule body.
 */

export type SearchRunsParams = z.infer<typeof SearchRunsInputSchema> & { idempotencyKey?: string; dryRun?: boolean };
export type CreatorRunsParams = z.infer<typeof CreatorRunsInputSchema> & { idempotencyKey?: string };

interface Family {
  name: string;
  area: "search_runs" | "creator_runs";
  runs: string;
  started: string;
}

const SEARCH: Family = {
  name: "Search Run",
  area: "search_runs",
  runs: "/v1/search/everywhere/runs",
  started: "POST search/everywhere with `queries` or `groups` (socialcrawl_request)",
};
const CREATORS: Family = {
  name: "Creator Run",
  area: "creator_runs",
  runs: "/v1/prism/creators/runs",
  started: "prism/creators (socialcrawl_request)",
};

const RUN_ERROR_HINTS: Record<string, string> = {
  RUN_EXPIRED: "The run's retention passed, so its rows can no longer be read. Start a new one.",
  run_not_a_list: "Only a list run (POST search/everywhere with queries or groups) can be cancelled or resumed; a one-off search is already settled.",
  run_not_settled: 'The run is still working: poll it with action "run_get" (wait_s 25) until it settles, then repeat.',
  run_busy: "Another step is running on this run; wait for it to settle, then repeat.",
  max_credits_below_estimate:
    "max_credits is below the quote for this step. Send dry_run first, ask the user to approve the estimate, then repeat with that max_credits.",
  CONCURRENCY_LIMIT: "Too many calls in flight on this key; wait a moment and retry. Nothing was charged.",
  SERVICE_UNAVAILABLE: "Retryable: nothing was charged. Retry the same call after a few seconds.",
};

const followHint = (area: string): string =>
  `**Next:** a \`data.next.*\` read URL (status_url, results_url, legs_url, changes_url) can be passed to action "follow" (input.url). more_url → "run_more", include_url → "run_include", resume_url → "run_resume" (area ${area}).`;

function badRunId(id: string): string {
  return `Error: Invalid parameter value(s): run id "${id}". It is run_ followed by letters and digits (data.run.run_id). Nothing was sent.`;
}

/** The read filters both families take on run_get / run_export. */
function readQuery(input: Record<string, unknown>, keys: string[], withPaging: boolean): Record<string, string> | string {
  if (!withPaging && (input.wait_s !== undefined || input.page_size !== undefined)) {
    return 'Error: Invalid parameter value(s): run_export takes no `wait_s` or `page_size`: it streams every matching row and ends with {"complete":true} or {"next_cursor":…}. Nothing was sent.';
  }
  const q: Record<string, string | undefined> = {};
  for (const k of keys) if (input[k] !== undefined) q[k] = String(input[k]);
  if (withPaging) {
    if (input.wait_s !== undefined) q.wait_s = String(input.wait_s);
    if (input.page_size !== undefined) q.page_size = String(input.page_size);
  }
  return pruneQuery(q);
}

async function runCommon(
  ctx: ApiContext,
  fam: Family,
  input: Record<string, unknown> & { action: string; run_id?: string; idempotencyKey?: string },
  readKeys: string[],
): Promise<string | undefined> {
  const runPath = `${fam.runs}/${input.run_id ? encodeURIComponent(input.run_id) : ""}`;
  const label = (suffix = ""): string => `${fam.runs}/${input.run_id}${suffix}`;
  switch (input.action) {
    case "run_list": {
      const q: Record<string, string | undefined> = {
        status: input.status as string | undefined,
        created_after: input.created_after as string | undefined,
        cursor: input.cursor as string | undefined,
        page_size: input.page_size?.toString(),
      };
      if (fam.area === "search_runs" && input.watch_id) q.schedule_id = String(input.watch_id);
      const response = await sendRequest(ctx, { method: "GET", path: fam.runs, query: pruneQuery(q), errorPlatform: "prism", timeoutMs: LONG_READ_TIMEOUT_MS });
      return render({
        title: `SocialCrawl ${fam.name}s`,
        label: `GET ${fam.runs}`,
        cost: "0 credits",
        notes: [`Your runs, newest first (started by ${fam.started}). Page with \`pagination.next_cursor\` as \`cursor\`.`],
        response,
        errorHints: RUN_ERROR_HINTS,
      });
    }
    case "run_get":
    case "run_export": {
      const paged = input.action === "run_get";
      const query = readQuery(input, readKeys, paged);
      if (typeof query === "string") return query;
      const response = await sendRequest(ctx, {
        method: "GET",
        path: paged ? runPath : `${runPath}/results.jsonl`,
        query,
        errorPlatform: "prism",
        timeoutMs: LONG_READ_TIMEOUT_MS,
      });
      return render({
        title: paged ? `SocialCrawl ${fam.name}` : `SocialCrawl ${fam.name} — JSONL export`,
        label: `GET ${label(paged ? "" : "/results.jsonl")}${paged && input.wait_s ? ` (wait_s=${String(input.wait_s)})` : ""}`,
        cost: "0 credits",
        notes: paged
          ? [followHint(fam.area)]
          : ['One row per line. The last line is {"complete":true,"changes_url":…}, or {"next_cursor":"…"} when the stream stopped early: call again with that cursor and the SAME filters.'],
        response,
        format: paged ? "json" : "jsonl",
        errorHints: RUN_ERROR_HINTS,
      });
    }
    case "run_legs": {
      const response = await sendRequest(ctx, { method: "GET", path: `${runPath}/legs`, errorPlatform: "prism", timeoutMs: LONG_READ_TIMEOUT_MS });
      return render({
        title: `SocialCrawl ${fam.name} — search log`,
        label: `GET ${label("/legs")}`,
        cost: "0 credits",
        notes: ["Every search the run made, with its outcome and credits."],
        response,
        errorHints: RUN_ERROR_HINTS,
      });
    }
    case "run_cancel": {
      const response = await sendRequest(ctx, { method: "DELETE", path: runPath, errorPlatform: "prism" });
      return render({
        title: `SocialCrawl ${fam.name} — cancelled`,
        label: `DELETE ${label()}`,
        cost: '0 credits — searches already run stay billed; nothing more is spent. Rows are kept and "run_resume" continues the run.',
        response,
        errorHints: RUN_ERROR_HINTS,
      });
    }
    case "run_resume": {
      const body: Record<string, unknown> = {};
      if (input.max_credits !== undefined) body.max_credits = input.max_credits;
      if (input.retry_failed !== undefined) body.retry_failed = input.retry_failed;
      const response = await sendRequest(ctx, { method: "POST", path: `${runPath}/resume`, body, errorPlatform: "prism" });
      return render({
        title: `SocialCrawl ${fam.name} — resumed`,
        label: `POST ${label("/resume")}`,
        cost: "0 for the resume. The searches it continues bill as they run, under the run's max_credits; a search already paid for is never paid twice.",
        notes: [followHint(fam.area)],
        response,
        errorHints: {
          ...RUN_ERROR_HINTS,
          suggested_max_credits: "A run paused at its cap needs a HIGHER max_credits: ask the user to approve data.suggested_max_credits, then resume with it.",
        },
      });
    }
    default:
      return undefined;
  }
}

const SEARCH_READ_KEYS = ["cursor", "format", "fields", "sort", "max_per_platform", "platform", "group", "state", "changes_since"];
const CREATOR_READ_KEYS = ["cursor", "format", "fields", "sort", "order", "platform", "group", "state", "changes_since", "country", "account_kind"];

export async function searchRuns(ctx: ApiContext, input: SearchRunsParams): Promise<string> {
  // SECURITY: every id interpolated into a path is checked against its shape.
  if (input.run_id !== undefined && !RUN_ID_RE.test(input.run_id)) return badRunId(input.run_id);
  if (input.watch_id !== undefined && !WATCH_ID_RE.test(input.watch_id)) {
    return `Error: Invalid parameter value(s): watch id "${input.watch_id}". It is letters, digits, '_' or '-' (data.watch.watch_id). Nothing was sent.`;
  }
  if (input.action.startsWith("run_") && input.action !== "run_list" && !input.run_id) {
    return 'Error: Missing required parameter(s): `id` (the run_id, data.run.run_id; "run_list" finds it). Nothing was sent.';
  }
  if (input.action.startsWith("watch_") && input.action !== "watch_list" && !input.watch_id) {
    return 'Error: Missing required parameter(s): `id` (the watch_id, data.watch.watch_id; "watch_list" finds it). Nothing was sent.';
  }

  const common = await runCommon(ctx, SEARCH, input, SEARCH_READ_KEYS);
  if (common !== undefined) return common;

  const runPath = `${SEARCH.runs}/${input.run_id ? encodeURIComponent(input.run_id) : ""}`;
  const watchPath = `/v1/search/everywhere/watches/${input.watch_id ? encodeURIComponent(input.watch_id) : ""}`;
  const schedulePath = `/v1/prism/discover/schedules/${input.watch_id ? encodeURIComponent(input.watch_id) : ""}`;
  const write = (path: string, body: Record<string, unknown>): Promise<string> =>
    sendRequest(ctx, { method: "POST", path, body, errorPlatform: "search", ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) });

  switch (input.action) {
    case "run_more": {
      const body: Record<string, unknown> = {};
      if (input.max_credits !== undefined) body.max_credits = input.max_credits;
      if (input.dryRun) body.dry_run = true;
      const response = await write(`${runPath}/more`, body);
      return render({
        title: "SocialCrawl Search Run — more",
        label: `POST ${SEARCH.runs}/${input.run_id}/more${input.dryRun ? " (dry run)" : ""}`,
        cost: input.dryRun
          ? "0 credits — a dry run answers the plan and the estimate only"
          : "metered — 20 credits per search that has another page, under max_credits (the run's new total cap). A 200 with data.more.nothing_more charges nothing.",
        idempotencyKey: input.idempotencyKey,
        notes: [
          "Prices at 20 credits per search that has another page. Send dry_run first to see `estimate`, then repeat with that max_credits.",
          'Read ONLY the rows this adds with action "run_get" and changes_since, or follow data.next.changes_url.',
        ],
        response,
        errorHints: RUN_ERROR_HINTS,
      });
    }
    case "run_include": {
      if (input.include === undefined) {
        return "Error: Missing required parameter(s): `include` (comments, authors and/or body). Nothing was sent.";
      }
      const body: Record<string, unknown> = { include: input.include };
      for (const k of ["ids", "comments.per_post", "comments.replies", "authors.top", "max_credits"] as const) {
        if (input[k] !== undefined) body[k] = input[k];
      }
      if (input.dryRun) body.dry_run = true;
      const response = await write(`${runPath}/include`, body);
      return render({
        title: "SocialCrawl Search Run — include",
        label: `POST ${SEARCH.runs}/${input.run_id}/include${input.dryRun ? " (dry run)" : ""}`,
        cost: input.dryRun
          ? "0 credits — a dry run answers estimate.credits {min, expected, max}"
          : "metered per read (comments per post, author profiles, page bodies) under max_credits, which defaults to the quoted ceiling; a block that does not fit is skipped with a `_warnings` line, and extras[].charged itemises what was kept.",
        idempotencyKey: input.idempotencyKey,
        notes: ["Quote it first with dry_run; a long read (or a list) answers 202 and the rows arrive on the run — poll run_get with changes_since."],
        response,
        errorHints: RUN_ERROR_HINTS,
      });
    }
    case "watch_list": {
      const response = await sendRequest(ctx, {
        method: "GET",
        path: "/v1/search/everywhere/watches",
        query: pruneQuery({ status: input.status, cursor: input.cursor, page_size: input.page_size?.toString() }),
        errorPlatform: "search",
        timeoutMs: LONG_READ_TIMEOUT_MS,
      });
      return render({
        title: "SocialCrawl Search Watches",
        label: "GET /v1/search/everywhere/watches",
        cost: "0 credits (each fire bills like the list it runs: 20 per search plus extras, within max_credits_per_run and max_credits_per_month)",
        notes: ['Create one with socialcrawl_request on POST search/everywhere and a `schedule` field (dry_run gives the price of a fire and of 30 days). A watch\'s fires are runs: action "run_list" with its id.'],
        response,
      });
    }
    case "watch_get":
    case "watch_delete": {
      const get = input.action === "watch_get";
      const response = await sendRequest(ctx, {
        method: get ? "GET" : "DELETE",
        path: watchPath,
        errorPlatform: "search",
        ...(get ? { timeoutMs: LONG_READ_TIMEOUT_MS } : {}),
      });
      return render({
        title: "SocialCrawl Search Watch",
        label: `${get ? "GET" : "DELETE"} /v1/search/everywhere/watches/${input.watch_id}`,
        cost: get ? "0 credits" : "0 credits — its fires keep their rows; nothing fires again",
        response,
      });
    }
    case "watch_pause":
    case "watch_resume": {
      const pause = input.action === "watch_pause";
      if (
        !pause &&
        input.max_credits_per_month !== undefined &&
        input.max_credits_per_month !== null &&
        input.max_credits_per_run !== undefined &&
        input.max_credits_per_month < input.max_credits_per_run
      ) {
        return "Error: Invalid parameter value(s): `max_credits_per_month` is below `max_credits_per_run`, so no fire could start. Nothing was sent.";
      }
      const body: Record<string, unknown> = {};
      if (!pause && input.max_credits_per_run !== undefined) body.max_credits_per_run = input.max_credits_per_run;
      if (!pause && input.max_credits_per_month !== undefined) body.max_credits_per_month = input.max_credits_per_month;
      const response = await sendRequest(ctx, { method: "POST", path: `${schedulePath}/${pause ? "pause" : "resume"}`, body, errorPlatform: "search" });
      return render({
        title: "SocialCrawl Search Watch",
        label: `POST /v1/prism/discover/schedules/${input.watch_id}/${pause ? "pause" : "resume"}`,
        cost: pause ? "0 credits — nothing fires until resumed" : "0 credits to resume — its fires bill like the list, within the watch's caps",
        response,
      });
    }
    case "follow":
      return follow(ctx, input.url, "search_runs");
    default:
      return `Error: Unknown action "${input.action}".`;
  }
}

export async function creatorRuns(ctx: ApiContext, input: CreatorRunsParams): Promise<string> {
  if (input.run_id !== undefined && !RUN_ID_RE.test(input.run_id)) return badRunId(input.run_id);
  if (input.action.startsWith("run_") && input.action !== "run_list" && !input.run_id) {
    return 'Error: Missing required parameter(s): `id` (the run_id, data.run.run_id of a prism/creators answer; "run_list" finds it). Nothing was sent.';
  }
  const common = await runCommon(ctx, CREATORS, input, CREATOR_READ_KEYS);
  if (common !== undefined) return common;
  const runPath = `${CREATORS.runs}/${input.run_id ? encodeURIComponent(input.run_id) : ""}`;
  const idem = input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {};

  switch (input.action) {
    case "run_more": {
      const body: Record<string, unknown> = {};
      for (const k of ["new_searches", "max_credits", "pages"] as const) if (input[k] !== undefined) body[k] = input[k];
      const response = await sendRequest(ctx, { method: "POST", path: `${runPath}/more`, body, errorPlatform: "prism" });
      return render({
        title: "SocialCrawl Creator Run — more",
        label: `POST ${CREATORS.runs}/${input.run_id}/more`,
        cost: "metered — each new search bills at its lane price under the run's max_credits. A 200 with data.more.nothing_more charges nothing.",
        notes: ['Read ONLY the creators this adds with "run_get" and changes_since (or follow data.next.changes_url).', followHint("creator_runs")],
        response,
        errorHints: RUN_ERROR_HINTS,
      });
    }
    case "run_save": {
      const body: Record<string, unknown> = input.keys ? { keys: input.keys } : {};
      const response = await sendRequest(ctx, { method: "POST", path: `${runPath}/save`, body, errorPlatform: "prism", ...idem });
      return render({
        title: "SocialCrawl Creator Run — saved",
        label: `POST ${CREATORS.runs}/${input.run_id}/save`,
        cost: "0 credits — saved lists are kept 30 days (at most 20 per account, 10,000 handles each)",
        idempotencyKey: input.idempotencyKey,
        notes: [
          "**Follow them:** `data.next.follow` is a ready POST prism/discover body with a daily schedule over the saved lists (event discover.new_rows). Send it with socialcrawl_request (its dry_run_url quotes it first); it costs what its runs cost, with no premium.",
        ],
        response,
        errorHints: RUN_ERROR_HINTS,
      });
    }
    case "follow":
      return follow(ctx, input.url, "creator_runs");
    default:
      return `Error: Unknown action "${input.action}".`;
  }
}

async function follow(ctx: ApiContext, url: string | undefined, area: string): Promise<string> {
  if (!url) return "Error: Missing required parameter(s): `url` in input (a data.next.* URL from a previous answer). Nothing was sent.";
  const resolved = resolveFollowUrl(ctx, url);
  if ("error" in resolved) return resolved.error;
  const opts: AsyncRequestOptions = { method: "GET", path: resolved.path, errorPlatform: "prism", timeoutMs: LONG_READ_TIMEOUT_MS };
  const response = await sendRequest(ctx, opts);
  return render({
    title: "SocialCrawl — followed next-step URL",
    label: `GET ${resolved.path}`,
    cost: "0 credits (a free read)",
    notes: [followHint(area)],
    response,
    format: resolved.path.split("?")[0]!.endsWith(".jsonl") ? "jsonl" : "json",
    errorHints: RUN_ERROR_HINTS,
  });
}
