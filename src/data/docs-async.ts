/**
 * Hand-written docs topics for the background-work areas of
 * `socialcrawl_manage`: `discover-runs` (areas `discover` and
 * `review_history`) and `events` (area `events`). Verified against the
 * backend source: packages/social-api/src/platforms/prism/discover/jobs/
 * {routes,resume,more,schedule-routes}.ts, platforms/review-history/
 * {http,engine}.ts, events/{feed,routes}.ts, webhooks/{http,limits}.ts.
 */

export const DISCOVER_RUNS_DOC = `# SocialCrawl API — Discover runs, schedules and review history

Work that keeps running after the call that started it. Start it with \`socialcrawl_request\`; read, export, steer and stop it with \`socialcrawl_manage\` (areas \`discover\` and \`review_history\`). Every read here is free; only the searches a run goes on to make are billed.

## Discover runs (\`/v1/prism/discover/runs\`)

Start a run with \`socialcrawl_request\` on \`prism/discover\` (\`max_credits\` is required; \`async\` runs it in the background). Manage it with \`socialcrawl_manage\` \`area: "discover"\`; \`id\` is the run id (\`run_…\`, \`data.run.run_id\`).

| Action | Route | Cost |
|--------|-------|------|
| \`run_list\` | \`GET /runs\` (status, kind, created_after, cursor, page_size ≤100; \`id\` = a schedule id lists that schedule's runs) | 0 |
| \`run_get\` | \`GET /runs/{run_id}\` | 0 |
| \`run_export\` | \`GET /runs/{run_id}/results.jsonl\` | 0 |
| \`run_legs\` | \`GET /runs/{run_id}/legs\` (page_size ≤500) | 0 |
| \`run_cancel\` | \`DELETE /runs/{run_id}\` | 0 — rows kept, resume continues |
| \`run_resume\` | \`POST /runs/{run_id}/resume\` \`{ max_credits?, retry_failed? }\` | 0 itself; continued searches bill as they run |
| \`run_more\` | \`POST /runs/{run_id}/more\` \`{ new_searches?, feedback?, max_credits?, pages? }\` | each new search bills at its lane price |

- **Long-poll:** \`run_get\` with \`wait_s\` (0-25) answers early on a status change, a finished stage or 10% more rows. At most 5 long-polls per key; a sixth answers at once.
- **Filters** (run_get and run_export): view, order (arrival | rank; rank on a running run is a free 400), include_pending, changes_since, group, platform, keyword, sort, state (kept | dropped | all), include=dropped, and \`tags\` sent as \`tag.<key>=<value>\`. Any parameter the route does not take is a free 400. A cursor is signed with the filters it was issued for: send the SAME filters with it.
- **run_export** streams every matching row; the last line is \`{"complete":true}\` or \`{"next_cursor":"…"}\` (stopped after about 45 s; send it back with the same filters).
- **run_resume** works on paused, partial, failed or cancelled runs. A run paused at its cap needs a HIGHER \`max_credits\`. Searches already paid for are never paid twice.
- **run_more** works on completed runs only: \`pages\` 1-10, \`feedback.accept\`/\`feedback.reject\` up to 100 ids each (\`accept\` needs \`new_searches: true\`). Read only the new rows with \`changes_since\` = \`data.more.since_version\`. \`data.more.nothing_more\` (200) charged nothing. The route takes no Idempotency-Key, so check the run before repeating a more.
- **No dry_run** on any run or schedule route (resume and more refuse any query parameter).
- **Errors:** 404 RUN_NOT_FOUND (not your run), 409 RUN_STATE_CONFLICT, 410 RUN_EXPIRED (retention passed), 503 store_unavailable (retryable, nothing charged).

## Discover schedules (\`/v1/prism/discover/schedules\`)

Created by \`prism/discover\` with a \`schedule\` field. All free; each scheduled run bills like a run within \`max_credits_per_run\` and \`max_credits_per_month\`. \`id\` is the schedule id (\`dsch_…\`).

\`schedule_list\` (status active | paused | stopped, cursor, page_size ≤100), \`schedule_get\` (its recent runs, this month's spend, next fire), \`schedule_pause\`, \`schedule_resume\` (\`{ max_credits_per_run?, max_credits_per_month? }\`, null clears the month cap), \`schedule_delete\` (runs keep their rows). \`run_list\` with the schedule id lists one schedule's runs.

## Review history (\`/v1/{platform}/reviews/history/{job_id}\`)

Start with \`socialcrawl_request\` on \`POST trustpilot/reviews/history\` (it holds the price and answers 202 with \`job_id\`). Poll with \`socialcrawl_manage\` \`area: "review_history"\`, \`action: "get"\`, \`id\` = the job id (\`job_…\`), free: status queued → running → polling → succeeded | failed, \`credits_hold\` and the settled \`credits_charged\`. Once succeeded, page the reviews with \`offset\` and \`limit\` (1-100). \`platform\` is \`trustpilot\` (default) or \`tripadvisor\`.

## follow

Answers carry ready next-step URLs in \`data.next.*\`. \`socialcrawl_manage\` \`area: "discover"\`, \`action: "follow"\`, \`input: { url }\` GETs one only when it is on the configured SocialCrawl API AND one of the free read routes above (batch jobs, discover runs and schedules, review history, the events feed, webhook endpoints). \`status_url\`, \`results_url\`, \`changes_url\` and \`poll_url\` are free reads. \`continue_url\` STARTS a billable continuation and is never followed (call \`socialcrawl_request\` after checking \`continue_estimate\`); \`resume_url\`/\`more_url\` are POSTs: use \`run_resume\`/\`run_more\`.
`;

export const EVENTS_DOC = `# SocialCrawl API — Account events feed and webhook endpoints

The account event log records what happens to this key's background work: discover runs (\`discover.completed\`, \`discover.partial\`, \`discover.paused\`, \`discover.failed\`, \`discover.progress\`, \`discover.accounts_ready\`, \`discover.new_rows\`, \`discover.new_accounts\`, \`discover.new_items\`), schedules (\`discover.run_skipped\`, \`discover.run_failed\`) and webhook endpoint health (\`endpoint.disabled\`). Pull it with the feed or have it pushed to a webhook endpoint. Use \`socialcrawl_manage\` \`area: "events"\`. Everything here costs **0 credits**, and no route here takes \`dry_run\`.

## Feed (\`GET /v1/events\`)

- **Your own cursor:** \`cursor\` = \`oldest\` (start of the 30-day retention), \`now\` (only new events), an event id (\`evt_…\`) or \`pagination.next_cursor\` exactly as returned. Save \`next_cursor\` after each page.
- **Named consumer:** \`id\` = a consumer name (a-z, 0-9, _ and -, up to 64). The server keeps its position; \`start\` (now | oldest) sets where a new consumer begins; its \`types\`/\`subject_ids\` filters bind at first use. A read commits nothing: process the page, then \`ack\` its \`pagination.next_cursor\` (\`POST /v1/events/consumers/{name}/ack\`, same \`id\`, \`input: { cursor }\`). Until you ack, the read returns the same page.
- Not both \`cursor\` and a consumer (a free 400).
- **Filters:** \`types\` (up to 50 types or patterns: \`discover.completed\`, \`discover.*\`, \`*\`) and \`subject_ids\` (up to 100 run_… or dsch_… ids). \`limit\` 1-500 (default 100).
- **Long-poll:** \`wait_s\` (0-25) holds an empty read until an event arrives. At most 5 long-polls per key; a sixth answers at once.
- **410 CURSOR_EXPIRED:** the position is older than the 30-day retention, so events were missed. Restart from \`oldest\` (a consumer restarts there on its next read and says \`restarted_from\` once) and tell the user which window was missed.
- \`data.next.poll_url\` is a free read: \`area: "discover"\` action \`follow\` can GET it.

## Webhook endpoints (\`/v1/webhook-endpoints\`)

At most **20 per API key**; an endpoint answers only to the key that created it. \`id\` is the endpoint id (\`we_…\`, \`data.endpoint.id\`).

| Action | Route |
|--------|-------|
| \`endpoint_create\` | \`POST /\` \`{ url, types?, description?, subject_ids? }\` (201) |
| \`endpoint_list\` | \`GET /\` (limit ≤100, cursor, status) |
| \`endpoint_get\` | \`GET /{id}\` |
| \`endpoint_update\` | \`PATCH /{id}\` (url, types, description, subject_ids, status enabled/disabled) |
| \`endpoint_delete\` | \`DELETE /{id}\` |
| \`endpoint_rotate_secret\` | \`POST /{id}/rotate-secret\` |
| \`endpoint_test\` | \`POST /{id}/test\` \`{ type? }\` |
| \`endpoint_attempts\` | \`GET /{id}/attempts\` (limit ≤100, cursor) |

- **The secret is shown ONCE.** \`endpoint_create\` and \`endpoint_rotate_secret\` return a \`whsec_\` secret in \`data.secret\`; store it immediately. Both send an Idempotency-Key (generated when you omit it, and echoed): a replay never creates a second endpoint and never shows the secret again. If it is lost, rotate with a NEW key.
- **Rotation:** for 24 hours every delivery is signed with both the old and the new secret, so deploy the new one before then.
- **URL rules:** a public HTTPS receiver. Private hosts and chat-app incoming webhooks are refused (400 invalid_webhook_url).
- **Types** default to \`["*"]\`. \`endpoint_test\` sends one signed sample of a subscribed type; the receiver has 15 s to answer 2xx. Answering 410 to a real delivery disables the endpoint.
- **Retries:** a failing delivery gets 8 attempts in all, backing off over roughly 41 hours; \`endpoint_attempts\` shows the log. Setting \`status: "enabled"\` on a disabled endpoint resumes its parked deliveries at once.
- **Links are full URLs.** An event's \`links\` (\`run\`, \`results\`, \`changes\`) start with the API's https origin; pass any of them to action \`follow\` (areas \`discover\`, \`search_runs\`, \`creator_runs\`).
`;

/**
 * Universal search runs, lists and watches (UPGRADE-LOG API-073, API-077,
 * API-084, API-091) and creator runs (API-062, API-082). Verified against
 * platforms/prism/discover/jobs/routes.ts (createSearchRunsRouter),
 * meta-search/{list-http,list-start,list-actions,list-more,list-followups,
 * list-watch,list-watch-routes,stored-runs}.ts and prism/creators/follow.ts.
 */
export const SEARCH_RUNS_DOC = `# SocialCrawl API — Universal search runs, lists, watches and creator runs

\`GET /v1/search/everywhere\` answers one search in the call (20 credits, flat). Everything that keeps working after the call — a list of searches, a scheduled watch, the next page, follow-up reads — is a **run**, read and steered with \`socialcrawl_manage\` area \`search_runs\`. Every read is free.

## Start one (socialcrawl_request, \`POST /v1/search/everywhere\`)

The JSON body takes every search field of the GET (\`query\` or \`keywords\`, \`context\`, \`platforms\`, \`exclude_platforms\`, \`period\`/\`since\`/\`until\`, \`languages\`, \`country\`, \`depth\`, \`label\`, …) plus exactly one of:

- **\`queries\`** — up to 100 search strings (≤512 chars each). One background run; each search is a job that reserves its own **20 credits**.
- **\`groups\`** — 1-100 \`{id, query | keywords, context?, platforms?, exclude_platforms?, period?, since?, until?, tags?}\`. A group's rows keep their own order; one de-duplication runs across the list, and a row several groups found lists them in \`also_in_groups\`.
- **\`schedule\`** — \`{every: 1h|6h|12h|1d|7d|30d, max_credits_per_run, max_credits_per_month?, name, start_at?}\` turns the search (or list) into a **watch**: each fire returns only rows that watch never delivered (the first fire marks its rows \`baseline: true\`).

**Price:** 20 credits per search plus any extras' ceilings (\`comments.*\`, \`authors.*\`). A list needs \`max_credits\` at or above that estimate; nothing is held at submit, each search charges as it runs, and the run **pauses** at \`max_credits\`, the key budget or the balance with \`data.next.resume_url\` — nothing is paid twice. A watch needs \`max_credits_per_run\` at least one fire's estimate; each fire bills like the list (no surcharge, no refund when nothing is new). \`dry_run: true\` answers the plan and estimate for free — on a watch, the price of a fire (\`credits_per_fire\`) and of 30 days (\`credits_per_30_days\`). The answer is **202** with \`data.run\` and \`data.next.status_url\` (a watch adds \`data.watch\`). \`Idempotency-Key\` replays the first answer; the same request sent again while its run is live returns that run (\`run.deduplicated\`).

## Runs (area \`search_runs\`)

| Action | Route | Cost |
|---|---|---|
| \`run_list\` | \`GET /v1/search/everywhere/runs\` — status, created_after, cursor, page_size 1-100; a watch id as \`id\` lists its fires | 0 |
| \`run_get\` | \`GET …/runs/{run_id}\` — \`wait_s\` 0-25 long-polls; format evidence\\|compact\\|text, fields, sort relevance\\|recent\\|engagement, max_per_platform, platform, group, state kept\\|dropped\\|all, changes_since, cursor, page_size | 0 |
| \`run_export\` | \`GET …/runs/{run_id}/results.jsonl\` — the same filters, no paging; ends with \`{"complete":true,"changes_url":…}\` | 0 |
| \`run_legs\` | \`GET …/runs/{run_id}/legs\` — every search with its outcome and credits | 0 |
| \`run_cancel\` | \`DELETE …/runs/{run_id}\` — a list only (409 \`run_not_a_list\` on a one-off) | 0 |
| \`run_resume\` | \`POST …/runs/{run_id}/resume\` — \`max_credits\` (higher, if it paused at its cap), \`retry_failed\` | 0 + the searches it runs |
| \`run_more\` | \`POST …/runs/{run_id}/more\` — the next page of every search that has one; \`max_credits\` is the run's new total cap | **20 credits per search** with another page; \`nothing_more\` is free; dry_run quotes it |
| \`run_include\` | \`POST …/runs/{run_id}/include\` — \`include\` comments\\|authors\\|body, \`ids\` (1-200 rows), \`comments.per_post\` 5-50, \`comments.replies\`, \`authors.top\` 1-100, \`max_credits\` | metered per read, capped by max_credits (default: the quote); dry_run answers \`estimate.credits {min, expected, max}\` |

\`run_more\` and \`run_include\` take \`Idempotency-Key\` and \`dry_run\`. Read only what a step added with \`run_get\` + \`changes_since\`, or follow \`data.next.changes_url\` — the page that serves a run's last row names it.

## Watches (area \`search_runs\`)

\`watch_list\` (status active\\|paused\\|stopped), \`watch_get\` (with its 10 latest fires), \`watch_delete\` — all free on \`/v1/search/everywhere/watches\`. \`watch_pause\` / \`watch_resume\` (new \`max_credits_per_run\` / \`max_credits_per_month\`) use the discover schedule routes a watch is built on. A watch view carries \`caps\`, \`spend.month\`, \`next_fire_at\`, \`last_fire {run_id, new_rows, results_url}\`.

## Creator runs (area \`creator_runs\`)

\`prism/creators\` (GET or POST, socialcrawl_request) works toward \`limit\` until it has the creators, runs dry or reaches \`max_credits\`, and says which (\`stopped_because\`, \`short_reason\`). Its run is read like a search run on \`/v1/prism/creators/runs\` (\`run_list\`, \`run_get\` with country / account_kind / platform / sort / order filters, \`run_export\`, \`run_legs\`, \`run_cancel\`, \`run_resume\`, \`run_more\`) — reads free.

\`run_save\` (\`POST …/runs/{run_id}/save\`, \`keys\` optional, Idempotency-Key) stores the creators as author lists — **free**, kept 30 days, at most 20 lists per account and 10,000 handles each — and answers \`data.next.follow\`: a ready \`POST prism/discover\` schedule body (daily, event \`discover.new_rows\`) that watches those creators for new posts. It costs what its runs cost, with no premium.

## follow

Any \`data.next.*\` read URL (status_url, results_url, legs_url, changes_url, a watch's links) goes to action \`follow\` — absolute or relative, on the configured API only. POST links are refused with the action to use: more_url → \`run_more\`, include_url → \`run_include\`, resume_url → \`run_resume\`, a creator save → \`run_save\`.
`;
