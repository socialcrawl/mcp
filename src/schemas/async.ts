import { z } from "zod";

/**
 * Input schemas for the background-work areas of `socialcrawl_manage`:
 *
 * - `discover`        — discover runs (`/v1/prism/discover/runs/*`), discover
 *   schedules (`/v1/prism/discover/schedules/*`) and `follow` (a guarded GET
 *   of a `data.next.*` URL).
 * - `review_history`  — the review history poll
 *   (`GET /v1/{platform}/reviews/history/{job_id}`).
 * - `events`          — the account events feed (`/v1/events`) and the
 *   account webhook endpoints (`/v1/webhook-endpoints`).
 *
 * `socialcrawl_manage` rebuilds `{ ...input, action, <id field>: id }` and
 * validates it against one of these strict schemas before anything is sent.
 * Every bound mirrors the backend source (packages/social-api/src/
 * platforms/prism/discover/jobs/{routes,resume,more,schedule-routes}.ts,
 * platforms/review-history/engine.ts, events/{feed,routes}.ts,
 * webhooks/{http,limits}.ts), so a call the API would refuse is refused
 * locally, for free. The id regexes are the SECURITY guard for path
 * interpolation and are re-checked inside the tools for non-MCP callers.
 */

/** Ids are `<prefix>_<nanoid>`; the shared generator's alphabet is [0-9A-Za-z]. */
export const BATCH_JOB_ID_RE = /^bj_[0-9A-Za-z]{8,64}$/;
export const REVIEW_JOB_ID_RE = /^job_[0-9A-Za-z]{8,64}$/;
export const RUN_ID_RE = /^run_[0-9A-Za-z]{8,64}$/;
export const SCHEDULE_ID_RE = /^dsch_[0-9A-Za-z]{8,64}$/;
export const WEBHOOK_ENDPOINT_ID_RE = /^we_[0-9A-Za-z]{8,64}$/;
/** events/feed.ts CONSUMER_RE. */
export const CONSUMER_NAME_RE = /^[a-z0-9_-]{1,64}$/;
/** A type (`discover.completed`), a namespace pattern (`discover.*`) or `*`. */
export const EVENT_TYPE_PATTERN_RE = /^(\*|[a-z0-9_]+(\.[a-z0-9_]+)*\.\*|[a-z0-9_]+(\.[a-z0-9_]+)+)$/;
/** A concrete event type (no pattern), as `endpoint_test` takes. */
export const EVENT_TYPE_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

export const DISCOVER_ACTIONS = [
  "run_list",
  "run_get",
  "run_export",
  "run_legs",
  "run_cancel",
  "run_resume",
  "run_more",
  "schedule_list",
  "schedule_get",
  "schedule_pause",
  "schedule_resume",
  "schedule_delete",
  "follow",
] as const;

export const DiscoverInputSchema = z
  .object({
    action: z
      .enum(DISCOVER_ACTIONS)
      .describe(
        "DISCOVER RUNS (started with socialcrawl_request on prism/discover): 'run_list', 'run_get' (status + a page of rows; wait_s long-polls), 'run_export' (every row as JSONL), 'run_legs' (the search log), 'run_cancel', 'run_resume', 'run_more'. DISCOVER SCHEDULES (created by prism/discover with a schedule field): 'schedule_list', 'schedule_get', 'schedule_pause', 'schedule_resume', 'schedule_delete'. 'follow' GETs a data.next.* URL a previous answer returned (free reads on the SocialCrawl API only).",
      ),
    run_id: z
      .string()
      .regex(RUN_ID_RE, "run_id is run_ followed by letters and digits (data.run.run_id)")
      .optional()
      .describe("Discover run id (run_…). manage's `id` on the run_* actions except run_list."),
    schedule_id: z
      .string()
      .regex(SCHEDULE_ID_RE, "schedule_id is dsch_ followed by letters and digits (data.schedule.schedule_id)")
      .optional()
      .describe("Discover schedule id (dsch_…). manage's `id` on the schedule_* actions; on run_list it lists only that schedule's runs."),
    // ── listing / paging ─────────────────────────────────────────────────
    cursor: z
      .string()
      .max(4096)
      .optional()
      .describe(
        "pagination.next_cursor of the previous answer. On run_get/run_export send the SAME filters with it: a cursor is signed with the filters it was issued for, and a different set is a free 400.",
      ),
    page_size: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe("run_list/schedule_list: 1-100 (default 20). run_get: rows per page, 1-100 (default 50). run_legs: 1-500 (default 100)."),
    status: z
      .string()
      .optional()
      .describe(
        "run_list: one or more (comma-separated) of queued, running, paused, partial, completed, failed, cancelled. schedule_list: one or more of active, paused, stopped.",
      ),
    kind: z.enum(["get", "background", "scheduled"]).optional().describe("run_list: only runs of this kind."),
    created_after: z
      .string()
      .optional()
      .describe("run_list: only runs created after this date (YYYY-MM-DD) or ISO 8601 time with its zone."),
    // ── run_get / run_export filters ─────────────────────────────────────
    wait_s: z
      .number()
      .int()
      .min(0)
      .max(25)
      .optional()
      .describe(
        "run_get: long-poll up to this many seconds; answers early on a status change, a finished stage or 10% more rows. At most 5 long-polls per key at once (a 6th answers immediately). Free.",
      ),
    view: z.enum(["posts", "accounts", "communities", "items"]).optional().describe("run_get/run_export: a view the run computed."),
    order: z
      .enum(["arrival", "rank"])
      .optional()
      .describe("run_get/run_export: 'arrival' (default while running) or 'rank' (default once settled; a free 400 on a running run)."),
    include_pending: z.boolean().optional().describe("run_get/run_export: true adds kept rows still waiting for the judge."),
    changes_since: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("run_get/run_export: only rows whose version is above this one. After run_more use data.more.since_version."),
    group: z.string().max(200).optional().describe("run_get/run_export: only rows of this group."),
    platform: z.string().max(64).optional().describe("run_get/run_export: only rows of this platform."),
    keyword: z.string().max(500).optional().describe("run_get/run_export: only rows matched by this keyword."),
    sort: z.string().max(64).optional().describe("run_get/run_export: any sort the run's request accepts."),
    state: z.enum(["kept", "dropped", "all"]).optional().describe("run_get/run_export: kept (default), dropped (with drop_reason) or all."),
    include: z
      .literal("dropped")
      .optional()
      .describe("run_get/run_export: 'dropped' also returns dropped rows with drop_reason."),
    tags: z
      .record(z.string())
      .optional()
      .describe("run_get/run_export: group tags, sent as tag.<key>=<value> (e.g. { region: 'eu' })."),
    // ── run_resume / run_more ────────────────────────────────────────────
    max_credits: z
      .number()
      .int()
      .min(1)
      .max(10_000_000)
      .optional()
      .describe(
        "run_resume: the run's new cap (required to resume a run paused at its cap; it must be higher). run_more: the run's cap from now on, counting what it already spent.",
      ),
    retry_failed: z.boolean().optional().describe("run_resume: true fetches the failed and skipped searches again."),
    new_searches: z.boolean().optional().describe("run_more: true plans new searches over the run's keywords, steered by feedback."),
    feedback: z
      .object({
        accept: z.array(z.string()).max(100).optional(),
        reject: z.array(z.string()).max(100).optional(),
      })
      .strict()
      .optional()
      .describe(
        "run_more: up to 100 row ids or account keys (<platform>:<id>) per list. accept steers new searches toward rows like these (needs new_searches: true); reject drops that account's rows from now on.",
      ),
    pages: z.number().int().min(1).max(10).optional().describe("run_more: further pages per search that reported more, 1-10 (default 1)."),
    // ── schedule_resume ──────────────────────────────────────────────────
    max_credits_per_run: z.number().int().min(1).optional().describe("schedule_resume: a new per-run cap."),
    max_credits_per_month: z
      .number()
      .int()
      .min(1)
      .nullable()
      .optional()
      .describe("schedule_resume: a new month cap; null clears it."),
    // ── follow ───────────────────────────────────────────────────────────
    url: z
      .string()
      .max(4096)
      .optional()
      .describe(
        "follow (required): a data.next.* URL from a previous answer (status_url, results_url, changes_url, poll_url, a self or attempts URL). It must be on the configured SocialCrawl API and a free read; continue_url (which bills) and POST URLs (resume_url, more_url, ack_url) are refused with the action to use instead.",
      ),
  })
  .strict();

export const REVIEW_HISTORY_ACTIONS = ["get"] as const;

export const ReviewHistoryInputSchema = z
  .object({
    action: z
      .enum(REVIEW_HISTORY_ACTIONS)
      .describe("'get' polls a review history job (started with socialcrawl_request on POST trustpilot/reviews/history) and pages its reviews once it succeeded. Free."),
    job_id: z
      .string()
      .regex(REVIEW_JOB_ID_RE, "job_id is job_ followed by letters and digits (data.job_id of POST trustpilot/reviews/history)")
      .optional()
      .describe("The review history job id (job_…); manage's `id`."),
    platform: z
      .enum(["trustpilot", "tripadvisor"])
      .optional()
      .describe("The platform the job was started on: 'trustpilot' (default) or 'tripadvisor'."),
    offset: z.number().int().min(0).optional().describe("First review to return once the job succeeded (default 0)."),
    limit: z.number().int().min(1).max(100).optional().describe("Reviews per page, 1-100 (default 100)."),
  })
  .strict();

export const EVENTS_ACTIONS = [
  "feed",
  "ack",
  "endpoint_create",
  "endpoint_list",
  "endpoint_get",
  "endpoint_update",
  "endpoint_delete",
  "endpoint_rotate_secret",
  "endpoint_test",
  "endpoint_attempts",
] as const;

export const EventsInputSchema = z
  .object({
    action: z
      .enum(EVENTS_ACTIONS)
      .describe(
        "FEED: 'feed' reads the account event log (discover runs, schedules, endpoint health) from a cursor you keep, or as a named consumer the server tracks; wait_s long-polls up to 25 s. 'ack' commits a consumer's position. WEBHOOK ENDPOINTS (push delivery of the same events, 20 per key): 'endpoint_create' (the signing secret is shown ONCE), 'endpoint_list', 'endpoint_get', 'endpoint_update', 'endpoint_delete', 'endpoint_rotate_secret' (new secret shown once; the old one keeps signing for 24 h), 'endpoint_test' (a signed sample delivery), 'endpoint_attempts' (delivery log). Everything is free.",
      ),
    // ── feed ─────────────────────────────────────────────────────────────
    cursor: z
      .string()
      .max(4096)
      .optional()
      .describe(
        "feed: where to read from: 'oldest' (start of the 30-day retention), 'now' (only new events), an event id (evt_…) or pagination.next_cursor exactly as returned. Not with consumer. ack (required): the pagination.next_cursor of the page the consumer processed (or an event id). endpoint_list/endpoint_attempts: pagination.next_cursor of the previous page.",
      ),
    consumer: z
      .string()
      .regex(CONSUMER_NAME_RE, "consumer is 1-64 characters of a-z, 0-9, _ and -")
      .optional()
      .describe("feed: read as this named consumer (the server keeps its position; filters bind at first use). ack (required): the consumer to commit. manage's `id` on feed/ack."),
    start: z.enum(["now", "oldest"]).optional().describe("feed with consumer: where a NEW consumer begins."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe("feed: events per page, 1-500 (default 100). endpoint_list/endpoint_attempts: 1-100 (default 50)."),
    wait_s: z
      .number()
      .int()
      .min(0)
      .max(25)
      .optional()
      .describe("feed: hold an empty read up to this many seconds until an event arrives. At most 5 long-polls per key; a 6th answers immediately."),
    types: z
      .array(z.string().regex(EVENT_TYPE_PATTERN_RE, "an event type (discover.completed), a pattern (discover.*) or *"))
      .min(1)
      .max(50)
      .optional()
      .describe(
        "feed: only these event types or patterns (e.g. ['discover.*']). endpoint_create/endpoint_update: what the endpoint subscribes to (default ['*']). Types include discover.completed, discover.partial, discover.paused, discover.failed, discover.progress, discover.accounts_ready, discover.new_rows, discover.new_accounts, discover.new_items, discover.run_skipped, discover.run_failed, endpoint.disabled.",
      ),
    subject_ids: z
      .array(z.string().min(1).max(100))
      .min(1)
      .max(100)
      .nullable()
      .optional()
      .describe("feed: only events about these subjects (run_… or dsch_… ids). endpoint_create/endpoint_update: deliver only events about these subjects; null on update clears the filter."),
    // ── webhook endpoints ────────────────────────────────────────────────
    endpoint_id: z
      .string()
      .regex(WEBHOOK_ENDPOINT_ID_RE, "endpoint_id is we_ followed by letters and digits")
      .optional()
      .describe("Webhook endpoint id (we_…); manage's `id` on the endpoint_* actions."),
    url: z
      .string()
      .url()
      .optional()
      .describe("endpoint_create (required) / endpoint_update: the public HTTPS URL of your receiver. Chat-app incoming webhooks and private hosts are refused."),
    description: z
      .string()
      .max(200)
      .nullable()
      .optional()
      .describe("endpoint_create/endpoint_update: a label, up to 200 characters (null on update clears it)."),
    status: z
      .enum(["enabled", "disabled"])
      .optional()
      .describe("endpoint_update: 'disabled' stops deliveries, 'enabled' resumes them (parked deliveries resume at once). endpoint_list: only endpoints in this status."),
    type: z
      .string()
      .regex(EVENT_TYPE_RE, "an event type such as discover.completed")
      .optional()
      .describe("endpoint_test: the event type of the sample (one the endpoint subscribes to); default its first subscribed type."),
    idempotencyKey: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe(
        "endpoint_create/endpoint_rotate_secret: the Idempotency-Key. Omit it and one is generated and echoed back. A replay never creates a second endpoint, but it also never shows the secret again.",
      ),
  })
  .strict();

export type DiscoverInput = z.infer<typeof DiscoverInputSchema>;
export type ReviewHistoryInput = z.infer<typeof ReviewHistoryInputSchema>;
export type EventsInput = z.infer<typeof EventsInputSchema>;
