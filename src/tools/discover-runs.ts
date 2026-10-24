import type { ApiContext } from "../context.js";
import { REVIEW_JOB_ID_RE, RUN_ID_RE, SCHEDULE_ID_RE } from "../schemas/async.js";
import type { DiscoverInput, ReviewHistoryInput } from "../schemas/async.js";
import {
  EVENTS_CURSOR_EXPIRED_HINT,
  LONG_READ_TIMEOUT_MS,
  dataOf,
  pruneQuery,
  render,
  resolveFollowUrl,
  sendRequest,
} from "./async-common.js";
import type { AsyncRequestOptions } from "./async-common.js";

/**
 * `socialcrawl_manage` areas `discover` and `review_history`: background work
 * after it has been started elsewhere.
 *
 * - **Discover runs** (`/v1/prism/discover/runs/*`). Created by the registry
 *   endpoint `prism/discover` (via `socialcrawl_request`); read, export,
 *   cancel, resume and extend here. Reads are free; resume/more bill only the
 *   searches they go on to run, under the run's `max_credits`.
 * - **Discover schedules** (`/v1/prism/discover/schedules/*`). Created by
 *   `prism/discover` with a `schedule` field; listed, paused, resumed and
 *   deleted here, all free.
 * - **Review history** (`GET /v1/{platform}/reviews/history/{job_id}`).
 *   Created by `POST trustpilot/reviews/history`; polled and paged here, free.
 * - **follow**: answers carry ready `data.next.*` URLs. Following one is a GET
 *   on a free read route of the configured SocialCrawl API only — never a
 *   billable `continue_url`, a POST, or another host.
 *
 * None of these routes honours `dry_run` (resume/more refuse any query
 * parameter), so the area takes no dry run.
 */

export type DiscoverParams = DiscoverInput;
export type ReviewHistoryParams = ReviewHistoryInput;

const RUN_ACTIONS_WITH_ID = new Set(["run_get", "run_export", "run_legs", "run_cancel", "run_resume", "run_more"]);
const SCHEDULE_ACTIONS_WITH_ID = new Set(["schedule_get", "schedule_pause", "schedule_resume", "schedule_delete"]);

const RUN_ERROR_HINTS: Record<string, string> = {
  RUN_EXPIRED:
    "The run's retention passed (or it was purged), so its rows can no longer be read. Start a new run with socialcrawl_request on prism/discover.",
  run_not_completed:
    'more is offered only on a completed run: poll it with action "run_get" (wait_s 25) until status is completed, or "run_resume" it first.',
  CONCURRENCY_LIMIT: "Too many calls in flight on this key; wait a moment and retry. Nothing was charged.",
  SERVICE_UNAVAILABLE: "Retryable: nothing was charged. Retry the same call after a few seconds.",
};

const FOLLOW_HINT =
  '**Next:** any `data.next.*` URL above (status_url, results_url, changes_url) can be passed to action "follow" (input.url); continue_url bills and is NOT followed (use socialcrawl_request), resume_url/more_url map to "run_resume"/"run_more".';

/** The run read filters (`RUN_PARAMS` / `JSONL_PARAMS` in the run routes). */
function runReadQuery(input: DiscoverParams, withPaging: boolean): Record<string, string> | string {
  if (!withPaging && (input.wait_s !== undefined || input.page_size !== undefined)) {
    return 'Error: Invalid parameter value(s): run_export takes no `wait_s` or `page_size`: it streams every matching row and ends with {"complete":true} or {"next_cursor":…}. Nothing was sent.';
  }
  if (withPaging && input.page_size !== undefined && input.page_size > 100) {
    return "Error: Invalid parameter value(s): `page_size` on run_get is 1 to 100 (default 50). Nothing was sent.";
  }
  const query: Record<string, string | undefined> = {
    view: input.view,
    cursor: input.cursor,
    order: input.order,
    include_pending: input.include_pending === undefined ? undefined : String(input.include_pending),
    changes_since: input.changes_since?.toString(),
    group: input.group,
    platform: input.platform,
    keyword: input.keyword,
    sort: input.sort,
    state: input.state,
    include: input.include,
  };
  if (withPaging) {
    query.wait_s = input.wait_s?.toString();
    query.page_size = input.page_size?.toString();
  }
  for (const [k, v] of Object.entries(input.tags ?? {})) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(k)) {
      return `Error: Invalid parameter value(s): tag key "${k}". Tag keys are 1-64 letters, digits, '_', '.' or '-'. Nothing was sent.`;
    }
    query[`tag.${k}`] = v;
  }
  return pruneQuery(query);
}

export async function discoverRuns(ctx: ApiContext, input: DiscoverParams): Promise<string> {
  const { action } = input;

  // SECURITY: every id interpolated into a path is checked against its exact
  // shape (prefix + nanoid alphabet), so "../credits/balance", "x?y=z" or an
  // encoded slash can never redirect a request — a DELETE included — to
  // another /v1 resource. Mirrors the zod schema for non-MCP callers.
  if (input.run_id !== undefined && !RUN_ID_RE.test(input.run_id)) {
    return `Error: Invalid parameter value(s): run id "${input.run_id}". It is run_ followed by letters and digits (data.run.run_id). Nothing was sent.`;
  }
  if (input.schedule_id !== undefined && !SCHEDULE_ID_RE.test(input.schedule_id)) {
    return `Error: Invalid parameter value(s): schedule id "${input.schedule_id}". It is dsch_ followed by letters and digits (data.schedule.schedule_id). Nothing was sent.`;
  }
  if (RUN_ACTIONS_WITH_ID.has(action) && !input.run_id) {
    return `Error: Missing required parameter(s): \`id\` (the run_id, data.run.run_id of a prism/discover answer; "run_list" finds it). Nothing was sent.`;
  }
  if (SCHEDULE_ACTIONS_WITH_ID.has(action) && !input.schedule_id) {
    return `Error: Missing required parameter(s): \`id\` (the schedule_id, data.schedule.schedule_id; "schedule_list" finds it). Nothing was sent.`;
  }

  const runPath = `/v1/prism/discover/runs/${input.run_id ? encodeURIComponent(input.run_id) : ""}`;
  const schedulePath = `/v1/prism/discover/schedules/${input.schedule_id ? encodeURIComponent(input.schedule_id) : ""}`;

  switch (action) {
    // ── discover runs ──────────────────────────────────────────────────
    case "run_list": {
      if (input.page_size !== undefined && input.page_size > 100) {
        return "Error: Invalid parameter value(s): `page_size` on run_list is 1 to 100 (default 20). Nothing was sent.";
      }
      const response = await sendRequest(ctx, {
        method: "GET",
        path: "/v1/prism/discover/runs",
        query: pruneQuery({
          status: input.status,
          kind: input.kind,
          schedule_id: input.schedule_id,
          created_after: input.created_after,
          cursor: input.cursor,
          page_size: input.page_size?.toString(),
        }),
        errorPlatform: "prism",
        timeoutMs: LONG_READ_TIMEOUT_MS,
      });
      return render({
        title: "SocialCrawl Discover Runs",
        label: "GET /v1/prism/discover/runs",
        cost: "0 credits",
        notes: ["Your runs from any of your keys, newest first. Page with `pagination.next_cursor` as `cursor`."],
        response,
        errorHints: RUN_ERROR_HINTS,
      });
    }

    case "run_get": {
      const query = runReadQuery(input, true);
      if (typeof query === "string") return query;
      const response = await sendRequest(ctx, {
        method: "GET",
        path: runPath,
        query,
        errorPlatform: "prism",
        timeoutMs: LONG_READ_TIMEOUT_MS,
      });
      return render({
        title: "SocialCrawl Discover Run",
        label: `GET /v1/prism/discover/runs/${input.run_id}${input.wait_s ? ` (wait_s=${input.wait_s})` : ""}`,
        cost: "0 credits",
        notes: [FOLLOW_HINT],
        response,
        errorHints: RUN_ERROR_HINTS,
      });
    }

    case "run_export": {
      const query = runReadQuery(input, false);
      if (typeof query === "string") return query;
      const response = await sendRequest(ctx, {
        method: "GET",
        path: `${runPath}/results.jsonl`,
        query,
        errorPlatform: "prism",
        timeoutMs: LONG_READ_TIMEOUT_MS,
      });
      return render({
        title: "SocialCrawl Discover Run — JSONL export",
        label: `GET /v1/prism/discover/runs/${input.run_id}/results.jsonl`,
        cost: "0 credits",
        notes: [
          'One row per line. The last line is {"complete":true}, or {"next_cursor":"…"} when the stream stopped early (about 45 s): call run_export again with that cursor and the SAME filters. Long exports are cut at this tool\'s response size limit; prefer "run_get" pages for large runs.',
        ],
        response,
        format: "jsonl",
        errorHints: RUN_ERROR_HINTS,
      });
    }

    case "run_legs": {
      const response = await sendRequest(ctx, {
        method: "GET",
        path: `${runPath}/legs`,
        query: pruneQuery({ cursor: input.cursor, page_size: input.page_size?.toString() }),
        errorPlatform: "prism",
        timeoutMs: LONG_READ_TIMEOUT_MS,
      });
      return render({
        title: "SocialCrawl Discover Run — search log",
        label: `GET /v1/prism/discover/runs/${input.run_id}/legs`,
        cost: "0 credits",
        notes: ["Every search the run made, with its outcome and credits. Page with `pagination.next_cursor` (page_size 1-500, default 100)."],
        response,
        errorHints: RUN_ERROR_HINTS,
      });
    }

    case "run_cancel": {
      const response = await sendRequest(ctx, { method: "DELETE", path: runPath, errorPlatform: "prism" });
      return render({
        title: "SocialCrawl Discover Run — cancelled",
        label: `DELETE /v1/prism/discover/runs/${input.run_id}`,
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
        title: "SocialCrawl Discover Run — resumed",
        label: `POST /v1/prism/discover/runs/${input.run_id}/resume`,
        cost:
          "0 for the resume itself. The searches it continues bill at their lane prices as they run, under the run's max_credits; a search already paid for is never paid twice (one whose page cursor expired is walked again from page 1 and those pages bill again; `_warnings` says so).",
        notes: [FOLLOW_HINT],
        response,
        errorHints: {
          ...RUN_ERROR_HINTS,
          max_credits:
            "A run paused at its cap needs a HIGHER max_credits to resume. Ask the user to approve the suggested amount, then resume with it.",
        },
      });
    }

    case "run_more": {
      if (input.feedback?.accept && input.feedback.accept.length > 0 && input.new_searches !== true) {
        return "Error: Invalid parameter value(s): `feedback.accept` steers new searches, so it needs `new_searches: true`. Nothing was sent.";
      }
      const body: Record<string, unknown> = {};
      if (input.new_searches !== undefined) body.new_searches = input.new_searches;
      if (input.feedback !== undefined) body.feedback = input.feedback;
      if (input.max_credits !== undefined) body.max_credits = input.max_credits;
      if (input.pages !== undefined) body.pages = input.pages;
      const response = await sendRequest(ctx, { method: "POST", path: `${runPath}/more`, body, errorPlatform: "prism" });
      return render({
        title: "SocialCrawl Discover Run — more",
        label: `POST /v1/prism/discover/runs/${input.run_id}/more`,
        cost:
          "metered — each new search bills at its lane price under the run's max_credits (checked against the cap, balance and key budget before anything moves). A 200 with data.more.nothing_more starts and charges nothing. The route takes no Idempotency-Key: check the run with run_get before repeating a more.",
        notes: [
          'Read ONLY the rows this adds with action "run_get" and changes_since = data.more.since_version (or follow data.next.changes_url).',
          FOLLOW_HINT,
        ],
        response,
        errorHints: RUN_ERROR_HINTS,
      });
    }

    // ── discover schedules ─────────────────────────────────────────────
    case "schedule_list": {
      if (input.page_size !== undefined && input.page_size > 100) {
        return "Error: Invalid parameter value(s): `page_size` on schedule_list is 1 to 100 (default 20). Nothing was sent.";
      }
      const response = await sendRequest(ctx, {
        method: "GET",
        path: "/v1/prism/discover/schedules",
        query: pruneQuery({ status: input.status, cursor: input.cursor, page_size: input.page_size?.toString() }),
        errorPlatform: "prism",
        timeoutMs: LONG_READ_TIMEOUT_MS,
      });
      return render({
        title: "SocialCrawl Discover Schedules",
        label: "GET /v1/prism/discover/schedules",
        cost: "0 credits (each scheduled run bills like a run, within max_credits_per_run and max_credits_per_month)",
        notes: [
          'Create a schedule with socialcrawl_request on POST prism/discover and a `schedule` field. List one schedule\'s runs with action "run_list" and its schedule id as `id`.',
        ],
        response,
      });
    }

    case "schedule_get":
    case "schedule_pause":
    case "schedule_resume":
    case "schedule_delete": {
      let response: string;
      let label: string;
      let cost = "0 credits";
      if (action === "schedule_get") {
        response = await sendRequest(ctx, { method: "GET", path: schedulePath, errorPlatform: "prism", timeoutMs: LONG_READ_TIMEOUT_MS });
        label = `GET /v1/prism/discover/schedules/${input.schedule_id}`;
      } else if (action === "schedule_pause") {
        response = await sendRequest(ctx, { method: "POST", path: `${schedulePath}/pause`, errorPlatform: "prism" });
        label = `POST /v1/prism/discover/schedules/${input.schedule_id}/pause`;
        cost = "0 credits — nothing fires until resumed";
      } else if (action === "schedule_resume") {
        if (
          input.max_credits_per_month !== undefined &&
          input.max_credits_per_month !== null &&
          input.max_credits_per_run !== undefined &&
          input.max_credits_per_month < input.max_credits_per_run
        ) {
          return "Error: Invalid parameter value(s): `max_credits_per_month` is below `max_credits_per_run`, so no run could start. Nothing was sent.";
        }
        const body: Record<string, unknown> = {};
        if (input.max_credits_per_run !== undefined) body.max_credits_per_run = input.max_credits_per_run;
        if (input.max_credits_per_month !== undefined) body.max_credits_per_month = input.max_credits_per_month;
        response = await sendRequest(ctx, { method: "POST", path: `${schedulePath}/resume`, body, errorPlatform: "prism" });
        label = `POST /v1/prism/discover/schedules/${input.schedule_id}/resume`;
        cost = "0 credits to resume — its runs bill like any run, within the schedule's caps";
      } else {
        response = await sendRequest(ctx, { method: "DELETE", path: schedulePath, errorPlatform: "prism" });
        label = `DELETE /v1/prism/discover/schedules/${input.schedule_id}`;
        cost = "0 credits — its runs keep their rows; a run still going finishes";
      }
      return render({ title: "SocialCrawl Discover Schedule", label, cost, response });
    }

    // ── follow ─────────────────────────────────────────────────────────
    case "follow": {
      if (!input.url) {
        return "Error: Missing required parameter(s): `url` in input (a data.next.* URL from a previous answer). Nothing was sent.";
      }
      const resolved = resolveFollowUrl(ctx, input.url);
      if ("error" in resolved) return resolved.error;
      const opts: AsyncRequestOptions = { method: "GET", path: resolved.path, errorPlatform: "prism" };
      if (resolved.longRead) opts.timeoutMs = LONG_READ_TIMEOUT_MS;
      const response = await sendRequest(ctx, opts);
      return render({
        title: "SocialCrawl — followed next-step URL",
        label: `GET ${resolved.path}`,
        cost: "0 credits (a free read)",
        notes: [FOLLOW_HINT],
        response,
        format: resolved.path.split("?")[0]!.endsWith(".jsonl") ? "jsonl" : "json",
        errorHints: { ...RUN_ERROR_HINTS, CURSOR_EXPIRED: EVENTS_CURSOR_EXPIRED_HINT },
      });
    }

    default:
      return `Error: Unknown action "${action as string}".`;
  }
}

export async function reviewHistory(ctx: ApiContext, input: ReviewHistoryParams): Promise<string> {
  if (!input.job_id) {
    return "Error: Missing required parameter(s): `id` (the job_id, data.job_id of POST trustpilot/reviews/history via socialcrawl_request). Nothing was sent.";
  }
  if (!REVIEW_JOB_ID_RE.test(input.job_id)) {
    return `Error: Invalid parameter value(s): job id "${input.job_id}". A review history job id is job_ followed by letters and digits. Nothing was sent.`;
  }
  const platform = input.platform ?? "trustpilot";
  if (platform !== "trustpilot" && platform !== "tripadvisor") {
    return `Error: Invalid parameter value(s): platform is "trustpilot" (default) or "tripadvisor", not "${String(platform)}". Nothing was sent.`;
  }
  const response = await sendRequest(ctx, {
    method: "GET",
    path: `/v1/${platform}/reviews/history/${encodeURIComponent(input.job_id)}`,
    query: pruneQuery({ offset: input.offset?.toString(), limit: input.limit?.toString() }),
    errorPlatform: platform,
  });
  return render({
    title: "SocialCrawl Review History",
    label: `GET /v1/${platform}/reviews/history/${input.job_id}`,
    cost: "0 credits (the POST held the price; `credits_charged` is the settled charge and the rest was refunded)",
    response,
    successNotes: (parsed) => {
      const data = dataOf(parsed);
      if (Array.isArray(data.items)) {
        const n = data.items.length;
        const lim = input.limit ?? 100;
        return n >= lim ? [`**More reviews:** call again with offset ${(input.offset ?? 0) + n}.`] : ["**Done:** this is the last page."];
      }
      return ["**Not ready:** status is queued, running or polling. Poll again in a few seconds; reviews appear here once status is succeeded."];
    },
  });
}
