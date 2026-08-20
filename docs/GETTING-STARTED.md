# Getting Started with SocialCrawl MCP

A step-by-step guide to using the SocialCrawl MCP server with your AI agent.

---

## What You Get

Once installed, your AI agent gains 9 tools that let it interact with 48 platforms and 381 endpoints — social media, commerce & product reviews, retail (Amazon, Walmart, Target, Home Depot, eBay, Google Shopping), app stores, places & travel, business reputation, web research, full web scraping & browser automation, prediction markets, search trends, Google News/Finance/Trends, Korean search, cross-platform Prism composites, and a universal meta-search:

- **Discover** what platforms and endpoints are available — browse by platform, search by free text across all 381 endpoints, or ask the live API to describe itself for free via its own `/v1/utility/*` endpoints
- **Fetch** profiles, posts, comments, search results, trending content, products, reviews, apps, places, analytics, and Prism composites
- **Price** any call before making it — the tier ladder, flat overrides, and the real min-max band for the 26 metered endpoints, with the rule that decides where inside the band you land
- **Read** detailed API documentation on demand — authentication, credits, pricing, errors, idempotency, pagination, caching, response schema, and rate limits
- **Check** your credit balance, or read the itemised ledger to see exactly what any past request charged and refunded
- **Schedule** Monitors that re-run any recipe on a cadence and deliver each result to a signed webhook
- **Scrape & browse** the open web — scrape/search/map/extract, async crawl/agent jobs, change monitors, and interactive browser sessions via `socialcrawl_web`

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
socialcrawl_check_balance
```

Proves auth end to end at 0 credits. If it fails, the message names the cause — `MISSING_API_KEY` means the env var never reached the process; `INVALID_API_KEY` means the key is malformed, revoked, or from another environment.

```
socialcrawl_discover  action: "freshness"
```

Confirms this server's bundled catalogue matches the live API. Data calls always work regardless, but discovery and pricing answer from a build-time snapshot — if it reports OUT OF DATE, upgrade with `npx -y socialcrawl-mcp@latest`.

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

The agent calls `socialcrawl_list_platforms` and shows all 48 platforms, grouped by category, with endpoint counts and credit ranges.

> "Show me all the TikTok endpoints"

The agent calls `socialcrawl_list_endpoints` with `platform: "tiktok"` and returns all 20 endpoints with their required parameters and credit costs.

### Cross-platform research

> "Compare the follower counts of @mkbhd on TikTok, Instagram, YouTube, and Twitter"

The agent makes 4 sequential `socialcrawl_request` calls — one per platform — and compiles the results.

### Access documentation

> "How does the credit system work?"

The agent calls `socialcrawl_get_docs` with `topic: "credits"` and returns the pricing and tier documentation.

---

## Understanding the 9 Tools

### `socialcrawl_list_platforms`

**When to use:** When you (or the agent) need to know what platforms are available.

**Input:** None.

**Output:** Tables of all 48 platforms grouped by category, each with its slug, endpoint count, credit range, and a description of the available data.

**No API key required.** This queries local bundled data.

---

### `socialcrawl_list_endpoints`

**When to use:** When you need to know what endpoints exist, what parameters they take, and what they cost — either for one platform, or by searching across all 381 endpoints.

**Input:** (all optional)
- `platform` — the platform slug, e.g., `"tiktok"`, `"instagram"`, `"youtube"`
- `search` — free text over endpoint names, summaries, descriptions, archetypes, and tags. With no `platform`, it searches every platform; with one, it narrows inside that platform
- `method` — `GET` | `POST` | `PATCH` | `DELETE`
- `maxCost` — only endpoints that can cost at most this many credits (metered endpoints judged by their ceiling)
- `detail` — `"full"` (default for a single platform) or `"compact"`

**Output:** A summary table plus, in full detail, the complete parameter contract for each endpoint: required params with examples, `oneOf` groups, optional params with their type, integer range, enum values, and couplings, CSV entry limits, the paging style and native cursor param, cache TTL, async/streaming mode, upstream fallback sources, and the price (with the metered rule where one applies).

**No API key required.** This queries local bundled data.

---

### `socialcrawl_pricing`

**When to use:** Before spending credits — to know what a call will cost, to find the cheapest endpoint that answers a question, or to explain a charge after the fact.

**Input:** (all optional)
- `action` — `"overview"` (default), `"endpoint"`, `"platform"`, or `"list"`
- `platform`, `resource`, `method` — required by `endpoint` (platform + resource) and `platform`; `method` disambiguates the `web` platform, where one resource is served by several methods
- `search`, `model`, `maxCost`, `minCost`, `sort`, `limit` — filters and ordering for `list`

**Output by action:**

- **`overview`** — the tier ladder with per-tier counts, every free endpoint, every flat override, all 26 metered endpoints with their min-max band and charging rule, the cache TTL table, and the full refund matrix.
- **`endpoint`** — one endpoint's price, whether it is ladder / flat / metered, the registry's exact charging rule, the parameters that actually move the bill, the cost of paging it, and the worst case to budget for.
- **`platform`** — a whole platform's cost table plus its metered rules.
- **`list`** — a ranked, filtered table across platforms, with the total worst-case spend of the listed rows. Use `maxCost: 1` for "everything I can call for a single credit", or the default `sort: "cost_desc"` for the most expensive endpoints.

**Why this exists:** a single number is a lie for most of the surface. A metered endpoint's base cost understates every call, and a flat endpoint ignores its tier rate entirely. This tool always quotes a metered endpoint as a band, never as its base.

**No API key required.** This queries local bundled data.

---

### `socialcrawl_discover`

**When to use:** To learn the API from the API — at 0 credits. This drives the `/v1/utility/*` family, four endpoints served in-process from the live endpoint registry, so they can never drift from what is actually callable.

**Input:** (all optional)
- `action` — `"quickstart"` (default), `"catalog"`, `"endpoint"`, `"llms"`, or `"freshness"`
- `platform` — scope quickstart, catalog, or llms to one platform slug
- `search`, `method` — catalog filters
- `id` — required by `endpoint`: an id (`tiktok/profile`), a path (`/v1/tiktok/profile`), or a full URL
- `format` — llms: `"markdown"` (default) or `"json"`
- `live` — set false to force the bundled answer
- `page` — long output is paged, not truncated

**Output by action:**

- **`quickstart`** (`GET /v1/utility/quickstart`) — authentication, base URL, a runnable first call, the success and error envelope shapes, the credit model, the **full error taxonomy** with HTTP statuses and meanings, rate limits, and the paging contract. Everything a new integration needs, in one response.
- **`catalog`** (`GET /v1/utility/endpoints`) — every endpoint with its **live** price label, required and optional params, `oneOf` groups, archetype, and paging flag. The label is metered-aware: `web/search` shows `2-120 (metered)`, not its `2` base.
- **`endpoint`** (`GET /v1/utility/endpoint`) — the deepest per-endpoint object the API exposes: every parameter with type, description and example, the exact pricing rule, cache TTL, the paging recipe, an example response with its schema URL, a copy-paste curl, and related endpoints to walk next.
- **`llms`** (`GET /v1/utility/llms`) — the agent context corpus for the whole API or one platform, as markdown or structured JSON. An agent with a key can bootstrap itself in one call instead of crawling documentation.
- **`freshness`** — compares the live registry totals against this server's bundled catalogue and tells you whether to upgrade.

**Requires API key?** No. With a key it calls the live endpoints; without one it answers everything except `llms` from bundled data, clearly labelled. Discovery must work before a key exists.

**Why it exists alongside the local tools:** `list_platforms` / `list_endpoints` / `pricing` / `get_docs` answer instantly from a catalogue generated at build time — faster, and no key needed. `socialcrawl_discover` answers from the live registry. Use the local tools to browse; use this one when an endpoint looks missing, when you need a metered endpoint's exact live price, or when you are generating code that must match production today.

---
### `socialcrawl_request`

**When to use:** To actually fetch social media data.

**Input:**
- `platform` (required) — platform slug
- `resource` (required) — the endpoint resource path (e.g., `"profile"`, `"post/comments"`, `"search"`)
- `params` (optional) — query parameters as key-value pairs (e.g., `{ "handle": "charlidamelio" }`). Includes required parameters, any optional parameters the endpoint accepts (forwarded through when provided), and at least one member of each `oneOf` group the endpoint declares.
- `body` (optional) — JSON request body for the POST batch endpoints (e.g. `youtube/videos`, `prism/profiles`). Put array/object params here — e.g. `{ "ids": ["dQw4w9WgXcQ"] }` — while scalar query params (like `hl`) stay in `params`. Ignored for GET endpoints.

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

### `socialcrawl_get_docs`

**When to use:** When the agent needs more context about the API — authentication, credit system, error handling, or platform-specific documentation.

**Input:**
- `topic` (optional, defaults to `"overview"`) — one of:
  - `"overview"` — compact API introduction
  - `"setup"` — how to configure SocialCrawl per client, verify it, and drive it well
  - `"full"` — comprehensive reference (all endpoints, all parameters)
  - `"authentication"` — how API keys work
  - `"credits"` — the three billing models, tiers, and what is never charged
  - `"pricing"` — exact per-endpoint credit cost for every endpoint
  - `"errors"` — error codes, what they mean, and which are retryable
  - `"idempotency"` — retry-safe requests via the `Idempotency-Key`
  - `"pagination"` — the universal `cursor` contract, `has_more`, and page-size vs collect-until-N
  - `"caching"` — TTLs, why hits are free, and how to force a fresh fetch
  - `"response-schema"` — the envelope, archetypes, `ext`, computed fields, response headers
  - `"limits"` — rate limit, concurrency, timeouts, circuit breaker, retry guidance
  - `"monitors"` — the scheduled-recipe wrapper (`/v1/monitors/*`)
  - `"discovery"` — the free self-describing `utility/*` endpoints, in full
  - Any platform slug (e.g., `"tiktok"`) — platform-specific endpoint reference
- `page` (optional, defaults to 1) — long topics are paged rather than truncated; the footer tells you how many pages there are

**Output:** Markdown documentation for the requested topic.

**No API key required.** This returns bundled documentation.

---

### `socialcrawl_check_balance`

**When to use:** To check the account's remaining credit balance, or to read the itemised ledger behind it.

**Input:** (all optional)
- `view` — `"balance"` (default) or `"transactions"`
- `limit`, `cursor`, `requestId` — transactions only: page size (1-100, default 50), keyset cursor, and an exact-match filter for one request id

**Output:** With the default view, the envelope from `GET /v1/credits/balance` — current balance and a recent-deduction summary. With `view: "transactions"`, the envelope from `GET /v1/credits/transactions` — dispute-grade receipts, newest first, each with `type`, `amount` (deductions negative, refunds positive), `balance_after`, `endpoint`, `credit_tier`, and `request_id`. Page with `cursor` until `next_cursor` is null.

Because a metered endpoint deducts a ceiling and then refunds down, the ledger is where you confirm what a call really settled at: filter by its `requestId` and read the deduction and refund rows together.

Both views cost **0 credits**.

**Requires API key.**

---

### `socialcrawl_monitors`

**When to use:** To create and manage stateful **Monitors** — schedule any registry endpoint or Prism composite to re-run on a cadence and deliver each result to a signed webhook.

**Input:**
- `action` (required) — one of `create`, `list`, `get`, `runs`, `timeseries`, `pause`, `resume`, `delete`
- `id` — the monitor id (required for get/runs/timeseries/pause/resume/delete)
- `recipe`, `cadence`, `webhook_url` (required for `create`), plus optional `params`, `name`, `alert_rules`, `suppress_webhook_unless_alert`, and list/runs/timeseries filters

**Output:** The monitor, list, run history, or time-series JSON. Monitors are **not** registry endpoints (not part of the 381 count) and use POST/PATCH/DELETE in addition to GET. Managing them costs **0 credits**; each scheduled run bills the recipe's normal cost plus a 1-credit scheduling premium.

**Requires API key.**

---

### `socialcrawl_web`

**When to use:** For anything on the open web — scraping a page, searching the web, mapping a site, extracting structured data, crawling a whole site, running an autonomous web agent, watching a URL for changes, or driving an interactive browser session. This is the dedicated tool for the `web` platform (`/v1/web/*`), which mixes GET/POST/PATCH/DELETE and async job lifecycles that `socialcrawl_request` can't express.

**Input:**
- `action` (required) — one of the sync reads (`scrape`, `search`, `map`, `extract`), async jobs (`crawl`, `batch_scrape`, `agent`, then `job_get`/`job_list`/`job_cancel`/`job_errors`, plus the free `crawl_preview` dry run), monitors (`monitor_create`/`list`/`get`/`update`/`delete`/`checks`), or sessions (`session_create`/`list`/`get`/`execute`/`close`)
- `id` — the job/monitor/session id (required for the `*_get`/`*_cancel`/`*_delete`/`*_update`/`*_checks`/`*_execute` actions)
- `input` — the operation parameters (query params for reads, JSON body for writes), e.g. `{ "url": "https://example.com", "formats": "markdown,screenshot" }`

**Output:** The scraped content, search results, job envelope, monitor, or session JSON. Most of the paid web surface is **metered**, not flat: `scrape` is 1-5cr depending on the formats requested, `search` 2-120cr with result depth, `crawl` holds `limit` credits and refunds every page it did not crawl, and a session holds against `ttl_seconds` and settles on close. `agent` is a flat 25cr, and job/monitor/session management is 0cr. The response header quotes the band and the exact rule for whichever action you called.

**Requires API key.** See `socialcrawl_get_docs` topic `web` for the full per-action reference.

---

## How Credits Work

Every API request costs credits, billed one of three ways.

**Ladder** — the tier rate, charged per request. This covers 294 of the 381 endpoints.

| Tier | Cost | What it covers |
|------|------|----------------|
| Standard | 1 credit | Profiles, posts, comments, search, reference data |
| Advanced | 5 credits | Trending feeds, audience demographics, ad libraries, retail & app-store data |
| Premium | 10 credits | AI transcripts, LinkedIn people/job search, app-listings databases |

**Flat** — a per-endpoint override (61 endpoints, 18 of them free). `GET /v1/search/everywhere` is a flat 20cr; the four `utility/*` discovery endpoints and all job/monitor/session management are 0cr.

**Metered** — the charge depends on the request (26 endpoints). An upfront ceiling is deducted and automatically refunded down to the work actually done, so the endpoint's base cost is *not* what you pay: `/v1/search/news` shows a 1cr base but really charges 2-14cr depending on how many country legs return articles. Ask `socialcrawl_pricing` for the real band and the rule before you run one.

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

The MCP handles errors gracefully and gives the agent actionable guidance:

| Error | What the agent sees |
|-------|---------------------|
| Missing API key | "No API key configured. Set SOCIALCRAWL_API_KEY..." |
| Invalid API key | "Invalid API key. Check your SOCIALCRAWL_API_KEY configuration." |
| Insufficient credits | "Insufficient credits (X remaining). Top up at socialcrawl.dev/billing." |
| Bad platform/resource | "Unknown platform/resource. Use socialcrawl_list_endpoints to see available endpoints." |
| Missing parameters | "Missing required parameter: handle. This endpoint requires: handle." |
| Platform down | "Platform temporarily unavailable. Try again shortly." |
| Upstream error | "Upstream error fetching data. Credits have been auto-refunded." |

The agent can self-correct from most errors by calling `socialcrawl_list_platforms` or `socialcrawl_list_endpoints` to discover the right platform, endpoint, or parameters.

---

## Tips

- **Start with discovery.** If you're unsure what data is available, ask the agent to list platforms and endpoints first.
- **Use platform slugs.** The API uses lowercase slugs: `tiktok`, `instagram`, `youtube`, `twitter`, `linkedin`, `reddit`, `threads`, `facebook`, `pinterest`, `google`, `twitch`, `truthsocial`, `snapchat`, `kick`, `amazon`, `linktree`, `linkbio`, `linkme`, `komi`, `pillar`, `utility`.
- **Check credit costs before bulk operations.** Ask the agent to show endpoint details so you know the per-call cost before running a batch.
- **Cross-platform queries work naturally.** The unified response format means the agent can compare data across platforms without special handling.
- **The `full` docs topic is comprehensive.** If the agent needs a complete reference of every endpoint and parameter, `socialcrawl_get_docs(topic: "full")` gives it everything.
