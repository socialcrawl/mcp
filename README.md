<div align="center">

# socialcrawl-mcp

**Give your AI agent access to 65 platforms and 575 endpoints — social media, commerce, marketplaces & product reviews, retail, app stores, places, travel & local, business & software reputation, jobs & salaries, markets & finance, congressional trading disclosures, news, web research, full web scraping & browser automation, on-page SEO, prediction markets, search trends, cross-platform Prism composites, and a universal meta-search — through a single API, with exact credit pricing for every endpoint**

[![npm](https://img.shields.io/npm/v/socialcrawl-mcp?style=flat-square&color=blue)](https://www.npmjs.com/package/socialcrawl-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-green?style=flat-square)](https://registry.modelcontextprotocol.io)
[![Platforms](https://img.shields.io/badge/Platforms-65-blue?style=flat-square)](https://socialcrawl.dev)
[![Endpoints](https://img.shields.io/badge/Endpoints-575-green?style=flat-square)](https://socialcrawl.dev/docs)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)
[![mcp MCP server](https://glama.ai/mcp/servers/socialcrawl/mcp/badges/score.svg)](https://glama.ai/mcp/servers/socialcrawl/mcp)

<a href="https://glama.ai/mcp/servers/socialcrawl/mcp">
  <img width="380" src="https://glama.ai/mcp/servers/socialcrawl/mcp/badges/card.svg" alt="Socialcrawl MCP server" />
</a>

[Overview](#overview) | [Installation](#installation) | [Setup](#setup) | [Usage](#usage) | [Tools](#available-tools) | [Platforms](#supported-platforms)

</div>

---

## Overview

`socialcrawl-mcp` is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that connects AI agents to the [SocialCrawl API](https://socialcrawl.dev) — a unified data API covering 65 platforms and 575 endpoints.

Retrieve profiles, posts, comments, search results, trending content, and analytics from TikTok, Instagram, YouTube, Twitter/X, LinkedIn, Reddit, Threads, Douyin, Telegram, Quora, Apple Music, GitHub, Hacker News, Polymarket, and 30 more platforms. Pull products, offers, price history, reviews, and sellers from Amazon, Walmart, Target, Home Depot, eBay, Klarna, AliExpress, Etsy, Sephora, H&M, Kohl's, Wayfair, Gumtree, and Google Shopping; apps, charts, and reviews from Google Play and the Apple App Store; hotels, restaurants, attractions, cruises, and traveler reviews from Tripadvisor, plus local business data from Yelp and Google Business; brand reputation from Trustpilot and software reviews from G2; job listings and salary bands from LinkedIn, Indeed, Bing, and Xing; market quotes, price history, financial statements, and options chains; US congressional trading disclosures; Korean search and Data Lab trend series from Naver; cross-web brand mentions with sentiment via Content Analysis; Google News headlines and Google Trends interest curves — plus web research via Tavily and Perplexity, AI-powered X search via Grok, on-page SEO audits, and a single `/search/everywhere` endpoint that fans out across 14 sources in one call.

New in this release (v1.12.0): a registry re-sync that adds **three endpoints and two new price levers**.

- **TikTok's own leaderboards.** `tiktok/hashtags/popular` reads the trending-hashtag board for a market and time window — the overall board plus 15 industry boards, 2cr per hashtag returned (one board is 6cr; `industry=all` holds 96 and settles around 88-92). `tiktok/videos/popular` reads the Top Videos board for the US, Japan, Vietnam, Thailand or Indonesia at 25cr per board plus 1cr per video. Both are ranked leaderboards with no second page.
- **`google_trends/trending`** — Trending Now by location, with hour window, category, status and sort filters (5cr).
- **`coverage=full` on `instagram/followers` and `instagram/following`.** A merged walk that never repeats an account across pages until the rows reach the profile's own total. It doubles the page price to 10cr, which moved both endpoints from a flat ladder rate to a **5-10cr metered band** — and a full list is genuinely expensive (a 2,652-account following list took 54 pages, 540 credits, measured 13/09). `socialcrawl_pricing` quotes the band and names `coverage` as the lever.
- **`feed=global|local` on `tiktok/trending`** — the worldwide web feed, or the For You feed as a phone in `region` would see it (more in-country content, slower, more videos).
- `instagram/location/posts` now pages properly with a cursor instead of being a single 60-post grid.

Prices, params, response shapes and paging descriptors are re-synced across 24 further endpoints. Row hydration (the opt-in `include=` joins added in v1.11.0) is unchanged at 33 joins across 28 endpoints.

**What the MCP server does:**
- Discovers platforms and endpoints dynamically, or by free-text search across all 575 of them
- Fetches live data on your behalf across every platform, method, and composite
- Prices every call up front — ladder, flat, or metered band — so an agent can budget before it spends
- Validates requests locally before calling the API: required params, `oneOf` groups, enum values, integer ranges, parameter couplings, and CSV limits. A bad call fails free instead of burning credits
- Provides built-in API documentation the agent can query on demand, paged rather than truncated

## Installation

### Remote server (hosted — no install)

Connect straight to the hosted Streamable HTTP endpoint — nothing to install or run:

**Claude Code** (works in the CLI *and* Claude Code on the web / cloud sandboxes)

```bash
claude mcp add --scope user --transport http socialcrawl https://mcp.socialcrawl.dev/mcp \
  --header "Authorization: Bearer sc_your_key_here"
```

**Any client that reads `.mcp.json`**

```json
{
  "mcpServers": {
    "socialcrawl": {
      "type": "http",
      "url": "https://mcp.socialcrawl.dev/mcp",
      "headers": { "Authorization": "Bearer ${SOCIALCRAWL_API_KEY}" }
    }
  }
}
```

**Cursor / Windsurf / VS Code** — choose the HTTP ("streamable-http") server type with the same URL and header. `x-api-key: sc_your_key_here` works as an alternative header.

The discovery tools (`socialcrawl_list_platforms`, `socialcrawl_list_endpoints`, `socialcrawl_get_docs`) work without a key, so you can explore before signing up. claude.ai custom connectors (Settings → Connectors) require OAuth, which ships in a follow-up release — use the header-based setup above in the meantime.

Prefer running it locally? Every stdio option below works exactly as before.

### npm

```bash
npm install -g socialcrawl-mcp
```

Available on [npm](https://www.npmjs.com/package/socialcrawl-mcp). Most users don't need this — the MCP client configs below use `npx` and auto-install on first run.

### Claude Code (quickest)

```bash
claude mcp add --scope user socialcrawl -- npx -y socialcrawl-mcp
```

Then set your API key:

```bash
claude mcp add-env socialcrawl SOCIALCRAWL_API_KEY sc_your_key_here
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

Add to `.cursor/mcp.json` in your project root or `~/.cursor/mcp.json` globally:

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

### Windsurf

Add to your Windsurf MCP configuration:

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

### Other MCP-compatible clients

Any MCP client that supports stdio transport can use this server. The general pattern is:

- **Command:** `npx`
- **Args:** `["-y", "socialcrawl-mcp"]`
- **Environment:** `SOCIALCRAWL_API_KEY` set to your API key

Restart your AI client after saving the configuration.

## Setup

### 1. Get your API key

Sign up at [socialcrawl.dev](https://socialcrawl.dev) and grab your API key from the dashboard. Every account starts with **100 free credits** — no credit card required.

### 2. Add the key to your config

Replace `sc_your_key_here` in the installation config above with your actual API key (starts with `sc_`).

> [!TIP]
> You can also set `SOCIALCRAWL_API_KEY` as a system environment variable instead of putting it in the MCP config. The discovery and documentation tools work even without a key — only actual API requests need one.

## Usage

Ask your AI agent in natural language. The MCP server handles the rest.

### Fetch a profile

```
Get the TikTok profile for @charlidamelio
```

The agent calls `socialcrawl_request` with `platform: "tiktok"`, `resource: "profile"`, `params: { handle: "charlidamelio" }` and returns structured profile data including followers, bio, verification status, and engagement metrics.

### Search across platforms

```
Search YouTube for "machine learning tutorials"
```

### Get post comments

```
Get the comments on this Instagram post: https://instagram.com/p/CwA1234abcd
```

### Cross-platform research

```
Compare the follower counts of @mkbhd on TikTok, Instagram, YouTube, and Twitter
```

The agent makes 4 sequential API calls — one per platform — and compiles the results into a comparison.

### Shop across retailers

```
Find the cheapest 65-inch OLED TV across Amazon, Walmart, Target, and eBay
```

### Explore available endpoints

```
What social media platforms can you access?
```

```
Show me all the TikTok endpoints
```

```
Which endpoints can give me video transcripts?
```

The last one is a cross-platform `socialcrawl_list_endpoints` search — no platform needed, it looks across all 575 endpoints.

### Learn the API from the API

```
How do I get started with SocialCrawl?
```

```
Show me exactly how to call the Prism comments endpoint
```

```
Is this MCP server's endpoint list up to date?
```

All three hit `socialcrawl_discover` and cost nothing.

### Check what something costs before running it

```
What would it cost to run a Prism brand-mentions report?
```

```
Show me everything I can call for 1 credit
```

```
Why did that last call charge me 7 credits instead of 2?
```

The first two hit `socialcrawl_pricing`; the third reads the credit ledger via `socialcrawl_check_balance` with `view: "transactions"` and shows the deduction and refund rows for that `request_id`.

### Access documentation

```
How does the SocialCrawl credit system work?
```

```
How do I page through a list endpoint?
```

### Example response

Every response follows a unified envelope format:

```json
{
  "success": true,
  "platform": "tiktok",
  "endpoint": "/v1/tiktok/profile",
  "data": {
    "content": { "text": "...", "media_urls": ["..."] },
    "author": { "username": "charlidamelio", "followers": 156000000 },
    "engagement": { "likes": 5200, "engagement_rate": 0.045 },
    "metadata": { "language": "en", "content_category": "entertainment" }
  },
  "credits_used": 1,
  "credits_remaining": 99
}
```

> [!NOTE]
> The same response structure is returned for every platform — no per-platform parsing logic needed.

## Available Tools

The MCP server exposes 10 tools:

| Tool | Description | Needs API key? |
|------|-------------|----------------|
| `socialcrawl_list_platforms` | Discover all 65 platforms, grouped by category, with endpoint counts and per-platform credit ranges | No |
| `socialcrawl_list_endpoints` | Endpoints with their full parameter contract — types, integer ranges, enum values, parameter couplings, CSV limits, pagination style, cache TTL, and pricing. Pass a `platform`, or a `search` term to find an endpoint across all 575. Filter by `method` and `maxCost` | No |
| `socialcrawl_pricing` | Exact credit cost for every endpoint: the tier ladder, every flat override, all metered bands with their charging rules and price-driving parameters, per-platform cost tables, budget-filtered rankings (`maxCost`, `model`, `sort`), the full `include=` row-join catalogue, and an exact upfront quote for a call you describe | No |
| `socialcrawl_request` | Make any SocialCrawl API call — profiles, posts, comments, search, trends, analytics, Prism composites. GET endpoints take query `params`; POST batch endpoints (e.g. youtube/videos, prism/profiles) take their array/object `body`. Supports an optional `idempotencyKey` for retry-safe calls | Yes |
| `socialcrawl_check_balance` | Credit balance and recent deductions, or the itemised ledger (`view: "transactions"`) — every deduction and refund keyed by `request_id`. Calls `/v1/credits/{balance,transactions}` — costs 0 credits | Yes |
| `socialcrawl_monitors` | Create and manage stateful monitors that re-run any recipe on a cadence, deliver results to a signed webhook, and accumulate a time-series. Actions: create, list, get, runs, timeseries, pause, resume, delete | Yes |
| `socialcrawl_web` | Full web scraping & browser automation (the `web` platform). Sync scrape/search/map/extract; async crawl/batch_scrape/agent jobs with poll/cancel/errors; free crawl parameter preview; stateful monitors; interactive browser sessions. One `action` per endpoint | Yes |
| `socialcrawl_cohorts` | Audience-filtered mention search (`/v1/cohorts/*`) — upload up to 10,000 public identities you already care about, then ask which of *them* posted your keywords. Actions: create, add_members, estimate_cost (local, free), query, query_status, query_results, query_cancel, get, delete. Everything but the query is 0 credits | Yes |
| `socialcrawl_discover` | The API describing itself, live, at 0 credits (`/v1/utility/*`) — quickstart, the full endpoint catalogue with live metered-aware prices, one endpoint's complete usage guide, the agent context corpus, a freshness check that tells you whether this server's bundled catalogue has fallen behind the API, and every platform's live circuit-breaker `status` | Optional |
| `socialcrawl_get_docs` | API documentation by topic or platform — overview, authentication, credits, pricing, errors, idempotency, pagination, caching, response-schema, limits, monitors, cohorts, discovery, or any platform slug. Long topics are paged, never truncated | No |

Four of the ten tools work without an API key — they query local bundled data generated from the backend registry. `socialcrawl_request`, `socialcrawl_check_balance`, `socialcrawl_monitors`, `socialcrawl_web`, and `socialcrawl_cohorts` require a key. `socialcrawl_discover` uses a key when it has one and falls back to bundled data when it does not (its `status` action needs no key at all).

### Discovery — the API describing itself, for free

`socialcrawl_discover` drives the **`/v1/utility/*`** family: four endpoints that let any client learn the whole API from inside the API, at **0 credits**. They are served in-process from the endpoint registry — no upstream call, no network hop — so they can never drift from what is actually callable.

| Action | Endpoint | What you get |
|--------|----------|--------------|
| `quickstart` | `/v1/utility/quickstart` | Auth, base URL, a runnable first call, the success and error envelopes, the billing model, the **full error taxonomy**, rate limits, and the paging contract — in one response |
| `catalog` | `/v1/utility/endpoints` | Every endpoint with its live metered-aware price label, required and optional params, `oneOf` groups, and paging flag. Filter by `platform` / `search` / `method` |
| `endpoint` | `/v1/utility/endpoint` | One endpoint's complete usage guide — every parameter with type and example, the exact pricing rule, cache TTL, paging recipe, an example response, a copy-paste curl, and related endpoints |
| `llms` | `/v1/utility/llms` | The agent context corpus for the whole API or one platform, as markdown or JSON — bootstrap an agent in one call instead of crawling docs |
| `freshness` | — | Compare the live registry against this server's bundled catalogue |

**Why `freshness` matters.** This server ships a catalogue generated when it was built; the API keeps moving. Data calls always hit the live API and keep working — but discovery, pricing, and local validation answer from that snapshot, so a newly added endpoint looks unknown until you upgrade. One free call tells you which situation you are in:

```
socialcrawl_discover  action: "freshness"
```

**Bundled vs live.** `list_platforms`, `list_endpoints`, `pricing`, and `get_docs` answer instantly from bundled data and need no key — prefer them for browsing. Reach for `socialcrawl_discover` when correctness matters more than latency: an endpoint looks missing, you need a metered endpoint's exact live price, or you are generating code that must match production today. Without a key it still answers everything except `llms` from bundled data, so discovery never hard-requires auth.

These same endpoints are plain HTTP, so a third-party integration or a non-MCP agent framework gets the identical information with a `curl`.

### Pricing — know the cost before you spend

`socialcrawl_pricing` exists because a single number is a lie for most of the surface. SocialCrawl bills three ways:

- **Ladder** (443 endpoints) — the tier rate per request: standard 1cr, advanced 5cr, premium 10cr.
- **Flat** (61 endpoints, 18 of them free) — a per-endpoint override, e.g. `/v1/search/everywhere` at 20cr flat.
- **Metered** (71 endpoints) — the charge depends on the request. An upfront ceiling is deducted and refunded down to the work actually done.

Quoting a metered endpoint's base cost understates every call: `/v1/search/news` has a 1cr base but really charges **2–62cr** — one credit per Google country leg that returns articles, plus per-article billing when the bing engine is added. The tool returns the real band, the registry's own charging rule, the parameters that move the bill, and the worst case to budget for:

```
action: "overview"   → ladder, every free endpoint, every flat override, every metered band + rule, cache TTLs, full refund matrix
action: "endpoint"   → one endpoint's price, rule, price-driving params, paging cost, worst case
action: "platform"   → a whole platform's cost table
action: "list"       → rank/filter by cost — "everything I can call for 1 credit", "the 10 most expensive endpoints"
action: "hydration"  → every include= row join: what it fills, per-row rate, row cap, fully-joined ceiling
```

Pass the `include` you intend to send to `action: "endpoint"` and the band becomes arithmetic — the exact hold, itemised per join, using the same formula the backend's pricer runs:

```
action: "endpoint", platform: "linkedin", resource: "search/people", include: "profile", rows: 3
→ holds 22 credits (10cr page + 12cr for 3 rows of `profile`), settling anywhere down to 10
```

It also states the rules that make the real charge differ from the sticker price: cache hits, idempotent replays, empty results, and upstream failures are all 0 credits.

### Row hydration — one call instead of a page plus a lookup per row

Some lists are thin because the upstream publishes nothing else on them: a Pinterest search result has no save count, a LinkedIn reactor row no follower count, a YouTube playlist no view counts or durations. Another SocialCrawl endpoint answers each of those for one row — so 28 endpoints now accept an `include=` token that joins every row to that sibling in the same call.

```
GET /v1/pinterest/search?query=kitchen&include=engagement      → saves, likes, comments, shares on every row
GET /v1/youtube/playlist?playlistId=PL...&include=engagement,channel
GET /v1/linkedin/search/people?keywords=cto&include=profile&limit=3
```

- **Opt-in.** No token, no join, no extra credit, no extra latency — a caller who never asks pays exactly what they always paid.
- **Billed per row actually filled.** The ceiling is held up front; a credit is kept only for a row a fresh sibling lookup filled. Rows served from the sibling's cache are free, unfillable rows are refunded, and a page that joined in full is cached whole, so an immediate repeat is 0 credits.
- **A row cap caps the bill.** `limit=3&include=profile` on LinkedIn holds 22 credits, not 50.
- **It tells you what it did.** `data.hydration` reports rows, lookups, cache hits, credits held vs kept, and milliseconds; `_warnings` carries `<token>_partial` when only some rows filled.

`socialcrawl_pricing` with `action: "hydration"` lists every join and its price; `socialcrawl_list_endpoints` with `hydrating: true` finds the endpoints that offer one; `socialcrawl_get_docs` topic `hydration` is the full contract.

### Monitors — schedule any recipe

`socialcrawl_monitors` wraps any registry endpoint or Prism composite in a scheduled, stateful monitor (`/v1/monitors/*`). It re-runs the recipe hourly/daily/weekly (or on a cron), delivers each result to an HMAC-signed webhook, raises alerts on metric thresholds or changes, and keeps a per-run time-series you can read back. *"Prism answers once; monitors watch it for you."* Managing monitors costs 0 credits; each scheduled run bills the recipe's normal cost plus a 1-credit scheduling premium. See `socialcrawl_get_docs` topic `monitors` for the full contract.

### Web — scrape, crawl, browse

`socialcrawl_web` drives the full web-scraping and browser-automation surface (the `web` platform, `/v1/web/*`) through a single `action` parameter:

- **Sync reads** — `scrape` (URL → markdown/HTML/screenshot/links), `search` (web search with page content), `map` (discover a site's URLs), `extract` (LLM structured data from a page).
- **Async jobs** — `crawl` a whole site, `batch_scrape` many URLs, or `agent` (autonomous multi-step web task); each returns a job you poll with `job_get`/`job_list`, inspect with `job_errors` (per-page failures), and stop with `job_cancel`. `crawl_preview` dry-runs a crawl's parameters for free before you pay for it.
- **Monitors** — `monitor_create`/`list`/`get`/`update`/`delete`/`checks` re-check a URL on a cadence and deliver changes to a webhook.
- **Sessions** — `session_create`/`get`/`list`, `session_execute` (run code in the live page), `session_close`.

Most of the paid web surface is metered rather than flat: a crawl holds `limit` credits and refunds every page it did not crawl; a session holds against `ttl_seconds` and settles on close. Job, monitor, and session management is 0 credits. See `socialcrawl_get_docs` topic `web`, or `socialcrawl_pricing` with `platform: "web"`.

### Smart validation

Before making any API call, `socialcrawl_request` mirrors the backend's own pre-billing validator against the bundled registry data: the platform and resource exist, required parameters and `oneOf` groups are satisfied, enum values are legal, integers sit inside their declared range, parameter couplings hold (`order` needs `sort`; Reddit's `timeframe` needs `sort=top`), and CSV lists are within their entry limits. A malformed call fails instantly and for free instead of costing a round trip — and an agent gets told exactly what to fix rather than looping on a call that can never succeed.

### Retry-safe requests

Pass an `idempotencyKey` to `socialcrawl_request` (UUIDv4 recommended) to make the call retry-safe. If the request is replayed within 24h, the server returns the original response and deducts **0 credits** (`X-Idempotent-Replay: true`).

## Supported Platforms

| Platform | Endpoints | Data Available |
|----------|-----------|----------------|
| **LinkedIn** | 45 | Profiles & company pages, posts, reposts, reactions, comments & replies, people/company-people search, profile sub-resources (experience, education, skills, certifications…), the complete post-history archive walk (metered per post), jobs (search, company jobs, details), company insights, groups, transcripts, Ad Library, profile-360 |
| **Instagram** | 37 | Profiles, account transparency (profile/about), posts, reels, comments & comment replies, highlights, stories, tagged & location feeds, followers/following, similar accounts, post likers, reshare stats, one-call reels/posts feeds with share counts, engagement analytics, universal + popular-post search, reels/hashtag/profile/location/music search, trending, transcripts, profile-360 |
| **TikTok** | 36 | Profiles, videos, comments & replies, on-screen text extraction, keyword/hashtag/user/music search + suggestions, hashtag details, trending (global or in-country For You), TikTok's own popular-hashtag and Top Videos boards, audience, followers, liked videos, playlists & collections, place feeds, effects, live, songs, transcripts, Ad Library, profile-360 |
| **Prism** | 33 | Cross-platform composites — URL lookup, comment harvesting, batch comment/profile lookup, handle-audit, brand mentions, demand signals, AI visibility, crisis radar/post-mortem, reputation, share-of-voice, creator vetting & creator cards, org radar, Korea gap, AI consensus answers, video/app/product intelligence |
| **YouTube** | 29 | Channels, videos, shorts, comments & replies, sponsors, playlists & items, community posts, search (advanced + autocomplete), trending, live streams, channel contact email lookup, media files (audio/video/subtitles/thumbnails), transcripts, batch videos/channels/transcripts, profile-360 |
| **Facebook** | 24 | Pages, groups & group posts, posts, comments, photos, reels (incl. full reels feed with view counts), events, Marketplace, transcripts, full Ad Library |
| **Web Scraping** | 22 | Scrape, web search, site map, LLM extract, async crawl/batch-scrape/agent jobs with per-page error feeds, change monitors, interactive browser sessions, document parse — driven by `socialcrawl_web` |
| **US Congress Trades** | 19 | US Congress STOCK Act disclosures — trade feeds (all/48h/7d), members, per-politician and per-ticker stats and trades, state delegations, and the full statistics suite (party, sectors, issuers, volume, unusual activity, buy/sell ratio, late filings) |
| **Klarna** | 18 | Product details and every merchant offer, keyword search + suggestions, user and professional reviews with score overviews, price history, product comparison, category browsing with filters/keywords/buying guides, store listings |
| **Tripadvisor** | 16 | Hotels, restaurants, attractions and cruise ships — search and full detail for each, traveler reviews with owner replies, place lookup by URL, destination autocomplete, experience types |
| **Twitter/X** | 15 | Profiles, tweets and replies, tweet & user search, user media, followers, following, retweeters, communities, video transcripts, AI search via Grok, profile-360 |
| **Naver** | 14 | Korea's #1 portal — blog, news, encyclopedia, cafe, KiN, local, image, web search, errata & adult classifiers, Data Lab search-trend & shopping-insight series, brief |
| **Reddit** | 14 | Subreddits, post detail, comments, user profiles with post and comment history, keyword/comment/media search, subreddit discovery, transcripts, omni-search VoC sweep |
| **GitHub** | 12 | Users, repos, issues, PRs, READMEs, releases, search, repo dossier, user profile-velocity |
| **Gumtree** | 11 | UK classifieds — listing search and details, similar listings, seller profiles and their ads, search suggestions, trending searches, category tree with filters, location lookup |
| **Jobs** | 11 | Job search and listing detail across LinkedIn, Indeed, Bing and Xing, LinkedIn organization-id resolution, and salary ranges by title and country |
| **Sephora** | 11 | Product details, reviews, keyword search + suggestions, category tree browsing, brand listings and per-brand products, store lookup, per-SKU in-store availability |
| **Content Analysis** | 10 | Cross-web brand mentions, sentiment, rating distributions, phrase/category trends |
| **Google** | 10 | Web search, Ads Transparency, Business Profile (info, reviews, updates, Q&A), Travel hotels |
| **AliExpress** | 9 | Product details, keyword search, similar products, reviews, per-SKU shipping, hot products, featured promotions, category tree |
| **Apple App Store** | 9 | App search, search suggestions, app details, reviews, charts, listings database, reference data |
| **Google Play** | 9 | App search, search suggestions, app details, reviews, charts, listings database, reference data |
| **Amazon** | 8 | Product search, ASIN details, reviews, sellers, shop pages, Best Sellers charts, current deals, seller profiles — ~13 marketplaces |
| **Douyin** | 8 | China's TikTok — video search, creator profiles and feeds, video detail, comments and comment replies, creator search, hot-search board (mostly metered per row) |
| **Finance** | 7 | Instrument quotes, ticker search, markets overview, instrument news, daily price history, company financial statements, options chains |
| **G2** | 7 | Software marketplace — product pages, reviews, category listings and the category index, vendor profiles and their catalogue, product URL index |
| **Quora** | 7 | Question search and detail, answer search, Space post search, profile search, Space/topic search |
| **H&M** | 6 | Keyword search + suggestions, store listings by country, countries/languages, category tree, per-product supplier and factory disclosure |
| **Spotify** | 6 | Artists, tracks, albums, podcasts, episodes, search |
| **Threads** | 6 | Profiles, posts, post comments, keyword search, user search |
| **Google Shopping** | 5 | Product search, product details, price history, cross-retailer reviews, per-seller offers |
| **Kohl's** | 5 | Keyword search, reviews, product questions and answers, store lookup, category tree |
| **Pinterest** | 5 | Pins, boards, search, URL save-counts |
| **Rumble** | 5 | Search, channel videos, video details, comments, transcripts |
| **Target** | 5 | Product details by TCIN, reviews, category browsing, full taxonomy, store lookup |
| **TikTok Shop** | 5 | Products, reviews, listings, search, creator showcases |
| **Walmart** | 5 | Product details, reviews, keyword search, category browsing, seller offers |
| **Yelp** | 5 | Business profiles by encid, business reviews, business search (compact and full-card), search suggestions |
| **Apple Music** | 4 | Catalog search, artist, album, track |
| **Etsy** | 4 | Listings by id or URL, a shop's catalogue, similar listings, search suggestions |
| **Hacker News** | 4 | Story search, story, comment tree, profile |
| **Home Depot** | 4 | Keyword search, product details by item id or URL (store/zip-aware pricing), reviews, store lookup by ZIP |
| **Tavily** | 4 | Web search (with LLM answer), URL extraction, sitemap, full crawl |
| **Twitch** | 4 | Profiles, clips, videos, schedules |
| **Universal Search** | 4 | One query fanned out across 14 platforms (20cr flat); forums lane; multi-country news lane (metered); creator-discovery lane across TikTok/Threads/Instagram |
| **Utility** | 4 | Free API self-discovery — quickstart, endpoint catalogue, per-endpoint usage guide, LLM context payload. 0 credits, served from the live registry. Driven by `socialcrawl_discover` |
| **Bluesky** | 3 | Profiles, posts |
| **Kwai** | 3 | Profiles, posts |
| **Telegram** | 3 | Public channel profiles, channel post feeds, single post lookup |
| **Truth Social** | 3 | Profiles, posts |
| **Wayfair** | 3 | Product search, product details by SKU, reviews |
| **eBay** | 2 | Listing search incl. sold/completed with realised prices, listing details |
| **Google Trends** | 3 | Interest-over-time (explore), rising/breakout related queries, and Trending Now by location |
| **Snapchat** | 2 | Profiles, Spotlight comments |
| **Trustpilot** | 2 | Business search, company reviews |
| **Google News** | 1 | Real-time Google News SERP search |
| **Kick** | 1 | Clips |
| **Komi** | 1 | Link pages |
| **LinkBio** | 1 | Link pages |
| **LinkMe** | 1 | Link pages |
| **Linktree** | 1 | Link pages |
| **On-Page** | 1 | Single-URL on-page SEO audit — the technical, content and meta checks in one call |
| **Perplexity** | 1 | Sonar web research with cited sources |
| **Pillar** | 1 | Link pages |
| **Polymarket** | 1 | Prediction-market research — multi-query fan-out + ranking |

**Total: 575 endpoints across 65 platforms.**

## Error Handling

The MCP server handles errors gracefully and gives the agent actionable guidance. Every API error passes the server's own `error.message` through, followed by `reason: …` when the API names one and `request_id: req-…` on its own line (read from the body, or the `X-Request-Id` header when the body is not JSON). Quote the `request_id` when you report a problem: it is how a call is found in the logs and the credit ledger.

| Error | What the agent sees |
|-------|---------------------|
| Missing API key | Prompts to set `SOCIALCRAWL_API_KEY` with link to sign up |
| Invalid API key | Asks to check the key configuration |
| Insufficient credits | Shows balance and links to billing page |
| Bad platform/resource | Suggests using discovery tools to find the right endpoint |
| Missing parameters | Lists exactly what's missing with examples — caught locally, before billing |
| Invalid parameter value | Names the illegal enum value, out-of-range integer, broken coupling, or over-long CSV — caught locally, before billing |
| Resource not found (404) | The server's reason the item is missing (e.g. `reason: video_gone`) and whether you were charged (BIL-01) |
| Idempotency-Key conflict (409) | Tells the agent the key was used by another account — generate a fresh one |
| Idempotency-Key payload mismatch (422) | Tells the agent the same key was reused with different params |
| Method not allowed (405) | Reports the wrong HTTP method for that route |
| Payload too large (413) | Request body over the JSON size cap; rejected before parse |
| Rate limited (429) | Over the 600 req/min per-key window — unbilled; back off and retry |
| Concurrency limit (429) | Asks the caller to back off (50 concurrent/key max) |
| Key budget exceeded (402) | This key's own spend cap is spent while the account still has credits — raise the cap, don't top up |
| Upstream error (502) | The server's account of which platform failed, the refund, and when to retry |
| Platform unavailable (503) | The server's cause (circuit breaker open or upstream throttling) and retry hint; credits refunded |

## Links

- [Get Your API Key](https://socialcrawl.dev/dashboard) — 100 free credits, no credit card required
- [API Documentation](https://socialcrawl.dev/docs) — full endpoint reference, credits, and error codes
- [SocialCrawl Website](https://socialcrawl.dev)
- [npm Package](https://www.npmjs.com/package/socialcrawl-mcp)
- [MCP Registry](https://registry.modelcontextprotocol.io)
- [Getting Started Guide](docs/GETTING-STARTED.md)
- [How It Works](docs/HOW-IT-WORKS.md)
