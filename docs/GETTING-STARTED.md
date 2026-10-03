# Getting Started with SocialCrawl MCP

A step-by-step guide to using the SocialCrawl MCP server with your AI agent.

---

## What You Get

Once installed, your AI agent gains 7 tools that let it interact with 67 platforms and 633 endpoints — social media, commerce, marketplaces & product reviews, retail (Amazon, Walmart, Target, Home Depot, eBay, Klarna, AliExpress, Etsy, Sephora, H&M, Kohl's, Wayfair, Gumtree, Google Shopping), app stores, places, travel & local (Tripadvisor, Yelp, Google Business), business & software reputation (Trustpilot, G2), jobs & salaries, markets & finance, US congressional trading disclosures, on-page SEO audits, web research, full web scraping & browser automation, prediction markets, Google News/Trends, Korean search, cross-platform Prism composites, and a universal meta-search:

- **Find** the right endpoint for a task in plain words (`socialcrawl_find`), and read what it needs and what it returns before calling (`socialcrawl_endpoint`)
- **Fetch** profiles, posts, comments, search results, trending content, products, reviews, apps, places, analytics, and Prism composites
- **Price** any call or plan before making it (`socialcrawl_estimate`) — the tier ladder, flat overrides, and the real min-max band for the 130 metered endpoints, with the rule that decides where inside the band you land
- **Read** detailed API documentation on demand — authentication, credits, pricing, errors, idempotency, pagination, caching, response schema, and rate limits
- **Collect** many pages in one call with a credit budget — `socialcrawl_collect` walks a paged endpoint until you have N unique rows and hands back a link to the full file
- **Check** your credit balance, or read the itemised ledger to see exactly what any past request charged and refunded
- **Schedule** Monitors that re-run any recipe on a cadence and deliver each result to a signed webhook
- **Scrape & browse** the open web — scrape/search/map/extract, async crawl/agent jobs, change monitors, and interactive browser sessions via `socialcrawl_manage` (area `web`)
- **Filter listening to a panel you supply** — upload up to 10,000 public identities and ask which of *them* posted your keywords, with per-member coverage, via `socialcrawl_manage` (area `cohorts`)

All data comes back in a clean, unified response envelope (`success`, `platform`, `endpoint`, `data`, `credits_used`, `credits_remaining`, `request_id`, `cached`) — the same structure whether you're querying TikTok, Instagram, YouTube, or any other platform. Only the inner `data` payload changes shape, and it's typed per archetype (`Author`, `Post`, `PostList`, etc.) so a post looks like a post no matter where it came from.

---

## Step 1: Get Your API Key

1. Go to [socialcrawl.dev](https://socialcrawl.dev) and create an account
2. You'll receive **100 free credits** instantly (no credit card required)
3. Navigate to your dashboard and copy your API key — it starts with `sc_`

---

## Step 2: Install the MCP Server

Add the SocialCrawl MCP to your AI client's configuration. Pick the one you use:

### Claude Desktop

Open your config file:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add:

```json
{
  "mcpServers": {
    "socialcrawl": {
      "command": "npx",
      "args": ["-y", "socialcrawl-mcp"],
      "env": {
        "SOCIALCRAWL_API_KEY": "sc_your_key_here"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "socialcrawl": {
      "command": "npx",
      "args": ["-y", "socialcrawl-mcp"],
      "env": {
        "SOCIALCRAWL_API_KEY": "sc_your_key_here"
      }
    }
  }
}
```

### VS Code (Claude Code)

Add to `.vscode/mcp.json` in your project or your user settings:

```json
{
  "servers": {
    "socialcrawl": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "socialcrawl-mcp"],
      "env": {
        "SOCIALCRAWL_API_KEY": "sc_your_key_here"
      }
    }
  }
}
```

Restart your AI client after saving the config. The SocialCrawl tools will appear in the tool list.

---

## Step 2b: Verify the setup

Two free calls confirm everything is wired up:

```
socialcrawl_account
```

Proves auth end to end at 0 credits. If it fails, the message names the cause — `MISSING_API_KEY` means the env var never reached the process; `INVALID_API_KEY` means the key is malformed, revoked, or from another environment.

```
socialcrawl_account  view: "freshness"
```

Confirms this server's bundled catalogue matches the live API. Data calls always work regardless, but discovery and pricing answer from a build-time snapshot — if it reports OUT OF DATE, upgrade with `npx -y socialcrawl-mcp@latest`. The server also runs this check once on its own and adds a one-line note to your next result when it is behind (set `SOCIALCRAWL_FRESHNESS_CHECK=off` to disable).

For per-client configuration and the full correct-use guide, ask for the `setup` docs topic.

---

## Step 3: Start Using It

Just ask your AI agent in natural language. Here are practical examples:

### Fetch a profile

> "Get the TikTok profile for charlidamelio"

The agent will call `socialcrawl_request` with `platform: "tiktok"`, `resource: "profile"`, `params: { handle: "charlidamelio" }` and return structured profile data — followers, bio, verification status, engagement metrics.

### Search across platforms

> "Search YouTube for 'machine learning tutorials'"

The agent calls `socialcrawl_request` with `platform: "youtube"`, `resource: "search"`, `params: { query: "machine learning tutorials" }`.

### Get post comments

> "Get the comments on this Instagram post: https://instagram.com/p/ABC123"

The agent calls `socialcrawl_request` with `platform: "instagram"`, `resource: "post/comments"`, `params: { url: "https://instagram.com/p/ABC123" }`.

### Explore what's available

> "What social media platforms can you access?"

The agent calls `socialcrawl_find` with no task and shows all 67 platforms, grouped by category, with endpoint counts and credit ranges.

> "Show me all the TikTok endpoints"

The agent calls `socialcrawl_find` with `platform: "tiktok"` and returns every TikTok endpoint with its required parameters and credit cost.

> "Which endpoint gives me the comments on a TikTok video?"

The agent calls `socialcrawl_find` with `task: "tiktok video comments"`; `tiktok/post/comments` comes first, with `url` listed as missing and the exact call to make.

### Cross-platform research

> "Compare the follower counts of @mkbhd on TikTok, Instagram, YouTube, and Twitter"

The agent makes 4 sequential `socialcrawl_request` calls — one per platform — and compiles the results.

### Access documentation

> "How does the credit system work?"

The agent calls `socialcrawl_endpoint` with `id: "credits"` and returns the pricing and tier documentation.

---

## Understanding the 7 Tools

Results from the API-calling tools carry `structuredContent` (`ok`, `credits.used`, `credits.remaining`, `paging`, `rows`, `warnings`) beside the text, and a failure sets `isError` with `{ ok: false, code, retryable, reason, fix }`. If the server's bundled catalogue is behind the live API, the next result carries one extra line saying so (and a `warnings` entry); upgrade with `npx -y socialcrawl-mcp@latest`. The remote server can also run in an OAuth mode (preview, off by default) — see `docs/REMOTE-STREAMABLE-HTTP.md` section 10a for the scopes (`socialcrawl:read`, `socialcrawl:spend`, `socialcrawl:manage`) each tool needs.

Version 2.0.0 has seven tools. The usual path is find → endpoint → estimate → request (or collect).

### `socialcrawl_find`

**When to use:** First, for any task. "Export the comments on this TikTok", "which endpoint gives me Amazon reviews", "what can I get from Reddit".

**Input:**
- `task` (optional) — the job in plain words. URLs and `@handles` in it are resolved and filled into the params.
- `platform` (optional) — only that platform's endpoints. With no `task`, lists that platform's endpoints.
- `limit` (optional) — how many endpoints to return (1-10, default 3).

With no arguments it lists the 67 platforms.

**Output:** The best endpoints, each with `params_filled` (taken from the task), `params_missing`, `credits` (`min`, `max`, and the `hold` for the filled params; `estimate` when the API quoted it) and `call`, the exact `socialcrawl_request` (or `socialcrawl_manage`) call to make once nothing is missing.

**How it ranks:** with a key it asks the API (`/v1/utility/find`, and `/v1/utility/resolve` for URLs and handles). Until those routes are deployed, and without a key, it ranks locally: BM25 over each endpoint's id, summary, returns, use-when and tags, with a boost for the platform the task names ("tiktok comments" ranks `tiktok/post/comments` first). Free.

---

### `socialcrawl_endpoint`

**When to use:** Before calling an endpoint you have not used, to see what to send and what comes back.

**Input:**
- `id` (required) — `platform/resource` (e.g. `"tiktok/post/comments"`, a path, or a concrete path such as `"prism/jobs/job_abc"`); a platform slug for its endpoint table; or a guide topic (`overview`, `setup`, `credits`, `pricing`, `errors`, `idempotency`, `pagination`, `caching`, `hydration`, `judgments`, `batch-jobs`, `response-schema`, `limits`, `monitors`, `cohorts`, `discovery`, `full`).
- `method` (optional) — only for an id served by several methods.
- `page` (optional) — page of a long guide.

**Output:** The contract: `purpose` (summary, returns, use when, not for), `params` (required, one-of groups, optional with types, ranges and enums), `outputs` (`rows_at`, the archetype, up to 25 response fields with their meaning, plus page-level keys), `cost` (band, model and rule), `paging`, `latency_ms` (when measured), `timeout_s`, `next` (related endpoints and why) and `sample` (a docs page with an example response). With a key it reads `/v1/utility/endpoint` live and lays what it adds over the bundled contract. Free.

---

### `socialcrawl_estimate`

**When to use:** Before any call that could cost more than a few credits, and to budget a job.

**Input:**
- `id` — `platform/resource` for one call; a platform slug for its price table; omit for the pricing overview.
- `params` (optional) — the exact params you will send (`include`, `label`, `limit`, `max_pages`, ... move the price).
- `body` (optional) — POST body for batch endpoints.
- `calls` (optional) — how many such calls, for a job total.
- `items` (optional) — rows wanted, to price the pages a walk needs.
- `plan` (optional) — a list of `{ id, params, body, repeat }` to total at once, in place of `id`.

**Output:** `quote` (`hold` — what is held up front — plus `min_credits` / `max_credits`, `calls`, `total_hold`; with the API also `expected_min` / `expected_max`, the formula, levers and `valid` / `rejection`), or `plan` with `total_hold`. Uses `/v1/utility/estimate` when deployed, else the bundled pricing. Free.

---

### `socialcrawl_request`

**When to use:** To actually fetch social media data.

**Input:**
- `platform` (required) — platform slug; an unknown slug gets a did-you-mean
- `resource` (required) — the endpoint resource path (e.g., `"profile"`, `"post/comments"`, `"search"`)
- `params` (optional) — query parameters as key-value pairs (e.g., `{ "handle": "charlidamelio" }`). Includes required parameters, any optional parameters the endpoint accepts (forwarded through when provided), and at least one member of each `oneOf` group the endpoint declares.
- `body` (optional) — JSON request body for the POST batch endpoints (e.g. `youtube/videos`, `prism/profiles`). Put array/object params here — e.g. `{ "ids": ["dQw4w9WgXcQ"] }` — while scalar query params (like `hl`) stay in `params`. Ignored for GET endpoints.
- `method` (optional) — only for a resource served by more than one method: `prism/jobs` is GET (list your jobs) and POST (submit one). When omitted, sending a `body` selects the POST variant.
- Path-param endpoints (`prism/jobs/{job_id}`) take the template as `resource` with the value in `params` (`{ "job_id": "…" }`), or the concrete path (`jobs/job_abc123`).
- `fields` (optional) — comma-separated field paths to keep on each row, root-qualified exactly as `socialcrawl_endpoint` lists them: e.g. `"post.id,post.content.text,post.engagement.*"` on a post list, `"comment.text,comment.engagement.likes"` on comments. Identity (`id`, `url`) is always kept; a path set that matches nothing returns a warning naming the right root. Cuts tokens, not credits.
- `max_items` (optional) — show at most this many rows; the whole page stays readable at the `socialcrawl://results/<request_id>` resource link (kept 30 minutes per key).
- `format` (optional) — `"json"` (default envelope), `"csv"` (flattened table) or `"summary"` (row count, columns, engagement totals, sample rows).
- `max_credits` (optional) — a spend cap: the call is quoted first and refused locally, for free, when the quoted hold is above it.
- `confirm` (optional) — set `true` after the user approves a spend above the confirmation threshold (`SOCIALCRAWL_CONFIRM_ABOVE`, default 100 credits). Clients that support elicitation ask the user directly instead.
- `idempotencyKey` (optional) — makes a retry safe; a replay returns the original response for 0 credits.

Responses too large for the context are cut at row boundaries (never mid-JSON); the result then carries a `truncated` block and a resource link to the full body. A submitted background job returns a `job` handle with the exact `socialcrawl_request` call to poll it (`GET prism/jobs/{job_id}`).

On every response the header states the price (the band and the rule for a metered endpoint). It also quotes the exact hold for any `include=` join or metered `label=` / `relevant_to=` you sent, says when the free default judgments are on the rows, and names the paging levers the endpoint offers (`max_pages`, `since` / `stop_at_id`, `seen`). A param the endpoint does not declare is reported as dropped; the API names it in `data._warnings`.

**Output:** A unified response envelope containing `success`, `platform`, `endpoint`, `data` (the actual social media payload, typed per archetype — `Author`, `Post`, `PostList`, etc.), `credits_used`, `credits_remaining`, `request_id`, and `cached`. The envelope shape is stable across every endpoint — only `data` varies.

**Requires API key.** This makes a real HTTP request to the SocialCrawl API.

**Smart validation:** Before making the API call, the tool mirrors the backend's own pre-billing validator against the bundled registry data:
1. The platform exists
2. The endpoint exists for that platform (near matches are suggested when it doesn't)
3. All required parameters are present
4. Every `oneOf` parameter group is satisfied by at least one provided identifier (e.g. an endpoint that accepts either `url` or `id` needs one of them, not both)
5. Enum parameters carry a legal value
6. Integer parameters sit inside their declared minimum/maximum
7. Coupled parameters have their partner — `order` is a no-op without `sort`; Reddit's `timeframe` needs `sort=top`
8. Comma-separated list parameters are within their entry limit and each entry is legal

Every one of these is a free 400 at the API, so failing locally costs nothing but saves the round trip — and tells the agent exactly what to fix instead of letting it loop on a call that can never succeed. Optional parameters are never *required* by pre-flight; they're forwarded through when the agent includes them, and undeclared ones are reported as ignored.

The response header also states the endpoint's price — including the metered band and rule where one applies — so the agent can see what the call cost alongside the data.

---

### `socialcrawl_collect`

**When to use:** When you need many rows from a paged endpoint (comments, search results, posts) — more than one page — without hand-rolling the cursor loop.

**Input:**
- `id` (required) — `platform/resource`, e.g. `"tiktok/post/comments"`; the endpoint must page
- `items` (required) — stop once this many unique rows are collected (1-10,000)
- `params` (optional) — the same query parameters as `socialcrawl_request`; do not pass `cursor`
- `max_credits` (optional) — budget for the whole walk; the call is refused, free, when one page's hold already exceeds it
- `format` (optional) — stored file format: `"jsonl"` (default), `"json"` or `"csv"`
- `fields` (optional) — root-qualified field paths to keep on each row, as `socialcrawl_endpoint` lists them (e.g. `"comment.text,comment.engagement.likes"`)
- `confirm` (optional) — `true` after the user approves a walk above `SOCIALCRAWL_CONFIRM_ABOVE`

**Output:** A summary (rows collected, pages, credits used, why it stopped, a cursor to resume) plus a `resource_link` to every row. The walk drops repeated rows by id and stops on a 402. It quotes up front (the API's estimate when deployed, else the bundled pricing).

**Requires API key.** Spends credits page after page; cached pages are free.

---

### `socialcrawl_account`

**When to use:** To check the balance, explain a charge, check platform health, or see whether this server is current.

**Input:**
- `view` (optional) — `"balance"` (default; includes this session's spend), `"transactions"` (the itemised ledger), `"status"` (each platform's live health; read it before retrying a persistent 502/503) or `"freshness"` (bundled catalogue vs the live API).
- `limit`, `cursor`, `request_id` (optional) — for `transactions`.

Free. `balance` and `transactions` need a key; `status` does not.

---

### `socialcrawl_manage`

**When to use:** For anything that persists or runs in the background.

**Input:**
- `area` (required) — `"monitors"`, `"cohorts"`, `"web"` or `"jobs"`.
- `action` (required) — monitors: `create`, `list`, `get`, `runs`, `timeseries`, `pause`, `resume`, `delete`. cohorts: `create`, `add_members`, `estimate_cost`, `query`, `query_status`, `query_results`, `query_cancel`, `get`, `delete`. web: `scrape`, `search`, `map`, `extract`, `crawl`, `batch_scrape`, `agent`, `crawl_preview`, `job_get`, `job_list`, `job_cancel`, `job_errors`, `monitor_*`, `session_*`. jobs (Prism background jobs): `submit`, `list`, `get`.
- `id` (optional) — the monitor, cohort, query, web job/monitor/session, or Prism job id.
- `input` (optional) — the action's other fields, e.g. `{ recipe, cadence, webhook_url }` for a monitor, `{ url }` for a scrape, `{ keywords, date_from, ... }` for a cohort query, or the job body for `jobs submit` (`max_credits` and `confirm` are allowed there).
- `idempotencyKey` (optional) — for web crawl/batch, cohort writes (a UUID) and job submits.

The arguments are checked against each area's rules before anything is sent, so a wrong field is a free error that lists the actions and the problem. Managing is 0 credits; scrapes, jobs, cohort queries and monitor runs bill credits. An async job returns a handle with the exact call to poll it: `socialcrawl_request` (`GET prism/jobs/{job_id}`) for a Prism job, `socialcrawl_manage` (`area: "web"`, `action: "job_get"`) for a web job.

---

### Upgrading from 1.x

`SOCIALCRAWL_LEGACY_TOOLS=1` also registers the retired 1.x names for this major version:

| 1.x tool | 2.0 tool |
|----------|----------|
| `socialcrawl_list_platforms` | `socialcrawl_find` with no arguments |
| `socialcrawl_list_endpoints` | `socialcrawl_find`; `socialcrawl_endpoint` for one contract |
| `socialcrawl_pricing` | `socialcrawl_estimate` |
| `socialcrawl_discover` | `socialcrawl_endpoint`, `socialcrawl_find`, `socialcrawl_account` (freshness, status) |
| `socialcrawl_get_docs` | `socialcrawl_endpoint` with the topic as `id` |
| `socialcrawl_check_balance` | `socialcrawl_account` |
| `socialcrawl_monitors` / `socialcrawl_web` / `socialcrawl_cohorts` | `socialcrawl_manage` with `area` |

---

## How Credits Work

Every API request costs credits, billed one of three ways.

**Ladder** — the tier rate, charged per request. This covers 431 of the 631 endpoints.

| Tier | Cost | What it covers |
|------|------|----------------|
| Standard | 1 credit | Profiles, posts, comments, search, reference data |
| Advanced | 5 credits | Trending feeds, audience demographics, ad libraries, retail & app-store data |
| Premium | 10 credits | AI transcripts, LinkedIn people/job search, app-listings databases |

**Flat** — a per-endpoint override (70 endpoints, 22 of them free). `GET /v1/search/everywhere` is a flat 20cr; the six `utility/*` discovery endpoints and all job/monitor/session management are 0cr.

**Metered** — the charge depends on the request (130 endpoints). An upfront ceiling is deducted and automatically refunded down to the work actually done, so the endpoint's base cost is *not* what you pay: `/v1/search/news` shows a 1cr base but really charges 2-62cr — 1 credit per Google country leg that returns articles, plus per-article billing if you add the bing engine. Ask `socialcrawl_estimate` for the real band and the rule before you run one.

What is **never** charged:

- **Cache hits** — a repeat of the same call inside its TTL returns `cached: true` at 0 credits
- **Idempotent replays** — same `Idempotency-Key` within 24h returns the stored response at 0 credits
- **Empty results** — a missing profile (404) or a zero-match search (200 `{items: []}`) is auto-refunded
- **Failures** — 502, 503, 500, and deadline 504s all reverse the charge; 400/401/402/405/409/413/422/429 never deduct, because validation runs before billing

Other facts worth knowing:

- You get **100 free credits** on signup, and credits **never expire**
- Rate limits are 600 requests/minute and 50 concurrent requests per key — both unbilled when exceeded, and every response carries `X-RateLimit-Remaining` so you can pace yourself
- Every response includes `credits_used` (the **settled** charge, post-refund) and `credits_remaining`

---

## Error Handling

The MCP handles errors gracefully and gives the agent actionable guidance. Every API error keeps the server's own `error.message`, then adds `reason: …` when the API names one and `request_id: req-…` on its own line. For example, a transcript of a deleted video reads:

```
Error: Resource not found (youtube). The video is unavailable (deleted, private, or it never existed). You were not charged for this request.
reason: video_gone
request_id: req-a1b2c3d4e5f6
```

Quote the `request_id` when you report a problem: it is how a single call is found in the logs and the credit ledger.

| Error | What the agent sees |
|-------|---------------------|
| Missing API key | "No API key configured. Set SOCIALCRAWL_API_KEY..." |
| Invalid API key | "Invalid API key. API key not found, revoked, or expired. Check your SOCIALCRAWL_API_KEY configuration." |
| Insufficient credits | "Insufficient credits (X remaining). Your account has X credits remaining. This endpoint requires Y credits. Top up at socialcrawl.dev/dashboard/billing." |
| Bad platform/resource | "Endpoint /v1/tiktok/fake not found. Unknown endpoint: /v1/tiktok/fake. Use socialcrawl_find with platform 'tiktok' to see its endpoints." |
| Missing parameters | "Missing required parameter: handle. This endpoint requires: handle." |
| Platform down | "Service unavailable. instagram is temporarily unavailable. Your credits have been refunded." |
| Upstream error | "Upstream error. pinterest returned an error for this request and every available source failed. Your credits have been refunded. This is usually transient, retry after 30 seconds." |

Every error that came back from the API is followed by its `request_id` (and `reason`, when present) as shown in the example. The missing-key and missing-parameter errors are caught locally before any call is made, so they have no request id.

The agent can self-correct from most errors by applying `did_you_mean`, or calling `socialcrawl_find`, to discover the right platform, endpoint, or parameters.

---

## Tips

- **Start with `socialcrawl_find`.** Describe the job; it returns the endpoint, the params still missing, and the cost.
- **Use platform slugs.** The API uses lowercase slugs: `tiktok`, `instagram`, `youtube`, `twitter`, `linkedin`, `reddit`, `threads`, `facebook`, `pinterest`, `google`, `twitch`, `truthsocial`, `snapchat`, `kick`, `amazon`, `linktree`, `linkbio`, `linkme`, `komi`, `pillar`, `utility`.
- **Check credit costs before bulk operations.** Ask the agent to show endpoint details so you know the per-call cost before running a batch.
- **Cross-platform queries work naturally.** The unified response format means the agent can compare data across platforms without special handling.
- **The `full` docs topic is comprehensive.** If the agent needs a complete reference of every endpoint and parameter, `socialcrawl_endpoint(id: "full")` gives it everything.
